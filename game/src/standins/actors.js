/**
 * Stand-in `ctx.actors` (ARCHITECTURE 4.5, 8.0): one rigid-skinned mesh per character (one draw call) built from
 * primitives sized by the spec's `build` and `radius` and coloured from its palette: a capsule body, a sphere
 * head with eyes and hair, two arms, two legs and (for the hero) the sash; creatures get a horizontal body with
 * four legs, flyers a body with two wings. The animator reads `ent.move`, `ent.vel` and `ent.combat` every frame
 * (stride, idle breathing, lean by velocity, flight poses, hurtle spin, falls), emits `actor:step` on each
 * footfall, and `play` drives short procedural clips with a squash. Timers run on sim time so stepped tests
 * animate too. Replaced by the actors package.
 * @module standins/actors
 */

import {
  Bone, Skeleton, SkinnedMesh, BufferGeometry, BufferAttribute, CapsuleGeometry, SphereGeometry, BoxGeometry, ConeGeometry, Matrix4,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { TMP, clamp, angleDelta, damp } from '../core/math.js';

const OWNER = 'standin:actors';
const CLIP_SECONDS = 0.3;

/** Bone indices of the stand-in rig. */
const B = { root: 0, hips: 1, chest: 2, head: 3, armL: 4, armR: 5, legL: 6, legR: 7, sash: 8 };
const BONES = 9;

/** Slot candidates by part, most specific first. */
const SLOTS = {
  body: ['coat', 'robe', 'jacket', 'tunic', 'body', 'plate', 'armour', 'armor', 'hide', 'shell', 'cape', 'iron'],
  legs: ['trousers', 'legs', 'under', 'pants', 'robe'],
  feet: ['boots', 'wraps', 'under'],
  skin: ['skin', 'face', 'veil', 'head'],
  hands: ['wraps', 'skin', 'gloves', 'under'],
  hair: ['hair'],
  sash: ['sash'],
  accent: ['glass', 'core', 'vial', 'crystal', 'ember', 'eye'],
  tusk: ['tusk', 'ivory', 'claw', 'horn', 'beak'],
};

/**
 * @param {string[]} names slot names of the spec @param {string[]} candidates @param {number} fallback
 * @returns {number} slot index
 */
function pickSlot(names, candidates, fallback) {
  for (const c of candidates) {
    const i = names.indexOf(c);
    if (i >= 0) return i;
  }
  return fallback;
}

/**
 * Merge primitive parts into one skinned geometry (`paletteIndex`, `skinIndex`, `skinWeight`).
 * @param {Array<{ geo:any, bone:number, slot:number, x?:number, y?:number, z?:number, rx?:number, rz?:number, sx?:number, sy?:number, sz?:number }>} parts
 */
function mergeParts(parts) {
  const P = [];
  const N = [];
  const S = [];
  const I = [];
  const m = new Matrix4();
  const r = new Matrix4();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    m.makeScale(p.sx || 1, p.sy || 1, p.sz || 1);
    if (p.rx) m.premultiply(r.makeRotationX(p.rx));
    if (p.rz) m.premultiply(r.makeRotationZ(p.rz));
    m.premultiply(r.makeTranslation(p.x || 0, p.y || 0, p.z || 0));
    g.applyMatrix4(m);
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    for (let i = 0; i < pos.length; i += 3) {
      P.push(pos[i], pos[i + 1], pos[i + 2]);
      N.push(nor[i], nor[i + 1], nor[i + 2]);
      S.push(p.slot);
      I.push(p.bone, 0, 0, 0);
    }
    g.dispose();
    if (g !== p.geo) p.geo.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('paletteIndex', new BufferAttribute(new Float32Array(S), 1));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(I), 4));
  const W = new Float32Array((P.length / 3) * 4);
  for (let i = 0; i < W.length; i += 4) W[i] = 1;
  geo.setAttribute('skinWeight', new BufferAttribute(W, 4));
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius *= 1.6;
  return geo;
}

/**
 * Build the cached rig of a spec: geometry, bone rest positions and dimensions.
 * @param {any} spec actorSpec definition (may be null) @param {string} specId
 */
function buildRig(spec, specId) {
  const s = spec || {};
  const rig = s.rig === 'quadruped' || s.rig === 'flyer' || s.rig === 'blob' ? s.rig : 'humanoid';
  const build = s.build || {};
  const scale = typeof s.scale === 'number' && s.scale > 0 ? s.scale : 1;
  const H = (typeof build.height === 'number' ? build.height : rig === 'quadruped' ? 1.2 : 1.8) * scale;
  const bulk = typeof build.bulk === 'number' ? build.bulk : 0.55;
  const headK = typeof build.head === 'number' ? build.head : 1;
  const shoulder = (typeof build.shoulder === 'number' ? build.shoulder : 0.44) * scale;
  const radius = typeof s.radius === 'number' ? s.radius * scale : Math.max(0.3, shoulder * 0.9);

  const names = Object.keys(s.palette || {}).slice(0, 15);
  const colours = names.map((n) => s.palette[n]);
  if (!names.length) {
    names.push('body', 'skin', 'legs');
    colours.push(PALETTE.biome.meadows.shade, PALETTE.paper, PALETTE.ink);
  }
  const ink = names.length;
  names.push('ink');
  colours.push(PALETTE.ink);
  const emissive = names.map((n) => (s.emissive && typeof s.emissive[n] === 'number' ? s.emissive[n] : 0));
  const slot = (key, fb) => pickSlot(names, SLOTS[key], fb);
  const body = slot('body', 0);

  /** Bone rest positions relative to their parent, and parents. */
  const rest = new Float32Array(BONES * 3);
  const parent = [-1, 0, 1, 2, 2, 2, 1, 1, 2];
  const setRest = (b, x, y, z) => { rest[b * 3] = x; rest[b * 3 + 1] = y; rest[b * 3 + 2] = z; };
  const parts = [];
  let legLen;
  let pivot;

  if (rig === 'humanoid') {
    legLen = 0.47 * H;
    const torso = 0.3 * H;
    const headR = 0.075 * H * headK;
    const torsoR = shoulder * (0.32 + bulk * 0.25);
    const limbR = 0.045 * H * (0.7 + bulk * 0.5);
    const armX = shoulder * 0.5 + limbR * 0.6;
    const hipX = torsoR * 0.45;
    const armLen = 0.36 * H;
    const chestY = legLen + torso * 0.45;
    const shoulderY = legLen + torso * 0.92;
    const headY = legLen + torso + headR * 1.05;
    setRest(B.root, 0, 0, 0);
    setRest(B.hips, 0, legLen, 0);
    setRest(B.chest, 0, chestY - legLen, 0);
    setRest(B.head, 0, legLen + torso - chestY, 0);
    setRest(B.armL, armX, shoulderY - chestY, 0);
    setRest(B.armR, -armX, shoulderY - chestY, 0);
    setRest(B.legL, hipX, 0, 0);
    setRest(B.legR, -hipX, 0, 0);
    setRest(B.sash, torsoR * 0.6, shoulderY - chestY, -torsoR * 0.8);
    const legs = slot('legs', body);
    parts.push({ geo: new CapsuleGeometry(torsoR, torso * 0.75, 3, 10), bone: B.chest, slot: body, y: legLen + torso * 0.5, sz: 0.75 });
    parts.push({ geo: new SphereGeometry(torsoR * 0.95, 10, 6), bone: B.hips, slot: legs, y: legLen + 0.02 * H, sz: 0.8 });
    for (const side of [1, -1]) {
      const bone = side > 0 ? B.legL : B.legR;
      parts.push({ geo: new CapsuleGeometry(limbR * 1.15, legLen - limbR * 2.6, 3, 8), bone, slot: legs, x: hipX * side, y: legLen * 0.52 });
      parts.push({ geo: new BoxGeometry(limbR * 2.4, limbR * 1.6, limbR * 3.6), bone, slot: slot('feet', legs), x: hipX * side, y: limbR * 0.8, z: limbR * 0.7 });
      const arm = side > 0 ? B.armL : B.armR;
      parts.push({ geo: new BoxGeometry(limbR * 1.8, armLen, limbR * 1.8), bone: arm, slot: slot('skin', body), x: armX * side, y: shoulderY - armLen * 0.5 });
      parts.push({ geo: new SphereGeometry(limbR * 1.35, 8, 6), bone: arm, slot: slot('hands', body), x: armX * side, y: shoulderY - armLen - limbR * 0.6 });
      parts.push({ geo: new BoxGeometry(headR * 0.22, headR * 0.34, headR * 0.1), bone: B.head, slot: ink, x: headR * 0.36 * side, y: headY + headR * 0.08, z: headR * 0.93 });
    }
    parts.push({ geo: new SphereGeometry(torsoR * 0.9, 10, 6), bone: B.chest, slot: body, x: 0, y: shoulderY - 0.02 * H, sx: 1.45, sy: 0.55, sz: 0.85 });
    parts.push({ geo: new SphereGeometry(headR, 14, 10), bone: B.head, slot: slot('skin', body), y: headY });
    const hair = slot('hair', -1);
    if (hair >= 0) {
      parts.push({ geo: new SphereGeometry(headR * 1.08, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), bone: B.head, slot: hair, y: headY + headR * 0.08, z: -headR * 0.12, rx: -0.35 });
      parts.push({ geo: new CapsuleGeometry(headR * 0.28, headR * 1.6, 3, 6), bone: B.head, slot: hair, y: headY - headR * 0.9, z: -headR * 1.05, rx: 0.25 });
    }
    const sash = slot('sash', -1);
    if (sash >= 0) {
      parts.push({ geo: new BoxGeometry(torsoR * 0.55, H * 0.42, 0.03 * H), bone: B.sash, slot: sash, x: torsoR * 0.6, y: shoulderY - H * 0.21, z: -torsoR * 0.85 });
    }
    const accent = slot('accent', -1);
    if (accent >= 0) parts.push({ geo: new SphereGeometry(torsoR * 0.22, 8, 6), bone: B.chest, slot: accent, y: chestY + torso * 0.15, z: torsoR * 0.72 });
    pivot = legLen + torso * 0.5;
  } else if (rig === 'quadruped') {
    legLen = 0.45 * H;
    const bodyR = H * 0.3 * (0.7 + bulk * 0.5);
    const bodyLen = H * 1.1;
    const limbR = H * 0.07;
    const headR = H * 0.2 * headK;
    setRest(B.root, 0, 0, 0);
    setRest(B.hips, 0, legLen + bodyR * 0.4, -bodyLen * 0.35);
    setRest(B.chest, 0, 0, bodyLen * 0.7);
    setRest(B.head, 0, bodyR * 0.3, bodyLen * 0.25);
    setRest(B.armL, bodyR * 0.6, -bodyR * 0.4, 0);
    setRest(B.armR, -bodyR * 0.6, -bodyR * 0.4, 0);
    setRest(B.legL, bodyR * 0.6, -bodyR * 0.4, 0);
    setRest(B.legR, -bodyR * 0.6, -bodyR * 0.4, 0);
    setRest(B.sash, 0, bodyR, -bodyLen * 0.2);
    const by = legLen + bodyR * 0.4;
    parts.push({ geo: new CapsuleGeometry(bodyR, bodyLen * 0.7, 4, 10), bone: B.chest, slot: body, y: by, rx: Math.PI / 2 });
    parts.push({ geo: new SphereGeometry(headR, 12, 8), bone: B.head, slot: slot('skin', body), y: by + bodyR * 0.3, z: bodyLen * 0.6 });
    for (const side of [1, -1]) {
      parts.push({ geo: new BoxGeometry(limbR * 2, legLen + bodyR * 0.2, limbR * 2), bone: side > 0 ? B.armL : B.armR, slot: slot('legs', body), x: bodyR * 0.6 * side, y: (legLen + bodyR * 0.2) / 2, z: bodyLen * 0.35 });
      parts.push({ geo: new BoxGeometry(limbR * 2, legLen + bodyR * 0.2, limbR * 2), bone: side > 0 ? B.legL : B.legR, slot: slot('legs', body), x: bodyR * 0.6 * side, y: (legLen + bodyR * 0.2) / 2, z: -bodyLen * 0.35 });
      parts.push({ geo: new ConeGeometry(headR * 0.18, headR * 1.1, 6), bone: B.head, slot: slot('tusk', ink), x: headR * 0.5 * side, y: by + bodyR * 0.1, z: bodyLen * 0.6 + headR * 0.9, rx: Math.PI / 2 - 0.3 });
      parts.push({ geo: new BoxGeometry(headR * 0.2, headR * 0.25, headR * 0.1), bone: B.head, slot: slot('accent', ink), x: headR * 0.45 * side, y: by + bodyR * 0.3 + headR * 0.3, z: bodyLen * 0.6 + headR * 0.85 });
    }
    const accent = slot('accent', -1);
    if (accent >= 0) parts.push({ geo: new ConeGeometry(bodyR * 0.25, bodyR * 0.8, 5), bone: B.chest, slot: accent, y: by + bodyR * 1.05, z: -bodyLen * 0.1 });
    pivot = by;
  } else {
    legLen = rig === 'flyer' ? H * 0.35 : H * 0.05;
    const bodyR = H * 0.32 * (0.7 + bulk * 0.5);
    const by = legLen + bodyR;
    setRest(B.root, 0, 0, 0);
    setRest(B.hips, 0, by, 0);
    setRest(B.chest, 0, 0, 0);
    setRest(B.head, 0, bodyR * 0.4, bodyR * 0.6);
    setRest(B.armL, bodyR * 0.8, bodyR * 0.2, 0);
    setRest(B.armR, -bodyR * 0.8, bodyR * 0.2, 0);
    setRest(B.legL, bodyR * 0.3, -bodyR, 0);
    setRest(B.legR, -bodyR * 0.3, -bodyR, 0);
    setRest(B.sash, 0, 0, -bodyR);
    parts.push({ geo: new SphereGeometry(bodyR, 14, 10), bone: B.chest, slot: body, y: by, sy: rig === 'blob' ? 0.8 : 1, sz: rig === 'flyer' ? 1.3 : 1 });
    for (const side of [1, -1]) {
      parts.push({ geo: new BoxGeometry(bodyR * 0.25, bodyR * 0.35, bodyR * 0.1), bone: B.head, slot: slot('accent', ink), x: bodyR * 0.35 * side, y: by + bodyR * 0.35, z: bodyR * (rig === 'flyer' ? 1.2 : 0.95) });
      if (rig === 'flyer') {
        parts.push({ geo: new BoxGeometry(H * 0.75, bodyR * 0.08, bodyR * 1.1), bone: side > 0 ? B.armL : B.armR, slot: slot('legs', body), x: (bodyR * 0.8 + H * 0.36) * side, y: by + bodyR * 0.2 });
      }
    }
    if (rig === 'flyer') parts.push({ geo: new ConeGeometry(bodyR * 0.5, bodyR * 1.6, 6), bone: B.sash, slot: slot('accent', body), y: by, z: -bodyR * 1.6, rx: -Math.PI / 2 });
    pivot = by;
  }

  return {
    specId, rig, H, radius, legLen, pivot, names, colours, emissive, rest, parent,
    geometry: mergeParts(parts), forms: s.forms || null,
  };
}

/**
 * Create the stand-in actors service.
 * @param {any} ctx
 */
function createActors(ctx) {
  /** @type {Map<string, any>} */
  const rigs = new Map();
  /** @type {any[]} live visual records */
  const records = [];
  const stepPayload = { entId: 0, surface: 'grass' };
  let lastReal = -1;

  /** @param {string} specId */
  function rigFor(specId) {
    let r = rigs.get(specId);
    if (!r) {
      const spec = ctx.defs ? ctx.defs.find('actorSpec', specId) : null;
      r = buildRig(spec, specId);
      rigs.set(specId, r);
    }
    return r;
  }

  /** @param {any} ent @returns {any} the record when `ent` is a live entity with a stand-in visual */
  function rec(ent) {
    if (!ent || !ent.visual || !ent.visual.standinActor) return null;
    return ent.visual;
  }

  /** Recompute the palette uniform: spec, then Form palette, then gear overrides. @param {any} r */
  function applyPalette(r) {
    const rig = r.rig;
    const pal = r.mat.uniforms.uPalette.value;
    const em = r.mat.uniforms.uEmissive.value;
    const form = r.formKey && rig.forms && rig.forms[r.formKey] ? rig.forms[r.formKey] : null;
    for (let i = 0; i < 16; i++) {
      const name = rig.names[i];
      let hex = i < rig.colours.length ? rig.colours[i] : PALETTE.paper;
      let e = i < rig.emissive.length ? rig.emissive[i] : 0;
      if (name && form && form.palette && typeof form.palette[name] === 'number') hex = form.palette[name];
      if (name && form && form.emissive && typeof form.emissive[name] === 'number') e = form.emissive[name];
      if (name && r.overrides && typeof r.overrides[name] === 'number') hex = r.overrides[name];
      pal[i].setHex(hex);
      em[i] = e;
    }
  }

  /** @param {any} r */
  function destroyRecord(r) {
    const i = records.indexOf(r);
    if (i >= 0) records.splice(i, 1);
    if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
    const render = ctx.render;
    if (render) {
      if (render.outline) render.outline.remove(r.mesh);
      if (render.blob) render.blob.remove(r.entId);
    }
    r.mat.dispose();
    r.skeleton.dispose();
    if (r.ent.visual === r && r.ent.id === r.entId) r.ent.visual = null;
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
      ent.radius = rig.radius;
      ent.height = rig.H;
      const render = ctx.render;
      if (!render || !render.layers) return;
      const bones = [];
      for (let b = 0; b < BONES; b++) {
        const bone = new Bone();
        bone.position.set(rig.rest[b * 3], rig.rest[b * 3 + 1], rig.rest[b * 3 + 2]);
        if (rig.parent[b] >= 0) bones[rig.parent[b]].add(bone);
        bones.push(bone);
      }
      const mat = render.materials.toonSkinned({ palette: true });
      const mesh = new SkinnedMesh(rig.geometry, mat);
      mesh.add(bones[0]);
      mesh.updateMatrixWorld(true);
      const skeleton = new Skeleton(bones);
      mesh.bind(skeleton);
      mesh.rotation.order = 'YXZ';
      mesh.frustumCulled = true;
      render.layers.actors.add(mesh);
      const r = {
        standinActor: true, ent, entId: ent.id, rig, mesh, mat, skeleton, bones,
        yaw: ent.yaw, phase: 0, pitch: 0, pivot: rig.pivot, lastX: ent.pos.x, lastZ: ent.pos.z,
        clip: '', clipStart: 0, clipDur: 0, hold: false, squashStart: -10,
        flashStart: -10, flashDur: 0, dissolveStart: -1, dissolveDur: 1, ghost: 1,
        look: false, lookX: 0, lookY: 0, lookZ: 0, flinchStart: -10, flinchK: 0,
        formKey: /** @type {string|null} */ (null), overrides: /** @type {object|null} */ (null), dead: false, spin: 0,
      };
      ent.visual = r;
      records.push(r);
      const o = opts || {};
      r.formKey = o.formKey || null;
      r.overrides = o.palette || null;
      applyPalette(r);
      if (r.formKey) actors.setForm(ent, r.formKey);
      if (render.outline) render.outline.add(mesh, { widthPx: 2 });
      if (render.blob) render.blob.add(ent.id, rig.radius);
      poseRecord(r, 0, 1);
    },

    /** @param {any} ent */
    destroy(ent) {
      const r = rec(ent);
      if (r) destroyRecord(r);
    },

    /** @param {string} specId @returns {{ radius:number, height:number }} */
    bounds(specId) {
      const rig = rigFor(specId);
      return { radius: rig.radius, height: rig.H };
    },

    /**
     * Procedural clip: a pose blended over the clip time plus a squash.
     * @param {any} ent @param {string} clipId @param {{ speed?:number, loop?:boolean, layer?:string, blend?:number, hold?:boolean }} [opts]
     */
    play(ent, clipId, opts) {
      const r = rec(ent);
      if (!r) return;
      const speed = opts && opts.speed > 0 ? opts.speed : 1;
      r.clip = clipId;
      r.clipStart = ctx.time.now;
      r.clipDur = opts && opts.loop ? Infinity : CLIP_SECONDS / speed;
      r.hold = !!(opts && opts.hold);
      r.squashStart = ctx.time.now;
    },

    /** @param {any} ent */
    stop(ent) {
      const r = rec(ent);
      if (!r) return;
      r.clip = '';
      r.hold = false;
    },

    /** @returns {number} */
    clipSeconds() {
      return CLIP_SECONDS;
    },

    /** Form look: rim glow in the Form colour and the spec's Form palette. @param {any} ent @param {string|null} formKey */
    setForm(ent, formKey) {
      const r = rec(ent);
      if (!r) return;
      r.formKey = formKey || null;
      applyPalette(r);
      const colour = formKey === 'ember' ? PALETTE.ember : formKey === 'tempest' ? PALETTE.tempest : formKey === 'zenith' ? PALETTE.zenith : 0;
      actors.rimGlow(ent, colour || PALETTE.ora, colour ? 0.7 : 0);
    },

    /** @param {any} ent @param {object|null} overrides slot name -> colour */
    setPalette(ent, overrides) {
      const r = rec(ent);
      if (!r) return;
      r.overrides = overrides || null;
      applyPalette(r);
    },

    /** Faces are not modelled in the stand-in. */
    setExpression() {},

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

    /** @param {any} ent @param {number} dirX @param {number} dirZ @param {number} strength 0..1 */
    flinch(ent, dirX, dirZ, strength) {
      const r = rec(ent);
      if (!r) return;
      r.flinchStart = ctx.time.real;
      r.flinchK = clamp(strength, 0, 1);
    },

    /**
     * World position of a socket this frame.
     * @param {any} ent @param {'handR'|'handL'|'chest'|'head'|'feet'|'back'} name @param {any} out Vector3
     */
    socket(ent, name, out) {
      if (!ent) return out.set(0, 0, 0);
      const r = rec(ent);
      const H = r ? r.rig.H : ent.height || 1.8;
      const w = r ? r.rig.radius : ent.radius || 0.5;
      let lx = 0;
      let ly = H * 0.68;
      let lz = w * 0.3;
      if (name === 'handR') { lx = -w * 0.9; ly = H * 0.5; lz = w * 0.6; } else if (name === 'handL') { lx = w * 0.9; ly = H * 0.5; lz = w * 0.6; } else if (name === 'head') { ly = H * 0.92; lz = 0; } else if (name === 'feet') { ly = 0.05; lz = 0; } else if (name === 'back') { lz = -w * 0.8; }
      const yaw = r ? r.yaw : ent.yaw;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      return out.set(ent.pos.x + lx * cs + lz * sn, ent.pos.y + ly, ent.pos.z - lx * sn + lz * cs);
    },

    /** @param {any} ent @param {boolean} visible */
    setVisible(ent, visible) {
      const r = rec(ent);
      if (r) r.mesh.visible = !!visible;
    },

    /** @param {any} ent @param {number} alpha 1 = solid */
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

    /** Death dissolve. @param {any} ent @param {number} seconds @param {number} [color] */
    dissolve(ent, seconds, color) {
      const r = rec(ent);
      if (!r) return;
      r.dissolveStart = ctx.time.real;
      r.dissolveDur = Math.max(0.05, seconds);
      if (typeof color === 'number') actors.rimGlow(ent, color, 1);
    },

    /** White hit flash. @param {any} ent @param {number} [seconds] */
    flash(ent, seconds = 0.06) {
      const r = rec(ent);
      if (!r) return;
      r.flashStart = ctx.time.real;
      r.flashDur = Math.max(0.016, seconds);
    },

    /** No frozen-pose clones in the stand-in. @returns {null} */
    snapshot() {
      return null;
    },

    /** @param {any} ent @param {number} color @param {number} strength */
    rimGlow(ent, color, strength) {
      const r = rec(ent);
      if (!r) return;
      r.mat.uniforms.uRimColor.value.setHex(color);
      r.mat.uniforms.uRimStrength.value = Math.max(0, strength);
    },

    /** Remove every visual. */
    dispose() {
      for (let i = records.length - 1; i >= 0; i--) destroyRecord(records[i]);
      for (const rig of rigs.values()) rig.geometry.dispose();
      rigs.clear();
    },
  };

  /**
   * Pose one actor.
   * @param {any} r record @param {number} dt seconds of animation time @param {number} alpha
   */
  function poseRecord(r, dt, alpha) {
    const ent = r.ent;
    const rig = r.rig;
    const bones = r.bones;
    const t = ctx.time.now;
    const real = ctx.time.real;
    const p = TMP.v3;
    ctx.ents.renderPos(ent, alpha, p);
    const mv = ent.move;
    const mode = mv ? mv.mode : 'ground';
    const grounded = mv ? mv.grounded : true;
    const boost = mv ? mv.boost : 0;
    const cs = ent.combat ? ent.combat.state : 'idle';
    const vh = Math.sqrt(ent.vel.x * ent.vel.x + ent.vel.z * ent.vel.z);
    const moved = Math.sqrt((p.x - r.lastX) * (p.x - r.lastX) + (p.z - r.lastZ) * (p.z - r.lastZ));
    r.lastX = p.x;
    r.lastZ = p.z;
    const stride = rig.rig === 'humanoid' ? rig.H * 0.42 : rig.H * 0.55;
    if (grounded && moved < 20) {
      const before = Math.floor(r.phase / Math.PI);
      r.phase += (moved / stride) * Math.PI;
      if (Math.floor(r.phase / Math.PI) !== before && mode !== 'fly' && ctx.world) {
        stepPayload.entId = ent.id;
        stepPayload.surface = ctx.world.surfaceAt(p.x, p.z);
        ctx.bus.emit('actor:step', stepPayload);
      }
    }
    r.yaw += angleDelta(r.yaw, ent.yaw) * (dt > 0 ? 1 - Math.exp(-18 * dt) : 1);

    for (let b = 1; b < BONES; b++) bones[b].rotation.set(0, 0, 0);
    bones[B.hips].position.y = rig.rest[B.hips * 3 + 1];
    const k = clamp(vh / 7, 0, 1);
    const breath = Math.sin(t * 2.2);
    const swing = Math.sin(r.phase) * (0.2 + 0.6 * k) * (vh > 0.4 ? 1 : 0);
    let pitch = 0;
    let pivot = rig.pivot;
    const dead = cs === 'dead' || r.dead;
    const down = cs === 'down';

    if (rig.rig === 'humanoid') {
      if (mode === 'fly' || mode === 'swim') {
        const sp = clamp(vh / 30, 0, 1);
        pitch = mode === 'swim' ? 1.2 : 0.12 + sp * 0.85 + boost * 0.25;
        const sway = Math.sin(t * 3) * 0.12;
        bones[B.legL].rotation.x = 0.15 + sway + (mode === 'swim' ? Math.sin(t * 9) * 0.4 : 0);
        bones[B.legR].rotation.x = 0.25 - sway - (mode === 'swim' ? Math.sin(t * 9) * 0.4 : 0);
        const back = boost > 0 ? 0.35 : 0.25 + (1 - sp) * 0.2;
        bones[B.armL].rotation.set(back * sp, 0, 0.25 + (1 - sp) * 0.4 + sway * 0.5);
        bones[B.armR].rotation.set(back * sp, 0, -0.25 - (1 - sp) * 0.4 - sway * 0.5);
        bones[B.sash].rotation.x = 0.4 + sp * 1.1 + Math.sin(t * 7) * 0.1;
      } else if (!grounded || mode === 'air') {
        bones[B.legL].rotation.x = -0.75;
        bones[B.legR].rotation.x = 0.25;
        bones[B.armL].rotation.z = 0.7;
        bones[B.armR].rotation.z = -0.7;
        bones[B.sash].rotation.x = 0.6;
      } else {
        bones[B.hips].position.y += Math.abs(Math.sin(r.phase)) * 0.05 * k * rig.H + breath * 0.006 * rig.H;
        bones[B.chest].rotation.x = 0.1 * k + 0.02 * breath;
        bones[B.legL].rotation.x = swing;
        bones[B.legR].rotation.x = -swing;
        bones[B.armL].rotation.set(-swing * 0.9, 0, 0.1 + 0.02 * breath);
        bones[B.armR].rotation.set(swing * 0.9, 0, -0.1 - 0.02 * breath);
        bones[B.sash].rotation.x = 0.15 + k * 0.6 + Math.sin(t * 4) * 0.05;
      }
      if (cs === 'guard') {
        bones[B.armL].rotation.set(-1.3, 0, -0.5);
        bones[B.armR].rotation.set(-1.3, 0, 0.5);
      } else if (cs === 'gather') {
        bones[B.armL].rotation.set(0.2, 0, 0.6);
        bones[B.armR].rotation.set(0.2, 0, -0.6);
        bones[B.chest].rotation.x = -0.12;
      } else if (cs === 'stagger') {
        bones[B.chest].rotation.x = -0.35;
        bones[B.armL].rotation.z = 0.9;
        bones[B.armR].rotation.z = -0.9;
      }
      applyClip(r, t);
    } else if (rig.rig === 'quadruped') {
      bones[B.hips].position.y += Math.abs(Math.sin(r.phase)) * 0.04 * k * rig.H + breath * 0.004 * rig.H;
      bones[B.legL].rotation.x = swing;
      bones[B.legR].rotation.x = -swing;
      bones[B.armL].rotation.x = -swing;
      bones[B.armR].rotation.x = swing;
      bones[B.head].rotation.x = 0.05 * breath;
      if (r.clip && t - r.clipStart < r.clipDur) bones[B.head].rotation.x = -0.5 * Math.sin(((t - r.clipStart) / r.clipDur) * Math.PI);
    } else {
      const flap = Math.sin(t * (rig.rig === 'flyer' ? 9 : 3));
      bones[B.hips].position.y += flap * 0.04 * rig.H;
      bones[B.armL].rotation.z = flap * 0.6;
      bones[B.armR].rotation.z = -flap * 0.6;
      bones[B.sash].rotation.y = Math.sin(t * 4) * 0.3;
      pitch = clamp(vh / 25, 0, 1) * 0.4;
    }

    if (r.flinchStart >= 0) {
      const f = 1 - (real - r.flinchStart) / 0.25;
      if (f > 0) bones[B.chest].rotation.x -= f * r.flinchK * 0.5;
    }
    if (r.look) {
      const dx = r.lookX - p.x;
      const dz = r.lookZ - p.z;
      bones[B.head].rotation.y = clamp(angleDelta(r.yaw, Math.atan2(dx, dz)), -1, 1);
    }
    if (mode === 'hurtle') {
      r.spin += dt * 14;
      pitch = r.spin;
    } else {
      r.spin = 0;
    }
    if (dead || down) {
      r.pitch += (-1.45 - r.pitch) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 1);
      pitch = r.pitch;
      pivot = rig.radius * 0.6;
    } else {
      r.pitch = damp(r.pitch, pitch, 12, dt > 0 ? dt : 1);
      pitch = mode === 'hurtle' ? pitch : r.pitch;
    }

    const sq = t - r.squashStart;
    const squash = sq >= 0 && sq < 0.15 ? Math.sin((sq / 0.15) * Math.PI) * 0.1 : 0;
    r.mesh.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);

    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    const sinY = Math.sin(r.yaw);
    const cosY = Math.cos(r.yaw);
    r.mesh.rotation.set(pitch, r.yaw, 0);
    r.mesh.position.set(p.x - pivot * sinP * sinY, p.y + pivot - pivot * cosP, p.z - pivot * sinP * cosY);

    const u = r.mat.uniforms;
    u.uFlash.value = r.flashStart >= 0 ? clamp(1 - (real - r.flashStart) / r.flashDur, 0, 1) : 0;
    u.uDissolve.value = r.dissolveStart >= 0 ? clamp((real - r.dissolveStart) / r.dissolveDur, 0, 1) : 0;
  }

  /** Arm poses of the procedural clips (humanoids). @param {any} r @param {number} t */
  function applyClip(r, t) {
    if (!r.clip) return;
    const e = t - r.clipStart;
    if (e > r.clipDur && !r.hold) {
      r.clip = '';
      return;
    }
    const u = r.clipDur === Infinity ? 1 : clamp(e / r.clipDur, 0, 1);
    const k = r.hold && e > r.clipDur ? 1 : Math.sin(u * Math.PI);
    const bones = r.bones;
    const c = r.clip;
    if (c === 'attack2' || c === 'attack4' || c === 'attack6') {
      bones[B.armL].rotation.set(-1.6 * k, 0, 0.1);
      bones[B.chest].rotation.y = -0.35 * k;
    } else if (c.indexOf('attack') === 0 || c === 'interact' || c === 'bite') {
      bones[B.armR].rotation.set(-1.6 * k, 0, -0.1);
      bones[B.chest].rotation.y = 0.35 * k;
    } else if (c === 'heavy' || c === 'heavy_air' || c === 'heavy_charge' || c === 'slam' || c === 'charge' || c === 'ult_dive') {
      bones[B.armL].rotation.set(-2.4 * k, 0, 0);
      bones[B.armR].rotation.set(-2.4 * k, 0, 0);
      bones[B.chest].rotation.x += 0.3 * k;
    } else if (c === 'cast' || c === 'cast_loop' || c.indexOf('beam') === 0 || c === 'ranged') {
      bones[B.armR].rotation.set(-1.5, 0, 0);
      bones[B.armL].rotation.set(0.5 * k, 0, 0.3);
    } else if (c === 'burst' || c === 'transform' || c === 'roar' || c === 'ult_rise' || c === 'taunt') {
      bones[B.armL].rotation.set(0, 0, 1.3 * k);
      bones[B.armR].rotation.set(0, 0, -1.3 * k);
      bones[B.chest].rotation.x -= 0.2 * k;
    } else if (c === 'victory') {
      bones[B.armR].rotation.set(-2.8 * k, 0, 0);
    } else if (c === 'talk') {
      bones[B.head].rotation.x = 0.15 * Math.sin(t * 9);
    } else if (c === 'flicker') {
      bones[B.chest].rotation.x += 0.5 * k;
    }
  }

  const animSystem = {
    id: 'standin.actors.anim',
    phase: 'anim',
    owner: OWNER,
    /**
     * Pose every visual. A frame pass with dt 0 after stepped ticks (tests) animates by the sim time that passed.
     * @param {any} c @param {number} frameDt @param {number} alpha
     */
    frame(c, frameDt, alpha) {
      const real = c.time.real;
      const simDt = lastReal < 0 ? 0 : real - lastReal;
      lastReal = real;
      const dt = Math.min(0.25, frameDt > 0 ? frameDt : simDt);
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i];
        const ent = c.ents.get(r.entId);
        if (!ent || ent !== r.ent) {
          destroyRecord(r);
          continue;
        }
        poseRecord(r, dt, alpha);
      }
    },
  };

  /** Listener helpers. */
  const on = {
    /** @param {any} e */
    removed(e) {
      const ent = ctx.ents.get(e.entId);
      const r = rec(ent);
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
      if (!rec(ent)) return;
      actors.flash(ent, 0.08);
      const dx = ent.pos.x - e.x;
      const dz = ent.pos.z - e.z;
      actors.flinch(ent, dx, dz, e.amount > 0 ? 0.6 : 0.2);
    },
    /** @param {any} e */
    form(e) {
      const ent = ctx.ents.get(e.entId);
      if (rec(ent)) actors.setForm(ent, e.formId);
    },
  };

  return { actors, animSystem, on };
}

/**
 * Install the stand-in actors service under the owner 'standin:actors'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { actors, animSystem, on } = createActors(ctx);
  ctx.provide('actors', actors, OWNER);
  ctx.systems.add(animSystem);
  ctx.bus.on('actor:removed', on.removed, OWNER);
  ctx.bus.on('actor:died', on.died, OWNER);
  ctx.bus.on('actor:damaged', on.damaged, OWNER);
  ctx.bus.on('combat:form', on.form, OWNER);
}
