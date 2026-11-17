/**
 * The 512 px canvas VFX atlas (ART_UX 3.1): a 4 x 4 grid of 128 px cells drawn once with Canvas 2D.
 * Alpha is the shape; red is a "hot core" mask (the particle shader pushes it toward white); green is a soft
 * top-light used to shade alpha (dust) particles. Cell order matches `CELL` in logic/recipes.js.
 * @module vfx/atlas
 */

import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from 'three';

const SIZE = 512;
const C = 128;

/**
 * @param {number} seed
 * @returns {() => number}
 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fill one cell pixel by pixel from a function returning [core, light, alpha] for local coords in [-1, 1].
 * @param {ImageData} img @param {number} cell @param {(x:number, y:number) => number[]} fn
 */
function paint(img, cell, fn) {
  const cx = (cell % 4) * C;
  const cy = Math.floor(cell / 4) * C;
  const d = img.data;
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const x = ((i + 0.5) / C) * 2 - 1;
      const y = ((j + 0.5) / C) * 2 - 1;
      const v = fn(x, y);
      const o = ((cy + j) * SIZE + cx + i) * 4;
      d[o] = Math.max(0, Math.min(255, v[0] * 255));
      d[o + 1] = Math.max(0, Math.min(255, v[1] * 255));
      d[o + 2] = 255;
      d[o + 3] = Math.max(0, Math.min(255, v[2] * 255));
    }
  }
}

/** @param {number} e0 @param {number} e1 @param {number} x */
function ss(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0,1]. @param {Float32Array} grid @param {number} n @param {number} x @param {number} y */
function vnoise(grid, n, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const g = (a, b) => grid[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx;
  const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

/** @param {number} x @param {number} y @param {number} ax @param {number} ay @param {number} bx @param {number} by */
function segDist(x, y, ax, ay, bx, by) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
}

/** @param {number} x @param {number} y @param {number[]} poly flat [x0,y0,x1,y1,...] @returns {boolean} */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Draw the atlas into a canvas and wrap it in a texture. Returns null without a DOM.
 * @returns {any|null}
 */
export function createAtlas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g2 = canvas.getContext('2d');
  if (!g2) return null;
  const img = g2.createImageData(SIZE, SIZE);
  const rnd = prng(0x51ab);
  const N = 16;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();

  // 0 soft dot
  paint(img, 0, (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.exp(-r * r * 4.2) * (1 - ss(0.85, 1, r));
    return [Math.exp(-r * r * 22), 1, a];
  });
  // 1 star burst: four long rays, four short, hot centre
  paint(img, 1, (x, y) => {
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const long = Math.pow(Math.abs(Math.cos(ang * 2)), 60) * (1 - ss(0, 0.98, r));
    const short = Math.pow(Math.abs(Math.cos(ang * 2 + Math.PI / 4 * 2)), 90) * (1 - ss(0, 0.55, r)) * 0.7;
    const core = Math.exp(-r * r * 30);
    const a = Math.min(1, long + short + core + Math.exp(-r * r * 9) * 0.35) * (1 - ss(0.9, 1, r));
    return [core + long * 0.5, 1, a];
  });
  // 2 streak: thin vertical line, soft at both ends, brighter head
  paint(img, 2, (x, y) => {
    const w = Math.exp(-x * x * 26);
    const along = (1 - ss(0.55, 1, Math.abs(y))) * (0.55 + 0.45 * ss(-1, 0.6, y));
    return [Math.exp(-x * x * 120) * along, 1, w * along];
  });
  // 3 ring
  paint(img, 3, (x, y) => {
    const r = Math.hypot(x, y);
    const d = Math.abs(r - 0.8);
    const a = Math.exp(-d * d * 500) + Math.exp(-d * d * 60) * 0.35;
    return [Math.exp(-d * d * 2500), 1, a * (1 - ss(0.95, 1, r))];
  });
  // 4-7 smoke puff flipbook: billowy noise blob, growing and thinning
  for (let f = 0; f < 4; f++) {
    const k = f / 3;
    paint(img, 4 + f, (x, y) => {
      const r = Math.hypot(x, y);
      const n = vnoise(grid, N, (x + 3.1 * f) * 2.6 + 9, (y + 1.7 * f) * 2.6 + 4) * 0.6 + vnoise(grid, N, x * 6 + 31 * f, y * 6 + 7) * 0.4;
      const rad = 0.62 + 0.25 * k;
      const edge = 1 - ss(rad - 0.32, rad + 0.05, r + (n - 0.5) * 0.5);
      const a = edge * (1 - 0.55 * k) * (0.75 + 0.25 * n);
      const light = 0.55 + 0.45 * ss(0.6, -0.6, y + (n - 0.5) * 0.4);
      return [0, light, a * (1 - ss(0.93, 1, r))];
    });
  }
  // 8 chip: an angular shard (also the ink splash triangle)
  paint(img, 8, (x, y) => {
    const tri = [-0.75, 0.6, 0.85, 0.3, -0.1, -0.85];
    const inside = inPoly(x, y, tri);
    let d = 9;
    for (let i = 0; i < tri.length; i += 2) {
      const j = (i + 2) % tri.length;
      d = Math.min(d, segDist(x, y, tri[i], tri[i + 1], tri[j], tri[j + 1]));
    }
    const a = inside ? 1 : 1 - ss(0, 0.04, d);
    return [0, 0.6 + 0.4 * ss(0.8, -0.8, y), a];
  });
  // 9 hexagon tile outline with a faint fill
  paint(img, 9, (x, y) => {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const hx = Math.max(ax * 0.866 + ay * 0.5, ay);
    const d = Math.abs(hx - 0.78);
    const a = Math.exp(-d * d * 900) + (hx < 0.78 ? 0.18 : 0);
    return [Math.exp(-d * d * 3000), 1, Math.min(1, a)];
  });
  // 10 warning triangle: bold outline with a bar and dot
  paint(img, 10, (x, y) => {
    const tri = [0, -0.82, 0.86, 0.68, -0.86, 0.68];
    let d = 9;
    for (let i = 0; i < tri.length; i += 2) {
      const j = (i + 2) % tri.length;
      d = Math.min(d, segDist(x, y, tri[i], tri[i + 1], tri[j], tri[j + 1]));
    }
    const edge = 1 - ss(0.07, 0.11, d);
    const bar = 1 - ss(0.07, 0.1, segDist(x, y, 0, -0.32, 0, 0.18));
    const dot = 1 - ss(0.07, 0.1, Math.hypot(x, y - 0.42));
    const inside = inPoly(x, y, tri) ? 0.28 : 0;
    return [Math.max(edge, bar, dot), 1, Math.min(1, Math.max(edge, bar, dot, inside))];
  });
  // 11 glyph ring: ring with tick glyphs
  paint(img, 11, (x, y) => {
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const ring = Math.exp(-Math.pow(r - 0.86, 2) * 1400);
    const inner = Math.exp(-Math.pow(r - 0.62, 2) * 2400);
    const tick = (Math.abs(((ang / (Math.PI * 2)) * 24 + 24) % 1 - 0.5) < 0.12 ? 1 : 0) * (r > 0.66 && r < 0.82 ? 1 : 0);
    const a = Math.min(1, ring + inner + tick * 0.9);
    return [ring, 1, a];
  });
  // 12 spark: sharp four-point diamond
  paint(img, 12, (x, y) => {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const d = Math.sqrt(ax) + Math.sqrt(ay);
    const a = 1 - ss(0.55, 1.0, d);
    return [1 - ss(0.2, 0.6, d), 1, a];
  });
  // 13 spiral
  paint(img, 13, (x, y) => {
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const t = ((ang / (Math.PI * 2)) + 1) % 1;
    let best = 9;
    for (let k = 0; k < 3; k++) best = Math.min(best, Math.abs(r - (t + k) * 0.28));
    const a = Math.exp(-best * best * 700) * (1 - ss(0.85, 0.98, r));
    return [Math.exp(-best * best * 3000), 1, a];
  });
  // 14 slash: a crescent arc
  paint(img, 14, (x, y) => {
    const r1 = Math.hypot(x, y + 0.35);
    const r2 = Math.hypot(x, y + 0.6);
    const a = (1 - ss(0.82, 0.86, r1)) * ss(0.9, 0.94, r2) * (1 - ss(0.4, 0.95, Math.abs(x)));
    return [a, 1, a];
  });
  // 15 pebble: rounded blob with a top light
  paint(img, 15, (x, y) => {
    const n = vnoise(grid, N, x * 3 + 50, y * 3 + 20);
    const r = Math.hypot(x, y) + (n - 0.5) * 0.25;
    return [0, 0.5 + 0.5 * ss(0.7, -0.7, y), 1 - ss(0.62, 0.7, r)];
  });

  g2.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}
