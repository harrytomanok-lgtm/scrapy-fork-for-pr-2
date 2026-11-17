/**
 * The actors service (ARCHITECTURE 4.5, 8.4): one merged rigid-skinned mesh per character with a per-actor palette
 * material, and the animator. Every frame (phase `anim`) each actor's pose is built in layers, all in preallocated
 * Float32Arrays: procedural locomotion (cycles from the pose library blended by speed and synced by stride phase,
 * with mode cross-fades), state clips (guard, gather, stagger, down, death), the full and upper clip slots with
 * cross-fades, then additive touches: lean and bank, look-at, flinch springs, spring-bone chains (sash, hair,
 * tails), face expressions (brow and jaw bones) and Form animation (seam pulse, prism cycling, blade bob).
 * Animation LOD: the nearest `caps.animatedActors` actors (and the player) pose every frame; the rest every third.
 * @module actors/service
 */

import { Bone, Skeleton, SkinnedMesh, Mesh, BufferGeometry, BufferAttribute, Vector3, Color } from 'three';
import { PALETTE } from '../core/palette.js';
import { clamp, angleDelta } from '../core/math.js';
import { buildRig, geometryFor, SOCKET_NAMES } from './builder.js';
import { resolveClip, sampleClip, rigPoseSize } from './logic/clips.js';
import { blendPose, POSE_EXTRA } from './logic/poses.js';

const OWNER = 'actors';
const TWO_PI = Math.PI * 2;

/** Locomotion tables per family: [clip id, speed anchor m/s (scaled by size), stride m per cycle or 0 (time-driven)]. */
const LOCO = {
  humanoid: {
    ground: [['idle', 0, 0], ['walk', 1.7, 1.55], ['run', 5.2, 2.9], ['sprint', 9.5, 3.9]],
    hover: [['fly_hover', 0, 0], ['fly_cruise', 6, 0]],
    fly: [['fly_hover', 0, 0], ['fly_cruise', 9, 0], ['fly_boost', 24, 0]],
    swim: [['swim', 0, 0]], air: [['fall', 0, 0]], hurtle: [['hurtle', 0, 0]],
  },
  quadruped: {
    ground: [['idle', 0, 0], ['walk', 1.6, 1.5], ['run', 6, 3.2]],
    hover: [['idle', 0, 0]], fly: [['fly_cruise', 0, 0]], swim: [['walk', 0, 1.5]], air: [['fall', 0, 0]], hurtle: [['hurtle', 0, 0]],
  },
  flyer: {
    ground: [['walk', 0, 0], ['fly_hover', 1.5, 0], ['fly_cruise', 8, 0]],
    hover: [['fly_hover', 0, 0], ['fly_cruise', 8, 0]], fly: [['fly_hover', 0, 0], ['fly_cruise', 8, 0], ['fly_boost', 22, 0]],
    swim: [['fly_hover', 0, 0]], air: [['fall', 0, 0]], hurtle: [['hurtle', 0, 0]],
  },
  blob: {
    ground: [['idle', 0, 0], ['walk', 2, 0], ['run', 7, 0]], hover: [['idle', 0, 0], ['walk', 2, 0]],
    fly: [['fly_hover', 0, 0], ['fly_cruise', 7, 0]], swim: [['idle', 0, 0]], air: [['fall', 0, 0]], hurtle: [['hurtle', 0, 0]],
  },
};

/** Expressions: browL xyz, browR xyz, jaw xyz (4.5 setExpression). */
const EXPR = {
  neutral: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  angry: [0.1, 0, 0.38, 0.1, 0, -0.38, 0.02, 0, 0],
  shout: [0.1, 0, 0.42, 0.1, 0, -0.42, 0.42, 0, 0],
  hurt: [-0.1, 0, -0.38, -0.1, 0, 0.38, 0.14, 0, 0],
  happy: [-0.25, 0, -0.1, -0.25, 0, 0.1, 0.12, 0, 0],
  ko: [0.2, 0, -0.2, 0.2, 0, 0.2, 0.22, 0, 0],
};

const FORM_COLOUR = { ember: PALETTE.ember, tempest: PALETTE.tempest, zenith: PALETTE.zenith };
const PRISM = [PALETTE.ora, PALETTE.tempest, PALETTE.ember];

/**
 * @typedef {{ clip:any, t:number, speed:number, loop:boolean, hold:boolean, w:number, fadeIn:number, fadeOut:number, xf:number,
 *   stopping:boolean, from:Float32Array, out:Float32Array, id:string }} Slot
 */

/** @param {number} n @returns {Slot} */
function makeSlot(n) {
  return { clip: null, t: 0, speed: 1, loop: false, hold: false, w: 0, fadeIn: 0.08, fadeOut: 0.12, xf: 1, stopping: false, from: new Float32Array(n), out: new Float32Array(n), id: '' };
}

/**
 * Create the service.
 * @param {any} ctx
 */
export function createActors(ctx) {
  /** @type {Map<string, any>} */
  const rigs = new Map();
  /** @type {any[]} */
  const records = [];
  /** @type {Set<string>} */
  const warned = new Set();
  const stepPayload = { entId: 0, surface: 'grass' };
  const P = new Vector3();
  const V = new Vector3();
  const colA = new Color();
  const colB = new Color();
  /** @type {{ mesh:any, geo:any, cap:number, used:boolean }[]} */
  const snapPool = [];
  let lastNow = -1;
  let frameNo = 0;
  const stats = { posed: 0, reduced: 0 };

  /** @param {string} tag @param {...any} a */
  function warnOnce(tag, ...a) {
    if (warned.has(tag)) return;
    warned.add(tag);
    ctx.log.warn('actors', tag, ...a);
  }

  /** @param {string} specId */
  function rigFor(specId) {
    let r = rigs.get(specId);
    if (!r) {
      let spec = ctx.defs ? ctx.defs.find('actorSpec', specId) : null;
      if (!spec) {
        warnOnce('missing spec ' + specId);
        spec = ctx.defs ? ctx.defs.find('actorSpec', 'npc_villager_1') : null;
      }
      if (!spec) return null;
      r = buildRig(spec, (m) => warnOnce(m));
      rigs.set(specId, r);
    }
    return r;
  }

  /** @param {any} ent @returns {any} the record when `ent` has an actors visual */
  function rec(ent) {
    if (!ent || !ent.visual || !ent.visual.actorsRecord) return null;
    return ent.visual;
  }

  /** Recompute the palette and emissive uniforms: spec, then Form, then gear overrides. @param {any} r */
  function applyPalette(r) {
    const rig = r.rig;
    const spec = rig.spec;
    const pal = r.mat.uniforms.uPalette.value;
    const form = r.formKey && spec.forms ? spec.forms[r.formKey] || null : null;
    for (let i = 0; i < 16; i++) {
      const name = rig.slots[i];
      let hex = name !== undefined ? spec.palette[name] : PALETTE.paper;
      let e = name !== undefined && spec.emissive && typeof spec.emissive[name] === 'number' ? spec.emissive[name] : 0;
      if (name !== undefined && form && form.palette && typeof form.palette[name] === 'number') hex = form.palette[name];
      if (name !== undefined && form && form.emissive && typeof form.emissive[name] === 'number') e = form.emissive[name];
      if (name !== undefined && r.overrides && typeof r.overrides[name] === 'number') hex = r.overrides[name];
      pal[i].setHex(hex);
      r.emisBase[i] = e;
      r.mat.uniforms.uEmissive.value[i] = e;
    }
  }

  /** @param {any} r */
  function destroyRecord(r) {
    const i = records.indexOf(r);
    if (i >= 0) records.splice(i, 1);
    const render = ctx.render;
    if (render) {
      if (render.outline) render.outline.remove(r.mesh);
      if (render.blob) render.blob.remove(r.entId);
    }
    if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
    r.mat.dispose();
    r.skeleton.dispose();
    if (r.ent.visual === r && r.ent.id === r.entId) r.ent.visual = null;
  }

  /** Point the outline hull at the mesh's current geometry and culling sphere. @param {any} r */
  function addOutline(r) {
    const render = ctx.render;
    if (!render || !render.outline || !r.rig.spec.outline) return;
    render.outline.add(r.mesh, { widthPx: 2 });
    for (let i = 0; i < r.mesh.children.length; i++) {
      const c = r.mesh.children[i];
      if (c.isSkinnedMesh) c.boundingSphere = r.mesh.boundingSphere;
    }
  }

  /**
   * Start a clip in a slot with a cross-fade from the slot's (or the composite's) current pose.
   * @param {any} r @param {Slot} s @param {any} clip @param {string} id @param {any} o
   */
  function startSlot(r, s, clip, id, o) {
    s.from.set(s.w > 0 ? s.out : r.final);
    s.clip = clip;
    s.id = id;
    s.t = 0;
    s.speed = o && o.speed > 0 ? o.speed : 1;
    s.loop = o && o.loop !== undefined ? !!o.loop : clip.loop;
    s.hold = !!(o && o.hold);
    s.fadeIn = o && typeof o.blend === 'number' ? Math.max(0, o.blend) : 0.08;
    s.xf = s.fadeIn > 0 ? 0 : 1;
    s.w = 1;
    s.stopping = false;
  }

  /** @param {any} r @param {string} clipId @param {any} [o] */
  function playInternal(r, clipId, o) {
    const res = resolveClip(r.rig.rig, clipId, r.rig.spec.clips || null);
    if (!res.clip) return;
    if (res.fallback) warnOnce('clip ' + clipId + ' missing for ' + r.rig.id + ', using ' + res.clip.id);
    const upper = o && o.layer ? o.layer === 'upper' : res.clip.upper;
    startSlot(r, upper ? r.upper : r.full, res.clip, clipId, o);
  }

  const actors = {
    /**
     * Build the visual for `ent` and set `ent.visual`, `ent.radius`, `ent.height`.
     * @param {any} ent @param {string} specId @param {{ formKey?:string|null, palette?:object|null }} [opts]
     */
    create(ent, specId, opts) {
      if (!ent || !ent.alive) return;
      if (rec(ent)) destroyRecord(ent.visual);
      const rig = rigFor(specId);
      if (!rig) return;
      ent.radius = rig.radius;
      ent.height = rig.height;
      const render = ctx.render;
      if (!render || !render.layers || !render.materials) return;
      const bones = [];
      for (let b = 0; b < rig.nb; b++) {
        const bone = new Bone();
        bone.position.set(rig.rest[b * 3], rig.rest[b * 3 + 1], rig.rest[b * 3 + 2]);
        if (rig.parent[b] >= 0) bones[rig.parent[b]].add(bone);
        bones.push(bone);
      }
      const o = opts || {};
      const formKey = o.formKey && rig.spec.forms && rig.spec.forms[o.formKey] ? o.formKey : null;
      const mat = render.materials.toonSkinned({ palette: true });
      const mesh = new SkinnedMesh(geometryFor(rig, formKey), mat);
      mesh.add(bones[0]);
      mesh.updateMatrixWorld(true);
      const skeleton = new Skeleton(bones);
      mesh.bind(skeleton);
      mesh.boundingSphere = rig.sphere;
      mesh.rotation.order = 'YXZ';
      mesh.name = 'actor:' + specId;
      render.layers.actors.add(mesh);
      const n = rigPoseSize(rig.rig);
      const r = {
        actorsRecord: true, ent, entId: ent.id, rig, mesh, mat, skeleton, bones, formKey, overrides: o.palette || null,
        emisBase: new Float32Array(16),
        final: new Float32Array(n), loco: new Float32Array(n), locoFrom: new Float32Array(n), tmpA: new Float32Array(n), tmpB: new Float32Array(n),
        full: makeSlot(n), upper: makeSlot(n), state: '', stateClip: '',
        phase: 0, time: 0, locoMode: '', modeXf: 1, speed: 0, airT: 0, lastY: ent.pos.y,
        yaw: ent.yaw, yawRate: 0, bank: 0, lean: 0, spin: 0,
        springA: new Float32Array(rig.springN * 2), springV: new Float32Array(rig.springN * 2),
        look: false, lookX: 0, lookY: 0, lookZ: 0, lookW: 0, lookYaw: 0, lookPitch: 0,
        flinchT: 10, flinchX: 0, flinchZ: 0,
        flashStart: -10, flashDur: 0.06, dissolveStart: -1, dissolveDur: 1, ghost: 1,
        expr: 'neutral', exprUntil: 0, exprCur: new Float32Array(9), dead: false, talkUntil: 0,
        accum: 0, visible: true, sashScale: 1, lift: 0,
      };
      ent.visual = r;
      records.push(r);
      applyPalette(r);
      if (formKey) actors.rimGlow(ent, FORM_COLOUR[formKey] || PALETTE.ora, 0.55);
      addOutline(r);
      if (render.blob) render.blob.add(ent.id, rig.radius);
      poseRecord(r, 0, 1, true);
      r.final.set(r.loco);
    },

    /** @param {any} ent */
    destroy(ent) {
      const r = rec(ent);
      if (r) destroyRecord(r);
    },

    /** @param {string} specId @returns {{ radius:number, height:number }} */
    bounds(specId) {
      const rig = rigFor(specId);
      return rig ? { radius: rig.radius, height: rig.height } : { radius: 0.45, height: 1.8 };
    },

    /**
     * @param {any} ent @param {string} clipId
     * @param {{ speed?:number, loop?:boolean, layer?:'full'|'upper', blend?:number, hold?:boolean }} [opts]
     */
    play(ent, clipId, opts) {
      const r = rec(ent);
      if (r) playInternal(r, clipId, opts);
    },

    /** @param {any} ent @param {'full'|'upper'} [layer] @param {number} [blend] */
    stop(ent, layer = 'full', blend = 0.12) {
      const r = rec(ent);
      if (!r) return;
      const s = layer === 'upper' ? r.upper : r.full;
      if (!s.clip) return;
      s.stopping = true;
      s.fadeOut = Math.max(0.001, blend);
    },

    /** @param {string} specId @param {string} clipId @returns {number} seconds of the clip that would play */
    clipSeconds(specId, clipId) {
      const rig = rigFor(specId);
      if (!rig) return 0.3;
      const res = resolveClip(rig.rig, clipId, rig.spec.clips || null);
      return res.clip ? res.clip.seconds : 0.3;
    },

    /** @param {any} ent @param {string|null} formKey */
    setForm(ent, formKey) {
      const r = rec(ent);
      if (!r) return;
      const spec = r.rig.spec;
      const key = formKey && spec.forms && spec.forms[formKey] ? formKey : null;
      if (key !== r.formKey) {
        const g = geometryFor(r.rig, key);
        if (g !== r.mesh.geometry) {
          const render = ctx.render;
          if (render && render.outline) render.outline.remove(r.mesh);
          r.mesh.geometry = g;
          addOutline(r);
        }
      }
      r.formKey = key;
      applyPalette(r);
      actors.rimGlow(ent, key ? FORM_COLOUR[key] : PALETTE.ora, key ? 0.55 : 0);
    },

    /** @param {any} ent @param {object|null} overrides */
    setPalette(ent, overrides) {
      const r = rec(ent);
      if (!r) return;
      r.overrides = overrides || null;
      applyPalette(r);
    },

    /** @param {any} ent @param {string} name */
    setExpression(ent, name) {
      const r = rec(ent);
      if (!r) return;
      r.expr = EXPR[name] ? name : 'neutral';
      r.exprUntil = 0;
    },

    /** @param {any} ent @param {number} x @param {number} y @param {number} z */
    lookAt(ent, x, y, z) {
      const r = rec(ent);
      if (!r) return;
      r.look = true; r.lookX = x; r.lookY = y; r.lookZ = z;
    },

    /** @param {any} ent */
    clearLook(ent) {
      const r = rec(ent);
      if (r) r.look = false;
    },

    /** @param {any} ent @param {number} dirX @param {number} dirZ @param {number} strength */
    flinch(ent, dirX, dirZ, strength) {
      const r = rec(ent);
      if (!r) return;
      const l = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      const k = clamp(strength, 0, 1);
      const sy = Math.sin(r.yaw);
      const cy = Math.cos(r.yaw);
      // push direction in the actor's frame: forward component leans the chest back, side component tilts it
      const fwd = (dirX * sy + dirZ * cy) / l;
      const side = (dirX * cy - dirZ * sy) / l;
      r.flinchX = fwd * 0.5 * k;
      r.flinchZ = -side * 0.4 * k;
      r.flinchT = 0;
    },

    /**
     * @param {any} ent @param {'handR'|'handL'|'chest'|'head'|'feet'|'back'} name @param {any} out Vector3
     * @returns {any}
     */
    socket(ent, name, out) {
      if (!ent) return out.set(0, 0, 0);
      const r = rec(ent);
      if (r) {
        const s = SOCKET_NAMES.indexOf(name);
        const b = s >= 0 ? r.rig.socketBone[s] : -1;
        if (b > 0 && name !== 'feet') {
          const o = r.rig.socketOff;
          return out.set(o[s * 3], o[s * 3 + 1], o[s * 3 + 2]).applyMatrix4(r.bones[b].matrixWorld);
        }
        if (name === 'feet') return out.copy(r.mesh.position);
      }
      const H = ent.height || 1.8;
      return out.set(ent.pos.x, ent.pos.y + (name === 'head' ? H * 0.92 : name === 'feet' ? 0.05 : H * 0.62), ent.pos.z);
    },

    /** @param {any} ent @param {boolean} visible */
    setVisible(ent, visible) {
      const r = rec(ent);
      if (r) r.mesh.visible = r.visible = !!visible;
    },

    /** @param {any} ent @param {number} alpha */
    setGhost(ent, alpha) {
      const r = rec(ent);
      if (!r) return;
      r.ghost = clamp(alpha, 0, 1);
      r.mat.uniforms.uGhost.value = r.ghost;
      const t = r.ghost < 1;
      if (r.mat.transparent !== t) {
        r.mat.transparent = t;
        r.mat.needsUpdate = true;
      }
    },

    /** @param {any} ent @param {number} seconds @param {number} [color] */
    dissolve(ent, seconds, color) {
      const r = rec(ent);
      if (!r) return;
      r.dissolveStart = ctx.time.real;
      r.dissolveDur = Math.max(0.05, seconds);
      if (typeof color === 'number') actors.rimGlow(ent, color, 1);
    },

    /** @param {any} ent @param {number} [seconds] */
    flash(ent, seconds = 0.06) {
      const r = rec(ent);
      if (!r) return;
      r.flashStart = ctx.time.real;
      r.flashDur = Math.max(0.016, seconds);
    },

    /**
     * Frozen-pose clone in world space (CPU-skinned once) for afterimages; return it with releaseSnapshot.
     * @param {any} ent @returns {any}
     */
    snapshot(ent) {
      const r = rec(ent);
      if (!r) return null;
      const src = r.mesh.geometry;
      const n = src.attributes.position.count;
      let slot = null;
      for (let i = 0; i < snapPool.length; i++) if (!snapPool[i].used && snapPool[i].cap >= n) { slot = snapPool[i]; break; }
      if (!slot) {
        if (snapPool.length >= 8) return null;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(n, 2048) * 3), 3));
        geo.setAttribute('normal', new BufferAttribute(new Float32Array(Math.max(n, 2048) * 3), 3));
        const mesh = new Mesh(geo, r.mat);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.name = 'actors.snapshot';
        slot = { mesh, geo, cap: Math.max(n, 2048), used: false };
        snapPool.push(slot);
      }
      slot.used = true;
      r.mesh.updateMatrixWorld(true);
      const pos = src.attributes.position.array;
      const nor = src.attributes.normal.array;
      const si = src.attributes.skinIndex.array;
      const out = slot.geo.attributes.position.array;
      const outN = slot.geo.attributes.normal.array;
      const bind = r.rig.rest;
      for (let v = 0; v < n; v++) {
        const b = si[v * 4];
        const e = r.bones[b].matrixWorld.elements;
        // bind position of bone b: sum of rest offsets up the chain
        let bx = 0; let by = 0; let bz = 0;
        for (let p = b; p >= 0; p = r.rig.parent[p]) { bx += bind[p * 3]; by += bind[p * 3 + 1]; bz += bind[p * 3 + 2]; }
        const x = pos[v * 3] - bx; const y = pos[v * 3 + 1] - by; const z = pos[v * 3 + 2] - bz;
        out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        out[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nx = nor[v * 3]; const ny = nor[v * 3 + 1]; const nz = nor[v * 3 + 2];
        outN[v * 3] = e[0] * nx + e[4] * ny + e[8] * nz;
        outN[v * 3 + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
        outN[v * 3 + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
      }
      slot.geo.attributes.position.needsUpdate = true;
      slot.geo.attributes.normal.needsUpdate = true;
      slot.geo.setIndex(src.index);
      slot.geo.setDrawRange(0, src.index.count);
      return slot.mesh;
    },

    /** @param {any} mesh a snapshot returned by snapshot() */
    releaseSnapshot(mesh) {
      for (let i = 0; i < snapPool.length; i++) {
        if (snapPool[i].mesh === mesh) {
          snapPool[i].used = false;
          if (mesh.parent) mesh.parent.remove(mesh);
        }
      }
    },

    /** @param {any} ent @param {number} color @param {number} strength */
    rimGlow(ent, color, strength) {
      const r = rec(ent);
      if (!r) return;
      r.mat.uniforms.uRimColor.value.setHex(color);
      r.mat.uniforms.uRimStrength.value = Math.max(0, strength);
    },

    /** Remove every visual and release the geometry cache. */
    dispose() {
      for (let i = records.length - 1; i >= 0; i--) destroyRecord(records[i]);
      for (const rig of rigs.values()) for (const g of rig.geos.values()) g.dispose();
      rigs.clear();
      for (const s of snapPool) {
        if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
        s.geo.dispose();
      }
      snapPool.length = 0;
    },

    /** Debug and scenario helpers (not part of 4.5). */
    debug: {
      records: () => records,
      rigOf: (specId) => rigFor(specId),
      stats,
      /** @returns {number} bone matrices with a NaN or infinite element */
      nanCount() {
        let bad = 0;
        for (const r of records) {
          for (const b of r.bones) {
            const e = b.matrixWorld.elements;
            for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) { bad++; break; }
          }
          const m = r.mesh.matrixWorld.elements;
          for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) { bad++; break; }
        }
        return bad;
      },
    },
  };

  // ------------------------------------------------------------------------------------------ animator

  /**
   * Locomotion target for the current movement into r.tmpA (weights by speed, cycles synced by stride phase).
   * @param {any} r @param {string} mode @param {number} s horizontal speed @param {number} dt
   */
  function locomotion(r, mode, s, dt) {
    const rig = r.rig;
    const table = LOCO[rig.fam][mode] || LOCO[rig.fam].ground;
    const k = rig.stride;
    let i = 0;
    while (i < table.length - 1 && s >= table[i + 1][1] * k) i++;
    const a = table[i];
    const b = i < table.length - 1 ? table[i + 1] : null;
    const w = b ? clamp((s - a[1] * k) / ((b[1] - a[1]) * k), 0, 1) : 0;
    const strideA = a[2] * k;
    const strideB = b ? b[2] * k : 0;
    const stride = b && strideB > 0 ? (strideA > 0 ? strideA + (strideB - strideA) * w : strideB) : strideA;
    if (stride > 0) {
      const before = r.phase;
      r.phase += (s * dt) / stride;
      if (mode === 'ground' && (rig.fam === 'humanoid' || rig.fam === 'quadruped') && s > 0.6 && Math.floor(before * 2) !== Math.floor(r.phase * 2)) footstep(r);
      r.phase -= Math.floor(r.phase);
    }
    sampleCycle(r, a, r.tmpA, s);
    if (b && w > 0) {
      sampleCycle(r, b, r.tmpB, s);
      blendPose(r.tmpA, r.tmpB, w, r.tmpA);
    }
  }

  /** @param {any} r @param {any[]} entry @param {Float32Array} out @param {number} s */
  function sampleCycle(r, entry, out, s) {
    const res = resolveClip(r.rig.rig, entry[0], r.rig.spec.clips || null);
    const clip = res.clip;
    if (!clip) return;
    // stride clips run by phase; time clips run by time (flight cycles speed up a little with speed)
    const t = entry[2] > 0 ? r.phase * clip.seconds : r.time * (1 + Math.min(s, 30) * 0.02);
    sampleClip(clip, t, out);
  }

  /** @param {any} r */
  function footstep(r) {
    const w = ctx.world;
    stepPayload.entId = r.entId;
    stepPayload.surface = w && w.surfaceAt ? w.surfaceAt(r.mesh.position.x, r.mesh.position.z) : 'grass';
    ctx.bus.emit('actor:step', stepPayload);
  }

  /**
   * Advance one clip slot and write its pose into s.out (cross-fade from s.from). Returns the slot weight.
   * @param {Slot} s @param {number} dt
   */
  function runSlot(s, dt) {
    if (!s.clip) return 0;
    s.t += dt * s.speed;
    const c = s.clip;
    if (!s.loop && s.t >= c.seconds && !s.hold && !s.stopping) {
      s.stopping = true;
      s.fadeOut = 0.12;
    }
    if (s.stopping) {
      s.w -= dt / Math.max(0.001, s.fadeOut);
      if (s.w <= 0) {
        s.w = 0;
        s.clip = null;
        s.id = '';
        return 0;
      }
    }
    sampleClip(c, s.loop ? s.t : Math.min(s.t, c.seconds), s.out);
    if (s.xf < 1) {
      s.xf = Math.min(1, s.xf + dt / Math.max(0.001, s.fadeIn));
      const e = s.xf * s.xf * (3 - 2 * s.xf);
      blendPose(s.from, s.out, e, s.out);
    }
    return s.w;
  }

  /** Combat state -> automatic clips (4.5: guard, gather, stagger, down, dead). @param {any} r @param {string} st */
  function stateChange(r, st) {
    const prev = r.state;
    r.state = st;
    const cur = r.full.clip ? r.full.id : '';
    if (prev === 'down' && st !== 'dead' && cur === 'down') playInternal(r, 'getup', null);
    else if ((prev === 'guard' || prev === 'gather' || prev === 'stagger') && cur === prev) actors.stop(r.ent, 'full', 0.14);
    if (st === 'guard' || st === 'gather') playInternal(r, st, { loop: true, blend: 0.08 });
    else if (st === 'stagger') { playInternal(r, 'stagger', { hold: true, blend: 0.04 }); r.expr = 'hurt'; r.exprUntil = r.time + 0.6; }
    else if (st === 'down') playInternal(r, 'down', { hold: true, blend: 0.06 });
    else if (st === 'dead') { playInternal(r, 'death', { hold: true, blend: 0.06 }); r.expr = 'ko'; r.exprUntil = 0; }
  }

  /**
   * Pose one actor.
   * @param {any} r @param {number} dt seconds of sim time @param {number} alpha @param {boolean} full false: reduced LOD (no springs)
   */
  function poseRecord(r, dt, alpha, full) {
    const ent = r.ent;
    const rig = r.rig;
    const nb = rig.nb;
    const bones = r.bones;
    r.time += dt;
    ctx.ents.renderPos(ent, alpha, P);
    const mv = ent.move;
    let mode = mv ? mv.mode : 'ground';
    const grounded = mv ? mv.grounded : true;
    const vx = ent.vel.x;
    const vz = ent.vel.z;
    const hs = Math.sqrt(vx * vx + vz * vz);
    const s = mv && typeof mv.speed === 'number' && mv.mode !== 'hurtle' ? Math.max(mv.speed, hs * 0.5) : hs;
    r.speed += (s - r.speed) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 1);
    const cs = r.dead ? 'dead' : ent.combat ? ent.combat.state : 'idle';
    if (cs !== r.state) stateChange(r, cs);

    // movement mode for locomotion
    let lm = mode;
    if (mode === 'ground' || mode === 'scripted') lm = grounded ? (rig.hover ? 'hover' : 'ground') : 'air';
    else if (mode === 'air') lm = rig.hover ? 'hover' : 'air';
    if (lm === 'air' && ent.vel.y > 1.5 && rig.fam === 'humanoid') lm = 'jump';
    if (!grounded) r.airT += dt;
    if (lm !== r.locoMode) {
      if (r.locoMode === 'air' && (lm === 'ground') && r.airT > 0.3 && !r.full.clip) playInternal(r, 'land', { blend: 0.03 });
      if (lm === 'ground' || lm === 'hover') r.airT = 0;
      r.locoFrom.set(r.loco);
      r.modeXf = r.locoMode === '' ? 1 : 0;
      r.locoMode = lm;
    }
    if (lm === 'jump') {
      const res = resolveClip(rig.rig, 'jump', null);
      if (res.clip) sampleClip(res.clip, Math.min(0.3, r.airT * 1.2), r.tmpA);
    } else {
      locomotion(r, lm, r.speed, dt);
    }
    if (r.modeXf < 1) {
      r.modeXf = Math.min(1, r.modeXf + dt / 0.18);
      const e = r.modeXf * r.modeXf * (3 - 2 * r.modeXf);
      blendPose(r.locoFrom, r.tmpA, e, r.loco);
    } else {
      r.loco.set(r.tmpA);
    }

    // clip slots
    const F = r.final;
    F.set(r.loco);
    const wf = runSlot(r.full, dt);
    if (wf > 0) blendPose(F, r.full.out, wf, F);
    if (r.talkUntil > 0 && r.time > r.talkUntil) {
      r.talkUntil = 0;
      if (r.upper.id === 'talk') actors.stop(ent, 'upper', 0.25);
    }
    const wu = runSlot(r.upper, dt);
    if (wu > 0) blendPose(F, r.upper.out, wu, F, rig.upper);

    // additive touches
    const yawDelta = angleDelta(r.yaw, ent.yaw);
    const turn = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
    r.yaw += yawDelta * turn;
    const rate = dt > 0 ? (yawDelta * turn) / dt : 0;
    r.yawRate += (rate - r.yawRate) * (dt > 0 ? 1 - Math.exp(-6 * dt) : 1);
    const hips = rig.hips;
    if (hips >= 0) {
      const flying = lm === 'fly';
      const bankT = clamp(-r.yawRate * (flying ? 0.12 : 0.04) * Math.min(1, r.speed / 6), flying ? -0.7 : -0.18, flying ? 0.7 : 0.18);
      r.bank += (bankT - r.bank) * (dt > 0 ? 1 - Math.exp(-6 * dt) : 1);
      F[hips * 3 + 2] += r.bank;
      if (lm === 'hurtle') {
        r.spin += dt * 13;
        F[hips * 3] += r.spin;
      } else {
        r.spin = 0;
      }
    }
    // flinch: quick rise, fast decay
    if (r.flinchT < 1 && rig.chest >= 0) {
      r.flinchT += dt;
      const f = r.flinchT < 0.04 ? r.flinchT / 0.04 : Math.exp(-(r.flinchT - 0.04) * 11);
      const c = rig.chest * 3;
      F[c] += r.flinchX * f;
      F[c + 2] += r.flinchZ * f;
      if (rig.spine >= 0) F[rig.spine * 3] += r.flinchX * f * 0.5;
      if (rig.head >= 0) F[rig.head * 3] += r.flinchX * f * 0.6;
    }
    // look-at: head and chest turn toward the target
    r.lookW += ((r.look ? 1 : 0) - r.lookW) * (dt > 0 ? 1 - Math.exp(-8 * dt) : 1);
    if (r.lookW > 0.001 && rig.head >= 0) {
      if (r.look) {
        const dx = r.lookX - P.x;
        const dz = r.lookZ - P.z;
        r.lookYaw = clamp(angleDelta(r.yaw, Math.atan2(dx, dz)), -1.2, 1.2);
        const d = Math.sqrt(dx * dx + dz * dz);
        r.lookPitch = clamp(-Math.atan2(r.lookY - (P.y + rig.height * 0.9), Math.max(0.5, d)), -0.6, 0.6);
      }
      F[rig.head * 3 + 1] += r.lookYaw * 0.6 * r.lookW;
      F[rig.head * 3] += r.lookPitch * 0.7 * r.lookW;
      if (rig.chest >= 0) F[rig.chest * 3 + 1] += r.lookYaw * 0.35 * r.lookW;
    }
    // face
    if (rig.face && rig.browL >= 0) {
      if (r.exprUntil > 0 && r.time > r.exprUntil) { r.expr = 'neutral'; r.exprUntil = 0; }
      const E = EXPR[r.expr] || EXPR.neutral;
      const ke = dt > 0 ? 1 - Math.exp(-18 * dt) : 1;
      for (let i = 0; i < 9; i++) r.exprCur[i] += (E[i] - r.exprCur[i]) * ke;
      for (let i = 0; i < 3; i++) {
        F[rig.browL * 3 + i] += r.exprCur[i];
        F[rig.browR * 3 + i] += r.exprCur[3 + i];
        if (rig.jaw >= 0) F[rig.jaw * 3 + i] += r.exprCur[6 + i];
      }
    }
    // spring chains
    if (full && rig.springN > 0) springs(r, F, dt, lm);
    // Form motion: floating blades bob, mantle ribbons flutter
    if (r.formKey && rig.extra >= 0) {
      const e = rig.extra * 3;
      if (r.formKey === 'zenith') { F[e + 1] += Math.sin(r.time * 1.3) * 0.06; F[e] += Math.sin(r.time * 2.1) * 0.04; }
      else if (r.formKey === 'tempest') F[e] += 0.12 + Math.sin(r.time * 7.5) * 0.08 + Math.min(0.9, r.speed * 0.05);
    }

    // apply to bones
    for (let b = 0; b < nb; b++) bones[b].rotation.set(F[b * 3], F[b * 3 + 1], F[b * 3 + 2]);
    if (hips >= 0) {
      const o = nb * 3;
      const k = rig.offScale;
      bones[hips].position.set(rig.rest[hips * 3] + F[o] * k, rig.rest[hips * 3 + 1] + F[o + 1] * k, rig.rest[hips * 3 + 2] + F[o + 2] * k);
      bones[hips].scale.set(F[o + 3], F[o + 4], F[o + 5]);
    }
    let lift = 0;
    if (rig.hover && (lm === 'hover' || lm === 'ground')) lift = rig.height * 0.16 + Math.sin(r.time * 2.1) * 0.05;
    r.lift = lift;
    r.mesh.position.set(P.x, P.y + lift, P.z);
    r.mesh.rotation.set(0, r.yaw, 0);
    r.mesh.updateMatrixWorld(true);

    // material state
    const u = r.mat.uniforms;
    const real = ctx.time.real;
    u.uFlash.value = r.flashStart >= 0 ? clamp(1 - (real - r.flashStart) / r.flashDur, 0, 1) : 0;
    u.uDissolve.value = r.dissolveStart >= 0 ? clamp((real - r.dissolveStart) / r.dissolveDur, 0, 1) : 0;
    if (r.formKey) formGlow(r, ent);
  }

  /** Seams pulse (Ember slow flow, Tempest 1.2 Hz), Zenith prism cycling, low-Ora flicker. @param {any} r @param {any} ent */
  function formGlow(r, ent) {
    const rig = r.rig;
    const u = r.mat.uniforms;
    const t = r.time;
    let k = 1;
    if (r.formKey === 'ember') k = 0.85 + 0.15 * Math.sin(t * 1.6);
    else if (r.formKey === 'tempest') k = 0.8 + 0.3 * Math.sin(t * TWO_PI * 1.2);
    else k = 0.9 + 0.1 * Math.sin(t * 2.4);
    const st = ent.stats;
    if (st && st.oraMax > 0 && st.ora / st.oraMax < 0.2) k *= Math.sin(t * 37) > 0.2 ? 1 : 0.25;
    const seam = rig.slotIndex.seam;
    const ora = rig.slotIndex.ora;
    if (seam !== undefined) u.uEmissive.value[seam] = r.emisBase[seam] * k;
    if (ora !== undefined) u.uEmissive.value[ora] = r.emisBase[ora] * (0.8 + 0.2 * k);
    if (r.formKey === 'zenith') {
      const c = (t * 0.35) % 1;
      const seg = c * 3;
      const i0 = Math.floor(seg) % 3;
      const f = seg - Math.floor(seg);
      colA.setHex(PRISM[i0]);
      colB.setHex(PRISM[(i0 + 1) % 3]);
      colA.lerp(colB, f * f * (3 - 2 * f));
      const pal = u.uPalette.value;
      if (seam !== undefined) pal[seam].copy(colA).lerp(colB.setHex(PALETTE.zenith), 0.35);
      const sash = rig.slotIndex.sash;
      if (sash !== undefined) pal[sash].copy(colA).lerp(colB.setHex(PALETTE.zenith), 0.55);
    }
  }

  /**
   * Damped angular springs on each chain bone, driven by the actor's velocity in its own frame.
   * @param {any} r @param {Float32Array} F @param {number} dt @param {string} lm
   */
  function springs(r, F, dt, lm) {
    const rig = r.rig;
    const sy = Math.sin(r.yaw);
    const cy = Math.cos(r.yaw);
    const vx = r.ent.vel.x;
    const vz = r.ent.vel.z;
    const fwd = vx * sy + vz * cy;
    const side = vx * cy - vz * sy;
    const vy = r.ent.vel.y;
    const flying = lm === 'fly' || lm === 'hurtle';
    const steps = dt > 0 ? Math.min(4, Math.ceil(dt / (1 / 60))) : 0;
    const h = steps > 0 ? dt / steps : 0;
    const A = r.springA;
    const Vv = r.springV;
    for (let c = 0; c < rig.chains.length; c++) {
      const ch = rig.chains[c];
      for (let j = 0; j < ch.idx.length; j++) {
        const i = (ch.start + j) * 2;
        let tx;
        let tz;
        const flutter = Math.sin(r.time * (9 + j * 1.7) + j * 1.3 + c) * Math.min(0.3, r.speed * 0.02 + (flying ? 0.12 : 0));
        if (ch.trail) {
          tx = clamp(-0.25 + fwd * 0.03, -0.4, 0.3) * (j + 1) * 0.5 + flutter * 0.6;
          tz = Math.sin(r.time * 3 + c * 2.1 + j) * 0.25 - side * 0.03;
        } else if (flying) {
          tx = 0.15 + flutter * 1.4 + j * 0.05;
          tz = clamp(-side * 0.02, -0.3, 0.3) + flutter * 0.4;
        } else {
          tx = clamp(fwd * 0.07 - vy * 0.04, -0.35, 1.25) * (0.6 + j * 0.35) + flutter;
          tz = clamp(-side * 0.05, -0.5, 0.5) * (0.6 + j * 0.3) + 0.06;
        }
        for (let n = 0; n < steps; n++) {
          Vv[i] += (ch.stiffness * (tx - A[i]) - ch.damping * Vv[i]) * h;
          Vv[i + 1] += (ch.stiffness * (tz - A[i + 1]) - ch.damping * Vv[i + 1]) * h;
          A[i] += Vv[i] * h;
          A[i + 1] += Vv[i + 1] * h;
        }
        if (!Number.isFinite(A[i]) || !Number.isFinite(A[i + 1])) { A[i] = 0; A[i + 1] = 0; Vv[i] = 0; Vv[i + 1] = 0; }
        const b = ch.idx[j] * 3;
        F[b] += A[i];
        F[b + 2] += A[i + 1];
      }
    }
    // the sash streams out to about twice the body length in flight
    if (rig.fam === 'humanoid' && rig.springN > 0 && rig.chains[0].idx.length === 3) {
      const target = flying ? 1.55 : 1;
      r.sashScale += (target - r.sashScale) * (dt > 0 ? 1 - Math.exp(-4 * dt) : 1);
      const ch = rig.chains[0];
      for (let j = 1; j < ch.idx.length; j++) r.bones[ch.idx[j]].position.y = rig.rest[ch.idx[j] * 3 + 1] * r.sashScale;
    }
  }

  /** Rank of a record by camera distance (no allocation; n <= 64). @param {number} i @param {Float32Array} d2 */
  function rankOf(i, d2) {
    let k = 0;
    for (let j = 0; j < records.length && j < d2.length; j++) if (d2[j] < d2[i] || (d2[j] === d2[i] && j < i)) k++;
    return k;
  }
  const dist2 = new Float32Array(128);

  const animSystem = {
    id: 'actors.anim',
    phase: 'anim',
    owner: OWNER,
    /** @param {any} c @param {number} frameDt @param {number} alpha */
    frame(c, frameDt, alpha) {
      const now = c.time.now;
      const dt = lastNow < 0 ? 0 : clamp(now - lastNow, 0, 0.25);
      lastNow = now;
      frameNo++;
      const cam = c.three && c.three.camera ? c.three.camera.position : null;
      const caps = c.render && c.render.caps ? c.render.caps : null;
      const cap = caps && caps.animatedActors > 0 ? caps.animatedActors : 8;
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        const ent = c.ents.get(r.entId);
        if (!ent || ent !== r.ent) destroyRecord(r);
      }
      const n = Math.min(records.length, dist2.length);
      for (let i = 0; i < n; i++) {
        const p = records[i].ent.pos;
        dist2[i] = cam ? (p.x - cam.x) * (p.x - cam.x) + (p.y - cam.y) * (p.y - cam.y) + (p.z - cam.z) * (p.z - cam.z) : 0;
      }
      stats.posed = 0;
      stats.reduced = 0;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const fullLod = i >= n || r.ent.kind === 'player' || records.length <= cap || rankOf(i, dist2) < cap;
        r.accum += dt;
        if (!fullLod && ((frameNo + r.entId) % 3) !== 0) {
          stats.reduced++;
          // keep the mesh on the entity between pose updates
          ctx.ents.renderPos(r.ent, alpha, V);
          r.mesh.position.set(V.x, V.y + r.lift, V.z);
          r.mesh.updateMatrixWorld(true);
          continue;
        }
        poseRecord(r, r.accum, alpha, fullLod);
        r.accum = 0;
        stats.posed++;
      }
    },
  };

  /** Bus listeners. */
  const on = {
    /** @param {any} e */
    removed(e) {
      const r = rec(ctx.ents.get(e.entId));
      if (r) destroyRecord(r);
    },
    /** @param {any} e */
    died(e) {
      const r = rec(ctx.ents.get(e.entId));
      if (r) r.dead = true;
    },
    /** @param {any} e */
    damaged(e) {
      const ent = ctx.ents.get(e.targetId);
      const r = rec(ent);
      if (!r) return;
      actors.flash(ent, e.crit ? 0.1 : 0.07);
      const hpMax = ent.stats && ent.stats.hpMax > 0 ? ent.stats.hpMax : 100;
      actors.flinch(ent, ent.pos.x - e.x, ent.pos.z - e.z, e.blocked ? 0.2 : clamp(0.35 + (e.amount / hpMax) * 3, 0.35, 1));
      if (!r.dead && r.expr !== 'ko') { r.expr = 'hurt'; r.exprUntil = r.time + 0.45; }
    },
    /** @param {any} e */
    staggered(e) {
      const ent = ctx.ents.get(e.entId);
      const r = rec(ent);
      if (!r) return;
      actors.flinch(ent, -Math.sin(r.yaw), -Math.cos(r.yaw), 1);
    },
    /** @param {any} e */
    form(e) {
      const ent = ctx.ents.get(e.entId);
      if (rec(ent)) actors.setForm(ent, e.formId);
    },
    /** @param {any} e */
    line(e) {
      const id = e.speakerId;
      let ent = null;
      if (id === 'tavi') ent = ctx.player;
      else {
        const list = ctx.ents.list('npc');
        for (let i = 0; i < list.length; i++) if (list[i].alive && list[i].defId === id) { ent = list[i]; break; }
      }
      const r = rec(ent);
      if (!r) return;
      if (r.upper.id !== 'talk') playInternal(r, 'talk', { loop: true, layer: 'upper', blend: 0.2 });
      r.talkUntil = r.time + 2.2;
    },
  };

  return { actors, animSystem, on };
}
