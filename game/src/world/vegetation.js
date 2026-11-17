/**
 * Vegetation, rocks and pillars (ARCHITECTURE 4.1, ART_UX 1.9): one instanced mesh per prop kind (10 draw calls),
 * chunky faceted geometry with baked vertex colours, wind sway on the plants, refilled nearest first from the
 * seeded per-cell scatter when the focus crosses a 128 m cell, with the tier radii and instance caps. Prop
 * colliders around the player enter the collider grid; destroyed props stay hidden until `game:loaded`.
 * @module world/vegetation
 */

import { BufferGeometry, BufferAttribute, InstancedMesh, Color, Vector3, InstancedBufferAttribute } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { WORLD_HALF } from '../core/constants.js';
import { REGIONS } from './gen/layout.js';
import { KIND, KIND_COUNT, IS_TREE, KIND_NAME, SCATTER_CELL, SCATTER_N, createCellBuffer, scatterCell } from './gen/scatter.js';
import { COLLIDER } from './gen/colliders.js';

const MAX_TREES = 4000;
const MAX_ROCKS = 2000;
const MAX_RADIUS = 960;
const MAX_PROP_COLLIDERS = 3000;

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

/** Build the ten prop geometries. @returns {any[]} */
function buildGeometries() {
  const P = PALETTE;
  const bark = P.biome.rustdune.shade;
  const out = [];
  const shade = (hex, k) => new Color(hex).multiplyScalar(k).getHex();
  // 0 kite cedar, 1 ember maple
  for (const leaf of [P.biome.meadows.foliage, P.flora.redLeaf]) {
    const B = builder();
    prism(B, 6, [0, 0, 0], 0.32, [0, 3.4, 0], 0.18, bark, shade(bark, 1.1));
    blob(B, 0, 4.2, 0, 1.9, 1.5, 1.8, shade(leaf, 0.86), shade(leaf, 1.12));
    blob(B, 0.7, 5.5, 0.3, 1.4, 1.2, 1.3, leaf, shade(leaf, 1.15));
    blob(B, -0.6, 5.1, -0.5, 1.2, 1.0, 1.2, shade(leaf, 0.93), shade(leaf, 1.1));
    out.push(B.geometry());
  }
  // 2 salt palm: curved trunk, five flat leaves
  {
    const B = builder();
    const tr = P.biome.coast.cliff;
    const pts = [[0, 0, 0], [0.35, 2.4, 0], [0.95, 4.6, 0], [1.7, 6.4, 0]];
    for (let i = 0; i < 3; i++) prism(B, 4, pts[i], 0.3 - i * 0.06, pts[i + 1], 0.24 - i * 0.06, shade(tr, 0.9 + i * 0.06));
    const top = pts[3];
    const leaf = P.biome.coast.foliage;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const tip = [top[0] + Math.cos(a) * 3.2, top[1] - 1.3, top[2] + Math.sin(a) * 3.2];
      const side = [-Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55];
      const mid = [top[0] + Math.cos(a) * 1.5, top[1] + 0.35, top[2] + Math.sin(a) * 1.5];
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
    blob(B, -1.3, 5.0, 0.9, 0.35, 0.3, 0.35, P.flora.brambleFlower, shade(P.flora.brambleFlower, 1.15));
    out.push(B.geometry());
  }
  // 4 rust cactus: stacked columns, an arm, copper-green tips
  {
    const B = builder();
    const body = P.biome.rustdune.foliage;
    const tip = P.biome.rustdune.accent;
    prism(B, 6, [0, 0, 0], 0.5, [0, 3.2, 0], 0.45, shade(body, 0.85), body);
    prism(B, 6, [0, 3.2, 0], 0.45, [0, 4.0, 0], 0, body, tip);
    prism(B, 4, [0.4, 1.6, 0], 0.26, [1.2, 2.6, 0], 0.22, body);
    prism(B, 4, [1.2, 2.6, 0], 0.22, [1.25, 3.3, 0], 0, body, tip);
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
  // 6 marsh reeds
  {
    const B = builder();
    const f = P.biome.stormwell.foliage;
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      const x = Math.cos(a) * 0.5 * (i % 3);
      const z = Math.sin(a) * 0.5 * (i % 3);
      prism(B, 3, [x, 0, z], 0.12, [x * 1.5 + 0.2, 2.2 + (i % 2) * 0.9, z * 1.5], 0, shade(f, 0.8), shade(f, 1.25));
    }
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
  return out;
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {ReturnType<import('./gen/colliders.js').createColliders>} colliders
 * @param {number} seed
 */
export function createVegetation(ctx, grid, colliders, seed) {
  const geos = buildGeometries();
  const cliff = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].cliff));
  /** @type {any[]} */
  const meshes = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    const cap = IS_TREE[k] ? MAX_TREES : MAX_ROCKS;
    const wind = IS_TREE[k] === 1 && k !== KIND.CRYSTAL;
    const opts = { vertexColors: true, instanced: true, wind, doubleSide: k === KIND.PALM };
    if (k === KIND.CRYSTAL) Object.assign(opts, { emissive: PALETTE.biome.spire.cliff, emissiveIntensity: 0.3, glossy: true });
    const m = new InstancedMesh(geos[k], ctx.render.materials.toon(opts), cap);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    ctx.render.layers.props.add(m);
    meshes.push(m);
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
  /** @type {Set<number>} */
  const destroyed = new Set();
  let lastCi = -9999;
  let lastCj = -9999;
  let lastAlt = -9999;
  let dirty = true;
  let treesDrawn = 0;
  let rocksDrawn = 0;
  const counts = new Int32Array(KIND_COUNT);

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

  /** Refill every instanced mesh nearest first around the focus. */
  function refill(fx, fy, fz) {
    const caps = ctx.render.caps;
    const tR = caps.treeRadius;
    const rR = caps.rockRadius;
    const tCap = Math.min(MAX_TREES, caps.treeInstances);
    const rCap = Math.min(MAX_ROCKS, caps.rockInstances);
    const maxR = tR > rR ? tR : rR;
    const ci0 = Math.floor((fx + WORLD_HALF) / SCATTER_CELL);
    const cj0 = Math.floor((fz + WORLD_HALF) / SCATTER_CELL);
    for (let k = 0; k < KIND_COUNT; k++) counts[k] = 0;
    let trees = 0;
    let rocks = 0;
    const alt = fy - grid.heightAt(fx, fz);
    const horiz = alt > maxR ? 0 : Math.sqrt(maxR * maxR - (alt > 0 ? alt * alt : 0));
    for (let o = 0; o < offI.length; o++) {
      if (offD[o] > horiz + SCATTER_CELL * 0.5) break;
      if (trees >= tCap && rocks >= rCap) break;
      const ci = ci0 + offI[o];
      const cj = cj0 + offJ[o];
      if (ci < 0 || cj < 0 || ci >= SCATTER_N || cj >= SCATTER_N) continue;
      const n = scatterCell(ci, cj, seed, grid, buf);
      for (let i = 0; i < n; i++) {
        const kind = buf.kind[i];
        const tree = IS_TREE[kind] === 1;
        if (tree ? trees >= tCap : rocks >= rCap) continue;
        const dx = buf.x[i] - fx;
        const dy = buf.y[i] - fy;
        const dz = buf.z[i] - fz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const R = tree ? tR : rR;
        if (d2 > R * R) continue;
        if (destroyed.size > 0 && destroyed.has(buf.key[i])) continue;
        const m = meshes[kind];
        const v = 0.86 + 0.24 * (((buf.key[i] * 2654435761) >>> 0) / 4294967296);
        if (tree) {
          put(m, counts[kind], buf.x[i], buf.y[i], buf.z[i], buf.s[i], buf.yaw[i], v, v, v);
          trees++;
        } else {
          const c = cliff[grid.regionIndexAt(buf.x[i], buf.z[i])];
          put(m, counts[kind], buf.x[i], buf.y[i], buf.z[i], buf.s[i], buf.yaw[i], c.r * v, c.g * v, c.b * v);
          rocks++;
        }
        counts[kind]++;
      }
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      const m = meshes[k];
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
      m.visible = counts[k] > 0;
    }
    treesDrawn = trees;
    rocksDrawn = rocks;
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
        const n = scatterCell(ci, cj, seed, grid, buf);
        for (let i = 0; i < n && colN < MAX_PROP_COLLIDERS; i++) {
          const kind = buf.kind[i];
          if (kind === KIND.REED) continue;
          if (destroyed.size > 0 && destroyed.has(buf.key[i])) continue;
          const s = buf.s[i];
          let id;
          if (kind === KIND.ROCK) {
            id = colliders.add({ shape: 'sphere', x: buf.x[i], y: buf.y[i] + 0.15 * s, z: buf.z[i], r: 0.75 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE, propKey: buf.key[i] });
          } else if (kind === KIND.PILLAR) {
            id = colliders.add({ shape: 'disc', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: 1.0 * s, h: 6.2 * s, flags: COLLIDER.SOLID | COLLIDER.DESTRUCTIBLE | COLLIDER.PLATFORM, propKey: buf.key[i] });
          } else {
            id = colliders.add({ shape: 'capsule', x: buf.x[i], y: buf.y[i], z: buf.z[i], r: (kind === KIND.BRAMBLE ? 0.6 : 0.4) * s, h: 3.6 * s, flags: COLLIDER.SOLID, propKey: buf.key[i] });
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
    /** Per-frame: refill on a 128 m cell crossing or a 64 m altitude change; colliders follow the player. */
    update(fx, fy, fz, px, pz, force) {
      const ci = Math.floor((fx + WORLD_HALF) / SCATTER_CELL);
      const cj = Math.floor((fz + WORLD_HALF) / SCATTER_CELL);
      const alt = Math.floor(fy / 64);
      if (force || dirty || ci !== lastCi || cj !== lastCj || alt !== lastAlt) {
        lastCi = ci;
        lastCj = cj;
        lastAlt = alt;
        dirty = false;
        refill(fx, fy, fz);
      }
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
    /** Force a refill (tier change, crater). */
    invalidate() {
      dirty = true;
      colCi = -9999;
    },
    stats: () => ({ trees: treesDrawn, rocks: rocksDrawn }),
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
