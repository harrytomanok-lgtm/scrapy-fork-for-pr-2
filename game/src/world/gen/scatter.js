/**
 * Per-cell seeded scatter of vegetation, rocks and ground cover (ARCHITECTURE 4.1; world pass: region identity). A
 * 128 m cell always yields the same props for a seed. The scatter composes rather than sprinkles:
 * - trees on a jittered 13 m lattice kept by the baked canopy layer (groves with a soft edge, clearings, a few lone
 *   trees in the open), each region with its own species mix and size range, plus tree lines in the path verges;
 * - ground cover (bushes, ferns, flower patches in the baked flower fields, tall grass, scrub, mushrooms) on a
 *   finer lattice that clusters at grove edges and in fields;
 * - rocks in clusters around a few seeded centres per cell, each region with its own rock shapes.
 * Species and shapes come from the region layer, everything else from `hash2`. Pure, allocation-free.
 * @module world/gen/scatter
 */

import { hash2 } from '../../core/rng.js';
import { WORLD_HALF } from '../../core/constants.js';
import { FLAG, R_MEADOWS, R_COAST, R_THORNWOOD, R_RUSTDUNE, R_FROSTSPINE, R_STORMWELL, R_SPIRE } from './layout.js';

/** Prop kinds (one instanced mesh each). 0-9 are the original kinds; the rest are world-pass additions. */
export const KIND = Object.freeze({
  CEDAR: 0, MAPLE: 1, PALM: 2, BRAMBLE: 3, CACTUS: 4, PINE: 5, REED: 6, CRYSTAL: 7, ROCK: 8, PILLAR: 9,
  POPLAR: 10, SNAG: 11, FIR: 12, BUSH: 13, FLOWERS: 14, FERN: 15, GRASS: 16, SCRUB: 17, MUSHROOM: 18, SLAB: 19,
  SHARD: 20, BASALT: 21,
});
export const KIND_COUNT = 22;
/** Draw class of each kind: 0 tree (tree radius and cap), 1 rock (rock radius and cap), 2 ground cover. */
export const CLASS = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
/** Kinds counted against the tree cap (1). Kept for older callers; CLASS is the full table. */
export const IS_TREE = Object.freeze(CLASS.map((c) => (c === 0 ? 1 : 0)));
/** Prop kind names for world:propDestroyed. */
export const KIND_NAME = Object.freeze([
  'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'reed', 'crystal', 'rock', 'pillar',
  'tree', 'tree', 'tree', 'bush', 'flowers', 'fern', 'grass', 'bush', 'mushroom', 'rock', 'crystal', 'pillar',
]);
/** Scatter cell size in metres. */
export const SCATTER_CELL = 128;
/** Cells per side of the world square. */
export const SCATTER_N = 56;
/** Max props one cell can yield. */
export const CELL_MAX = 420;

const TREE_STEP = 13;
const TREE_COLS = Math.floor(SCATTER_CELL / TREE_STEP);
const COVER_STEP = 6.4;
const COVER_COLS = SCATTER_CELL / COVER_STEP;
/** Base size of each ground cover kind (indexed by KIND; 0 elsewhere). */
const COVER_S = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.45, 1.9, 1.4, 1.5, 1.7, 1.15, 0, 0.85, 0]);

/** Rock clusters per cell by region, and the chance that one is kept (more on slopes). */
const ROCKY = Object.freeze([0.3, 0.32, 0.4, 0.55, 0.65, 0.55, 0.4]);
/** Ground cover density by region (candidates kept at the fullest spot). */
const COVER = Object.freeze([0.9, 0.6, 0.95, 0.55, 0.45, 0.75, 0.4]);
/** Size range of the trees by region: min, span. */
const TREE_S0 = Object.freeze([1.65, 1.3, 1.8, 1.0, 1.45, 1.0, 1.0]);
const TREE_S1 = Object.freeze([1.0, 0.7, 1.3, 0.9, 1.1, 0.8, 0.9]);
/** Rock size by region: Rustdune hoodoos and Stormwell columns stand tall, Coast shards read from the air. */
const ROCK_S = Object.freeze([1.0, 1.3, 1.1, 1.9, 1.15, 1.5, 1.2]);

/**
 * Output buffers of one cell.
 * @returns {{ n:number, kind:Uint8Array, x:Float32Array, y:Float32Array, z:Float32Array, s:Float32Array, yaw:Float32Array, key:Int32Array, tint:Uint8Array }}
 */
export function createCellBuffer() {
  return {
    n: 0, kind: new Uint8Array(CELL_MAX), x: new Float32Array(CELL_MAX), y: new Float32Array(CELL_MAX), z: new Float32Array(CELL_MAX),
    s: new Float32Array(CELL_MAX), yaw: new Float32Array(CELL_MAX), key: new Int32Array(CELL_MAX), tint: new Uint8Array(CELL_MAX),
  };
}

/**
 * Discs kept clear of props (landmark stamps, points of interest, authored places). Filled by the owner; read by
 * scatterCell. Pure data.
 * @param {number} [max]
 * @returns {{ n:number, x:Float32Array, z:Float32Array, r:Float32Array }}
 */
export function createClearSet(max = 256) {
  return { n: 0, x: new Float32Array(max), z: new Float32Array(max), r: new Float32Array(max) };
}

/** @param {ReturnType<typeof createClearSet>} c @param {number} x @param {number} z @param {number} r */
export function addClear(c, x, z, r) {
  if (c.n >= c.x.length) return;
  c.x[c.n] = x;
  c.z[c.n] = z;
  c.r[c.n] = r;
  c.n++;
}

/** Stable prop key of item `idx` in cell (ci, cj). Always > 0. */
export function propKey(ci, cj, idx) {
  return ((ci & 255) << 20) | ((cj & 255) << 12) | (idx & 4095) | (1 << 29);
}

/** @param {number} h @returns {number} 0..1 */
function u(h) {
  return (h >>> 0) / 4294967296;
}

/**
 * Tree species of a region at a point. `verge` is a tree-line spot beside a path, `edge` the canopy density.
 * @param {number} ri @param {number} h hash @param {number} height @param {boolean} verge @param {number} dens
 */
function treeKind(ri, h, height, verge, dens) {
  const r = h & 15;
  switch (ri) {
    case R_MEADOWS:
      if (verge) return KIND.POPLAR;
      if (dens < 0.2) return r < 7 ? KIND.MAPLE : KIND.CEDAR;
      return r < 3 ? KIND.MAPLE : r < 5 ? KIND.POPLAR : KIND.CEDAR;
    case R_COAST:
      if (height > 18 && r < 9) return r < 4 ? KIND.POPLAR : KIND.CEDAR;
      return r === 0 ? KIND.SNAG : KIND.PALM;
    case R_THORNWOOD:
      if (r === 0) return KIND.MAPLE;
      if (r === 1) return KIND.SNAG;
      return r < 8 ? KIND.FIR : KIND.BRAMBLE;
    case R_RUSTDUNE: return r < 5 ? KIND.SNAG : KIND.CACTUS;
    case R_FROSTSPINE:
      if (height < 120) return r < 6 ? KIND.FIR : r < 8 ? KIND.CEDAR : KIND.PINE;
      return r === 0 ? KIND.SNAG : KIND.PINE;
    case R_STORMWELL:
      if (height < 6) return KIND.REED;
      return r < 4 ? KIND.CRYSTAL : r < 8 ? KIND.SNAG : KIND.REED;
    case R_SPIRE: return KIND.CRYSTAL;
    default: return KIND.CEDAR;
  }
}

/**
 * Ground cover kind of a region (0 = none). `field` is a flower field spot, `edge` the canopy density (grove
 * edges and floors take bushes and ferns), `tint` gets the colour variant (0..3).
 * @param {number} ri @param {number} h @param {boolean} field @param {number} edge @param {number} height
 */
function coverKind(ri, h, field, edge, height) {
  const r = h & 15;
  if (field) return KIND.FLOWERS;
  switch (ri) {
    case R_MEADOWS:
      if (edge > 0.12) return r < 9 ? KIND.BUSH : KIND.FERN;
      return r < 6 ? KIND.GRASS : r < 9 ? KIND.BUSH : r < 11 ? KIND.FLOWERS : 0;
    case R_COAST:
      if (height < 6) return r < 10 ? KIND.GRASS : 0;
      return r < 6 ? KIND.GRASS : r < 11 ? KIND.BUSH : 0;
    case R_THORNWOOD:
      if (edge > 0.25) return r < 8 ? KIND.FERN : r < 11 ? KIND.MUSHROOM : KIND.BUSH;
      return r < 6 ? KIND.FERN : r < 10 ? KIND.BUSH : r < 12 ? KIND.MUSHROOM : 0;
    case R_RUSTDUNE: return r < 9 ? KIND.SCRUB : r < 11 ? KIND.GRASS : 0;
    case R_FROSTSPINE:
      if (height > 470) return 0;
      return r < 4 ? KIND.SHARD : r < 8 ? KIND.SCRUB : r < 11 ? KIND.GRASS : 0;
    case R_STORMWELL: return r < 9 ? KIND.GRASS : r < 12 ? KIND.SCRUB : 0;
    case R_SPIRE: return r < 7 ? KIND.SHARD : r < 10 ? KIND.GRASS : 0;
    default: return 0;
  }
}

/** Rock shape of a region. @param {number} ri @param {number} h */
function rockKind(ri, h) {
  const r = h & 15;
  switch (ri) {
    case R_MEADOWS: return r < 3 ? KIND.SLAB : KIND.ROCK;
    case R_COAST: return r < 6 ? KIND.SHARD : r < 8 ? KIND.PILLAR : KIND.ROCK;
    case R_THORNWOOD: return r < 3 ? KIND.PILLAR : KIND.ROCK;
    case R_RUSTDUNE: return r < 8 ? KIND.SLAB : r < 11 ? KIND.PILLAR : KIND.ROCK;
    case R_FROSTSPINE: return r < 4 ? KIND.SHARD : r < 6 ? KIND.SLAB : KIND.ROCK;
    case R_STORMWELL: return r < 9 ? KIND.BASALT : KIND.ROCK;
    case R_SPIRE: return r < 6 ? KIND.SHARD : r < 10 ? KIND.PILLAR : KIND.ROCK;
    default: return KIND.ROCK;
  }
}

/**
 * True when (x, z) lies in a clear disc. Only the discs that touch the cell (listed in `near`) are tested.
 * @param {any} c @param {Int32Array} near @param {number} nn @param {number} x @param {number} z @param {number} pad
 */
function inClear(c, near, nn, x, z, pad) {
  for (let i = 0; i < nn; i++) {
    const k = near[i];
    const dx = x - c.x[k];
    const dz = z - c.z[k];
    const r = c.r[k] + pad;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

const NEAR = new Int32Array(384);

/**
 * Fill `out` with the props of scatter cell (ci, cj).
 * @param {number} ci @param {number} cj @param {number} seed
 * @param {{ heightAt:Function, slopeAt:Function, canopyAt:Function, regionIndexAt:Function, flagsAt:Function }} g
 * @param {ReturnType<typeof createCellBuffer>} out
 * @param {{ cover?:boolean, clear?:ReturnType<typeof createClearSet>|null }} [opt] cover: include the ground cover
 *   (default true); clear: discs kept free of props
 * @returns {number} count
 */
export function scatterCell(ci, cj, seed, g, out, opt) {
  let n = 0;
  const x0 = -WORLD_HALF + ci * SCATTER_CELL;
  const z0 = -WORLD_HALF + cj * SCATTER_CELL;
  const withCover = !opt || opt.cover !== false;
  const clear = opt && opt.clear ? opt.clear : null;
  let nn = 0;
  if (clear) {
    for (let k = 0; k < clear.n && nn < NEAR.length; k++) {
      const r = clear.r[k] + 6;
      if (clear.x[k] + r < x0 || clear.x[k] - r > x0 + SCATTER_CELL || clear.z[k] + r < z0 || clear.z[k] - r > z0 + SCATTER_CELL) continue;
      NEAR[nn++] = k;
    }
  }
  // ---- trees: a jittered lattice kept with the canopy density, plus tree lines in the path verges
  for (let b = 0; b < TREE_COLS; b++) {
    for (let a = 0; a < TREE_COLS; a++) {
      const idx = b * TREE_COLS + a;
      const h1 = hash2(ci * 16 + a, cj * 16 + b, seed ^ 0x7ee5);
      const h2 = hash2(ci * 16 + a, cj * 16 + b, seed ^ 0x2b1d);
      const x = x0 + (a + 0.1 + 0.8 * u(h1)) * TREE_STEP;
      const z = z0 + (b + 0.1 + 0.8 * u(h2)) * TREE_STEP;
      const fl = g.flagsAt(x, z);
      if (fl & (FLAG.PATH | FLAG.SETTLEMENT | FLAG.WATER | FLAG.SCORCH)) continue;
      const dens = g.canopyAt(x, z);
      const keep = u(h1 * 0x9e37 + 17);
      let verge = false;
      if (dens <= 0.02 || keep * 0.92 > dens) {
        // tree lines: about every other lattice spot of a path verge carries a tree (Meadows, Coast, Frostspine)
        if ((fl & FLAG.VERGE) === 0 || keep > 0.42) continue;
        verge = true;
      }
      const y = g.heightAt(x, z);
      if (y < 1.2) continue;
      const slope = g.slopeAt(x, z);
      if (slope > 0.5) continue;
      if (nn > 0 && inClear(clear, NEAR, nn, x, z, 3)) continue;
      const ri = g.regionIndexAt(x + (u(h2 * 31) - 0.5) * 60, z + (u(h1 * 13) - 0.5) * 60);
      if (verge && ri !== R_MEADOWS && ri !== R_COAST && ri !== R_FROSTSPINE) continue;
      const kind = treeKind(ri, h2 >>> 8, y, verge, dens);
      const sz = u(h1 ^ h2);
      // grove interiors grow taller than their edges; verge poplars are kept even
      const s = verge ? 1.9 + 0.4 * sz : (TREE_S0[ri] + TREE_S1[ri] * sz) * (0.82 + 0.3 * (dens > 1 ? 1 : dens));
      out.kind[n] = kind;
      out.x[n] = x;
      out.z[n] = z;
      // sink the trunk on slopes so the downhill side never floats
      out.y[n] = y - 0.3 - slope * 2.2 * s;
      out.s[n] = s;
      out.yaw[n] = u(h2 * 7 + 3) * Math.PI * 2;
      out.key[n] = propKey(ci, cj, idx);
      out.tint[n] = (h1 >>> 3) & 3;
      n++;
      if (n >= CELL_MAX - 140) break;
    }
  }
  // ---- rocks: a few clusters per cell, three to six stones of falling size around each centre
  for (let k = 0; k < 4; k++) {
    const h = hash2(ci * 37 + k, cj * 53 - k, seed ^ 0x40c5);
    const cx = x0 + 10 + u(h) * (SCATTER_CELL - 20);
    const cz = z0 + 10 + u(h * 0x2545f491 + k) * (SCATTER_CELL - 20);
    const cy = g.heightAt(cx, cz);
    if (cy < 0.6) continue;
    const cslope = g.slopeAt(cx, cz);
    if (cslope > 0.7) continue;
    const ri = g.regionIndexAt(cx, cz);
    const r2 = u(hash2(k, ci + cj * 61, seed ^ 0x99));
    if (r2 > ROCKY[ri] * (0.55 + cslope * 1.6)) continue;
    const count = 3 + (h >>> 28) % 4;
    const big = (0.7 + 1.5 * u(h ^ 0x51)) * ROCK_S[ri];
    for (let m = 0; m < count && n < CELL_MAX - 100; m++) {
      const hm = hash2(k * 13 + m, ci * 7 + cj * 131, seed ^ 0x6a3);
      const a = u(hm) * Math.PI * 2;
      const d = m === 0 ? 0 : (1.2 + 2.6 * u(hm >>> 5)) * big;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const fl = g.flagsAt(x, z);
      if (fl & (FLAG.PATH | FLAG.SETTLEMENT | FLAG.SCORCH)) continue;
      const y = g.heightAt(x, z);
      if (y < 0.6) continue;
      if (nn > 0 && inClear(clear, NEAR, nn, x, z, 2)) continue;
      const slope = g.slopeAt(x, z);
      const kind = rockKind(ri, hm >>> 8);
      const s = (m === 0 ? 1 : 0.35 + 0.45 * u(hm ^ 0x77)) * big * (kind === KIND.PILLAR || kind === KIND.BASALT ? 0.75 : 1);
      out.kind[n] = kind;
      out.x[n] = x;
      out.z[n] = z;
      // half-buried: deeper on slopes, pillars and columns stand on a socket
      out.y[n] = y - (kind === KIND.PILLAR || kind === KIND.BASALT ? 0.7 : 0.35) * s - slope * 1.6 * s;
      out.s[n] = s;
      out.yaw[n] = u(hm * 3 + 1) * Math.PI * 2;
      out.key[n] = propKey(ci, cj, 4000 + k * 8 + m);
      out.tint[n] = (hm >>> 12) & 3;
      n++;
    }
  }
  if (!withCover) {
    out.n = n;
    return n;
  }
  // ---- ground cover on a 6.4 m lattice: grove edges, fields, open ground
  for (let b = 0; b < COVER_COLS; b++) {
    for (let a = 0; a < COVER_COLS; a++) {
      if (n >= CELL_MAX) break;
      const h = hash2(ci * 17 + a, cj * 17 + b, seed ^ 0x3c07);
      const x = x0 + (a + 0.1 + 0.8 * u(h)) * COVER_STEP;
      const z = z0 + (b + 0.1 + 0.8 * u(h * 0x2c1b + 7)) * COVER_STEP;
      const fl = g.flagsAt(x, z);
      if (fl & (FLAG.PATH | FLAG.SETTLEMENT | FLAG.WATER | FLAG.SCORCH)) continue;
      const field = (fl & FLAG.FIELD) !== 0;
      const dens = g.canopyAt(x, z);
      const ri = g.regionIndexAt(x, z);
      // fuller at grove edges (canopy 0.1-0.6) and in fields, sparse in the open and under a closed canopy
      const edge = dens > 0.6 ? 0.6 : dens > 0.08 ? 1 : 0.62;
      const want = field ? 0.95 : COVER[ri] * edge;
      if (u(h ^ 0x5bd1e995) > want) continue;
      const y = g.heightAt(x, z);
      if (y < 0.8) continue;
      const slope = g.slopeAt(x, z);
      if (slope > 0.45) continue;
      if (nn > 0 && inClear(clear, NEAR, nn, x, z, 1)) continue;
      const kind = coverKind(ri, h >>> 9, field, dens, y);
      if (kind === 0) continue;
      out.kind[n] = kind;
      out.x[n] = x;
      out.z[n] = z;
      out.y[n] = y - 0.12 - slope * 0.8;
      out.s[n] = COVER_S[kind] * (0.75 + 0.5 * u(h * 0x45d9f3b + 11)) * (field ? 1.15 : 1);
      out.yaw[n] = u(h * 13 + 5) * Math.PI * 2;
      out.key[n] = propKey(ci, cj, 2000 + b * COVER_COLS + a);
      out.tint[n] = (h >>> 25) & 3;
      n++;
    }
  }
  out.n = n;
  return n;
}
