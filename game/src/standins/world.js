/**
 * Stand-in `ctx.world` (ARCHITECTURE 4.1, 8.0): an analytic noise island over the full 7168 m square.
 * `heightAt` evaluates three octaves of value noise per region (no baked grid), blended between the seven
 * regions of GDD 3.2 by noise-warped distance, inside a noise-warped coastline, with the landmark stamps of
 * GDD 3.3 and in-memory crater bowls applied on top.
 *
 * Visuals: a whole-island far mesh (56 m cells) plus a 768 m near patch (6 m cells) that follows the focus
 * and is rebuilt over a few frames (at once on `flushBuilds`). Below sea level both meshes are drawn flat at
 * y = 0 and coloured by depth (turquoise shallows, deep blue, a foam band at the shore), and an ocean plane
 * frames the world square out to the horizon. The Wellspring Spire marks the centre of the island.
 * Colliders live in a plain array; rays and sweeps march. Replaced by the world package.
 * @module standins/world
 */

import { BufferGeometry, BufferAttribute, Mesh, CylinderGeometry, Color } from 'three';
import { PALETTE } from '../core/palette.js';
import { BALANCE } from '../core/balance.js';
import { regionLevel as bandLevel } from '../core/formulas.js';
import { hash2 } from '../core/rng.js';
import { WORLD_SIZE, WORLD_HALF } from '../core/constants.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

const OWNER = 'standin:world';

/** Static collider flags (4.1). */
export const COLLIDER = Object.freeze({ SOLID: 1, PLATFORM: 2, DESTRUCTIBLE: 4, NO_CAMERA: 8 });

/** @param {object} o @returns {any} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/** Regions of GDD 3.2 (RegionDef, 5.8). Heights are the stand-in recipe. */
export const REGIONS = deepFreeze([
  { id: 'meadows', cx: -1300, cz: 1400, levels: [1, 6], biome: 'meadows', height: { base: 30, amp: 45, ridge: 0.15, terrace: 0 }, chestTable: 'chest_t1', musicKey: 'warm', content: true },
  { id: 'coast', cx: 700, cz: 2400, levels: [5, 10], biome: 'coast', height: { base: 6, amp: 22, ridge: 0.1, terrace: 0.3 }, chestTable: 'chest_t1', musicKey: 'warm', content: true },
  { id: 'thornwood', cx: -2200, cz: -400, levels: [8, 14], biome: 'thornwood', height: { base: 55, amp: 80, ridge: 0.35, terrace: 0 }, chestTable: 'chest_t2', musicKey: 'cold', content: true },
  { id: 'rustdune', cx: 2000, cz: 700, levels: [13, 20], biome: 'rustdune', height: { base: 40, amp: 70, ridge: 0.1, terrace: 0.6 }, chestTable: 'chest_t2', musicKey: 'warm', content: true },
  { id: 'frostspine', cx: -400, cz: -2300, levels: [19, 26], biome: 'frostspine', height: { base: 220, amp: 420, ridge: 0.8, terrace: 0 }, snowLine: 520, chestTable: 'chest_t3', musicKey: 'cold', content: true },
  { id: 'stormwell', cx: 2000, cz: -1700, levels: [24, 32], biome: 'stormwell', height: { base: 10, amp: 40, ridge: 0.25, terrace: 0 }, chestTable: 'chest_t3', musicKey: 'cold', content: false },
  { id: 'spire', cx: 0, cz: 0, radius: 450, levels: [24, 28], biome: 'spire', height: { base: 140, amp: 18, ridge: 0, terrace: 0.4 }, chestTable: 'chest_t3', musicKey: 'cold', content: true },
]);

/** Authored landmarks of GDD 3.3 (LandmarkDef, 5.8); y is resolved after the bake. */
export const LANDMARKS = deepFreeze([
  { id: 'sparkstead', x: -1430, z: 1580, type: 'settlement', stamp: { kind: 'flatten', radius: 110, falloff: 60 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'selas_ledge', x: -1650, z: 1860, type: 'training', stamp: { kind: 'plateau', radius: 60, height: 40, falloff: 50 }, tag: 'P0' },
  { id: 'haven_aster', x: -360, z: 1150, type: 'settlement', stamp: { kind: 'flatten', radius: 160, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'windmill_run', x: -1200, z: 1250, type: 'landmark', stamp: null, tag: 'P0' },
  { id: 'saltglass_arches', x: 1150, z: 2800, type: 'landmark', stamp: { kind: 'arch', radius: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'tide_beacon', x: 150, z: 2950, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'talias_camp', x: -1800, z: 150, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'bramble_hollow', x: -2580, z: -860, type: 'arena', stamp: { kind: 'basin', radius: 90, height: 25, falloff: 50 }, tag: 'P0' },
  { id: 'copperwatch', x: 1580, z: 430, type: 'settlement', stamp: { kind: 'flatten', radius: 80, falloff: 50 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'burrow_pit', x: 2300, z: 140, type: 'arena', stamp: { kind: 'basin', radius: 110, height: 35, falloff: 50 }, tag: 'P0' },
  { id: 'ridgerest', x: -860, z: -2000, type: 'settlement', stamp: { kind: 'flatten', radius: 90, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'still_wind', x: -300, z: -2500, type: 'settlement', stamp: { kind: 'flatten', radius: 70, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'paleglass_summit', x: 100, z: -2750, type: 'arena', stamp: { kind: 'flatten', radius: 100, falloff: 80 }, tag: 'P0' },
  { id: 'stormwell_eye', x: 2100, z: -1800, type: 'landmark', stamp: { kind: 'basin', radius: 120, height: 30, falloff: 60 }, tag: 'P0' },
  { id: 'spire_approach', x: 0, z: 520, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'dim_court', x: 0, z: 300, type: 'arena', stamp: { kind: 'flatten', radius: 120, falloff: 60 }, tag: 'P0' },
  { id: 'wellspring_spire', x: 0, z: 0, type: 'spire', stamp: { kind: 'spire', radius: 60 }, tag: 'P0' },
  { id: 'shattered_crown', x: 0, z: 0, type: 'landmark', stamp: null, tag: 'P0' },
  { id: 'siphon_1', x: -1000, z: 720, type: 'siphon', stamp: { kind: 'flatten', radius: 50, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_2', x: -2150, z: -215, type: 'siphon', stamp: null, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_3', x: 860, z: 2300, type: 'siphon', stamp: null, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_4', x: 1860, z: 1150, type: 'siphon', stamp: null, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_5', x: -1400, z: -2300, type: 'siphon', stamp: null, beacon: PALETTE.hostile, tag: 'P0' },
]);

/** Ora Shrines of GDD 3.4 (P0). */
const SHRINES = Object.freeze([[-1900, 1100], [-700, 1750], [300, 2450], [1500, 2400], [-2600, 100], [-1900, -900], [2450, 600], [1500, 1200], [-1300, -1900], [400, -2350]]);
/** Landmarks with a Ringstone (GDD 3.4). */
const RINGSTONE_AT = Object.freeze(['sparkstead', 'haven_aster', 'saltglass_arches', 'tide_beacon', 'talias_camp', 'copperwatch', 'ridgerest', 'still_wind', 'spire_approach']);
/** Regions with camps and free-standing chests. */
const CAMP_REGIONS = Object.freeze(['meadows', 'coast', 'thornwood', 'rustdune', 'frostspine']);

const SEA_FLOOR = -30;
const COAST_RADIUS = 3100;
const COAST_WARP = 250;
const SPIRE_RADIUS = 450;
const REGION_BLEND = 180;
const MAX_BOWLS = 64;
const MAX_COLLIDERS = 4096;

// Near patch and far mesh layout.
const NEAR_SEG = 128;
const NEAR_CELL = 6;
const NEAR_HALF = (NEAR_SEG * NEAR_CELL) / 2;
const NEAR_RECENTRE = 150;
const NEAR_ROWS_PER_FRAME = 12;
const FAR_SEG = 128;
const FAR_CELL = WORLD_SIZE / FAR_SEG;

/** @typedef {{ hit:boolean, t:number, x:number, y:number, z:number, nx:number, ny:number, nz:number, kind:'terrain'|'collider'|null, colliderId:number, propKey:number }} Hit */
/** @typedef {{ id:number, shape:'sphere'|'capsule'|'box'|'disc', x:number, y:number, z:number, r:number, h:number, hx:number, hz:number, yaw:number, flags:number, propKey:number }} Collider */
/** @typedef {{ id:string, type:string, x:number, y:number, z:number, regionId:string, data:object }} Poi */

/**
 * Create the stand-in world.
 * @param {any} ctx
 */
function createWorld(ctx) {
  const seed = (ctx.rng && ctx.rng.world ? ctx.rng.world.seed : 7168) >>> 0;
  const cellFlag = Number(ctx.flags && ctx.flags.grid);

  // ---------------------------------------------------------------- noise
  /** Value noise in [-1, 1]. */
  function vnoise(x, z, s) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, s) / 4294967296;
    const b = hash2(ix + 1, iz, s) / 4294967296;
    const c = hash2(ix, iz + 1, s) / 4294967296;
    const d = hash2(ix + 1, iz + 1, s) / 4294967296;
    return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
  }

  /** Three octaves of value noise in about [-1, 1]. */
  function fbm3(x, z, s) {
    return (vnoise(x, z, s) + 0.5 * vnoise(x * 2.03, z * 2.03, s + 1) + 0.25 * vnoise(x * 4.01, z * 4.01, s + 2)) / 1.75;
  }

  // ---------------------------------------------------------------- regions and raw height
  const NR = REGIONS.length;
  const weights = new Float64Array(NR);
  const regionIndex = Object.create(null);
  for (let i = 0; i < NR; i++) regionIndex[REGIONS[i].id] = i;
  const SPIRE_I = regionIndex.spire;
  let sampleLand = 0;

  /**
   * Fill `weights` with the blend weight of every region at (x, z) and return the index of the region the point
   * belongs to (nearest warped centre; 'spire' inside its radius).
   */
  function regionWeights(x, z) {
    const wx = x + 280 * vnoise(x / 900, z / 900, seed + 11);
    const wz = z + 280 * vnoise(x / 900 + 37, z / 900 + 71, seed + 12);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < NR; i++) {
      if (i === SPIRE_I) continue;
      const r = REGIONS[i];
      const d = Math.sqrt((wx - r.cx) * (wx - r.cx) + (wz - r.cz) * (wz - r.cz));
      weights[i] = d;
      if (d < bestD) { bestD = d; best = i; }
    }
    let sum = 0;
    for (let i = 0; i < NR; i++) {
      if (i === SPIRE_I) continue;
      const w = Math.exp(-(weights[i] - bestD) / REGION_BLEND);
      weights[i] = w;
      sum += w;
    }
    const rr = Math.sqrt(x * x + z * z);
    const sp = smoothstep(SPIRE_RADIUS + 120, SPIRE_RADIUS - 30, rr);
    for (let i = 0; i < NR; i++) if (i !== SPIRE_I) weights[i] = (weights[i] / sum) * (1 - sp);
    weights[SPIRE_I] = sp;
    return rr < SPIRE_RADIUS ? SPIRE_I : best;
  }

  /** Terrain height of one region recipe at (x, z). */
  function regionHeight(r, x, z) {
    const h = r.height;
    const n = fbm3(x / 520, z / 520, seed + 3);
    const ridged = 1 - Math.abs(fbm3(x / 700 + 13, z / 700 + 29, seed + 5));
    let v = h.base + h.amp * ((n * 0.5 + 0.5) * (1 - h.ridge) + ridged * ridged * h.ridge);
    if (h.terrace > 0) {
      const step = 14;
      const t = v / step;
      const f = t - Math.floor(t);
      v = lerp(v, (Math.floor(t) + smoothstep(0.35, 0.65, f)) * step, h.terrace);
    }
    return v;
  }

  /** Coastline radius in the direction of (x, z). */
  function coastRadius(x, z, r) {
    const inv = r > 1e-6 ? 1 / r : 0;
    return COAST_RADIUS + COAST_WARP * fbm3(x * inv * 2.2 + 50, z * inv * 2.2 + 50, seed + 7);
  }

  /** Height without stamps and craters; fills `weights`; returns the owning region index in `sampleRegion`. */
  let sampleRegion = 0;
  function rawHeight(x, z) {
    sampleRegion = regionWeights(x, z);
    let h = 0;
    for (let i = 0; i < NR; i++) {
      const w = weights[i];
      if (w > 0.002) h += w * regionHeight(REGIONS[i], x, z);
    }
    const r = Math.sqrt(x * x + z * z);
    const land = smoothstep(0, 1, (coastRadius(x, z, r) - r) / 450);
    sampleLand = land;
    return h * land + SEA_FLOOR * (1 - land);
  }

  // ---------------------------------------------------------------- stamps
  /** Precomputed stamps: [x, z, inner, outer, kind (0 flatten/plateau, 1 basin), target, depth]. */
  const stamps = [];
  for (const lm of LANDMARKS) {
    const s = lm.stamp;
    if (!s || (s.kind !== 'flatten' && s.kind !== 'plateau' && s.kind !== 'basin')) continue;
    const raw = rawHeight(lm.x, lm.z);
    const falloff = s.falloff !== undefined ? s.falloff : 40;
    if (s.kind === 'basin') {
      stamps.push({ x: lm.x, z: lm.z, inner: s.radius, outer: s.radius + falloff, basin: true, target: raw, depth: s.height || s.radius * 0.3 });
    } else {
      const base = Math.max(raw, lm.type === 'settlement' || lm.type === 'siphon' ? 5 : 2);
      stamps.push({ x: lm.x, z: lm.z, inner: s.radius, outer: s.radius + falloff, basin: false, target: base + (s.kind === 'plateau' ? s.height || 0 : 0), depth: 0 });
    }
  }

  // ---------------------------------------------------------------- craters
  const bowlX = new Float64Array(MAX_BOWLS);
  const bowlZ = new Float64Array(MAX_BOWLS);
  const bowlR = new Float64Array(MAX_BOWLS);
  const bowlD = new Float64Array(MAX_BOWLS);
  let bowlCount = 0;
  let bowlNext = 0;

  /** Full terrain height: raw, stamps, craters. Leaves the region blend in `weights`. */
  function sampleHeight(x, z) {
    let h = rawHeight(x, z);
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= s.outer * s.outer) continue;
      const d = Math.sqrt(d2);
      const w = smoothstep(s.outer, s.inner, d);
      if (s.basin) {
        const k = d < s.inner ? 1 - (d / s.inner) * (d / s.inner) : 0;
        h = lerp(h, s.target - s.depth * k, w);
      } else {
        h = lerp(h, s.target, w);
      }
    }
    for (let i = 0; i < bowlCount; i++) {
      const dx = x - bowlX[i];
      const dz = z - bowlZ[i];
      const r = bowlR[i];
      const lip = r * 1.25;
      const d2 = dx * dx + dz * dz;
      if (d2 >= lip * lip) continue;
      const q = Math.sqrt(d2) / r;
      h += q < 1 ? -bowlD[i] * (1 - q * q) + r * 0.08 * q * q : r * 0.08 * (1 - (q - 1) / 0.25);
    }
    return h;
  }

  // ---------------------------------------------------------------- colours
  const cTmp = new Color();
  const cMix = new Color();
  const cLand = new Color();
  /** Linear-space palette colours, built once. */
  const BIOME = REGIONS.map((r) => {
    const p = PALETTE.biome[r.biome];
    return { ground: new Color(p.ground), shade: new Color(p.shade), cliff: new Color(p.cliff), foliage: new Color(p.foliage) };
  });
  const C_SNOW = new Color(PALETTE.snow);
  const C_FOAM = new Color(PALETTE.ocean.foam);
  const C_SHALLOW = new Color(PALETTE.ocean.shallow);
  const C_DEEP = new Color(PALETTE.ocean.deep);
  const C_PATH = new Color(PALETTE.path);
  const C_PAPER = new Color(PALETTE.paper);

  /**
   * Ground colour at a sample whose height `h` and slope `slope` are known and whose blend is in `weights`.
   * @param {number} x @param {number} z @param {number} h @param {number} slope @param {Color} out
   */
  function groundColour(x, z, h, slope, out) {
    if (h < 0.15) {
      const depth = -h;
      if (depth < 1.2) return out.copy(C_FOAM).lerp(C_SHALLOW, smoothstep(0.2, 1.2, depth));
      return out.copy(C_SHALLOW).lerp(C_DEEP, smoothstep(2, 22, depth));
    }
    const patch = vnoise(x / 60, z / 60, seed + 21);
    const dither = (hash2(Math.floor(x / 9), Math.floor(z / 9), seed + 23) / 4294967296) * 0.5 - 0.25;
    cLand.setRGB(0, 0, 0);
    for (let i = 0; i < NR; i++) {
      const w = weights[i];
      if (w < 0.002) continue;
      const b = BIOME[i];
      cMix.copy(b.ground).lerp(b.shade, smoothstep(-0.2, 0.9, patch + dither) * 0.45);
      cMix.lerp(b.foliage, smoothstep(0.35, 0.75, vnoise(x / 140 + 9, z / 140 + 3, seed + 25)) * 0.35);
      cMix.lerp(b.cliff, smoothstep(0.5, 0.62, slope + dither * 0.1));
      cLand.r += cMix.r * w;
      cLand.g += cMix.g * w;
      cLand.b += cMix.b * w;
    }
    out.copy(cLand);
    const fs = weights[regionIndex.frostspine];
    if (fs > 0.05 && h > 520 + dither * 40 && slope < 0.6) out.lerp(C_SNOW, Math.min(1, fs * 1.5));
    if (h < 2.2) out.lerp(cTmp.copy(BIOME[regionIndex.coast].ground), smoothstep(2.2, 0.6, h) * 0.8);
    return out;
  }

  // ---------------------------------------------------------------- normals and slope
  /** Slope 0 (flat) .. 1 (vertical) from a unit normal's y. */
  function slopeFromNy(ny) {
    return Math.acos(clamp(ny, -1, 1)) / (Math.PI / 2);
  }

  // ---------------------------------------------------------------- colliders
  /** @type {Collider[]} */
  const colliders = [];
  let nextColliderId = 1;
  /** @type {Collider[]} */
  const candidates = [];

  /**
   * Inside test of a point against a collider inflated by `inflate`; writes the outward normal to `nOut`.
   * @param {Collider} c @param {number} px @param {number} py @param {number} pz @param {number} inflate @param {number[]} nOut
   */
  function insideCollider(c, px, py, pz, inflate, nOut) {
    const dx = px - c.x;
    const dz = pz - c.z;
    if (c.shape === 'sphere') {
      const dy = py - c.y;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= c.r + inflate) return false;
      const inv = d > 1e-6 ? 1 / d : 0;
      nOut[0] = dx * inv; nOut[1] = d > 1e-6 ? dy * inv : 1; nOut[2] = dz * inv;
      return true;
    }
    if (c.shape === 'capsule') {
      const y0 = c.y + c.r;
      const y1 = Math.max(y0, c.y + c.h - c.r);
      const cy = py < y0 ? y0 : py > y1 ? y1 : py;
      const dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= c.r + inflate) return false;
      const inv = d > 1e-6 ? 1 / d : 0;
      nOut[0] = dx * inv; nOut[1] = d > 1e-6 ? dy * inv : 1; nOut[2] = dz * inv;
      return true;
    }
    if (py < c.y - inflate || py > c.y + c.h + inflate) return false;
    if (c.shape === 'disc') {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= c.r + inflate) return false;
      const side = c.r + inflate - d;
      const top = c.y + c.h + inflate - py;
      if (top < side) { nOut[0] = 0; nOut[1] = 1; nOut[2] = 0; } else {
        const inv = d > 1e-6 ? 1 / d : 0;
        nOut[0] = dx * inv; nOut[1] = 0; nOut[2] = dz * inv;
      }
      return true;
    }
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const ex = c.hx + inflate - Math.abs(lx);
    const ez = c.hz + inflate - Math.abs(lz);
    if (ex <= 0 || ez <= 0) return false;
    const top = c.y + c.h + inflate - py;
    if (top < ex && top < ez) { nOut[0] = 0; nOut[1] = 1; nOut[2] = 0; return true; }
    const nlx = ex < ez ? Math.sign(lx) : 0;
    const nlz = ex < ez ? 0 : Math.sign(lz);
    nOut[0] = nlx * cs + nlz * sn; nOut[1] = 0; nOut[2] = -nlx * sn + nlz * cs;
    return true;
  }

  /** Horizontal reach of a collider. @param {Collider} c */
  function reach(c) {
    return c.shape === 'box' ? Math.sqrt(c.hx * c.hx + c.hz * c.hz) : c.r;
  }

  /** Collect SOLID colliders near the segment into `candidates`. */
  function gatherCandidates(ax, az, bx, bz, pad) {
    candidates.length = 0;
    const minX = Math.min(ax, bx) - pad;
    const maxX = Math.max(ax, bx) + pad;
    const minZ = Math.min(az, bz) - pad;
    const maxZ = Math.max(az, bz) + pad;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if ((c.flags & COLLIDER.SOLID) === 0) continue;
      const r = reach(c);
      if (c.x + r < minX || c.x - r > maxX || c.z + r < minZ || c.z - r > maxZ) continue;
      candidates.push(c);
    }
  }

  const nScratch = [0, 1, 0];

  /**
   * March a sphere of `radius` from a to b; fill `out` with the first contact.
   * @returns {boolean}
   */
  function march(ax, ay, az, bx, by, bz, radius, out) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.hit = false; out.t = 1; out.x = bx; out.y = by; out.z = bz; out.nx = 0; out.ny = 1; out.nz = 0;
    out.kind = null; out.colliderId = 0; out.propKey = 0;
    if (len < 1e-6) return false;
    gatherCandidates(ax, az, bx, bz, radius + 1);
    const stepLen = clamp(len / 200, 0.25, 4);
    const steps = Math.ceil(len / stepLen);
    let prevT = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const kind = blocked(ax + dx * t, ay + dy * t, az + dz * t, radius);
      if (kind === 0) { prevT = t; continue; }
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 8; k++) {
        const m = (lo + hi) * 0.5;
        if (blocked(ax + dx * m, ay + dy * m, az + dz * m, radius) !== 0) hi = m; else lo = m;
      }
      const px = ax + dx * hi;
      const py = ay + dy * hi;
      const pz = az + dz * hi;
      const k2 = blocked(px, py, pz, radius);
      out.hit = true;
      out.t = hi;
      out.x = px; out.y = py; out.z = pz;
      if (k2 === 1 || k2 === 0) {
        world.normalAt(px, pz, normalTmp);
        out.nx = normalTmp.x; out.ny = normalTmp.y; out.nz = normalTmp.z;
        out.kind = 'terrain';
      } else {
        out.nx = nScratch[0]; out.ny = nScratch[1]; out.nz = nScratch[2];
        out.kind = 'collider';
        out.colliderId = hitCollider ? hitCollider.id : 0;
        out.propKey = hitCollider ? hitCollider.propKey : 0;
      }
      return true;
    }
    return false;
  }

  /** @type {Collider|null} */
  let hitCollider = null;
  /** 0 free, 1 terrain, 2 collider (normal in nScratch, collider in hitCollider). */
  function blocked(px, py, pz, radius) {
    if (py - radius <= sampleHeight(px, pz)) return 1;
    for (let i = 0; i < candidates.length; i++) {
      if (insideCollider(candidates[i], px, py, pz, radius, nScratch)) {
        hitCollider = candidates[i];
        return 2;
      }
    }
    return 0;
  }

  const normalTmp = { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

  // ---------------------------------------------------------------- landmarks and POIs
  /** Landmark copies with y resolved after the bake. */
  const landmarks = LANDMARKS.map((l) => Object.assign({}, l, { y: 0 }));
  /** @type {Record<string, any>} */
  const landmarkById = Object.create(null);
  for (const l of landmarks) landmarkById[l.id] = l;
  /** @type {Poi[]} */
  const poiAll = [];
  /** @type {Record<string, Poi[]>} */
  const poiByType = { ringstone: [], shrine: [], camp: [], chest: [], siphon: [], race: [], crownChest: [] };
  const EMPTY_POIS = Object.freeze([]);

  function buildPois() {
    poiAll.length = 0;
    for (const k of Object.keys(poiByType)) poiByType[k].length = 0;
    const add = (id, type, x, y, z, data) => {
      const p = { id, type, x, y, z, regionId: world.regionAt(x, z), data };
      poiAll.push(p);
      poiByType[type].push(p);
    };
    for (const lmId of RINGSTONE_AT) {
      const l = landmarkById[lmId];
      add('ringstone_' + lmId, 'ringstone', l.x, world.heightAt(l.x, l.z), l.z, { landmarkId: lmId });
    }
    SHRINES.forEach(([x, z], i) => {
      add('shrine_' + String(i + 1).padStart(2, '0'), 'shrine', x, Math.max(0, world.heightAt(x, z)), z, {});
    });
    for (let i = 1; i <= 5; i++) {
      const l = landmarkById['siphon_' + i];
      add(l.id, 'siphon', l.x, world.heightAt(l.x, l.z), l.z, { landmarkId: l.id });
    }
    const wr = landmarkById.windmill_run;
    add('race_windmill_run', 'race', wr.x, world.heightAt(wr.x, wr.z), wr.z, { courseId: 'windmill_run' });

    const rng = ctx.rng.world.fork('standin.pois');
    const spot = { x: 0, y: 0, z: 0 };
    const settlements = landmarks.filter((l) => l.type === 'settlement');
    for (const regionId of CAMP_REGIONS) {
      const r = REGIONS[regionIndex[regionId]];
      /** @type {Array<[number, number]>} */
      const placed = [];
      for (let n = 1; n <= 5; n++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(280, 780);
          if (!world.findSpot(r.cx + Math.cos(a) * d, r.cz + Math.sin(a) * d, 120, spot, { maxSlope: 0.4 })) continue;
          if (world.regionAt(spot.x, spot.z) !== regionId) continue;
          if (settlements.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 250)) continue;
          if (placed.some(([px, pz]) => Math.hypot(px - spot.x, pz - spot.z) < 300) && attempt < 39) continue;
          placed.push([spot.x, spot.z]);
          add(`camp_${regionId}_${n}`, 'camp', spot.x, spot.y, spot.z, { tier: n <= 3 ? 1 : n === 4 ? 2 : 3, level: world.regionLevel(spot.x, spot.z) });
          break;
        }
      }
      for (let n = 1; n <= 4; n++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(150, 900);
          if (!world.findSpot(r.cx + Math.cos(a) * d, r.cz + Math.sin(a) * d, 80, spot, { maxSlope: 0.6 })) continue;
          if (world.regionAt(spot.x, spot.z) !== regionId && attempt < 39) continue;
          add(`chest_${regionId}_${n}`, 'chest', spot.x, spot.y, spot.z, { table: r.chestTable });
          break;
        }
      }
    }
    for (let n = 1; n <= 6; n++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(300, 700);
      add(`crownChest_spire_${n}`, 'crownChest', Math.cos(a) * d, rng.range(500, 900), Math.sin(a) * d, { table: 'chest_t3' });
    }
  }

  // ---------------------------------------------------------------- meshes
  /** @type {any} */
  let farMesh = null;
  /** @type {any} */
  let ocean = null;
  /** @type {any} */
  let spireMesh = null;
  /** @type {Float32Array|null} terrain heights of the far vertices (unsunk) */
  let farTrueY = null;
  /** Near patch double buffer. */
  /** @type {any[]} */
  const nearMeshes = [];
  let nearActive = -1;
  let nearCx = NaN;
  let nearCz = NaN;
  const NV = NEAR_SEG + 1;
  const NH = NV + 2;
  const nearH = new Float32Array(NH * NH);
  const nearSlope = new Float32Array(NV * NV);
  const job = { active: false, row: 0, cx: 0, cz: 0, target: 0 };
  let focusX = 0;
  let focusZ = 0;
  let sunkMinI = 0;
  let sunkMaxI = -1;
  let sunkMinJ = 0;
  let sunkMaxJ = -1;

  /** Index buffer of an n x n vertex grid. */
  function gridIndex(n) {
    const idx = new Uint16Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx[k++] = a; idx[k++] = a + n; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = a + n; idx[k++] = a + n + 1;
      }
    }
    return new BufferAttribute(idx, 1);
  }

  /** Empty grid geometry with position, normal and colour attributes. */
  function gridGeometry(n, index) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setIndex(index);
    return g;
  }

  function buildFar() {
    const n = FAR_SEG + 1;
    const g = gridGeometry(n, gridIndex(n));
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    const col = g.attributes.color.array;
    farTrueY = new Float32Array(n * n);
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * FAR_CELL;
        const z = -WORLD_HALF + j * FAR_CELL;
        hs[j * n + i] = sampleHeight(x, z);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -WORLD_HALF + i * FAR_CELL;
        const z = -WORLD_HALF + j * FAR_CELL;
        const h = hs[k];
        const vy = h > 0 ? h : 0;
        farTrueY[k] = vy;
        pos[k * 3] = x; pos[k * 3 + 1] = vy; pos[k * 3 + 2] = z;
        const hl = Math.max(0, hs[j * n + Math.max(0, i - 1)]);
        const hr = Math.max(0, hs[j * n + Math.min(n - 1, i + 1)]);
        const hu = Math.max(0, hs[Math.max(0, j - 1) * n + i]);
        const hd = Math.max(0, hs[Math.min(n - 1, j + 1) * n + i]);
        let nx = hl - hr;
        let ny = 2 * FAR_CELL;
        let nz = hu - hd;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
        sampleHeight(x, z);
        groundColour(x, z, h, slopeFromNy(ny), cTmp);
        col[k * 3] = cTmp.r; col[k * 3 + 1] = cTmp.g; col[k * 3 + 2] = cTmp.b;
      }
    }
    const farMat = ctx.render.materials.toon({ vertexColors: true });
    farMat.polygonOffset = true;
    farMat.polygonOffsetFactor = 1;
    farMat.polygonOffsetUnits = 4;
    farMesh = new Mesh(g, farMat);
    farMesh.frustumCulled = false;
    farMesh.matrixAutoUpdate = false;
    farMesh.updateMatrix();
    ctx.render.layers.world.add(farMesh);
  }

  /** Lower the far vertices fully covered by the near patch centred at (cx, cz); restore the previous set. */
  function sinkFar(cx, cz) {
    if (!farMesh || !farTrueY) return;
    const n = FAR_SEG + 1;
    const pos = farMesh.geometry.attributes.position.array;
    for (let j = sunkMinJ; j <= sunkMaxJ; j++) for (let i = sunkMinI; i <= sunkMaxI; i++) pos[(j * n + i) * 3 + 1] = farTrueY[j * n + i];
    const inset = NEAR_HALF - FAR_CELL - 1;
    sunkMinI = Math.max(0, Math.ceil((cx - inset + WORLD_HALF) / FAR_CELL));
    sunkMaxI = Math.min(n - 1, Math.floor((cx + inset + WORLD_HALF) / FAR_CELL));
    sunkMinJ = Math.max(0, Math.ceil((cz - inset + WORLD_HALF) / FAR_CELL));
    sunkMaxJ = Math.min(n - 1, Math.floor((cz + inset + WORLD_HALF) / FAR_CELL));
    for (let j = sunkMinJ; j <= sunkMaxJ; j++) for (let i = sunkMinI; i <= sunkMaxI; i++) pos[(j * n + i) * 3 + 1] = farTrueY[j * n + i] - 60;
    farMesh.geometry.attributes.position.needsUpdate = true;
  }

  function ensureNear() {
    if (nearMeshes.length) return;
    const index = gridIndex(NV);
    for (let b = 0; b < 2; b++) {
      const m = new Mesh(gridGeometry(NV, index), ctx.render.materials.toon({ vertexColors: true }));
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.visible = false;
      ctx.render.layers.world.add(m);
      nearMeshes.push(m);
    }
  }

  /** Start rebuilding the near patch around (x, z) into the hidden buffer. */
  function startJob(x, z) {
    ensureNear();
    job.active = true;
    job.row = 0;
    job.cx = Math.round(x / (NEAR_CELL * 4)) * NEAR_CELL * 4;
    job.cz = Math.round(z / (NEAR_CELL * 4)) * NEAR_CELL * 4;
    job.target = nearActive === 0 ? 1 : 0;
  }

  /** Advance the near job by up to `rows` height rows; finish (normals, colours, swap) when done. */
  function runJob(rows) {
    if (!job.active) return;
    const x0 = job.cx - NEAR_HALF - NEAR_CELL;
    const z0 = job.cz - NEAR_HALF - NEAR_CELL;
    const end = Math.min(NH, job.row + rows);
    for (let j = job.row; j < end; j++) {
      const z = z0 + j * NEAR_CELL;
      for (let i = 0; i < NH; i++) nearH[j * NH + i] = sampleHeight(x0 + i * NEAR_CELL, z);
    }
    job.row = end;
    if (job.row < NH) return;
    const m = nearMeshes[job.target];
    const g = m.geometry;
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    const col = g.attributes.color.array;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NV; i++) {
        const k = j * NV + i;
        const hk = (j + 1) * NH + (i + 1);
        const h = nearH[hk];
        const x = job.cx - NEAR_HALF + i * NEAR_CELL;
        const z = job.cz - NEAR_HALF + j * NEAR_CELL;
        pos[k * 3] = x; pos[k * 3 + 1] = h > 0 ? h : 0; pos[k * 3 + 2] = z;
        const hl = nearH[hk - 1];
        const hr = nearH[hk + 1];
        const hu = nearH[hk - NH];
        const hd = nearH[hk + NH];
        const tl = Math.max(0, hl) - Math.max(0, hr);
        const tz = Math.max(0, hu) - Math.max(0, hd);
        let ny = 2 * NEAR_CELL;
        const inv = 1 / Math.sqrt(tl * tl + ny * ny + tz * tz);
        nor[k * 3] = tl * inv; ny *= inv; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = tz * inv;
        const sx = hl - hr;
        const sz = hu - hd;
        const sl = slopeFromNy((2 * NEAR_CELL) / Math.sqrt(sx * sx + 4 * NEAR_CELL * NEAR_CELL + sz * sz));
        nearSlope[k] = sl;
        regionWeights(x, z);
        groundColour(x, z, h, sl, cTmp);
        col[k * 3] = cTmp.r; col[k * 3 + 1] = cTmp.g; col[k * 3 + 2] = cTmp.b;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    m.visible = true;
    if (nearActive >= 0 && nearActive !== job.target) nearMeshes[nearActive].visible = false;
    nearActive = job.target;
    nearCx = job.cx;
    nearCz = job.cz;
    job.active = false;
    sinkFar(nearCx, nearCz);
  }

  /** Recompute far vertices touched by a crater bowl. */
  function refreshFarAround(x, z, r) {
    if (!farMesh || !farTrueY) return;
    const n = FAR_SEG + 1;
    const pos = farMesh.geometry.attributes.position.array;
    const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / FAR_CELL));
    const i1 = Math.min(n - 1, Math.ceil((x + r + WORLD_HALF) / FAR_CELL));
    const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / FAR_CELL));
    const j1 = Math.min(n - 1, Math.ceil((z + r + WORLD_HALF) / FAR_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        const h = sampleHeight(-WORLD_HALF + i * FAR_CELL, -WORLD_HALF + j * FAR_CELL);
        farTrueY[k] = h > 0 ? h : 0;
        const sunk = i >= sunkMinI && i <= sunkMaxI && j >= sunkMinJ && j <= sunkMaxJ;
        pos[k * 3 + 1] = farTrueY[k] - (sunk ? 60 : 0);
      }
    }
    farMesh.geometry.attributes.position.needsUpdate = true;
  }

  function buildSpire() {
    const geo = new CylinderGeometry(42, 60, 900, 6, 1);
    geo.translate(0, 450, 0);
    const mat = ctx.render.materials.toon({ color: PALETTE.biome.spire.ground, emissive: PALETTE.ora, emissiveIntensity: 0.12, fogScale: 0.5, glossy: true });
    spireMesh = new Mesh(geo, mat);
    spireMesh.position.set(0, Math.max(0, sampleHeight(0, 0)) - 5, 0);
    spireMesh.matrixAutoUpdate = false;
    spireMesh.updateMatrix();
    ctx.render.layers.world.add(spireMesh);
    world.addCollider({ shape: 'capsule', x: 0, y: spireMesh.position.y, z: 0, r: 60, h: 905, hx: 0, hz: 0, yaw: 0, flags: COLLIDER.SOLID, propKey: 0 });
  }

  /** Static ocean frame around the world square out to the horizon (the far mesh draws the sea inside it). */
  function buildOcean() {
    const inner = WORLD_HALF;
    const outer = 14000;
    const quads = [[-outer, -outer, outer, -inner], [-outer, inner, outer, outer], [-outer, -inner, -inner, inner], [inner, -inner, outer, inner]];
    const pos = new Float32Array(quads.length * 18);
    let k = 0;
    for (const [x0, z0, x1, z1] of quads) {
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        pos[k++] = x; pos[k++] = 0; pos[k++] = z;
      }
    }
    const nor = new Float32Array(pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    ocean = new Mesh(geo, ctx.render.materials.toon({ color: PALETTE.ocean.deep }));
    ocean.frustumCulled = false;
    ocean.matrixAutoUpdate = false;
    ocean.updateMatrix();
    ctx.render.layers.world.add(ocean);
  }

  // ---------------------------------------------------------------- region tracking
  let lastRegion = /** @type {string|null} */ (null);
  const regionPayload = { regionId: '', prevRegionId: /** @type {string|null} */ (null), first: false };

  // ---------------------------------------------------------------- the service
  const world = {
    size: WORLD_SIZE,
    half: WORLD_HALF,
    cell: cellFlag === 8 ? 8 : 4,
    seaLevel: 0,
    islandRadius: 3100,
    edgeStart: 3300,
    edgeHard: 3450,
    ceiling: BALANCE.move.ceiling,
    /** @type {ReadonlyArray<any>} */
    regions: REGIONS,

    /**
     * Build the meshes and resolve landmarks and POIs. Emits world:baked.
     * @param {(progress:number)=>void} [onProgress] @returns {Promise<void>}
     */
    async bake(onProgress) {
      const clock = typeof performance !== 'undefined' ? () => performance.now() : () => 0;
      const t0 = clock();
      const report = (p) => { if (typeof onProgress === 'function') onProgress(p); };
      report(0);
      for (const l of landmarks) l.y = sampleHeight(l.x, l.z);
      const s = ctx.store && ctx.store.state && ctx.store.state.player;
      focusX = s ? s.x : landmarkById.sparkstead.x;
      focusZ = s ? s.z : landmarkById.sparkstead.z;
      if (ctx.render && ctx.render.layers) {
        buildFar();
        report(0.5);
        buildOcean();
        buildSpire();
        startJob(focusX, focusZ);
        runJob(NH);
      }
      report(0.8);
      buildPois();
      report(1);
      ctx.bus.emit('world:baked', { seed, ms: clock() - t0 });
    },

    /** @param {number} x @param {number} z @returns {number} */
    heightAt(x, z) {
      return sampleHeight(clamp(x, -WORLD_HALF, WORLD_HALF), clamp(z, -WORLD_HALF, WORLD_HALF));
    },

    /** @param {number} x @param {number} z @param {any} out @returns {any} */
    normalAt(x, z, out) {
      const e = 1.5;
      const nx = world.heightAt(x - e, z) - world.heightAt(x + e, z);
      const nz = world.heightAt(x, z - e) - world.heightAt(x, z + e);
      const ny = 2 * e;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      return out.set(nx * inv, ny * inv, nz * inv);
    },

    /** @param {number} x @param {number} z @returns {number} 0 flat .. 1 vertical */
    slopeAt(x, z) {
      world.normalAt(x, z, normalTmp);
      return slopeFromNy(normalTmp.y);
    },

    /** @param {number} x @param {number} y @param {number} z @returns {number} */
    groundAt(x, y, z) {
      let g = world.heightAt(x, z);
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if ((c.flags & COLLIDER.PLATFORM) === 0) continue;
        const top = c.y + c.h;
        if (top > y + 1 || top <= g) continue;
        if (insideCollider(c, x, top - 0.01, z, 0, nScratch)) g = top;
      }
      return g;
    },

    /** @param {number} x @param {number} z @returns {number} */
    waterDepthAt(x, z) {
      const d = -world.heightAt(x, z);
      return d > 0 ? d : 0;
    },

    /** @param {number} x @param {number} z @returns {'grass'|'stone'|'snow'|'sand'|'water'} */
    surfaceAt(x, z) {
      const h = world.heightAt(x, z);
      if (h < 0) return 'water';
      const region = REGIONS[sampleRegion].id;
      if (region === 'frostspine' && h > 520) return 'snow';
      if (h < 2.2 || region === 'coast' || region === 'rustdune') return 'sand';
      if (region === 'spire' || region === 'stormwell' || world.slopeAt(x, z) > 0.62) return 'stone';
      return 'grass';
    },

    /** @param {number} x @param {number} z @returns {string} */
    regionAt(x, z) {
      return REGIONS[regionWeights(clamp(x, -WORLD_HALF, WORLD_HALF), clamp(z, -WORLD_HALF, WORLD_HALF))].id;
    },

    /** @param {number} x @param {number} z @returns {number} */
    regionLevel(x, z) {
      const r = REGIONS[regionWeights(clamp(x, -WORLD_HALF, WORLD_HALF), clamp(z, -WORLD_HALF, WORLD_HALF))];
      const sp = landmarkById.sparkstead;
      const d = Math.hypot(x - sp.x, z - sp.z);
      const dc = Math.hypot(r.cx - sp.x, r.cz - sp.z);
      return bandLevel(r.levels, 0.5 + (d - dc) / 1200);
    },

    /** @param {number} x @param {number} z @returns {number} */
    edgeFactor(x, z) {
      const r = Math.sqrt(x * x + z * z);
      return clamp((r - world.edgeStart) / (world.edgeHard - world.edgeStart), 0, 1);
    },

    /** @returns {boolean} */
    raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = maxDist / len;
      return march(ox, oy, oz, ox + dx * k, oy + dy * k, oz + dz * k, 0, out);
    },

    /** @returns {boolean} */
    sweepSphere(ax, ay, az, bx, by, bz, radius, out) {
      return march(ax, ay, az, bx, by, bz, radius, out);
    },

    /** Terrain only, 8 m steps. @returns {boolean} */
    lineOfSight(ax, ay, az, bx, by, bz) {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const steps = Math.max(1, Math.ceil(len / 8));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (ay + dy * t < world.heightAt(ax + dx * t, az + dz * t)) return false;
      }
      return true;
    },

    /** @param {number} x @param {number} z @param {number} r @param {Collider[]} out @returns {number} */
    queryColliders(x, z, r, out) {
      let n = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const reachR = reach(c) + r;
        const dx = c.x - x;
        const dz = c.z - z;
        if (dx * dx + dz * dz <= reachR * reachR) out[n++] = c;
      }
      out.length = n;
      return n;
    },

    /** @param {Omit<Collider, 'id'>} def @returns {number} */
    addCollider(def) {
      if (colliders.length >= MAX_COLLIDERS) return 0;
      const c = {
        id: nextColliderId++, shape: def.shape || 'sphere', x: def.x || 0, y: def.y || 0, z: def.z || 0, r: def.r || 0, h: def.h || 0,
        hx: def.hx || 0, hz: def.hz || 0, yaw: def.yaw || 0, flags: def.flags !== undefined ? def.flags : COLLIDER.SOLID, propKey: def.propKey || 0,
      };
      colliders.push(c);
      return c.id;
    },

    /** @param {number} id */
    removeCollider(id) {
      for (let i = 0; i < colliders.length; i++) {
        if (colliders[i].id === id) {
          colliders.splice(i, 1);
          return;
        }
      }
    },

    /**
     * Crater bowl (radius >= 6 edits the terrain). Always emits world:crater.
     * @param {number} x @param {number} z @param {number} radius @param {number} depth @param {number} [sourceId]
     */
    crater(x, z, radius, depth, sourceId = 0) {
      const r = Math.max(0, radius);
      const d = clamp(depth, 0, 0.3 * r);
      const deformed = r >= 6;
      if (deformed) {
        bowlX[bowlNext] = x; bowlZ[bowlNext] = z; bowlR[bowlNext] = r; bowlD[bowlNext] = d;
        bowlNext = (bowlNext + 1) % MAX_BOWLS;
        if (bowlCount < MAX_BOWLS) bowlCount++;
        refreshFarAround(x, z, r * 1.3 + FAR_CELL);
        if (nearActive >= 0 && Math.abs(x - nearCx) < NEAR_HALF + r && Math.abs(z - nearCz) < NEAR_HALF + r) {
          startJob(nearCx, nearCz);
        }
      }
      ctx.bus.emit('world:crater', { x, y: world.heightAt(x, z), z, radius: r, depth: d, deformed, sourceId });
    },

    /** Destroy DESTRUCTIBLE colliders touching the sphere. @returns {number} */
    damageProps(x, y, z, radius, damage, sourceId = 0) {
      let n = 0;
      for (let i = colliders.length - 1; i >= 0; i--) {
        const c = colliders[i];
        if ((c.flags & COLLIDER.DESTRUCTIBLE) === 0 || damage <= 0) continue;
        if (!insideCollider(c, x, y, z, radius, nScratch)) continue;
        colliders.splice(i, 1);
        n++;
        ctx.bus.emit('world:propDestroyed', { key: c.propKey, kind: 'rock', x: c.x, y: c.y, z: c.z, sourceId });
      }
      return n;
    },

    /** @param {string} id @returns {any} */
    landmark(id) {
      return landmarkById[id] || null;
    },

    /** @param {string} [type] @returns {ReadonlyArray<Poi>} live list, do not mutate */
    pois(type) {
      if (type === undefined) return poiAll;
      return poiByType[type] || EMPTY_POIS;
    },

    /**
     * Nearest dry, walkable, collider-free spot within `radius`.
     * @param {number} x @param {number} z @param {number} radius @param {{x:number,y:number,z:number}} out
     * @param {{ maxSlope?:number, clearance?:number }} [opts] @returns {boolean}
     */
    findSpot(x, z, radius, out, opts) {
      const maxSlope = opts && opts.maxSlope !== undefined ? opts.maxSlope : 0.5;
      const clearance = opts && opts.clearance !== undefined ? opts.clearance : 1.5;
      const ring = 4;
      for (let rr = 0; rr <= radius; rr += ring) {
        const count = rr === 0 ? 1 : Math.max(6, Math.floor((Math.PI * 2 * rr) / ring));
        for (let k = 0; k < count; k++) {
          const a = (k / count) * Math.PI * 2;
          const px = x + Math.cos(a) * rr;
          const pz = z + Math.sin(a) * rr;
          const h = world.heightAt(px, pz);
          if (h < 0.5 || world.edgeFactor(px, pz) > 0) continue;
          if (world.slopeAt(px, pz) > maxSlope) continue;
          let free = true;
          for (let i = 0; i < colliders.length && free; i++) {
            if ((colliders[i].flags & COLLIDER.SOLID) && insideCollider(colliders[i], px, h + 1, pz, clearance, nScratch)) free = false;
          }
          if (!free) continue;
          out.x = px; out.y = h; out.z = pz;
          return true;
        }
      }
      out.x = x; out.y = world.heightAt(x, z); out.z = z;
      return false;
    },

    /** Streaming centre (the camera position). @param {number} x @param {number} y @param {number} z */
    setFocus(x, y, z) {
      focusX = x;
      focusZ = z;
    },

    /** Build the near patch for the current focus now. */
    flushBuilds() {
      if (!nearMeshes.length) return;
      if (!job.active && (Math.abs(focusX - nearCx) > NEAR_RECENTRE || Math.abs(focusZ - nearCz) > NEAR_RECENTRE)) startJob(focusX, focusZ);
      runJob(NH);
    },

    /** Parchment map of the whole square, north up; cached per size. @param {number} size @returns {HTMLCanvasElement} */
    mapCanvas(size) {
      const s = size === 512 ? 512 : 256;
      if (mapCache[s]) return mapCache[s];
      const canvas = document.createElement('canvas');
      canvas.width = s;
      canvas.height = s;
      const g = canvas.getContext('2d');
      const img = g.createImageData(s, s);
      const paperMix = 0.3;
      for (let py = 0; py < s; py++) {
        for (let px = 0; px < s; px++) {
          const x = -WORLD_HALF + ((px + 0.5) / s) * WORLD_SIZE;
          const z = -WORLD_HALF + ((py + 0.5) / s) * WORLD_SIZE;
          const h = sampleHeight(x, z);
          groundColour(x, z, h, 0, cTmp);
          cTmp.lerp(C_PAPER, paperMix);
          cTmp.convertLinearToSRGB();
          const k = (py * s + px) * 4;
          img.data[k] = cTmp.r * 255; img.data[k + 1] = cTmp.g * 255; img.data[k + 2] = cTmp.b * 255; img.data[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      mapCache[s] = canvas;
      return canvas;
    },

    /** @param {number} x @param {number} z @param {{u:number,v:number}} out */
    toMap(x, z, out) {
      out.u = (x + WORLD_HALF) / WORLD_SIZE;
      out.v = (z + WORLD_HALF) / WORLD_SIZE;
      return out;
    },

    /** Remove the meshes. */
    dispose() {
      for (const m of [farMesh, ocean, spireMesh, ...nearMeshes]) {
        if (!m) continue;
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      nearMeshes.length = 0;
      farMesh = null;
      ocean = null;
      spireMesh = null;
      nearActive = -1;
    },
  };

  /** @type {Record<number, HTMLCanvasElement>} */
  const mapCache = {};

  const streamSystem = {
    id: 'standin.world.stream',
    phase: { step: 'post', frame: 'world' },
    owner: OWNER,
    /** Region-enter tracking for the player. @param {any} c */
    step(c) {
      const p = c.player;
      if (!p || !p.alive) return;
      const id = world.regionAt(p.pos.x, p.pos.z);
      if (id === lastRegion) return;
      const seen = c.store && c.store.state.world ? c.store.state.world.regionsSeen : null;
      const first = !!seen && seen.indexOf(id) < 0;
      if (first) {
        seen.push(id);
        c.store.set('world.regionsSeen', seen);
      }
      regionPayload.regionId = id;
      regionPayload.prevRegionId = lastRegion;
      regionPayload.first = first;
      lastRegion = id;
      c.bus.emit('world:regionEnter', regionPayload);
    },
    /** Near patch streaming. */
    frame(c) {
      if (!nearMeshes.length) return;
      if (!job.active && (Math.abs(focusX - nearCx) > NEAR_RECENTRE || Math.abs(focusZ - nearCz) > NEAR_RECENTRE)) startJob(focusX, focusZ);
      runJob(NEAR_ROWS_PER_FRAME);
    },
  };

  return { world, streamSystem, resetRegion() { lastRegion = null; } };
}

/**
 * Install the stand-in world under the owner 'standin:world'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { world, streamSystem, resetRegion } = createWorld(ctx);
  ctx.provide('world', world, OWNER);
  ctx.systems.add(streamSystem);
  ctx.bus.on('game:loaded', resetRegion, OWNER);
  ctx.bus.on('game:ended', resetRegion, OWNER);
}
