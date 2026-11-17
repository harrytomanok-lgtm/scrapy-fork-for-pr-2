/**
 * Stand-in `ctx.env` (ARCHITECTURE 4.2, 8.0): a clock that advances `store.state.world.hour`, the sun (or moon)
 * direction and the five-key day palette of ART_UX 1.4 written to `render.globals`, a sky that is the clear
 * colour, gameplay props as coloured primitives whose states change colour, and settlements built as one
 * merged mesh of simple houses each, with NPC spots on a circle. Replaced by the env package.
 * @module standins/env
 */

import {
  Vector3, Color, Mesh, Group, BufferGeometry, BufferAttribute, BoxGeometry, ConeGeometry, CylinderGeometry,
  SphereGeometry, TorusGeometry, Matrix4,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { IDS } from '../core/ids.js';

const OWNER = 'standin:env';

/** Real seconds per game hour at clock scale 1 (one day per 24 real minutes). */
const SECONDS_PER_HOUR = 60;

/**
 * Day phase of an hour.
 * @param {number} h @returns {'dawn'|'day'|'golden'|'dusk'|'night'}
 */
export function phaseOf(h) {
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19) return 'golden';
  if (h >= 19 && h < 21) return 'dusk';
  return 'night';
}

/** Prop kinds of 4.2: shape builder, size, state colours and collider. */
const PROPS = {
  ringstone: { states: { idle: PALETTE.biome.meadows.cliff, active: PALETTE.structure.ringstone }, glow: PALETTE.structure.ringstone, collider: { shape: 'capsule', r: 0.8, h: 3.4 } },
  shrine: { states: { ready: PALETTE.ora, claimed: PALETTE.biome.spire.shade }, glow: PALETTE.ora, collider: null },
  chest: { states: { locked: PALETTE.structure.terracotta, closed: PALETTE.ember, open: PALETTE.structure.copper }, glow: PALETTE.ember, collider: { shape: 'box', hx: 0.7, hz: 0.5, h: 1 } },
  siphon: { states: { closed: PALETTE.ink, open: PALETTE.hostile, destroyed: PALETTE.corruption }, glow: PALETTE.hostile, collider: { shape: 'capsule', r: 4, h: 40 } },
  ringGate: { states: { idle: PALETTE.ora, next: PALETTE.structure.lantern, passed: PALETTE.biome.meadows.accent }, glow: PALETTE.ora, collider: null },
  trainingPost: { states: { idle: PALETTE.structure.terracotta, broken: PALETTE.ink }, glow: PALETTE.ora, collider: { shape: 'capsule', r: 0.4, h: 2 } },
  bell: { states: { idle: PALETTE.structure.copper, used: PALETTE.ora }, glow: PALETTE.ora, collider: { shape: 'capsule', r: 0.6, h: 2.4 } },
  fallenBlade: { states: { idle: PALETTE.biome.frostspine.cliff, used: PALETTE.ora }, glow: PALETTE.ora, collider: { shape: 'box', hx: 0.3, hz: 1.2, h: 1.6 } },
  saltPillar: { states: { idle: PALETTE.biome.coast.ground, used: PALETTE.ora, broken: PALETTE.biome.coast.shade }, glow: PALETTE.biome.coast.accent, collider: { shape: 'capsule', r: 1.2, h: 6 } },
  crate: { states: { idle: PALETTE.path, used: PALETTE.path, broken: PALETTE.biome.meadows.shade }, glow: PALETTE.ember, collider: { shape: 'box', hx: 0.6, hz: 0.6, h: 1.2 } },
  lightPillar: { states: { on: PALETTE.ora, off: PALETTE.ink }, glow: PALETTE.ora, collider: null },
  campfire: { states: { idle: PALETTE.structure.lantern }, glow: PALETTE.structure.lantern, collider: { shape: 'box', hx: 0.6, hz: 0.6, h: 0.5 } },
  tent: { states: { idle: PALETTE.biome.coast.ground }, glow: PALETTE.structure.lantern, collider: { shape: 'box', hx: 1.6, hz: 1.6, h: 2.4 } },
  signpost: { states: { idle: PALETTE.path }, glow: PALETTE.ora, collider: { shape: 'box', hx: 0.3, hz: 0.3, h: 2.2 } },
};

/** @type {Record<string, any>} geometry per prop kind, built once */
const propGeometry = {};

/** @param {string} kind @returns {any} */
function geometryFor(kind) {
  if (propGeometry[kind]) return propGeometry[kind];
  let g;
  switch (kind) {
    case 'ringstone': g = new BoxGeometry(1.3, 3.4, 0.7); g.translate(0, 1.7, 0); break;
    case 'shrine': g = new TorusGeometry(2, 0.3, 6, 20); g.translate(0, 2.4, 0); break;
    case 'chest': g = new CylinderGeometry(0.6, 0.6, 1, 10); g.rotateZ(Math.PI / 2); g.translate(0, 0.6, 0); break;
    case 'siphon': g = new ConeGeometry(4, 40, 6); g.translate(0, 20, 0); break;
    case 'ringGate': g = new TorusGeometry(4.5, 0.35, 6, 28); break;
    case 'trainingPost': g = new CylinderGeometry(0.3, 0.4, 2, 8); g.translate(0, 1, 0); break;
    case 'bell': g = new ConeGeometry(0.6, 1.2, 10, 1, true); g.translate(0, 1.8, 0); break;
    case 'fallenBlade': g = new BoxGeometry(0.25, 1.6, 2.4); g.translate(0, 0.8, 0); break;
    case 'saltPillar': g = new CylinderGeometry(1, 1.3, 6, 6); g.translate(0, 3, 0); break;
    case 'crate': g = new BoxGeometry(1.2, 1.2, 1.2); g.translate(0, 0.6, 0); break;
    case 'lightPillar': g = new CylinderGeometry(0.6, 0.6, 400, 6, 1, true); g.translate(0, 200, 0); break;
    case 'campfire': g = new ConeGeometry(0.6, 0.9, 6); g.translate(0, 0.45, 0); break;
    case 'tent': g = new ConeGeometry(1.8, 2.4, 4); g.translate(0, 1.2, 0); break;
    default: g = new BoxGeometry(0.3, 2.2, 0.3); g.translate(0, 1.1, 0); break;
  }
  propGeometry[kind] = g;
  return g;
}

/** Building footprint (half width, wall height, roof height) by settlement building kind (5.13). */
const BUILDING = {
  house_s: [3, 3, 2.5], house_m: [4, 3.5, 3], house_l: [5.5, 4, 3.5], windmill: [3, 12, 4], well: [1.5, 1, 1.5],
  kiteTower: [2.5, 30, 6], stall: [2.5, 2.4, 1.2], jetty: [3, 0.6, 0], mast: [0.6, 18, 2], cloister: [7, 4, 3],
  tent: [2, 0.2, 2.6], kitePole: [0.3, 10, 1.5], lantern: [0.3, 2.6, 0.6], beacon: [4, 30, 4],
};

/** Default house count when a settlement definition lists no buildings. */
const STYLE_HOUSES = { village: 8, town: 12, outpost: 5, mountain: 6, monastery: 5, camp: 2, beacon: 2, ledge: 2 };

/**
 * Append a transformed, non-indexed geometry to position, normal and colour lists.
 * @param {any} geo @param {any} m Matrix4 @param {Color} color @param {number[]} P @param {number[]} N @param {number[]} C
 */
function appendGeometry(geo, m, color, P, N, C) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(m);
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) {
    P.push(p[i], p[i + 1], p[i + 2]);
    N.push(n[i], n[i + 1], n[i + 2]);
    C.push(color.r, color.g, color.b);
  }
  g.dispose();
  if (g !== geo) geo.dispose();
}

/**
 * Create the stand-in env service.
 * @param {any} ctx
 */
function createEnv(ctx) {
  let clockScale = 1;
  let lastHourInt = -1;
  let lastPhase = '';
  const hourPayload = { hour: 0, phase: 'day' };
  const sunDir = new Vector3(0.4, 0.8, 0.45).normalize();
  const sunTmp = new Vector3();
  const moonTmp = new Vector3();

  const keyColors = PALETTE.day.map((k) => ({
    hour: k.hour, intensity: k.intensity, sun: new Color(k.sun), ambSky: new Color(k.ambSky), ambGround: new Color(k.ambGround),
    fogTint: k.fogTint === null ? null : new Color(k.fogTint), shadowTint: new Color(k.shadowTint),
  }));
  /** Keys in hour order with the night key repeated at 24. */
  const ordered = keyColors.slice().sort((a, b) => a.hour - b.hour);
  ordered.push(Object.assign({}, ordered[0], { hour: 24 }));
  const regionFog = new Color(PALETTE.biome.meadows.fog);
  const regionFogTarget = new Color();
  const fogA = new Color();
  const fogB = new Color();
  const sky = new Color();
  const white = new Color(0xffffff);
  let snapFog = true;

  /** Settlement infos built on boot. @type {Record<string, any>} */
  const settlements = Object.create(null);
  /** @type {any[]} */
  const settlementMeshes = [];
  /** @type {Set<any>} */
  const props = new Set();
  let nextPropId = 1;

  function state() {
    const s = ctx.store && ctx.store.state;
    return s && s.world ? s.world : null;
  }

  /** Sun or moon direction for an hour, blended across dawn and dusk. @param {number} h */
  function computeSunDir(h) {
    const a = ((h - 6) / 12) * Math.PI;
    sunTmp.set(Math.cos(a), Math.max(0.12, Math.sin(a)), 0.45).normalize();
    const b = ((((h - 18) % 24) + 24) % 24 / 12) * Math.PI;
    moonTmp.set(Math.cos(b) * 0.8, Math.max(0.35, Math.sin(b)), -0.35).normalize();
    const night = h >= 12 ? Math.min(1, Math.max(0, h - 19.5)) : 1 - Math.min(1, Math.max(0, h - 4.5));
    sunDir.copy(sunTmp).lerp(moonTmp, night).normalize();
  }

  /** Write the interpolated day key into render.globals and the clear colour. @param {number} dt */
  function applyLighting(dt) {
    const render = ctx.render;
    if (!render || !render.globals) return;
    const g = render.globals;
    const h = env.hour;
    let i = 0;
    while (i < ordered.length - 2 && h >= ordered[i + 1].hour) i++;
    const a = ordered[i];
    const b = ordered[i + 1];
    const t = Math.min(1, Math.max(0, (h - a.hour) / (b.hour - a.hour)));
    const cam = ctx.three && ctx.three.camera;
    const world = ctx.world;
    if (cam && world) {
      const biome = PALETTE.biome[world.regionAt(cam.position.x, cam.position.z)] || PALETTE.biome.meadows;
      regionFogTarget.setHex(biome.fog);
      regionFog.lerp(regionFogTarget, snapFog ? 1 : 1 - Math.exp(-1.5 * dt));
      snapFog = false;
    }
    g.uSunColor.value.copy(a.sun).lerp(b.sun, t).multiplyScalar(a.intensity + (b.intensity - a.intensity) * t);
    g.uAmbSky.value.copy(a.ambSky).lerp(b.ambSky, t);
    g.uAmbGround.value.copy(a.ambGround).lerp(b.ambGround, t);
    g.uShadowTint.value.copy(a.shadowTint).lerp(b.shadowTint, t);
    fogA.copy(a.fogTint || regionFog);
    fogB.copy(b.fogTint || regionFog);
    g.uFogColor.value.copy(fogA).lerp(fogB, t);
    g.uRimColor.value.copy(g.uAmbSky.value).lerp(white, 0.4);
    g.uFogDensity.value = 0.00018 + 0.0001 * Math.max(0, 1 - Math.abs(h - 5.5) / 1.5);
    g.uSunDir.value.copy(sunDir);
    const wt = g.uTime.value;
    g.uWind.value.set(Math.cos(0.6 + Math.sin(wt * 0.05) * 0.3), 0.15, Math.sin(0.6 + Math.sin(wt * 0.05) * 0.3));
    const renderer = ctx.three && ctx.three.renderer;
    if (renderer) {
      sky.copy(g.uFogColor.value).lerp(g.uAmbSky.value, 0.45);
      renderer.setClearColor(sky, 1);
    }
  }

  /** Emit env:hour on each integer hour and each phase change. */
  function emitHour() {
    const h = env.hour;
    const hi = Math.floor(h);
    const ph = phaseOf(h);
    if (hi === lastHourInt && ph === lastPhase) return;
    lastHourInt = hi;
    lastPhase = ph;
    hourPayload.hour = hi;
    hourPayload.phase = ph;
    ctx.bus.emit('env:hour', hourPayload);
  }

  /** @param {any} lm landmark @param {any} def settlement definition or null */
  function buildSettlement(lm, def) {
    const world = ctx.world;
    const id = lm.id;
    const radius = lm.stamp && lm.stamp.radius ? lm.stamp.radius : 60;
    const P = [];
    const N = [];
    const C = [];
    const m = new Matrix4();
    const wall = new Color(PALETTE.structure.clay);
    const roof = new Color(PALETTE.structure.copper);
    const band = new Color(PALETTE.structure.terracotta);
    const door = new Color(PALETTE.structure.curtain);
    const style = def && def.style ? def.style : 'village';
    let buildings = def && Array.isArray(def.buildings) && def.buildings.length ? def.buildings : null;
    if (!buildings) {
      const n = STYLE_HOUSES[style] || 6;
      const ring = Math.min(radius * 0.6, 18 + n * 3);
      buildings = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        buildings.push({ kind: i % 3 === 0 ? 'house_m' : i % 3 === 1 ? 'house_s' : 'house_l', dx: Math.cos(a) * ring, dz: Math.sin(a) * ring, yaw: -a + Math.PI / 2 });
      }
      if (style === 'village' || style === 'town') buildings.push({ kind: style === 'town' ? 'kiteTower' : 'windmill', dx: -ring * 0.4, dz: ring * 0.3, yaw: 0.6 });
    }
    for (const b of buildings) {
      const dim = BUILDING[b.kind] || BUILDING.house_m;
      const x = lm.x + b.dx;
      const z = lm.z + b.dz;
      const y = world.groundAt(x, 1e4, z) - 0.3;
      const [hw, wh, rh] = dim;
      m.makeRotationY(b.yaw || 0).setPosition(x, y + wh / 2 + 0.3, z);
      appendGeometry(new CylinderGeometry(hw * 0.92, hw, wh + 0.6, 10), m, wall, P, N, C);
      m.makeRotationY(b.yaw || 0).setPosition(x, y + 0.6, z);
      appendGeometry(new CylinderGeometry(hw * 1.02, hw * 1.04, 1.2, 10), m, band, P, N, C);
      if (rh > 0) {
        m.makeRotationY(b.yaw || 0).setPosition(x, y + wh + 0.3 + rh / 2, z);
        appendGeometry(new ConeGeometry(hw * 1.25, rh, 10), m, roof, P, N, C);
      }
      if (wh >= 2.4 && hw >= 2.5) {
        const yaw = b.yaw || 0;
        m.makeRotationY(yaw).setPosition(x + Math.sin(yaw) * hw * 0.98, y + 1.4, z + Math.cos(yaw) * hw * 0.98);
        appendGeometry(new BoxGeometry(1.2, 2, 0.3), m, door, P, N, C);
      }
    }
    if (P.length) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
      geo.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
      geo.setAttribute('color', new BufferAttribute(new Float32Array(C), 3));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, ctx.render.materials.toon({ vertexColors: true }));
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      ctx.render.layers.props.add(mesh);
      settlementMeshes.push(mesh);
    }
    const spots = [];
    const given = def && Array.isArray(def.spots) ? def.spots : [];
    for (const s of given) spots.push({ id: s.id, dx: s.dx, dz: s.dz, yaw: s.yaw || 0 });
    const required = ['ringstone', 'a', 'b', 'c', 'stall'];
    required.forEach((sid, i) => {
      if (spots.some((s) => s.id === sid)) return;
      if (sid === 'ringstone') { spots.push({ id: sid, dx: 0, dz: 0, yaw: 0 }); return; }
      const a = (i / required.length) * Math.PI * 2;
      spots.push({ id: sid, dx: Math.cos(a) * 12, dz: Math.sin(a) * 12, yaw: -a - Math.PI / 2 });
    });
    settlements[id] = {
      id, x: lm.x, z: lm.z, radius,
      spots: spots.map((s) => ({ id: s.id, x: lm.x + s.dx, y: world.groundAt(lm.x + s.dx, 1e4, lm.z + s.dz), z: lm.z + s.dz, yaw: s.yaw })),
    };
  }

  function buildSettlements() {
    const world = ctx.world;
    if (!world || !ctx.render || !ctx.render.layers) return;
    const defs = ctx.defs;
    for (const id of IDS.settlement) {
      const lm = world.landmark(id);
      if (!lm) continue;
      buildSettlement(lm, defs ? defs.find('settlement', id) : null);
    }
  }

  const env = {
    /** @returns {number} 0..24 */
    get hour() {
      const s = state();
      return s && typeof s.hour === 'number' ? s.hour : 7;
    },
    /** @returns {number} */
    get day() {
      const s = state();
      return s && typeof s.day === 'number' ? s.day : 1;
    },
    /** @returns {'dawn'|'day'|'golden'|'dusk'|'night'} */
    get phase() {
      return phaseOf(env.hour);
    },
    /** @returns {boolean} */
    get isNight() {
      return phaseOf(env.hour) === 'night';
    },
    /** Unit vector toward the light (sun or moon), read-only. */
    sunDir,

    /** @param {number} h */
    setHour(h) {
      const s = state();
      if (!s) return;
      s.hour = ((Number(h) % 24) + 24) % 24;
      computeSunDir(s.hour);
      emitHour();
    },

    /** @param {number} s 1 = one game day per 24 real minutes; 0 freezes */
    setClockScale(s) {
      clockScale = Math.max(0, Number(s) || 0);
    },

    /**
     * Coloured primitive for a gameplay prop.
     * @param {string} kind @param {number} x @param {number} y @param {number} z
     * @param {{ yaw?:number, scale?:number, state?:string, color?:number }} [opts]
     */
    spawnProp(kind, x, y, z, opts) {
      const o = opts || {};
      const def = PROPS[kind] || PROPS.signpost;
      const object = new Group();
      object.position.set(x, y, z);
      object.rotation.y = o.yaw || 0;
      const sc = o.scale || 1;
      object.scale.set(sc, sc, sc);
      /** @type {Record<string, any>} */
      const mats = {};
      const pillar = kind === 'lightPillar';
      for (const st of Object.keys(def.states)) {
        const col = pillar && o.color !== undefined && st === 'on' ? o.color : def.states[st];
        mats[st] = pillar ? ctx.render.materials.unlit({ color: col, additive: true, fog: false })
          : ctx.render.materials.toon({ color: col, emissive: kind === 'siphon' && st === 'open' ? PALETTE.hostile : undefined, emissiveIntensity: 0.4 });
      }
      const states = Object.keys(def.states);
      let current = o.state && def.states[o.state] !== undefined ? o.state : states[0];
      const body = new Mesh(geometryFor(kind), mats[current]);
      if (kind === 'ringGate') body.rotation.y = Math.PI / 2;
      object.add(body);
      const glowMat = ctx.render.materials.unlit({ color: def.glow, additive: true });
      const glow = new Mesh(propGlowGeometry(), glowMat);
      glow.position.y = kind === 'siphon' ? 6 : kind === 'shrine' ? 2.4 : 1.4;
      glow.visible = false;
      object.add(glow);
      ctx.render.layers.props.add(object);
      let colliderId = 0;
      const world = ctx.world;
      if (def.collider && world) {
        const c = def.collider;
        colliderId = world.addCollider({ shape: c.shape, x, y, z, r: (c.r || 0) * sc, h: c.h * sc, hx: (c.hx || 0) * sc, hz: (c.hz || 0) * sc, yaw: o.yaw || 0, flags: 1, propKey: 0 });
      }
      const handle = {
        id: nextPropId++,
        kind,
        object,
        /** @param {string} st */
        setState(st) {
          if (!mats[st]) return;
          current = st;
          body.material = mats[st];
          if (kind === 'trainingPost' || kind === 'saltPillar' || kind === 'crate') body.scale.y = st === 'broken' ? 0.35 : 1;
        },
        /** @param {number} v 0..1 */
        setGlow(v) {
          const k = Math.max(0, Math.min(1, v));
          glow.visible = k > 0.01;
          glow.scale.setScalar(0.4 + k * 0.6);
          const u = glowMat.uniforms && glowMat.uniforms.uOpacity;
          if (u) u.value = k * 0.4;
        },
        /** @param {boolean} b */
        setVisible(b) {
          object.visible = !!b;
        },
        dispose() {
          if (object.parent) object.parent.remove(object);
          for (const st of states) mats[st].dispose();
          glowMat.dispose();
          const w = ctx.world;
          if (colliderId && w) w.removeCollider(colliderId);
          colliderId = 0;
          props.delete(handle);
        },
      };
      props.add(handle);
      return handle;
    },

    /** @param {string} id @returns {any} */
    settlement(id) {
      return settlements[id] || null;
    },

    /** @param {string} settlementId @param {string} spotId @param {{x:number,y:number,z:number,yaw:number}} out @returns {boolean} */
    spot(settlementId, spotId, out) {
      const s = settlements[settlementId];
      if (!s) return false;
      for (let i = 0; i < s.spots.length; i++) {
        const p = s.spots[i];
        if (p.id !== spotId) continue;
        out.x = p.x; out.y = p.y; out.z = p.z; out.yaw = p.yaw;
        return true;
      }
      return false;
    },

    /** Remove props and settlements. */
    dispose() {
      for (const h of Array.from(props)) h.dispose();
      for (const m of settlementMeshes) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      settlementMeshes.length = 0;
    },
  };

  /** @type {any} */
  let glowGeo = null;
  function propGlowGeometry() {
    if (!glowGeo) glowGeo = new SphereGeometry(1, 10, 8);
    return glowGeo;
  }

  const clockSystem = {
    id: 'standin.env.clock',
    phase: { step: 'script', frame: 'world' },
    owner: OWNER,
    /** Advance the clock. @param {any} c @param {number} dt */
    step(c, dt) {
      const s = state();
      if (!s) return;
      if (clockScale > 0) {
        let h = s.hour + (dt * clockScale) / SECONDS_PER_HOUR;
        if (h >= 24) {
          h -= 24;
          s.day += 1;
        }
        s.hour = h;
      }
      emitHour();
    },
    /** Lighting from the clock. @param {any} c @param {number} dt */
    frame(c, dt) {
      computeSunDir(env.hour);
      applyLighting(dt);
    },
  };

  /** Apply `flags.hour` (start hour and frozen clock) when a journey loads. */
  function onLoaded() {
    lastHourInt = -1;
    lastPhase = '';
    const f = ctx.flags || {};
    const fh = Number(f.hour);
    if (f.hour !== undefined && f.hour !== null && f.hour !== '' && Number.isFinite(fh)) {
      env.setHour(fh);
      env.setClockScale(0);
    } else {
      emitHour();
    }
    snapFog = true;
  }

  return { env, clockSystem, onLoaded, buildSettlements };
}

/**
 * Install the stand-in env service under the owner 'standin:env'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { env, clockSystem, onLoaded, buildSettlements } = createEnv(ctx);
  ctx.provide('env', env, OWNER);
  ctx.systems.add(clockSystem);
  ctx.bus.on('game:loaded', onLoaded, OWNER);
  ctx.onBoot(() => {
    if (ctx.env === env) buildSettlements();
  });
}
