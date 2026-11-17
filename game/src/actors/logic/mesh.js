/**
 * Primitive shapes and the part merger (ARCHITECTURE 8.4 builder; ART_UX 2.1): every part of an actor spec becomes
 * indexed triangles bound rigidly to one bone, and all parts merge into one buffer set with a `paletteIndex` per
 * vertex. Pure math (no three) so Node tests can count triangles exactly.
 *
 * Shape sizes (metres): sphere [dx, dy, dz] full extents (or [d]); capsule [r, length, depthRatio?];
 * box [w, h, d]; cone [r, h]; cylinder [r, h, rTop?]; torus [R, r] (ring in the XZ plane);
 * lathe [rBottom, rMid, rTop, h, depthRatio?]; tuft [w, length, thick, bend?] (hangs along -Y from its base);
 * blade [w, length, thick] (a flat diamond along +Y). Optional `seg` overrides the radial segment count.
 * @module actors/logic/mesh
 */

import { skeleton } from './rigs.js';

export const SHAPES = Object.freeze(['sphere', 'capsule', 'box', 'cone', 'cylinder', 'torus', 'lathe', 'tuft', 'blade']);

/** @param {number} m largest extent in metres @returns {number} radial segments */
export function radialSegments(m) {
  if (m >= 0.4) return 12;
  if (m >= 0.18) return 10;
  if (m >= 0.08) return 8;
  if (m >= 0.04) return 6;
  return 5;
}

/** @param {any} part @returns {number} largest extent of a part */
function extent(part) {
  const s = part.size || [];
  let m = 0;
  for (let i = 0; i < s.length; i++) if (typeof s[i] === 'number') m = Math.max(m, Math.abs(s[i]));
  if (part.shape === 'capsule' || part.shape === 'cone' || part.shape === 'cylinder' || part.shape === 'torus') m = Math.max(m, (s[0] || 0) * 2);
  return m;
}

/**
 * Lathe a profile ([r, y] points, traversed along the surface from bottom to top) around +Y.
 * Equal consecutive points make a hard edge (each copy takes the normal of its own segment).
 * @param {number[][]} prof @param {number} n @param {any} g
 */
function lathe(prof, n, g) {
  const base = g.p.length / 3;
  const m = prof.length;
  for (let i = 0; i < m; i++) {
    const [r, y] = prof[i];
    const prev = prof[i > 0 ? i - 1 : i];
    const next = prof[i < m - 1 ? i + 1 : i];
    let tr;
    let ty;
    const dupPrev = i > 0 && prev[0] === r && prev[1] === y;
    const dupNext = i < m - 1 && next[0] === r && next[1] === y;
    if (dupPrev) { tr = prof[Math.min(m - 1, i + 1)][0] - r; ty = prof[Math.min(m - 1, i + 1)][1] - y; }
    else if (dupNext) { tr = r - prev[0]; ty = y - prev[1]; }
    else { tr = next[0] - prev[0]; ty = next[1] - prev[1]; }
    let nr = ty;
    let ny = -tr;
    const l = Math.hypot(nr, ny) || 1;
    nr /= l; ny /= l;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      g.p.push(r * s, y, r * c);
      g.n.push(nr * s, ny, nr * c);
    }
  }
  for (let i = 0; i < m - 1; i++) {
    const ra = prof[i][0];
    const rb = prof[i + 1][0];
    if (prof[i][0] === prof[i + 1][0] && prof[i][1] === prof[i + 1][1]) continue;
    if (ra === 0 && rb === 0) continue;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const a0 = base + i * n + j;
      const a1 = base + i * n + j1;
      const b0 = base + (i + 1) * n + j;
      const b1 = base + (i + 1) * n + j1;
      if (ra === 0) g.i.push(a0, b1, b0);
      else if (rb === 0) g.i.push(a0, a1, b0);
      else g.i.push(a0, a1, b1, a0, b1, b0);
    }
  }
}

/** @param {number} k latitude steps @returns {number[][]} unit semicircle profile */
function circle(k) {
  const out = [];
  for (let i = 0; i <= k; i++) {
    const phi = -Math.PI / 2 + (i / k) * Math.PI;
    out.push([i === 0 || i === k ? 0 : Math.cos(phi), Math.sin(phi)]);
  }
  return out;
}

/**
 * Raw geometry of one part in its own frame, plus the scale to apply (normals use the inverse scale).
 * @param {any} part @returns {{ p:number[], n:number[], i:number[], sx:number, sy:number, sz:number, bend:number, len:number }}
 */
export function shapeGeometry(part) {
  const s = part.size || [];
  const n = Math.max(3, Math.min(16, part.seg || radialSegments(extent(part))));
  const g = { p: [], n: [], i: [], sx: 1, sy: 1, sz: 1, bend: 0, len: 0 };
  switch (part.shape) {
    case 'sphere': {
      const k = Math.max(3, Math.round(n / 2) + (n >= 10 ? 1 : 0));
      lathe(circle(k), n, g);
      const dx = s[0] || 0.1;
      g.sx = dx / 2; g.sy = (s.length > 1 ? s[1] : dx) / 2; g.sz = (s.length > 2 ? s[2] : dx) / 2;
      break;
    }
    case 'capsule': {
      const r = s[0] || 0.05;
      const half = (s[1] || 0) / 2;
      const k = n >= 8 ? 3 : 2;
      const prof = [];
      for (let i = 0; i <= k; i++) {
        const phi = -Math.PI / 2 + (i / k) * (Math.PI / 2);
        prof.push([i === 0 ? 0 : Math.cos(phi) * r, Math.sin(phi) * r - half]);
      }
      for (let i = 0; i <= k; i++) {
        const phi = (i / k) * (Math.PI / 2);
        prof.push([i === k ? 0 : Math.cos(phi) * r, Math.sin(phi) * r + half]);
      }
      lathe(prof, n, g);
      g.sz = typeof s[2] === 'number' ? s[2] : 1;
      break;
    }
    case 'cone': {
      const r = s[0] || 0.05;
      const h = s[1] || 0.1;
      lathe([[0, -h / 2], [r, -h / 2], [r, -h / 2], [0, h / 2]], n, g);
      break;
    }
    case 'cylinder': {
      const r = s[0] || 0.05;
      const h = s[1] || 0.1;
      const r2 = typeof s[2] === 'number' ? s[2] : r;
      lathe([[0, -h / 2], [r, -h / 2], [r, -h / 2], [r2, h / 2], [r2, h / 2], [0, h / 2]], n, g);
      break;
    }
    case 'lathe': {
      const r0 = s[0] || 0.1;
      const r1 = typeof s[1] === 'number' ? s[1] : r0;
      const r2 = typeof s[2] === 'number' ? s[2] : r1;
      const h = s[3] || 0.2;
      const prof = [];
      if (r0 > 0) prof.push([0, -h / 2], [r0, -h / 2]);
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        // quadratic through r0 (t=0), r1 (t=0.5), r2 (t=1)
        const r = r0 * (1 - t) * (1 - 2 * t) + r1 * 4 * t * (1 - t) + r2 * t * (2 * t - 1);
        prof.push([Math.max(0, r), -h / 2 + t * h]);
      }
      if (r2 > 0) prof.push([r2, h / 2], [0, h / 2]);
      lathe(prof, n, g);
      g.sz = typeof s[4] === 'number' ? s[4] : 1;
      break;
    }
    case 'tuft': {
      const w = s[0] || 0.05;
      const len = s[1] || 0.1;
      const th = typeof s[2] === 'number' ? s[2] : w * 0.5;
      lathe([[0, -len], [0.55, -len * 0.55], [1, -len * 0.12], [0.8, 0], [0, 0]], Math.min(n, 6), g);
      g.sx = w / 2; g.sz = th / 2; g.bend = typeof s[3] === 'number' ? s[3] : 0.25; g.len = len;
      break;
    }
    case 'blade': {
      const w = s[0] || 0.05;
      const len = s[1] || 0.3;
      const th = typeof s[2] === 'number' ? s[2] : 0.02;
      lathe([[0, -len * 0.5], [1, -len * 0.25], [0, len * 0.5]], 4, g);
      g.sx = w / 2; g.sz = th / 2;
      break;
    }
    case 'torus':
      break;
    default: { // box
      const w = (s[0] || 0.1) / 2;
      const h = (s.length > 1 ? s[1] : s[0] || 0.1) / 2;
      const d = (s.length > 2 ? s[2] : s[0] || 0.1) / 2;
      const F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (const [nx, ny, nz] of F) {
        const b = g.p.length / 3;
        // two tangent axes u, v with u x v = normal
        const u = nx ? [0, nx > 0 ? 1 : -1, 0] : ny ? [0, 0, ny > 0 ? 1 : -1] : [nz > 0 ? 1 : -1, 0, 0];
        const v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
        for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          g.p.push((nx + u[0] * a + v[0] * c) * w, (ny + u[1] * a + v[1] * c) * h, (nz + u[2] * a + v[2] * c) * d);
          g.n.push(nx, ny, nz);
        }
        g.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
  }
  if (part.shape === 'torus') {
    const R = s[0] || 0.1;
    const r = s[1] || 0.02;
    const m = Math.max(3, Math.min(6, Math.round(n / 2)));
    for (let a = 0; a < n; a++) {
      const ta = (a / n) * Math.PI * 2;
      for (let b = 0; b < m; b++) {
        const tb = (b / m) * Math.PI * 2;
        const cx = Math.sin(ta);
        const cz = Math.cos(ta);
        g.p.push((R + r * Math.cos(tb)) * cx, r * Math.sin(tb), (R + r * Math.cos(tb)) * cz);
        g.n.push(Math.cos(tb) * cx, Math.sin(tb), Math.cos(tb) * cz);
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < m; b++) {
        const a1 = (a + 1) % n;
        const b1 = (b + 1) % m;
        const i0 = a * m + b; const i1 = a1 * m + b; const i2 = a1 * m + b1; const i3 = a * m + b1;
        g.i.push(i0, i2, i1, i0, i3, i2);
      }
    }
  }
  return g;
}

/** @param {any} part @returns {number} triangles of one part */
export function partTriangles(part) {
  return shapeGeometry(part).i.length / 3;
}

/**
 * Euler XYZ rotation matrix (three's default order: v' = Rx * Ry * Rz * v), row-major 3x3.
 * @param {number} x @param {number} y @param {number} z @returns {number[]}
 */
export function eulerMatrix(x, y, z) {
  const a = Math.cos(x); const b = Math.sin(x);
  const c = Math.cos(y); const d = Math.sin(y);
  const e = Math.cos(z); const f = Math.sin(z);
  // three.js Matrix4.makeRotationFromEuler, order XYZ
  return [
    c * e, -c * f, d,
    a * f + b * e * d, a * e - b * f * d, -b * c,
    b * f - a * e * d, b * e + a * f * d, a * c,
  ];
}

/**
 * The parts of a spec in one Form (base parts plus the Form's partsAdd).
 * @param {any} spec @param {string|null} formKey @returns {any[]}
 */
export function specParts(spec, formKey) {
  const base = spec.parts || [];
  const f = formKey && spec.forms && spec.forms[formKey] ? spec.forms[formKey] : null;
  return f && f.partsAdd ? base.concat(f.partsAdd) : base;
}

/**
 * Merge the parts of a spec into one buffer set in bind space (spec.scale applied).
 * @param {any} spec @param {string|null} [formKey]
 * @returns {{ position:Float32Array, normal:Float32Array, paletteIndex:Float32Array, skinIndex:Uint16Array,
 *   index:Uint16Array|Uint32Array, triangles:number, vertices:number, bones:string[], slots:string[], bind:Float32Array,
 *   rest:Float32Array, parent:Int8Array, problems:string[] }}
 */
export function mergeSpec(spec, formKey = null) {
  const scale = typeof spec.scale === 'number' && spec.scale > 0 ? spec.scale : 1;
  const sk = skeleton(spec.rig, spec.build, scale);
  const slots = Object.keys(spec.palette || {});
  const parts = specParts(spec, formKey);
  const P = [];
  const N = [];
  const S = [];
  const B = [];
  const I = [];
  const problems = [];
  for (const part of parts) {
    const bi = sk.names.indexOf(part.bone);
    if (bi < 0) problems.push('unknown bone ' + part.bone);
    let si = slots.indexOf(part.slot);
    if (si < 0) {
      problems.push('unknown slot ' + part.slot);
      si = 0;
    }
    const g = shapeGeometry(part);
    const r = part.rot || [0, 0, 0];
    const M = eulerMatrix(r[0] || 0, r[1] || 0, r[2] || 0);
    const pos = part.pos || [0, 0, 0];
    const bx = bi >= 0 ? sk.world[bi * 3] : 0;
    const by = bi >= 0 ? sk.world[bi * 3 + 1] : 0;
    const bz = bi >= 0 ? sk.world[bi * 3 + 2] : 0;
    const base = P.length / 3;
    for (let v = 0; v < g.p.length; v += 3) {
      let x = g.p[v] * g.sx;
      const y = g.p[v + 1] * g.sy;
      let z = g.p[v + 2] * g.sz;
      if (g.bend) {
        const t = -y / g.len;
        z += g.bend * g.len * t * t;
        x *= 1 - 0.15 * t;
      }
      let nx = g.n[v] / g.sx;
      let ny = g.n[v + 1] / g.sy;
      let nz = g.n[v + 2] / g.sz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      P.push(
        (bx + ((pos[0] || 0) + M[0] * x + M[1] * y + M[2] * z) * scale),
        (by + ((pos[1] || 0) + M[3] * x + M[4] * y + M[5] * z) * scale),
        (bz + ((pos[2] || 0) + M[6] * x + M[7] * y + M[8] * z) * scale),
      );
      N.push(M[0] * nx + M[1] * ny + M[2] * nz, M[3] * nx + M[4] * ny + M[5] * nz, M[6] * nx + M[7] * ny + M[8] * nz);
      S.push(si);
      B.push(Math.max(0, bi), 0, 0, 0);
    }
    for (let k = 0; k < g.i.length; k++) I.push(base + g.i[k]);
  }
  const vertices = P.length / 3;
  return {
    position: new Float32Array(P), normal: new Float32Array(N), paletteIndex: new Float32Array(S), skinIndex: new Uint16Array(B),
    index: vertices > 65535 ? new Uint32Array(I) : new Uint16Array(I), triangles: I.length / 3, vertices,
    bones: sk.names, slots, bind: sk.world, rest: sk.rest, parent: sk.parent, problems,
  };
}
