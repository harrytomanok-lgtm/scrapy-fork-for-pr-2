/**
 * Per-cell seeded scatter of vegetation, rocks and pillars (ARCHITECTURE 4.1). A 128 m cell always yields the
 * same props for a seed: the forest density comes from the baked canopy layer (so the far-mesh canopy tint and
 * the instances agree), species from the region layer, and everything else from `hash2`. Pure, allocation-free.
 * @module world/gen/scatter
 */

import { hash2 } from '../../core/rng.js';
import { WORLD_HALF } from '../../core/constants.js';
import { FLAG, R_MEADOWS, R_COAST, R_THORNWOOD, R_RUSTDUNE, R_FROSTSPINE, R_STORMWELL, R_SPIRE } from './layout.js';

/** Prop kinds (one instanced mesh each). */
export const KIND = Object.freeze({ CEDAR: 0, MAPLE: 1, PALM: 2, BRAMBLE: 3, CACTUS: 4, PINE: 5, REED: 6, CRYSTAL: 7, ROCK: 8, PILLAR: 9 });
export const KIND_COUNT = 10;
/** Kinds counted against the tree cap (the rest count as rocks). */
export const IS_TREE = Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
/** Prop kind names for world:propDestroyed. */
export const KIND_NAME = Object.freeze(['tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'reed', 'crystal', 'rock', 'pillar']);
/** Scatter cell size in metres. */
export const SCATTER_CELL = 128;
/** Cells per side of the world square. */
export const SCATTER_N = 56;
/** Max props one cell can yield. */
export const CELL_MAX = 160;

const TREE_STEP = 13;
const TREE_COLS = Math.floor(SCATTER_CELL / TREE_STEP);

/** Rockiness per region (rock candidates kept). */
const ROCKY = Object.freeze([0.25, 0.3, 0.35, 0.45, 0.6, 0.5, 0.3]);
/** Pillar chance per region. */
const PILLARS = Object.freeze([0, 0.12, 0.05, 0.35, 0.05, 0.15, 0.4]);

/**
 * Output buffers of one cell.
 * @returns {{ n:number, kind:Uint8Array, x:Float32Array, y:Float32Array, z:Float32Array, s:Float32Array, yaw:Float32Array, key:Int32Array }}
 */
export function createCellBuffer() {
  return {
    n: 0, kind: new Uint8Array(CELL_MAX), x: new Float32Array(CELL_MAX), y: new Float32Array(CELL_MAX), z: new Float32Array(CELL_MAX),
    s: new Float32Array(CELL_MAX), yaw: new Float32Array(CELL_MAX), key: new Int32Array(CELL_MAX),
  };
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
 * Tree species of a region at a point.
 * @param {number} ri @param {number} h hash
 */
function treeKind(ri, h, height) {
  switch (ri) {
    case R_MEADOWS: return (h & 7) < 3 ? KIND.MAPLE : KIND.CEDAR;
    case R_COAST: return KIND.PALM;
    case R_THORNWOOD: return (h & 15) === 0 ? KIND.MAPLE : KIND.BRAMBLE;
    case R_RUSTDUNE: return KIND.CACTUS;
    case R_FROSTSPINE: return height < 90 && (h & 3) === 0 ? KIND.CEDAR : KIND.PINE;
    case R_STORMWELL: return height < 6 ? KIND.REED : (h & 3) === 0 ? KIND.CRYSTAL : KIND.REED;
    case R_SPIRE: return KIND.CRYSTAL;
    default: return KIND.CEDAR;
  }
}

/**
 * Fill `out` with the props of scatter cell (ci, cj).
 * @param {number} ci @param {number} cj @param {number} seed
 * @param {{ heightAt:Function, slopeAt:Function, canopyAt:Function, regionIndexAt:Function, flagsAt:Function }} g
 * @param {ReturnType<typeof createCellBuffer>} out
 * @returns {number} count
 */
export function scatterCell(ci, cj, seed, g, out) {
  let n = 0;
  const x0 = -WORLD_HALF + ci * SCATTER_CELL;
  const z0 = -WORLD_HALF + cj * SCATTER_CELL;
  // Trees on a jittered lattice, kept with the canopy density.
  for (let b = 0; b < TREE_COLS; b++) {
    for (let a = 0; a < TREE_COLS; a++) {
      const idx = b * TREE_COLS + a;
      const h1 = hash2(ci * 16 + a, cj * 16 + b, seed ^ 0x7ee5);
      const h2 = hash2(ci * 16 + a, cj * 16 + b, seed ^ 0x2b1d);
      const x = x0 + (a + 0.1 + 0.8 * u(h1)) * TREE_STEP;
      const z = z0 + (b + 0.1 + 0.8 * u(h2)) * TREE_STEP;
      const dens = g.canopyAt(x, z);
      if (dens <= 0.02 || u(h1 * 0x9e37 + 17) * 0.92 > dens) continue;
      const fl = g.flagsAt(x, z);
      if (fl & (FLAG.PATH | FLAG.SETTLEMENT | FLAG.WATER | FLAG.SCORCH)) continue;
      const y = g.heightAt(x, z);
      if (y < 1.2) continue;
      if (g.slopeAt(x, z) > 0.5) continue;
      const ri = g.regionIndexAt(x + (u(h2 * 31) - 0.5) * 60, z + (u(h1 * 13) - 0.5) * 60);
      out.kind[n] = treeKind(ri, h2 >>> 8, y);
      out.x[n] = x;
      out.z[n] = z;
      out.y[n] = y - 0.3;
      out.s[n] = 1.25 + 0.95 * u(h1 ^ h2);
      out.yaw[n] = u(h2 * 7 + 3) * Math.PI * 2;
      out.key[n] = propKey(ci, cj, idx);
      n++;
      if (n >= CELL_MAX - 16) break;
    }
  }
  // Rocks and pillars.
  for (let k = 0; k < 10; k++) {
    const h = hash2(ci * 37 + k, cj * 53 - k, seed ^ 0x40c5);
    const x = x0 + u(h) * SCATTER_CELL;
    const z = z0 + u(h * 0x2545f491 + k) * SCATTER_CELL;
    const y = g.heightAt(x, z);
    if (y < 0.6) continue;
    const fl = g.flagsAt(x, z);
    if (fl & (FLAG.PATH | FLAG.SETTLEMENT | FLAG.SCORCH)) continue;
    const slope = g.slopeAt(x, z);
    if (slope > 0.7) continue;
    const ri = g.regionIndexAt(x, z);
    const keep = ROCKY[ri] * (0.6 + slope * 1.4);
    const r2 = u(hash2(k, ci + cj * 61, seed ^ 0x99));
    if (r2 > keep) continue;
    const pillar = u(h >>> 3 ^ 0x5bd1) < PILLARS[ri];
    out.kind[n] = pillar ? KIND.PILLAR : KIND.ROCK;
    out.x[n] = x;
    out.z[n] = z;
    out.y[n] = y - (pillar ? 0.8 : 0.5);
    out.s[n] = pillar ? 0.8 + 0.7 * r2 : 0.6 + 1.6 * u(h ^ 0x51) * u(h ^ 0x77);
    out.yaw[n] = u(h * 3 + 1) * Math.PI * 2;
    out.key[n] = propKey(ci, cj, 4000 + k);
    n++;
  }
  out.n = n;
  return n;
}
