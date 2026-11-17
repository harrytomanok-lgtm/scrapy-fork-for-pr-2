/**
 * Parchment map canvas (ARCHITECTURE 4.1): the baked ground colour with hill shading, painted water bands, an
 * ink coastline and a paper wash; whole world square, north (-z) up. Cached per size.
 * @module world/map
 */

import { PALETTE } from '../core/palette.js';
import { WORLD_HALF, WORLD_SIZE } from '../core/constants.js';

/** @param {number} hex @returns {number[]} */
function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/**
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {number} size 256 | 512
 * @returns {HTMLCanvasElement}
 */
export function drawMap(grid, size) {
  const s = size;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const g2 = canvas.getContext('2d');
  const img = g2.createImageData(s, s);
  const paper = rgb(PALETTE.paper);
  const ink = rgb(PALETTE.ink);
  const deep = rgb(PALETTE.ocean.deep);
  const shallow = rgb(PALETTE.ocean.shallow);
  const t = new Float32Array(3);
  const px = WORLD_SIZE / s;
  const hs = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) hs[y * s + x] = grid.heightAt(-WORLD_HALF + (x + 0.5) * px, -WORLD_HALF + (y + 0.5) * px);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const k = y * s + x;
      const h = hs[k];
      const wx = -WORLD_HALF + (x + 0.5) * px;
      const wz = -WORLD_HALF + (y + 0.5) * px;
      let r;
      let gg;
      let b;
      if (h < 0) {
        const d = Math.min(1, -h / 20);
        const band = d < 0.3 ? 0 : 1;
        r = shallow[0] + (deep[0] - shallow[0]) * band;
        gg = shallow[1] + (deep[1] - shallow[1]) * band;
        b = shallow[2] + (deep[2] - shallow[2]) * band;
      } else {
        grid.tintAt(wx, wz, t, 0);
        const hl = hs[y * s + Math.max(0, x - 1)];
        const hu = hs[Math.max(0, y - 1) * s + x];
        const shade = Math.max(0.72, Math.min(1.2, 1 + ((hl - h) + (hu - h)) * (0.9 / px) * 4));
        r = t[0] * 255 * shade;
        gg = t[1] * 255 * shade;
        b = t[2] * 255 * shade;
      }
      // Ink coastline.
      const right = x + 1 < s ? hs[k + 1] : h;
      const down = y + 1 < s ? hs[k + s] : h;
      const coast = (h >= 0) !== (right >= 0) || (h >= 0) !== (down >= 0);
      const mix = 0.32;
      r = r + (paper[0] - r) * mix;
      gg = gg + (paper[1] - gg) * mix;
      b = b + (paper[2] - b) * mix;
      if (coast) {
        r = r + (ink[0] - r) * 0.75;
        gg = gg + (ink[1] - gg) * 0.75;
        b = b + (ink[2] - b) * 0.75;
      }
      const o = k * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g2.putImageData(img, 0, 0);
  return canvas;
}
