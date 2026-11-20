/**
 * Vegetation, ground cover, rocks and pillars (ARCHITECTURE 4.1, ART_UX 1.9; world pass: region identity): one
 * instanced mesh per prop kind (a draw call only for the kinds in view), chunky faceted geometry with baked vertex
 * colours, wind sway on the plants, refilled nearest first from the seeded per-cell scatter when the focus crosses a
 * 128 m cell, with the tier radii and instance caps. Three draw classes: trees (tree radius and cap), rocks (rock
 * radius and cap) and ground cover (bushes, ferns, flowers, grass, scrub, mushrooms: half the rock radius up to 200 m, 1.5x the
 * rock cap). Tinted kinds take a per-instance colour from their region (foliage, flowers, cliff) and one of four
 * variants, so the same mesh reads differently in every region.
 * Streaming: an instance that was not drawn before grows in from its root over 0.7 s instead of popping (a flush
 * from a teleport places everything at full size). Prop colliders around the player enter the collider grid;
 * destroyed props stay hidden until `game:loaded`. Instance buffers are sized for the active tier (resized only on
 * a tier change) and a refill uploads only the instances it wrote.
 * @module world/vegetation
 */

import { BufferGeometry, BufferAttribute, InstancedMesh, Color, Vector3, InstancedBufferAttribute } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { WORLD_HALF } from '../core/constants.js';
import { REGIONS, NR } from './gen/layout.js';
import { KIND, KIND_COUNT, CLASS, KIND_NAME, SCATTER_CELL, SCATTER_N, createCellBuffer, scatterCell } from './gen/scatter.js';
import { COLLIDER } from './gen/colliders.js';

const MAX_TREES = 4000;
const MAX_ROCKS = 2000;
const MAX_COVER = 1600;
const MAX_RADIUS = 960;
const MAX_PROP_COLLIDERS = 3000;
/** Trees whose trunk is closer to the camera than this many metres (times the instance scale) are hidden. */
const TREE_NEAR_HIDE = 4.2;
/** Ground cover within this many metres (times its scale) of the camera, horizontally, is not drawn: nothing fills
 * the screen or stands between the camera and the hero. Small rocks the same within 1.8 m x scale. */
const COVER_NEAR_HIDE = 3.5;
const ROCK_NEAR_HIDE = 1.8;
/** Seconds an instance takes to grow in. */
const GROW_S = 0.7;
const GROW_MAX = 4096;
const TABLE = 16384;

// ------------------------------------------------------------- geometry builder
/** Flat-shaded triangle soup with per-vertex colours. */
function builder() {
  const pos = [];
  const col = [];
  const c = new Color();
  const a = new Vector3();
  const b = new Vector3();
  const d = new Vector3();
  return {
    /** @param {number[]} p0 @param {number[]} p1 @param {number[]} p2 @param {number} c0 @param {number} [c1] @param {number} [c2] */
    tri(p0, p1, p2, c0, c1, c2) {
      pos.push(...p0, ...p1, ...p2);
      for (const h of [c0, c1 === undefined ? c0 : c1, c2 === undefined ? c0 : c2]) {
        c.set(h);
        col.push(c.r, c.g, c.b);
      }
    },
    geometry() {
      const g = new BufferGeometry();
      const p = new Float32Array(pos);
      const nrm = new Float32Array(pos.length);
      for (let i = 0; i < p.length; i += 9) {
        a.set(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]);
        b.set(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]);
        d.crossVectors(a, b).normalize();
        for (let k = 0; k < 3; k++) {
          nrm[i + k * 3] = d.x; nrm[i + k * 3 + 1] = d.y; nrm[i + k * 3 + 2] = d.z;
        }
      }
      g.setAttribute('position', new BufferAttribute(p, 3));
      g.setAttribute('normal', new BufferAttribute(nrm, 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.computeBoundingSphere();
      return g;
    },
  };
}

/**
 * Tapered prism around the y axis (sides only, optional top cap or apex).
 * @param {any} B @param {number} sides @param {number[]} c0 bottom centre @param {number} r0 @param {number[]} c1 top centre @param {number} r1
 * @param {number} col @param {number} [colTop] @param {boolean} [cap]
 */
function prism(B, sides, c0, r0, c1, r1, col, colTop, cap) {
  const ct = colTop === undefined ? col : colTop;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p00 = [c0[0] + Math.cos(a0) * r0, c0[1], c0[2] + Math.sin(a0) * r0];
    const p01 = [c0[0] + Math.cos(a1) * r0, c0[1], c0[2] + Math.sin(a1) * r0];
    const p10 = [c1[0] + Math.cos(a0) * r1, c1[1], c1[2] + Math.sin(a0) * r1];
    const p11 = [c1[0] + Math.cos(a1) * r1, c1[1], c1[2] + Math.sin(a1) * r1];
    if (r1 <= 0.0001) {
      B.tri(p00, c1, p01, col, ct, col);
      continue;
    }
    B.tri(p00, p10, p01, col, ct, col);
    B.tri(p01, p10, p11, col, ct, ct);
    if (cap) B.tri(p10, c1, p11, ct);
  }
}

/** Octahedron blob. */
function blob(B, cx, cy, cz, rx, ry, rz, col, colTop) {
  const top = [cx, cy + ry, cz];
  const bot = [cx, cy - ry * 0.8, cz];
  const ring = [[cx + rx, cy, cz], [cx, cy, cz + rz], [cx - rx, cy, cz], [cx, cy, cz - rz]];
  for (let i = 0; i < 4; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 4];
    B.tri(p, top, q, col, colTop, col);
    B.tri(p, q, bot, col, col, col);
  }
}

/**
 * A rounded faceted clump: a pentagonal belly at cy, a smaller rotated upper ring, a top point and a flat-ish dark
 * underside. r horizontal radius, h half height. 20 triangles.
 */
function ball(B, cx, cy, cz, r, h, cBot, cMid, cTop, rot) {
  const N = 5;
  const mid = [];
  const up = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rot;
    const b = a + Math.PI / N;
    mid.push([cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]);
    up.push([cx + Math.cos(b) * r * 0.7, cy + h * 0.65, cz + Math.sin(b) * r * 0.7]);
  }
  const top = [cx, cy + h, cz];
  const bot = [cx, cy - h * 0.75, cz];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    B.tri(mid[i], up[i], mid[j], cMid, cTop, cMid);
    B.tri(up[i], up[j], mid[j], cTop, cTop, cMid);
    B.tri(up[i], top, up[j], cTop, cTop, cTop);
    B.tri(mid[i], mid[j], bot, cMid, cMid, cBot);
  }
}

/** Squashed, displaced icosahedron (rock). */
function rock(B, col, seed) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const p = v.map((q, i) => {
    const k = 0.42 + 0.14 * ((hash2(i, seed, 77) >>> 0) / 4294967296);
    return [q[0] * k * 1.25, q[1] * k * 0.7 + 0.35, q[2] * k];
  });
  const shade = new Color();
  for (const tri of f) {
    const y = (p[tri[0]][1] + p[tri[1]][1] + p[tri[2]][1]) / 3;
    shade.set(col).multiplyScalar(0.82 + 0.25 * Math.min(1, Math.max(0, y)));
    B.tri(p[tri[0]], p[tri[2]], p[tri[1]], shade.getHex());
  }
}

/** A box yawed by `a` about (cx, cz), from y0 to y1; five faces (no bottom). */
function slab(B, cx, cz, a, hx, y0, y1, hz, col, colTop) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const P = (lx, y, lz) => [cx + lx * c + lz * sn, y, cz - lx * sn + lz * c];
  const b = [P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz)];
  const t = [P(-hx, y1, -hz), P(hx, y1, -hz), P(hx, y1, hz), P(-hx, y1, hz)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    B.tri(b[i], b[j], t[i], col, col, colTop);
    B.tri(b[j], t[j], t[i], col, colTop, colTop);
  }
  B.tri(t[0], t[1], t[3], colTop);
  B.tri(t[1], t[2], t[3], colTop);
}

/** Build the prop geometries, one per KIND (ART_UX 1.9; world pass: region identity). @returns {any[]} */
function buildGeometries() {
  const P = PALETTE;
  const bark = P.biome.rustdune.shade;
  const out = [];
  const shade = (hex, k) => new Color(hex).multiplyScalar(k).getHex();
  const grey = (k) => new Color(k, k, k).getHex();
  // 0 kite cedar: a tall crown of three stacked blobs
  {
    const B = builder();
    const leaf = P.biome.meadows.foliage;
    prism(B, 6, [0, 0, 0], 0.32, [0, 3.4, 0], 0.18, bark, shade(bark, 1.1));
    blob(B, 0, 4.2, 0, 1.9, 1.5, 1.8, shade(leaf, 0.82), shade(leaf, 1.1));
    blob(B, 0.5, 5.6, 0.25, 1.45, 1.35, 1.35, leaf, shade(leaf, 1.16));
    blob(B, -0.3, 6.8, -0.2, 0.95, 1.1, 0.9, shade(leaf, 0.96), shade(leaf, 1.2));
    out.push(B.geometry());
  }
  // 1 ember maple: a short trunk under a broad, round red crown
  {
    const B = builder();
    const leaf = P.flora.redLeaf;
    prism(B, 6, [0, 0, 0], 0.36, [0.2, 2.6, 0], 0.2, bark, shade(bark, 1.1));
    blob(B, 0, 3.7, 0, 2.5, 1.35, 2.3, shade(leaf, 0.8), shade(leaf, 1.08));
    blob(B, 1.1, 4.5, 0.6, 1.5, 1.1, 1.4, leaf, shade(leaf, 1.16));
    blob(B, -1.0, 4.4, -0.5, 1.5, 1.05, 1.5, shade(leaf, 0.93), shade(leaf, 1.12));
    blob(B, 0.1, 5.2, -0.1, 1.2, 0.85, 1.1, shade(leaf, 1.02), shade(leaf, 1.22));
    out.push(B.geometry());
  }
  // 2 salt palm: curved trunk, six flat leaves
  {
    const B = builder();
    const tr = P.biome.coast.cliff;
    const pts = [[0, 0, 0], [0.35, 2.4, 0], [0.95, 4.6, 0], [1.7, 6.4, 0]];
    for (let i = 0; i < 3; i++) prism(B, 4, pts[i], 0.3 - i * 0.06, pts[i + 1], 0.24 - i * 0.06, shade(tr, 0.9 + i * 0.06));
    const top = pts[3];
    const leaf = P.biome.coast.foliage;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const tip = [top[0] + Math.cos(a) * 3.3, top[1] - 1.4, top[2] + Math.sin(a) * 3.3];
      const side = [-Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55];
      const mid = [top[0] + Math.cos(a) * 1.5, top[1] + 0.4, top[2] + Math.sin(a) * 1.5];
      B.tri(top, [mid[0] + side[0], mid[1], mid[2] + side[2]], tip, leaf, shade(leaf, 1.12), shade(leaf, 0.85));
      B.tri(top, tip, [mid[0] - side[0], mid[1], mid[2] - side[2]], leaf, shade(leaf, 0.85), shade(leaf, 1.12));
    }
    out.push(B.geometry());
  }
  // 3 bramble tree: twisted thick trunk, dark slabs, thorns and flowers
  {
    const B = builder();
    const tw = P.biome.thornwood.cliff;
    prism(B, 5, [0, 0, 0], 0.55, [0.4, 2.2, 0.2], 0.4, shade(tw, 0.75), tw);
    prism(B, 5, [0.4, 2.2, 0.2], 0.4, [-0.1, 3.6, -0.2], 0.28, tw, shade(tw, 0.9));
    const f = P.biome.thornwood.foliage;
    blob(B, 0, 4.4, 0, 2.6, 1.0, 2.3, shade(f, 0.8), shade(f, 1.1));
    blob(B, 0.6, 5.5, -0.4, 1.8, 0.8, 1.7, f, shade(f, 1.18));
    prism(B, 3, [1.4, 4.3, 0.6], 0.25, [2.2, 4.0, 1.0], 0, shade(tw, 0.7));
    prism(B, 3, [-1.2, 4.1, -0.8], 0.22, [-2.0, 3.7, -1.3], 0, shade(tw, 0.7));
    blob(B, -1.3, 5.0, 0.9, 0.35, 0.3, 0.35, P.flora.brambleFlower, shade(P.flora.brambleFlower, 1.15));
    blob(B, 1.5, 4.9, -0.7, 0.3, 0.26, 0.3, P.flora.brambleFlower, shade(P.flora.brambleFlower, 1.15));
    out.push(B.geometry());
  }
  // 4 rust cactus: stacked columns, two arms, copper-green tips
  {
    const B = builder();
    const body = P.biome.rustdune.foliage;
    const tip = P.biome.rustdune.accent;
    prism(B, 6, [0, 0, 0], 0.5, [0, 3.2, 0], 0.45, shade(body, 0.85), body);
    prism(B, 6, [0, 3.2, 0], 0.45, [0, 4.0, 0], 0, body, tip);
    prism(B, 4, [0.4, 1.6, 0], 0.26, [1.2, 2.6, 0], 0.22, body);
    prism(B, 4, [1.2, 2.6, 0], 0.22, [1.25, 3.3, 0], 0, body, tip);
    prism(B, 4, [-0.4, 2.2, 0.1], 0.22, [-1.0, 2.9, 0.15], 0.2, body);
    prism(B, 4, [-1.0, 2.9, 0.15], 0.2, [-1.05, 3.5, 0.15], 0, body, tip);
    out.push(B.geometry());
  }
  // 5 frost pine: three stacked cones with white tips
  {
    const B = builder();
    const f = P.biome.frostspine.foliage;
    prism(B, 4, [0, 0, 0], 0.25, [0, 1.6, 0], 0.18, bark);
    const tiers = [[1.0, 2.2, 3.4], [2.6, 1.7, 2.7], [4.0, 1.2, 2.3]];
    for (const [y, r, h] of tiers) {
      prism(B, 6, [0, y, 0], r, [0, y + h, 0], 0, shade(f, 0.85), P.snow);
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        const a1 = ((i + 1) / 6) * Math.PI * 2;
        B.tri([Math.cos(a1) * r, y, Math.sin(a1) * r], [0, y + 0.2, 0], [Math.cos(a0) * r, y, Math.sin(a0) * r], shade(f, 0.6));
      }
    }
    out.push(B.geometry());
  }
  // 6 marsh reeds with a seed head
  {
    const B = builder();
    const f = P.biome.stormwell.foliage;
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4;
      const x = Math.cos(a) * 0.5 * (i % 3);
      const z = Math.sin(a) * 0.5 * (i % 3);
      prism(B, 3, [x, 0, z], 0.12, [x * 1.5 + 0.2, 2.2 + (i % 2) * 0.9, z * 1.5], 0, shade(f, 0.8), shade(f, 1.25));
    }
    blob(B, 0.35, 2.5, 0.1, 0.1, 0.32, 0.1, shade(bark, 0.9), bark);
    out.push(B.geometry());
  }
  // 7 crystal spikes
  {
    const B = builder();
    const c = P.biome.spire.cliff;
    prism(B, 6, [0, 0, 0], 0.55, [0.2, 2.6, 0], 0.5, shade(c, 0.85), c);
    prism(B, 6, [0.2, 2.6, 0], 0.5, [0.25, 3.6, 0], 0, c, P.biome.spire.accent);
    prism(B, 6, [0.6, 0, 0.4], 0.32, [1.3, 1.6, 0.8], 0.3, shade(c, 0.9), c);
    prism(B, 6, [1.3, 1.6, 0.8], 0.3, [1.5, 2.2, 0.9], 0, c, P.biome.spire.accent);
    out.push(B.geometry());
  }
  // 8 rock (tinted per instance)
  {
    const B = builder();
    rock(B, 0xf0f0f0, 3);
    out.push(B.geometry());
  }
  // 9 pillar (tinted per instance)
  {
    const B = builder();
    prism(B, 6, [0, 0, 0], 1.1, [0.1, 4.5, 0.05], 0.85, 0xc8c8c8, 0xf4f4f4);
    prism(B, 6, [0.1, 4.5, 0.05], 0.85, [0.1, 6.2, 0.05], 0.7, 0xe0e0e0, 0xffffff, true);
    out.push(B.geometry());
  }
  // 10 kite poplar: a slim column of light green, planted in rows along the paths
  {
    const B = builder();
    const leaf = P.biome.meadows.ground;
    prism(B, 5, [0, 0, 0], 0.24, [0, 2.4, 0], 0.15, bark, shade(bark, 1.15));
    blob(B, 0, 4.4, 0, 1.05, 2.7, 1.0, shade(leaf, 0.7), shade(leaf, 0.98));
    blob(B, 0.08, 7.0, 0.05, 0.72, 1.7, 0.7, shade(leaf, 0.84), shade(leaf, 1.1));
    out.push(B.geometry());
  }
  // 11 snag: a bleached, leafless dead tree with three crooked limbs
  {
    const B = builder();
    const w = P.biome.coast.shade;
    prism(B, 5, [0, 0, 0], 0.36, [0.25, 2.2, 0.1], 0.24, shade(w, 0.72), w);
    prism(B, 5, [0.25, 2.2, 0.1], 0.24, [-0.1, 4.4, -0.1], 0.1, w, shade(w, 1.12));
    prism(B, 3, [0.2, 2.0, 0.1], 0.14, [1.5, 3.3, 0.5], 0, w, shade(w, 1.15));
    prism(B, 3, [0.05, 3.1, 0], 0.12, [-1.3, 4.0, -0.6], 0, w, shade(w, 1.15));
    prism(B, 3, [0.0, 3.7, -0.05], 0.09, [0.6, 4.9, -0.9], 0, w, shade(w, 1.15));
    out.push(B.geometry());
  }
  // 12 thorn fir: a tall, narrow dark spire of four cones (Thornwood, the lower Frostspine)
  {
    const B = builder();
    const f = P.biome.thornwood.foliage;
    prism(B, 4, [0, 0, 0], 0.26, [0, 1.6, 0], 0.18, bark);
    const tiers = [[1.1, 1.75, 3.0], [2.8, 1.45, 2.8], [4.4, 1.1, 2.6], [5.9, 0.75, 2.6]];
    for (let i = 0; i < tiers.length; i++) {
      const [y, r, h] = tiers[i];
      prism(B, 6, [0, y, 0], r, [0, y + h, 0], 0, shade(f, 0.72 + i * 0.05), shade(f, 1.2 + i * 0.04));
    }
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = ((i + 1) / 6) * Math.PI * 2;
      B.tri([Math.cos(a1) * 1.75, 1.1, Math.sin(a1) * 1.75], [0, 1.4, 0], [Math.cos(a0) * 1.75, 1.1, Math.sin(a0) * 1.75], shade(f, 0.5));
    }
    out.push(B.geometry());
  }
  // 13 bush: three leafy blobs (tinted per instance with the region foliage)
  {
    const B = builder();
    // a cluster of three small rounded clumps (0.75 m tall at scale 1), dark underneath, light on top
    ball(B, 0, 0.42, 0, 0.48, 0.36, grey(0.5), grey(0.82), grey(1.1), 0);
    ball(B, 0.45, 0.3, 0.28, 0.36, 0.28, grey(0.52), grey(0.86), grey(1.14), 0.5);
    ball(B, -0.4, 0.28, -0.22, 0.34, 0.26, grey(0.5), grey(0.84), grey(1.12), 1.1);
    out.push(B.geometry());
  }
  // 14 flower patch: seven small blooms on stems (tinted per instance; double-sided)
  {
    const B = builder();
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996;
      const d = 0.15 + 0.55 * Math.sqrt(i / 7);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const y = 0.3 + ((i * 5) % 4) * 0.09;
      const r = 0.075 + (i % 3) * 0.02;
      B.tri([x - 0.02, 0, z], [x + 0.02, 0, z], [x, y, z], grey(0.38));
      const ring = [[x + r, y, z], [x, y, z + r], [x - r, y, z], [x, y, z - r]];
      for (let k = 0; k < 4; k++) B.tri(ring[k], [x, y + 0.05, z], ring[(k + 1) % 4], grey(1.0), grey(1.15), grey(1.0));
    }
    out.push(B.geometry());
  }
  // 15 fern: seven arching fronds (tinted; double-sided)
  {
    const B = builder();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + (i % 2) * 0.3;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const L = 0.95 + (i % 3) * 0.15;
      const mid = [c * L * 0.5, 0.55, sn * L * 0.5];
      const tip = [c * L, 0.22, sn * L];
      const w = 0.2;
      B.tri([0, 0.05, 0], [mid[0] - sn * w, mid[1] - 0.05, mid[2] + c * w], mid, grey(0.62), grey(0.95), grey(1.05));
      B.tri([0, 0.05, 0], mid, [mid[0] + sn * w, mid[1] - 0.05, mid[2] - c * w], grey(0.62), grey(1.05), grey(0.9));
      B.tri(mid, [mid[0] - sn * w * 0.8, mid[1] - 0.1, mid[2] + c * w * 0.8], tip, grey(1.05), grey(0.95), grey(1.15));
      B.tri(mid, tip, [mid[0] + sn * w * 0.8, mid[1] - 0.1, mid[2] - c * w * 0.8], grey(1.05), grey(1.15), grey(0.9));
    }
    out.push(B.geometry());
  }
  // 16 tall grass: a clump of nine long blades (tinted; double-sided)
  {
    const B = builder();
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const r0 = 0.08 + (0.18 * ((i * 3) % 5)) / 5;
      const h = 0.75 + ((i * 7) % 5) * 0.12;
      const lean = 0.25 + (i % 3) * 0.12;
      const bx = c * r0;
      const bz = sn * r0;
      B.tri([bx - sn * 0.06, 0, bz + c * 0.06], [bx + sn * 0.06, 0, bz - c * 0.06], [c * (r0 + lean), h, sn * (r0 + lean)], grey(0.58), grey(0.58), grey(1.12));
    }
    out.push(B.geometry());
  }
  // 17 scrub: a dry, spiky desert or mountain shrub (tinted; double-sided)
  {
    const B = builder();
    blob(B, 0, 0.3, 0, 0.45, 0.32, 0.45, grey(0.7), grey(0.95));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const L = 0.8 + (i % 3) * 0.2;
      B.tri([-sn * 0.07, 0.1, c * 0.07], [sn * 0.07, 0.1, -c * 0.07], [c * L, 0.55 + (i % 2) * 0.35, sn * L], grey(0.6), grey(0.6), grey(1.1));
    }
    out.push(B.geometry());
  }
  // 18 mushrooms: two violet-capped toadstools of the Thornwood floor
  {
    const B = builder();
    const cap = P.flora.brambleFlower;
    const stem = P.paper;
    for (const [x, z, h, r] of [[0, 0, 1.3, 0.9], [0.95, 0.5, 0.75, 0.55]]) {
      prism(B, 5, [x, 0, z], r * 0.28, [x + 0.05, h, z], r * 0.22, shade(stem, 0.8), stem);
      prism(B, 6, [x + 0.05, h, z], r, [x + 0.05, h + r * 0.75, z], 0, shade(cap, 0.85), shade(cap, 1.18));
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        const a1 = ((i + 1) / 6) * Math.PI * 2;
        B.tri([x + 0.05 + Math.cos(a1) * r, h, z + Math.sin(a1) * r], [x + 0.05, h - 0.1, z], [x + 0.05 + Math.cos(a0) * r, h, z + Math.sin(a0) * r], shade(stem, 0.7));
      }
    }
    out.push(B.geometry());
  }
  // 19 slab stack: layered strata stones, light and dark bands (a hoodoo in the Rustdune; tinted)
  {
    const B = builder();
    slab(B, 0, 0, 0.2, 1.5, -0.4, 0.9, 1.2, grey(0.7), grey(0.82));
    slab(B, 0.1, 0.05, 0.5, 1.05, 0.9, 2.3, 0.9, grey(0.95), grey(1.05));
    slab(B, 0.05, 0.1, 0.1, 0.75, 2.3, 3.0, 0.7, grey(0.72), grey(0.8));
    slab(B, 0.15, 0.05, 0.65, 1.25, 3.0, 3.45, 1.05, grey(1.0), grey(1.15));
    out.push(B.geometry());
  }
  // 20 shard cluster: three tilted crystal prisms (salt-glass on the Coast, ice in the Frostspine; glossy, tinted)
  {
    const B = builder();
    for (const [x, z, h, r, tx, tz] of [[0, 0, 2.6, 0.45, 0.35, 0.1], [0.6, 0.4, 1.6, 0.32, 0.6, 0.4], [-0.5, 0.3, 1.2, 0.28, -0.45, 0.2]]) {
      prism(B, 4, [x, -0.2, z], r, [x + tx, h, z + tz], r * 0.85, grey(0.78), grey(1.0));
      prism(B, 4, [x + tx, h, z + tz], r * 0.85, [x + tx * 1.15, h + r * 1.6, z + tz * 1.15], 0, grey(1.0), grey(1.2));
    }
    out.push(B.geometry());
  }
  // 21 basalt columns: three hexagonal columns of different heights (Stormwell; tinted)
  {
    const B = builder();
    for (const [x, z, h, r] of [[0, 0, 3.4, 0.62], [1.05, 0.3, 2.3, 0.55], [0.35, -1.0, 1.5, 0.58]]) {
      prism(B, 6, [x, -0.3, z], r, [x, h, z], r, grey(0.68), grey(0.9), true);
    }
    out.push(B.geometry());
  }
  return out;
}

/** Kinds whose colour comes from the instance (region and variant); the rest are baked and only vary in value. */
const TINTED = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1]);
/** Hue drift of the baked kinds per variant (warm, cool, dry), so a grove is not one colour. */
const DRIFT = Object.freeze([[1, 1, 1], [1.06, 1.0, 0.9], [0.92, 1.0, 1.04], [1.02, 0.95, 0.94]]);

/**
 * The per-instance colour table [kind][region][variant] -> linear rgb, for the tinted kinds.
 * @returns {Float32Array}
 */
function tintTable() {
  const P = PALETTE;
  const t = new Float32Array(KIND_COUNT * NR * 4 * 3);
  const c = new Color();
  const d = new Color();
  const set = (k, ri, v, hex, mix, k2) => {
    c.setHex(hex);
    if (mix !== undefined) c.lerp(d.setHex(mix), k2);
    const o = ((k * NR + ri) * 4 + v) * 3;
    t[o] = c.r; t[o + 1] = c.g; t[o + 2] = c.b;
  };
  for (let ri = 0; ri < NR; ri++) {
    const b = P.biome[REGIONS[ri].biome];
    for (let v = 0; v < 4; v++) {
      // rocks and pillars: the region cliff, with a lighter and a darker stone
      set(KIND.ROCK, ri, v, b.cliff, v === 1 ? b.ground : v === 2 ? b.shade : undefined, 0.3);
      set(KIND.PILLAR, ri, v, b.cliff, v === 1 ? b.ground : undefined, 0.25);
      set(KIND.SLAB, ri, v, ri === 3 ? (v < 2 ? b.cliff : b.ground) : b.cliff, ri === 3 ? undefined : b.ground, 0.2 * v);
      set(KIND.BASALT, ri, v, ri === 5 ? b.cliff : b.shade, b.ground, 0.12 * v);
      // shards: salt-glass on the Coast, ice in the Frostspine, pale crystal elsewhere
      if (ri === 1) set(KIND.SHARD, ri, v, P.paper, b.accent, 0.25 + 0.12 * v);
      else if (ri === 4) set(KIND.SHARD, ri, v, P.snow, b.accent, 0.35 + 0.12 * v);
      else set(KIND.SHARD, ri, v, P.biome.spire.cliff, P.biome.spire.ground, 0.2 * v);
      // ground cover: the region foliage, pulled toward its ground and shade
      set(KIND.BUSH, ri, v, ri === 0 && v === 3 ? P.flora.redLeaf : b.foliage, v === 1 ? b.ground : v === 2 ? b.shade : undefined, v === 3 ? 0.5 : 0.3);
      set(KIND.FERN, ri, v, b.foliage, b.ground, 0.15 + 0.12 * v);
      set(KIND.GRASS, ri, v, ri === 1 ? b.cliff : b.ground, b.foliage, ri === 1 ? 0.25 + 0.1 * v : 0.35 + 0.15 * v);
      set(KIND.SCRUB, ri, v, b.foliage, ri === 3 ? b.cliff : b.ground, 0.15 + 0.15 * v);
    }
    // flowers by region: Meadows yellow, red, white and blue; Thornwood violet; Coast sea-pinks; the high meadows white
    const fl = ri === 0 ? [b.accent, P.flora.redLeaf, P.paper, P.structure.kites[2]]
      : ri === 2 ? [P.flora.brambleFlower, P.flora.brambleFlower, P.paper, b.accent]
        : ri === 1 ? [P.flora.brambleFlower, P.paper, P.biome.meadows.accent, P.flora.brambleFlower]
          : ri === 4 ? [P.paper, b.accent, P.paper, P.biome.meadows.accent]
            : [P.biome.meadows.accent, P.paper, P.flora.brambleFlower, b.accent];
    for (let v = 0; v < 4; v++) set(KIND.FLOWERS, ri, v, fl[v]);
  }
  return t;
}

/** Instance-cap of a draw class from the tier caps. @param {number} cls @param {any} caps */
function classCap(cls, caps) {
  if (cls === 0) {
    const want = caps ? caps.treeInstances : MAX_TREES;
    return typeof want === 'number' && want > 0 ? Math.min(MAX_TREES, want) : MAX_TREES;
  }
  const rock = caps ? caps.rockInstances : MAX_ROCKS;
  const r = typeof rock === 'number' && rock > 0 ? Math.min(MAX_ROCKS, rock) : MAX_ROCKS;
  return cls === 1 ? r : Math.min(MAX_COVER, Math.round(r * 1.5));
}

/**
 * Instance capacity of one prop kind for the tier caps: one kind may hold every drawn prop of its class.
 * @param {number} k kind @param {{ treeInstances?:number, rockInstances?:number }|null|undefined} caps
 * @returns {number}
 */
export function capacityFor(k, caps) {
  return classCap(CLASS[k], caps);
}

/**
 * Draw radius of the ground cover: half the rock radius, at most 200 m (low: 150 m of its 300 m rock radius).
 * @param {any} caps @returns {number}
 */
export function coverRadius(caps) {
  const r = caps && typeof caps.rockRadius === 'number' ? caps.rockRadius : 700;
  return Math.min(200, r * 0.5);
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {ReturnType<import('./gen/colliders.js').createColliders>} colliders
 * @param {number} seed
 * @param {ReturnType<import('./gen/scatter.js').createClearSet>} [clear] discs kept free of props
 */
export function createVegetation(ctx, grid, colliders, seed, clear) {
  const geos = buildGeometries();
  const tints = tintTable();
  /** @type {any[]} */
  const meshes = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    const cap = capacityFor(k, ctx.render.caps);
    const cls = CLASS[k];
    const wind = cls !== 1 && k !== KIND.CRYSTAL && k !== KIND.MUSHROOM;
    const thin = k === KIND.PALM || k === KIND.FLOWERS || k === KIND.FERN || k === KIND.GRASS || k === KIND.SCRUB;
    const opts = { vertexColors: true, instanced: true, wind, doubleSide: thin };
    if (k === KIND.CRYSTAL) Object.assign(opts, { emissive: PALETTE.biome.spire.cliff, emissiveIntensity: 0.3, glossy: true });
    if (k === KIND.SHARD) Object.assign(opts, { emissive: PALETTE.paper, emissiveIntensity: 0.12, glossy: true });
    const m = new InstancedMesh(geos[k], ctx.render.materials.toon(opts), cap);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.name = 'world.veg.' + k;
    // a tree the camera is inside (crown at eye height, trunk a few metres away) is not drawn: no screen-filling
    // canopy; ground cover shrinks toward its root right under the lens instead
    const u = m.material.uniforms.uNearHide;
    if (u) u.value = cls === 0 ? TREE_NEAR_HIDE : cls === 2 ? COVER_NEAR_HIDE : ROCK_NEAR_HIDE;
    ctx.render.layers.props.add(m);
    meshes.push(m);
  }

  /**
   * Re-size a kind's instance buffers for the active tier (tier change only; not a frame path). The old GPU buffers
   * are released through the mesh's dispose event (WebGLObjects removes its instance attributes).
   * @param {any} m @param {number} cap
   */
  function resize(m, cap) {
    m.dispose();
    m.instanceMatrix = new InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.count = 0;
  }

  // Cell offsets in distance order (nearest first).
  const offs = [];
  const span = Math.ceil(MAX_RADIUS / SCATTER_CELL) + 1;
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const dx = Math.max(0, Math.abs(di) - 1) * SCATTER_CELL;
      const dz = Math.max(0, Math.abs(dj) - 1) * SCATTER_CELL;
      offs.push([di, dj, Math.sqrt(dx * dx + dz * dz)]);
    }
  }
  offs.sort((a, b) => a[2] - b[2]);
  const offI = new Int32Array(offs.map((o) => o[0]));
  const offJ = new Int32Array(offs.map((o) => o[1]));
  const offD = new Float32Array(offs.map((o) => o[2]));

  const buf = createCellBuffer();
  const optAll = { cover: true, clear: clear || null };
  const optNoCover = { cover: false, clear: clear || null };
  /** @type {Set<number>} */
  const destroyed = new Set();
  let lastCi = -9999;
  let lastCj = -9999;
  let lastAlt = -9999;
  let dirty = true;
  let treesDrawn = 0;
  let rocksDrawn = 0;
  let coverDrawn = 0;
  const counts = new Int32Array(KIND_COUNT);
  const classN = new Int32Array(3);
  const classCapN = new Int32Array(3);
  const classR = new Float32Array(3);

  // growth: two open-addressed key tables (drawn last refill / this refill) holding each key's growth 0..1
  let keysA = new Int32Array(TABLE);
  let growA = new Float32Array(TABLE);
  let keysB = new Int32Array(TABLE);
  let growB = new Float32Array(TABLE);
  const gKind = new Uint8Array(GROW_MAX);
  const gIdx = new Int32Array(GROW_MAX);
  const gSlot = new Int32Array(GROW_MAX);
  const gF = new Float32Array(GROW_MAX);
  let gN = 0;
  const upLo = new Int32Array(KIND_COUNT);
  const upHi = new Int32Array(KIND_COUNT);

  /** @param {Int32Array} keys @param {number} key @returns {number} slot of the key or of the empty slot ending its probe */
  function probe(keys, key) {
    let s = (Math.imul(key, 0x9e3779b1) >>> 18) & (TABLE - 1);
    for (let i = 0; i < TABLE; i++) {
      const k = keys[s];
      if (k === key || k === 0) return s;
      s = (s + 1) & (TABLE - 1);
    }
    return -1;
  }

  /** Write one instance. */
  function put(m, i, x, y, z, s, yaw, r, g, b) {
    const e = m.instanceMatrix.array;
    const o = i * 16;
    const c = Math.cos(yaw) * s;
    const sn = Math.sin(yaw) * s;
    e[o] = c; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    const ca = m.instanceColor.array;
    ca[i * 3] = r; ca[i * 3 + 1] = g; ca[i * 3 + 2] = b;
  }

  /** Refill every instanced mesh nearest first around the focus. @param {boolean} instant no growth */
  function refill(fx, fy, fz, instant) {
    const caps = ctx.render.caps;
    classR[0] = caps.treeRadius;
    classR[1] = caps.rockRadius;
    classR[2] = coverRadius(caps);
    for (let c = 0; c < 3; c++) {
      classCapN[c] = classCap(c, caps);
      classN[c] = 0;
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      const want = capacityFor(k, caps);
      if (meshes[k].instanceMatrix.count !== want) resize(meshes[k], want);
    }
    const maxR = classR[0] > classR[1] ? classR[0] : classR[1];
    const ci0 = Math.floor((fx + WORLD_HALF) / SCATTER_CELL);
    const cj0 = Math.floor((fz + WORLD_HALF) / SCATTER_CELL);
    for (let k = 0; k < KIND_COUNT; k++) counts[k] = 0;
    const ground = grid.heightAt(fx, fz);
    const alt = fy - ground;
    const horiz = alt > maxR ? 0 : Math.sqrt(maxR * maxR - (alt > 0 ? alt * alt : 0));
    const cR = classR[2];
    const coverHoriz = alt > cR ? 0 : Math.sqrt(cR * cR - (alt > 0 ? alt * alt : 0));
    // swap the key tables: B holds last refill, A is rebuilt
    const tk = keysB; keysB = keysA; keysA = tk;
    const tg = growB; growB = growA; growA = tg;
    keysA.fill(0);
    gN = 0;
    for (let o = 0; o < offI.length; o++) {
      if (offD[o] > horiz + SCATTER_CELL * 0.5) break;
      if (classN[0] >= classCapN[0] && classN[1] >= classCapN[1] && classN[2] >= classCapN[2]) break;
      const ci = ci0 + offI[o];
      const cj = cj0 + offJ[o];
      if (ci < 0 || cj < 0 || ci >= SCATTER_N || cj >= SCATTER_N) continue;
      const n = scatterCell(ci, cj, seed, grid, buf, offD[o] <= coverHoriz + SCATTER_CELL * 0.5 ? optAll : optNoCover);
      for (let i = 0; i < n; i++) {
        const kind = buf.kind[i];
        const cls = CLASS[kind];
        if (classN[cls] >= classCapN[cls]) continue;
        const dx = buf.x[i] - fx;
        const dy = buf.y[i] - fy;
        const dz = buf.z[i] - fz;
        const R = classR[cls];
        if (dx * dx + dy * dy + dz * dz > R * R) continue;
        const key = buf.key[i];
        if (destroyed.size > 0 && destroyed.has(key)) continue;
        const m = meshes[kind];
        const idx = counts[kind];
        const v = 0.86 + 0.24 * (((key * 2654435761) >>> 0) / 4294967296);
        const tv = buf.tint[i];
        // growth: a key drawn last time keeps its growth, a new one starts small (unless this is a flush)
        let f = 1;
        const slot = probe(keysA, key);
        if (!instant) {
          const ps = probe(keysB, key);
          f = ps >= 0 && keysB[ps] === key ? growB[ps] : 0.02;
        }
        if (slot >= 0) {
          keysA[slot] = key;
          growA[slot] = f;
        }
        const s = buf.s[i] * f;
        if (TINTED[kind] === 1) {
          const ri = grid.regionIndexAt(buf.x[i], buf.z[i]);
          const to = ((kind * NR + ri) * 4 + tv) * 3;
          put(m, idx, buf.x[i], buf.y[i], buf.z[i], s, buf.yaw[i], tints[to] * v, tints[to + 1] * v, tints[to + 2] * v);
        } else {
          const dr = DRIFT[tv];
          put(m, idx, buf.x[i], buf.y[i], buf.z[i], s, buf.yaw[i], v * dr[0], v * dr[1], v * dr[2]);
        }
        if (f < 1 && gN < GROW_MAX && slot >= 0) {
          gKind[gN] = kind;
          gIdx[gN] = idx;
          gSlot[gN] = slot;
          gF[gN] = f;
          gN++;
        }
        counts[kind]++;
        classN[cls]++;
      }
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      const m = meshes[k];
      const n = counts[k];
      m.count = n;
      m.visible = n > 0;
      if (n === 0) continue;
      // upload only the instances written this refill (the tail past `count` is never drawn)
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, n * 3);
      m.instanceColor.needsUpdate = true;
    }
    treesDrawn = classN[0];
    rocksDrawn = classN[1];
    coverDrawn = classN[2];
  }

  /** Per frame: grow the new instances toward full size (smoothstep over GROW_S). @param {number} dt */
  function grow(dt) {
    if (gN === 0 || !(dt > 0)) return;
    for (let k = 0; k < KIND_COUNT; k++) {
      upLo[k] = 1 << 30;
      upHi[k] = -1;
    }
    const step = dt / GROW_S;
    let w = 0;
    for (let g = 0; g < gN; g++) {
      const f0 = gF[g];
      let f1 = f0 + step * (0.35 + 1.3 * f0 * (1 - f0)) * 1.5;
      if (f1 > 1) f1 = 1;
      const k = gKind[g];
      const i = gIdx[g];
      const e = meshes[k].instanceMatrix.array;
      const o = i * 16;
      const r = f1 / f0;
      e[o] *= r; e[o + 2] *= r; e[o + 5] *= r; e[o + 8] *= r; e[o + 10] *= r;
      if (i < upLo[k]) upLo[k] = i;
      if (i > upHi[k]) upHi[k] = i;
      growA[gSlot[g]] = f1;
      if (f1 < 1) {
        gKind[w] = k;
        gIdx[w] = i;
        gSlot[w] = gSlot[g];
        gF[w] = f1;
        w++;
      }
    }
    gN = w;
    for (let k = 0; k < KIND_COUNT; k++) {
      if (upHi[k] < 0) continue;
      const im = meshes[k].instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(upLo[k] * 16, (upHi[k] - upLo[k] + 1) * 16);
      im.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------- prop colliders around the player
  const colIds = new Int32Array(MAX_PROP_COLLIDERS);
  const colKind = new Uint8Array(MAX_PROP_COLLIDERS);
  let colN = 0;
  let colCi = -9999;
  let colCj = -9999;

  function rebuildColliders(px, pz) {
    for (let i = 0; i < colN; i++) colliders.remove(colIds[i]);
    colN = 0;
    const ci0 = Math.floor((px + WORLD_HALF) / SCATTER_CELL);
    const cj0 = Math.floor((pz + WORLD_HALF) / SCATTER_CELL);
    colCi = ci0;
    colCj = cj0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ci = ci0 + di;
        const cj = cj0 + dj;
        if (ci < 0 || cj < 0 || ci >= SCATTER_N || cj >= SCATTER_N) continue;
        const n = scatterCell(ci, cj, seed, grid, buf, optNoCover);
        for (let i = 0; i < n && colN < MAX_PROP_COLLIDERS; i++) {
          const kind = buf.kind[i];
          if (kind === KIND.REED || CLASS[kind] === 2) continue;
          if (destroyed.size > 0 && destroyed.has(buf.key[i])) continue;
          const s = buf.s[i];
          const key = buf.key[i];
          let id;
          if (kind === KIND.ROCK) {
            id = colliders.add({ shape: 'sphere', x: buf.x[i], y: buf.y[i] + 0.15 * s, z: buf.z[i], r: 0.75 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE, propKey: key });
          } else if (kind === KIND.SLAB) {
            id = colliders.add({ shape: 'disc', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: 1.3 * s, h: 3.4 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE | COLLIDER.PLATFORM, propKey: key });
          } else if (kind === KIND.PILLAR) {
            id = colliders.add({ shape: 'disc', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: 1.0 * s, h: 6.2 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE | COLLIDER.PLATFORM, propKey: key });
          } else if (kind === KIND.BASALT) {
            id = colliders.add({ shape: 'disc', x: buf.x[i] + 0.45 * s, y: buf.y[i], z: buf.z[i] - 0.2 * s, r: 1.25 * s, h: 3.3 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE | COLLIDER.PLATFORM, propKey: key });
          } else if (kind === KIND.SHARD) {
            id = colliders.add({ shape: 'capsule', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: 0.7 * s, h: 2.6 * s, flags: COLLIDER.SOLID, propKey: key });
          } else {
            const r = kind === KIND.BRAMBLE ? 0.6 : kind === KIND.CACTUS ? 0.5 : kind === KIND.POPLAR || kind === KIND.SNAG ? 0.3 : 0.4;
            id = colliders.add({ shape: 'capsule', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: r * s, h: 3.6 * s, flags: COLLIDER.SOLID, propKey: key });
          }
          if (id) {
            colIds[colN] = id;
            colKind[colN] = kind;
            colN++;
          }
        }
      }
    }
  }

  return {
    meshes,
    /**
     * Per-frame: refill on a 128 m cell crossing or a 64 m altitude change (new instances grow in); colliders
     * follow the player. `force` (a flush after a teleport) places everything at full size.
     * @param {number} fx @param {number} fy @param {number} fz @param {number} px @param {number} pz @param {boolean} force
     * @param {number} [dt] seconds since the last frame (growth)
     */
    update(fx, fy, fz, px, pz, force, dt) {
      const ci = Math.floor((fx + WORLD_HALF) / SCATTER_CELL);
      const cj = Math.floor((fz + WORLD_HALF) / SCATTER_CELL);
      const alt = Math.floor(fy / 64);
      if (force || dirty || ci !== lastCi || cj !== lastCj || alt !== lastAlt) {
        const instant = !!force || lastCi === -9999 || Math.abs(ci - lastCi) > 2 || Math.abs(cj - lastCj) > 2;
        lastCi = ci;
        lastCj = cj;
        lastAlt = alt;
        dirty = false;
        refill(fx, fy, fz, instant);
      }
      // growth runs every frame, also right after a refill (a moving camera can refill on consecutive frames)
      if (dt) grow(dt);
      const pci = Math.floor((px + WORLD_HALF) / SCATTER_CELL);
      const pcj = Math.floor((pz + WORLD_HALF) / SCATTER_CELL);
      if (pci !== colCi || pcj !== colCj) rebuildColliders(px, pz);
    },
    /** Prop kind name of an active prop collider. @param {number} id */
    kindOf(id) {
      for (let i = 0; i < colN; i++) if (colIds[i] === id) return KIND_NAME[colKind[i]];
      return 'rock';
    },
    /** Hide a destroyed prop until game:loaded. @param {number} key */
    destroy(key) {
      destroyed.add(key);
      dirty = true;
    },
    /** Bring every destroyed prop back. */
    restore() {
      destroyed.clear();
      dirty = true;
      colCi = -9999;
    },
    /** Force a refill (tier change, crater, new clear discs). */
    invalidate() {
      dirty = true;
      colCi = -9999;
    },
    /** Instances still growing in (diagnostics). */
    growing: () => gN,
    stats: () => ({ trees: treesDrawn, rocks: rocksDrawn, cover: coverDrawn, growing: gN }),
    dispose() {
      for (let i = 0; i < colN; i++) colliders.remove(colIds[i]);
      colN = 0;
      for (const m of meshes) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
      meshes.length = 0;
    },
  };
}
