/**
 * The bake: samples the field into the Float32 height grid (4 or 8 m) and the 8 m layers (tint RGB8, region,
 * flags, canopy). Written as a generator that yields progress so the same code runs in the blob Worker (to
 * completion), on the main thread (time-sliced) and in Node tests. Pure.
 * @module world/gen/bake
 */

import { createField } from './field.js';
import { GEN, FLAG } from './layout.js';
import { WORLD_SIZE, WORLD_HALF } from '../../core/constants.js';

/**
 * @typedef {object} BakeResult
 * @property {number} seed @property {number} cell @property {number} n   grid side (size / cell + 1)
 * @property {Float32Array} height
 * @property {number} lcell @property {number} ln   layer cell (8 m) and side
 * @property {Uint8Array} tint    RGB8 ground colour (sRGB)
 * @property {Uint8Array} region  region index
 * @property {Uint8Array} flags   FLAG bits
 * @property {Uint8Array} canopy  forest density 0..255
 * @property {number} ms
 */

/** @param {number} cell @returns {number} */
export function gridSide(cell) {
  return WORLD_SIZE / cell + 1;
}

/**
 * Generator bake. Yields progress 0..1 after each batch of rows; returns the result.
 * @param {number} seed @param {4|8} cell @param {number} [rowsPerYield]
 * @returns {Generator<number, BakeResult, void>}
 */
export function* bakeSteps(seed, cell, rowsPerYield = 32) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const f = createField(seed);
  const n = gridSide(cell);
  const height = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -WORLD_HALF + j * cell;
    const row = j * n;
    for (let i = 0; i < n; i++) height[row + i] = f.height(-WORLD_HALF + i * cell, z);
    if (j % rowsPerYield === rowsPerYield - 1) yield (j / n) * 0.82;
  }
  const lcell = GEN.layerCell;
  const ln = gridSide(lcell);
  const step = lcell / cell;
  const tint = new Uint8Array(ln * ln * 3);
  const region = new Uint8Array(ln * ln);
  const flags = new Uint8Array(ln * ln);
  const canopy = new Uint8Array(ln * ln);
  const inv2 = 1 / (2 * lcell);
  const rowsL = Math.max(1, Math.round(rowsPerYield / step));
  for (let j = 0; j < ln; j++) {
    const z = -WORLD_HALF + j * lcell;
    const gj = j * step;
    for (let i = 0; i < ln; i++) {
      const x = -WORLD_HALF + i * lcell;
      const gi = i * step;
      const h = height[gj * n + gi];
      const hl = height[gj * n + (gi >= step ? gi - step : gi)];
      const hr = height[gj * n + (gi + step < n ? gi + step : gi)];
      const hu = height[(gj >= step ? gj - step : gj) * n + gi];
      const hd = height[(gj + step < n ? gj + step : gj) * n + gi];
      const sx = (hl - hr) * inv2;
      const sz = (hu - hd) * inv2;
      const ny = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      const slope = Math.acos(ny > 1 ? 1 : ny) / (Math.PI / 2);
      const k = j * ln + i;
      region[k] = f.regionWeights(x, z);
      const path = f.pathDist(x, z);
      const settle = f.settlementAt(x, z);
      f.groundColour(x, z, h, slope, path, settle, tint, k * 3);
      canopy[k] = Math.round(f.forest(x, z, h, slope, path, settle) * 255);
      let fl = 0;
      if (path < 6 && h > 0.4) fl |= FLAG.PATH;
      if (settle > 0.5) fl |= FLAG.SETTLEMENT | FLAG.NO_SPAWN;
      if (h < 0) fl |= FLAG.WATER;
      flags[k] = fl;
    }
    if (j % rowsL === rowsL - 1) yield 0.82 + (j / ln) * 0.18;
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { seed: f.seed, cell, n, height, lcell, ln, tint, region, flags, canopy, ms: t1 - t0 };
}

/**
 * Run a bake to completion.
 * @param {number} seed @param {4|8} cell @returns {BakeResult}
 */
export function bakeSync(seed, cell) {
  const it = bakeSteps(seed, cell, 1 << 30);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
