/**
 * Queries over a baked grid (ARCHITECTURE 4.1 surface queries) and the crater grid edit. O(1), allocation-free,
 * valid for any x,z (outside the square they clamp). Pure.
 * @module world/gen/grid
 */

import { WORLD_HALF } from '../../core/constants.js';
import { PALETTE } from '../../core/palette.js';
import { FLAG } from './layout.js';

const SCORCH = [(PALETTE.scorch >> 16) & 255, (PALETTE.scorch >> 8) & 255, PALETTE.scorch & 255];

/**
 * @param {import('./bake.js').BakeResult} b
 */
export function createGrid(b) {
  const { n, cell, height, ln, lcell, tint, region, flags, canopy } = b;
  const inv = 1 / cell;
  const linv = 1 / lcell;
  const max = n - 1;
  const lmax = ln - 1;

  /** Bilinear height. @param {number} x @param {number} z */
  function heightAt(x, z) {
    let gx = (x + WORLD_HALF) * inv;
    let gz = (z + WORLD_HALF) * inv;
    gx = gx < 0 ? 0 : gx > max ? max : gx;
    gz = gz < 0 ? 0 : gz > max ? max : gz;
    let i = gx | 0;
    let j = gz | 0;
    if (i >= max) i = max - 1;
    if (j >= max) j = max - 1;
    const fx = gx - i;
    const fz = gz - j;
    const k = j * n + i;
    const a = height[k];
    const bb = height[k + 1];
    const c = height[k + n];
    const d = height[k + n + 1];
    return a + (bb - a) * fx + (c - a) * fz + (a - bb - c + d) * fx * fz;
  }

  /** @param {number} x @param {number} z @param {{x:number,y:number,z:number,set?:Function}} out */
  function normalAt(x, z, out) {
    const e = cell;
    const nx = heightAt(x - e, z) - heightAt(x + e, z);
    const nz = heightAt(x, z - e) - heightAt(x, z + e);
    const ny = 2 * e;
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    out.x = nx * l;
    out.y = ny * l;
    out.z = nz * l;
    return out;
  }

  /** 0 flat .. 1 vertical. @param {number} x @param {number} z */
  function slopeAt(x, z) {
    const e = cell;
    const nx = heightAt(x - e, z) - heightAt(x + e, z);
    const nz = heightAt(x, z - e) - heightAt(x, z + e);
    const ny = 2 * e;
    const y = ny / Math.sqrt(nx * nx + ny * ny + nz * nz);
    return Math.acos(y > 1 ? 1 : y) / (Math.PI / 2);
  }

  /** Index into the 8 m layers of the nearest sample. */
  function layerIndex(x, z) {
    let i = Math.round((x + WORLD_HALF) * linv);
    let j = Math.round((z + WORLD_HALF) * linv);
    i = i < 0 ? 0 : i > lmax ? lmax : i;
    j = j < 0 ? 0 : j > lmax ? lmax : j;
    return j * ln + i;
  }

  /** @param {number} x @param {number} z @returns {number} region index */
  function regionIndexAt(x, z) {
    return region[layerIndex(x, z)];
  }

  /** @param {number} x @param {number} z @returns {number} FLAG bits */
  function flagsAt(x, z) {
    return flags[layerIndex(x, z)];
  }

  /** Bilinear canopy density 0..1. @param {number} x @param {number} z */
  function canopyAt(x, z) {
    let gx = (x + WORLD_HALF) * linv;
    let gz = (z + WORLD_HALF) * linv;
    gx = gx < 0 ? 0 : gx > lmax - 0.001 ? lmax - 0.001 : gx;
    gz = gz < 0 ? 0 : gz > lmax - 0.001 ? lmax - 0.001 : gz;
    const i = gx | 0;
    const j = gz | 0;
    const fx = gx - i;
    const fz = gz - j;
    const k = j * ln + i;
    const a = canopy[k];
    const bb = canopy[k + 1];
    const c = canopy[k + ln];
    const d = canopy[k + ln + 1];
    return (a + (bb - a) * fx + (c - a) * fz + (a - bb - c + d) * fx * fz) / 255;
  }

  /**
   * Bilinear ground colour, sRGB 0..1 into out[o..o+2].
   * @param {number} x @param {number} z @param {Float32Array|number[]} out @param {number} o
   */
  function tintAt(x, z, out, o) {
    let gx = (x + WORLD_HALF) * linv;
    let gz = (z + WORLD_HALF) * linv;
    gx = gx < 0 ? 0 : gx > lmax - 0.001 ? lmax - 0.001 : gx;
    gz = gz < 0 ? 0 : gz > lmax - 0.001 ? lmax - 0.001 : gz;
    const i = gx | 0;
    const j = gz | 0;
    const fx = gx - i;
    const fz = gz - j;
    const k = (j * ln + i) * 3;
    const r = ln * 3;
    for (let c = 0; c < 3; c++) {
      const a = tint[k + c];
      const bb = tint[k + 3 + c];
      const cc = tint[k + r + c];
      const d = tint[k + r + 3 + c];
      out[o + c] = (a + (bb - a) * fx + (cc - a) * fz + (a - bb - cc + d) * fx * fz) / 255;
    }
  }

  /**
   * Crater grid edit: bowl of radius r and depth d, raised lip 0.08 r out to 1.25 r, scorched tint.
   * Returns false (and edits nothing) for r < 6.
   * @param {number} x @param {number} z @param {number} r @param {number} d
   */
  function crater(x, z, r, d) {
    if (!(r >= 6)) return false;
    const lip = r * 1.25;
    const i0 = Math.max(0, Math.floor((x - lip + WORLD_HALF) * inv));
    const i1 = Math.min(max, Math.ceil((x + lip + WORLD_HALF) * inv));
    const j0 = Math.max(0, Math.floor((z - lip + WORLD_HALF) * inv));
    const j1 = Math.min(max, Math.ceil((z + lip + WORLD_HALF) * inv));
    for (let j = j0; j <= j1; j++) {
      const pz = -WORLD_HALF + j * cell - z;
      for (let i = i0; i <= i1; i++) {
        const px = -WORLD_HALF + i * cell - x;
        const q = Math.sqrt(px * px + pz * pz) / r;
        if (q >= 1.25) continue;
        const dh = q < 1 ? -d * (1 - q * q) + r * 0.08 * q * q : r * 0.08 * (1 - (q - 1) / 0.25);
        height[j * n + i] += dh;
      }
    }
    const li0 = Math.max(0, Math.floor((x - lip + WORLD_HALF) * linv));
    const li1 = Math.min(lmax, Math.ceil((x + lip + WORLD_HALF) * linv));
    const lj0 = Math.max(0, Math.floor((z - lip + WORLD_HALF) * linv));
    const lj1 = Math.min(lmax, Math.ceil((z + lip + WORLD_HALF) * linv));
    for (let j = lj0; j <= lj1; j++) {
      const pz = -WORLD_HALF + j * lcell - z;
      for (let i = li0; i <= li1; i++) {
        const px = -WORLD_HALF + i * lcell - x;
        const q = Math.sqrt(px * px + pz * pz) / r;
        if (q >= 1.15) continue;
        const k = j * ln + i;
        const s = q < 0.85 ? 0.85 : 0.85 * (1 - (q - 0.85) / 0.3);
        for (let c = 0; c < 3; c++) tint[k * 3 + c] = Math.round(tint[k * 3 + c] + (SCORCH[c] - tint[k * 3 + c]) * s);
        canopy[k] = 0;
        flags[k] |= FLAG.SCORCH;
        const hx = heightAt(-WORLD_HALF + i * lcell, -WORLD_HALF + j * lcell);
        if (hx < 0) flags[k] |= FLAG.WATER;
      }
    }
    return true;
  }

  return { n, cell, height, ln, lcell, tint, region, flags, canopy, heightAt, normalAt, slopeAt, regionIndexAt, flagsAt, canopyAt, tintAt, crater };
}
