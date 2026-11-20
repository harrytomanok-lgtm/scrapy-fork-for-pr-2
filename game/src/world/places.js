/**
 * Authored places between the settlements (world pass: landmarks). Each is one merged, vertex-coloured toon mesh
 * (one draw call when in view, frustum culled, drawn with reduced fog so its silhouette carries in flight) with its
 * colliders, placed on resolved ground after the bake:
 * - the Saltglass Arches: three great arches of salt-glass standing in the shallows (GDD 3.3);
 * - three elder trees: a 40 m ember maple in the Meadows, a giant bramble in the Thornwood, an ancient pine below
 *   Ridgerest;
 * - bridges: a boardwalk across the lagoon on the Tide Beacon road, a plank bridge over the Thornwood gorge;
 * - ruins: the Drowned Observatory (a broken ring of columns and a cracked dome in the Stormwell lake), a ring of
 *   standing stones in the Meadows, the Iron Ring (a half-buried giant copper wheel in the Rustdune);
 * (No Weeping Falls: there is no cliff near the landmark.)
 * The ids and positions are listed by `world.places()` (an addition) for the gallery and the map.
 * @module world/places
 */

import { BufferGeometry, BufferAttribute, Mesh, Color, Vector3 } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { COLLIDER } from './gen/colliders.js';
import { GORGE } from './gen/field.js';
import { addClear } from './gen/scatter.js';

/** Flat-shaded soup with per-vertex colour. */
function soup() {
  const pos = [];
  const col = [];
  const c = new Color();
  const e1 = new Vector3();
  const e2 = new Vector3();
  return {
    tri(a, b, d, c0, c1, c2) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
      for (const h of [c0, c1 === undefined ? c0 : c1, c2 === undefined ? c0 : c2]) {
        c.set(h);
        col.push(c.r, c.g, c.b);
      }
    },
    quad(a, b, d, e, c0, c1) {
      this.tri(a, b, d, c0, c0, c1 === undefined ? c0 : c1);
      this.tri(a, d, e, c0, c1 === undefined ? c0 : c1, c1 === undefined ? c0 : c1);
    },
    count: () => pos.length / 9,
    geometry() {
      const g = new BufferGeometry();
      const p = new Float32Array(pos);
      const n = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 9) {
        e1.set(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]);
        e2.set(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]);
        e1.cross(e2).normalize();
        for (let k = 0; k < 3; k++) {
          n[i + k * 3] = e1.x; n[i + k * 3 + 1] = e1.y; n[i + k * 3 + 2] = e1.z;
        }
      }
      g.setAttribute('position', new BufferAttribute(p, 3));
      g.setAttribute('normal', new BufferAttribute(n, 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** Basis perpendicular to a direction. @param {number[]} d unit */
function basis(d) {
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return [u, v];
}

/**
 * Tube segment from a (radius ra) to b (radius rb), `sides` faces; outward normals.
 * @param {any} S @param {number[]} a @param {number[]} b @param {number} ra @param {number} rb @param {number} sides
 * @param {number} ca @param {number} cb @param {number} [rot]
 */
function tube(S, a, b, ra, rb, sides, ca, cb, rot = 0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= L; d[1] /= L; d[2] /= L;
  const [u, v] = basis(d);
  const ring = (c, r, ang) => [c[0] + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * r, c[1] + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * r, c[2] + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * r];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + rot;
    const a1 = ((i + 1) / sides) * Math.PI * 2 + rot;
    const p0 = ring(a, ra, a0);
    const p1 = ring(a, ra, a1);
    if (rb <= 0) {
      S.tri(p0, p1, b, ca, ca, cb);
      continue;
    }
    const q0 = ring(b, rb, a0);
    const q1 = ring(b, rb, a1);
    S.tri(p0, p1, q1, ca, ca, cb);
    S.tri(p0, q1, q0, ca, cb, cb);
  }
}

/** Octahedron blob. */
function blob(S, cx, cy, cz, rx, ry, rz, col, colTop) {
  const top = [cx, cy + ry, cz];
  const bot = [cx, cy - ry * 0.8, cz];
  const ring = [[cx + rx, cy, cz], [cx, cy, cz + rz], [cx - rx, cy, cz], [cx, cy, cz - rz]];
  for (let i = 0; i < 4; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 4];
    S.tri(p, top, q, col, colTop, col);
    S.tri(p, q, bot, col, col, col);
  }
}

/** Oriented box with yaw about y; centre (cx, cy, cz), half extents hx, hy, hz. */
function box(S, cx, cy, cz, hx, hy, hz, yaw, col, colTop) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
  const t = colTop === undefined ? col : colTop;
  S.quad(v[4], v[7], v[6], v[5], t);
  S.quad(v[0], v[1], v[5], v[4], col, t);
  S.quad(v[1], v[2], v[6], v[5], col, t);
  S.quad(v[2], v[3], v[7], v[6], col, t);
  S.quad(v[3], v[0], v[4], v[7], col, t);
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {ReturnType<import('./gen/colliders.js').createColliders>} colliders
 * @param {number} seed
 * @param {ReturnType<import('./gen/scatter.js').createClearSet>} clear discs kept free of vegetation
 * @param {any[]} landmarks resolved landmarks
 */
export function createPlaces(ctx, grid, colliders, seed, clear, landmarks) {
  const P = PALETTE;
  const k = (hex, m) => new Color(hex).multiplyScalar(m).getHex();
  const mix = (a, b, t) => new Color(a).lerp(new Color(b), t).getHex();
  const H = (x, z) => grid.heightAt(x, z);
  const lm = Object.create(null);
  for (const l of landmarks) lm[l.id] = l;
  /** @type {{ id:string, x:number, z:number, y:number, lookUp:number, mesh:any }[]} */
  const list = [];
  /** @type {any[]} */
  const mats = [];
  /** Falls: the mesh, its colour attribute, the band phase per vertex. */
  let falls = null;

  /** Nearest dry, gentle spot to (x, z) within `r` (spiral), or null. */
  function flatSpot(x, z, r, minH, maxSlope) {
    for (let d = 0; d <= r; d += 12) {
      const n = Math.max(1, Math.floor(d / 8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        const h = H(px, pz);
        if (h < minH || grid.slopeAt(px, pz) > maxSlope || (grid.flagsAt(px, pz) & 3) !== 0) continue;
        let ok = true;
        for (let q = 0; q < 6 && ok; q++) {
          const qa = q * 1.047;
          if (Math.abs(H(px + Math.cos(qa) * 10, pz + Math.sin(qa) * 10) - h) > 3) ok = false;
        }
        if (ok) return { x: px, z: pz, y: h };
      }
    }
    return null;
  }

  /** @param {string} id @param {any} S @param {number} x @param {number} z @param {number} y @param {number} lookUp @param {any} [opts] */
  function finish(id, S, x, z, y, lookUp, opts, scale) {
    const mat = ctx.render.materials.toon(Object.assign({ vertexColors: true, fogScale: 0.55 }, opts || {}));
    const geo = S.geometry();
    if (scale && scale !== 1) {
      // scale about the foot of the place (elder trees are built at 1x and grown here)
      geo.translate(-x, -y, -z).scale(scale, scale, scale).translate(x, y, z);
      geo.computeBoundingSphere();
    }
    const mesh = new Mesh(geo, mat);
    mesh.name = 'world.place.' + id;
    mesh.matrixAutoUpdate = false;
    ctx.render.layers.props.add(mesh);
    mats.push(mat);
    list.push({ id, x, z, y, lookUp, mesh });
    return mesh;
  }

  // ---------------------------------------------------------------- the Saltglass Arches
  {
    const a = lm.saltglass_arches;
    if (a) {
      const S = soup();
      const salt = P.biome.coast.cliff;
      const glass = mix(P.paper, P.biome.coast.accent, 0.35);
      // span, height, offset, yaw, thickness
      const arches = [[96, 64, -80, 34, 0.5, 7], [62, 42, 70, 74, 1.4, 5.2], [40, 27, 22, -90, 2.6, 4]];
      for (const [span, ht, ox, oz, yaw, th] of arches) {
        const cx = a.x + ox;
        const cz = a.z + oz;
        const ux = Math.cos(yaw);
        const uz = -Math.sin(yaw);
        const base = Math.min(H(cx + ux * span * 0.5, cz + uz * span * 0.5), H(cx - ux * span * 0.5, cz - uz * span * 0.5)) - 3;
        const N = 12;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const ang = Math.PI * t;
          // a slightly pointed, leaning arch: wider legs, a crest that drifts off-centre
          const r = 0.5 * span;
          pts.push([cx - ux * Math.cos(ang) * r, base + Math.sin(ang) * (ht + 3) + Math.sin(ang * 2) * 1.5, cz - uz * Math.cos(ang) * r]);
        }
        for (let i = 0; i < N; i++) {
          const t0 = Math.abs(i / N - 0.5) * 2;
          const t1 = Math.abs((i + 1) / N - 0.5) * 2;
          const r0 = th * (0.75 + 0.6 * t0 * t0);
          const r1 = th * (0.75 + 0.6 * t1 * t1);
          const band = i % 3 === 1;
          tube(S, pts[i], pts[i + 1], r0, r1, 6, band ? glass : mix(salt, P.paper, 0.2 + 0.5 * (1 - t0)), band ? k(glass, 1.1) : mix(salt, P.paper, 0.2 + 0.5 * (1 - t1)), 0.3);
          const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2, (pts[i][2] + pts[i + 1][2]) / 2];
          colliders.add({ shape: 'sphere', x: m[0], y: m[1], z: m[2], r: (r0 + r1) * 0.5, flags: COLLIDER.SOLID });
        }
        // crystal growths on the crest
        const top = pts[N / 2];
        tube(S, [top[0], top[1] + th * 0.6, top[2]], [top[0] + 1.5, top[1] + th + 6, top[2] - 1], th * 0.45, 0, 5, glass, P.paper);
        tube(S, [top[0] - 2, top[1] + th * 0.5, top[2] + 1], [top[0] - 4, top[1] + th + 3.5, top[2] + 2], th * 0.3, 0, 5, glass, P.paper);
      }
      finish('saltglass_arches', S, a.x, a.z, a.y, 22, { glossy: true, emissive: P.paper, emissiveIntensity: 0.06 });
    }
  }

  // ---------------------------------------------------------------- elder trees
  /** @param {string} id @param {number} x0 @param {number} z0 @param {number} kind 0 maple, 1 bramble, 2 pine */
  function elder(id, x0, z0, kind) {
    const s = flatSpot(x0, z0, 260, 4, 0.28);
    if (!s) return;
    const S = soup();
    const bark = kind === 1 ? P.biome.thornwood.cliff : P.biome.rustdune.shade;
    const x = s.x;
    const z = s.z;
    const y = s.y - 1;
    const trunkH = kind === 2 ? 20 : 17;
    // root flares
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      tube(S, [x + Math.cos(a) * 6.5, y - 0.5, z + Math.sin(a) * 6.5], [x + Math.cos(a) * 1.5, y + 5, z + Math.sin(a) * 1.5], 1.4, 0.6, 4, k(bark, 0.7), bark);
    }
    tube(S, [x, y - 1, z], [x + 1, y + trunkH * 0.55, z + 0.5], 3.4, 2.6, 8, k(bark, 0.75), bark, 0.2);
    tube(S, [x + 1, y + trunkH * 0.55, z + 0.5], [x - 0.5, y + trunkH, z - 0.3], 2.6, 1.7, 8, bark, k(bark, 1.12), 0.4);
    const E = 1.55;
    colliders.add({ shape: 'capsule', x, y: y - 1, z, r: 3.4 * E, h: trunkH * E, flags: COLLIDER.SOLID });
    if (kind === 2) {
      // an ancient pine: five stacked snow-tipped tiers
      const f = P.biome.frostspine.foliage;
      for (let i = 0; i < 5; i++) {
        const yy = y + 10 + i * 6.5;
        const r = 12 - i * 2.1;
        tube(S, [x, yy, z], [x, yy + 10, z], r, 0, 8, k(f, 0.8 + i * 0.04), i === 4 ? P.snow : mix(f, P.snow, 0.55), i * 0.4);
      }
    } else {
      const leaf = kind === 0 ? P.flora.redLeaf : P.biome.thornwood.foliage;
      // limbs and a broad crown of blobs
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.6;
        const ex = x + Math.cos(a) * 10;
        const ez = z + Math.sin(a) * 10;
        tube(S, [x, y + trunkH * 0.75, z], [ex, y + trunkH + 4, ez], 1.4, 0.6, 5, bark, k(bark, 1.1));
        blob(S, ex, y + trunkH + 8, ez, 9, 6.5, 8.5, k(leaf, 0.82), k(leaf, 1.12));
      }
      blob(S, x, y + trunkH + 14, z, 11, 8, 10.5, k(leaf, 0.92), k(leaf, 1.18));
      if (kind === 1) {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.1;
          blob(S, x + Math.cos(a) * 12, y + trunkH + 9 + (i % 2) * 5, z + Math.sin(a) * 12, 1.4, 1.2, 1.4, P.flora.brambleFlower, k(P.flora.brambleFlower, 1.15));
        }
      }
    }
    addClear(clear, x, z, 34);
    finish(id, S, x, z, y, 38, undefined, E);
  }
  elder('elder_maple', -1650, 1320, 0);
  elder('elder_bramble', -2420, -60, 1);
  elder('elder_pine', -620, -1820, 2);

  // ---------------------------------------------------------------- bridges
  /** A plank deck on posts from a to b at deck height y (straight); rails on both sides. */
  function bridge(id, ax, az, bx, bz, ya, yb, rope) {
    const S = soup();
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const ux = dx / L;
    const uz = dz / L;
    const wood = P.biome.rustdune.shade;
    const plank = P.path;
    const n = Math.max(2, Math.round(L / 2.2));
    const sag = rope ? Math.min(6, L * 0.06) : 0;
    const yAt = (t) => ya + (yb - ya) * t - sag * Math.sin(Math.PI * t);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = ax + dx * t;
      const pz = az + dz * t;
      box(S, px, yAt(t) - 0.12, pz, 1.7, 0.12, (L / n) * 0.45, yaw, i % 2 ? k(plank, 0.88) : plank, k(plank, 1.05));
    }
    // rails and posts
    const posts = Math.max(2, Math.round(L / 6));
    for (const side of [-1.6, 1.6]) {
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const px = ax + dx * t + uz * side;
        const pz = az + dz * t - ux * side;
        const yy = yAt(t);
        box(S, px, yy + 0.6, pz, 0.12, 0.6, 0.12, yaw, wood);
        if (!rope) {
          const g = H(px, pz);
          if (yy - g > 1.2) box(S, px, (yy + g) / 2 - 0.5, pz, 0.18, (yy - g) / 2 + 0.5, 0.18, yaw, k(wood, 0.8), wood);
        }
        if (i < posts) {
          const t1 = (i + 1) / posts;
          tube(S, [px, yy + 1.15, pz], [ax + dx * t1 + uz * side, yAt(t1) + 1.15, az + dz * t1 - ux * side], 0.07, 0.07, 4, rope ? P.biome.coast.shade : wood, rope ? P.biome.coast.shade : wood);
        }
      }
    }
    // deck colliders: a walkable box per stretch
    const segs = Math.max(1, Math.round(L / 8));
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      colliders.add({ shape: 'box', x: ax + dx * t, y: yAt(t) - 0.8, z: az + dz * t, hx: 1.7, hz: L / segs / 2 + 0.3, h: 0.8, yaw, flags: COLLIDER.PLATFORM });
    }
    addClear(clear, (ax + bx) / 2, (az + bz) / 2, L / 2 + 4);
    finish(id, S, (ax + bx) / 2, (az + bz) / 2, (ya + yb) / 2, 2);
  }
  // the lagoon boardwalk on the road from the Tide Beacon to the Arches: walk the straight road, bridge the water
  {
    const A = lm.tide_beacon;
    const B = lm.saltglass_arches;
    if (A && B) {
      const L = Math.hypot(B.x - A.x, B.z - A.z);
      let w0 = -1;
      let w1 = -1;
      for (let d = 0; d <= L; d += 4) {
        const x = A.x + ((B.x - A.x) * d) / L;
        const z = A.z + ((B.z - A.z) * d) / L;
        if (H(x, z) < 0.4) {
          if (w0 < 0) w0 = d;
          w1 = d;
        }
      }
      if (w0 > 0 && w1 - w0 < 260) {
        const d0 = Math.max(0, w0 - 10);
        const d1 = Math.min(L, w1 + 10);
        const p = (d) => [A.x + ((B.x - A.x) * d) / L, A.z + ((B.z - A.z) * d) / L];
        const [ax, az] = p(d0);
        const [bx, bz] = p(d1);
        bridge('lagoon_boardwalk', ax, az, bx, bz, Math.max(1.4, H(ax, az) + 0.3), Math.max(1.4, H(bx, bz) + 0.3), false);
      }
    }
  }
  // the gorge bridge: across the Thornwood gorge where its walls are deepest, near the middle of its second leg
  {
    let best = null;
    for (let sg = 0; sg + 3 < GORGE.length; sg += 2)
    for (let t = 0.2; t <= 0.8; t += 0.05) {
      const ax0 = GORGE[sg];
      const az0 = GORGE[sg + 1];
      const bx0 = GORGE[sg + 2];
      const bz0 = GORGE[sg + 3];
      if (Math.hypot(ax0 + 2580, az0 + 860) < 160) continue;
      const cx = ax0 + (bx0 - ax0) * t;
      const cz = az0 + (bz0 - az0) * t;
      const L = Math.hypot(bx0 - ax0, bz0 - az0);
      const nx = -(bz0 - az0) / L;
      const nz = (bx0 - ax0) / L;
      // the rims: a common level both walls reach within 90 m, and where each wall first reaches it
      let ma = -1e9;
      let mb = -1e9;
      for (let d = 8; d <= 90; d += 2) {
        ma = Math.max(ma, H(cx + nx * d, cz + nz * d));
        mb = Math.max(mb, H(cx - nx * d, cz - nz * d));
      }
      const level = Math.min(ma, mb) - 1;
      let ra = null;
      let rb = null;
      for (let d = 8; d <= 90 && (!ra || !rb); d += 2) {
        if (!ra && H(cx + nx * d, cz + nz * d) >= level) ra = { d, h: level };
        if (!rb && H(cx - nx * d, cz - nz * d) >= level) rb = { d, h: level };
      }
      if (!ra || !rb) continue;
      const floor = H(cx, cz);
      const depth = level - floor;
      if (depth > 12 && ra.d + rb.d < 175 && (!best || depth - (ra.d + rb.d) * 0.2 > best.depth)) best = { cx, cz, nx, nz, ra, rb, depth: depth - (ra.d + rb.d) * 0.2 };
    }
    if (best) {
      const ax = best.cx + best.nx * (best.ra.d + 3);
      const az = best.cz + best.nz * (best.ra.d + 3);
      const bx = best.cx - best.nx * (best.rb.d + 3);
      const bz = best.cz - best.nz * (best.rb.d + 3);
      bridge('gorge_bridge', ax, az, bx, bz, best.ra.h + 0.6, best.rb.h + 0.6, true);
    }
  }

  // ---------------------------------------------------------------- ruins
  {
    // the Drowned Observatory: a broken colonnade and a cracked dome in the Stormwell lake
    // stand it in the lake: the deepest water within 350 m of its landmark
    let ox = 1500;
    let oz = -1250;
    let deep = H(ox, oz);
    for (let r = 0; r <= 350; r += 25) {
      const n = Math.max(1, Math.floor(r / 12));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const h = H(1500 + Math.cos(a) * r, -1250 + Math.sin(a) * r);
        if (h < deep - 0.5 && h > -12) {
          deep = h;
          ox = 1500 + Math.cos(a) * r;
          oz = -1250 + Math.sin(a) * r;
        }
      }
    }
    const S = soup();
    const stone = P.biome.spire.shade;
    const pale = P.biome.spire.cliff;
    const R = 26;
    const floor = H(ox, oz);
    const base = Math.min(floor, 0) - 2;
    tube(S, [ox, base, oz], [ox, 1.2, oz], R + 4, R + 3, 16, k(stone, 0.7), k(stone, 0.95));
    // the observatory tower: a tall drum, its top broken off in a jagged crown, a cracked dome perched on it
    const TR = 7.5;
    const TH = 34;
    tube(S, [ox, base, oz], [ox, TH, oz], TR + 0.8, TR, 12, k(pale, 0.8), pale);
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2;
      const top = TH + 2 + ((i * 7) % 5) * 1.6;
      const p0 = [ox + Math.cos(a0) * TR, TH, oz + Math.sin(a0) * TR];
      const p1 = [ox + Math.cos(a1) * TR, TH, oz + Math.sin(a1) * TR];
      S.quad(p0, p1, [p1[0], top, p1[2]], [p0[0], top, p0[2]], pale, k(pale, 1.08));
    }
    for (const y of [9, 20, TH - 1]) tube(S, [ox, y, oz], [ox, y + 1.2, oz], TR + 1, TR + 1, 12, k(stone, 0.95), stone);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + 0.3;
      box(S, ox + Math.cos(a) * (TR + 0.05), 26, oz + Math.sin(a) * (TR + 0.05), 0.9, 1.6, 0.1, -a + Math.PI / 2, P.ink);
    }
    colliders.add({ shape: 'disc', x: ox, y: base, z: oz, r: TR + 0.8, h: TH - base, flags: COLLIDER.SOLID | COLLIDER.PLATFORM });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = ox + Math.cos(a) * R;
      const pz = oz + Math.sin(a) * R;
      const h = (hash2(i, 7, seed) % 100) < 35 ? 3 + (i % 3) : 12 + (i % 4) * 2.5;
      tube(S, [px, 1, pz], [px, 1 + h, pz], 1.3, 1.1, 6, pale, k(pale, 1.08));
      if (h > 10) box(S, px, 1 + h + 0.4, pz, 1.8, 0.4, 1.8, a, k(pale, 1.05));
      colliders.add({ shape: 'disc', x: px, y: base, z: pz, r: 1.4, h: 1 + h - base, flags: COLLIDER.SOLID | COLLIDER.PLATFORM });
      // a lintel between two standing neighbours
      if (h > 10 && i % 3 === 0) {
        const b = ((i + 1) / 12) * Math.PI * 2;
        tube(S, [px, 1 + h + 0.8, pz], [ox + Math.cos(b) * R, 1 + h + 0.8, oz + Math.sin(b) * R], 0.8, 0.8, 4, pale, pale, 0.78);
      }
    }
    // a cracked half dome with an orrery ring
    const dr = 11;
    const dy = TH + 1;
    for (let j = 0; j < 4; j++) {
      const p0 = (j / 4) * Math.PI * 0.5;
      const p1 = ((j + 1) / 4) * Math.PI * 0.5;
      for (let i = 0; i < 11; i++) {
        if (j === 3 && i > 5) continue;
        const a0 = (i / 16) * Math.PI * 2 + 0.4;
        const a1 = ((i + 1) / 16) * Math.PI * 2 + 0.4;
        const pt = (a, p) => [ox + Math.cos(a) * Math.cos(p) * dr, dy + Math.sin(p) * dr, oz + Math.sin(a) * Math.cos(p) * dr];
        S.quad(pt(a0, p0), pt(a0, p1), pt(a1, p1), pt(a1, p0), k(P.structure.copper, 0.85 + j * 0.06), k(P.structure.copper, 0.95 + j * 0.06));
      }
    }
    // the great orrery ring, tilted out of the broken dome, and its teal lens
    tube(S, [ox - 13, dy + 4, oz + 4], [ox + 12, dy + 12, oz - 7], 0.6, 0.6, 4, P.structure.copper, P.structure.copper);
    const OR = 13;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      const q = (a) => [ox + Math.cos(a) * OR, dy + 8 + Math.sin(a) * OR * 0.45, oz + Math.sin(a) * OR * 0.9];
      tube(S, q(a0), q(a1), 0.55, 0.55, 4, P.structure.copper, k(P.structure.copper, 1.15));
    }
    blob(S, ox + 2, dy + 8, oz - 1, 2.6, 2.6, 2.6, P.structure.ringstone, k(P.structure.ringstone, 1.15));
    addClear(clear, ox, oz, R + 8);
    finish('drowned_observatory', S, ox, oz, 1, 10, { emissive: P.structure.ringstone, emissiveIntensity: 0.05 });
  }
  {
    // a ring of nine standing stones on a Meadows rise, one fallen
    const s = flatSpot(-1010, 1900, 220, 6, 0.2);
    if (s) {
      const S = soup();
      const stone = P.biome.meadows.cliff;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const px = s.x + Math.cos(a) * 14;
        const pz = s.z + Math.sin(a) * 14;
        const g = H(px, pz);
        if (i === 6) {
          box(S, px, g + 0.5, pz, 0.9, 0.6, 2.6, a + 0.4, k(stone, 0.85), stone);
          continue;
        }
        const h = 4.5 + (i % 3) * 1.2;
        box(S, px, g + h / 2 - 0.8, pz, 0.9, h / 2, 0.6, -a + Math.PI / 2, k(stone, 0.78), k(stone, 1.06));
        colliders.add({ shape: 'box', x: px, y: g - 0.8, z: pz, hx: 0.9, hz: 0.6, h, yaw: -a + Math.PI / 2, flags: COLLIDER.SOLID });
      }
      // the carved ring stone at the centre (the Kethran ring motif)
      tube(S, [s.x - 2.2, s.y + 3.2, s.z], [s.x + 2.2, s.y + 3.2, s.z], 3, 3, 10, P.biome.meadows.cliff, P.biome.meadows.cliff);
      tube(S, [s.x - 2.25, s.y + 3.2, s.z], [s.x + 2.25, s.y + 3.2, s.z], 1.5, 1.5, 10, P.biome.meadows.shade, P.biome.meadows.shade);
      colliders.add({ shape: 'disc', x: s.x, y: s.y - 0.5, z: s.z, r: 3, h: 6.6, flags: COLLIDER.SOLID });
      addClear(clear, s.x, s.z, 18);
      finish('stone_ring', S, s.x, s.z, s.y, 4);
    }
  }
  {
    // the Iron Ring: a half-buried giant copper wheel in the Rustdune, green with age
    const s = flatSpot(2560, 980, 300, 6, 0.25);
    if (s) {
      const S = soup();
      const cu = P.structure.copper;
      const rust = P.biome.rustdune.cliff;
      const R = 30;
      const yaw = 0.7;
      const ux = Math.cos(yaw);
      const uz = -Math.sin(yaw);
      const cy = s.y + R * 0.55;
      const N = 20;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        const p0 = [s.x + ux * Math.cos(a0) * R, cy + Math.sin(a0) * R, s.z + uz * Math.cos(a0) * R];
        const p1 = [s.x + ux * Math.cos(a1) * R, cy + Math.sin(a1) * R, s.z + uz * Math.cos(a1) * R];
        if (p0[1] < s.y - 3 && p1[1] < s.y - 3) continue;
        tube(S, p0, p1, 2.4, 2.4, 6, i % 4 === 0 ? rust : cu, i % 4 === 0 ? k(rust, 1.1) : k(cu, 1.12));
        if (i % 5 === 0) tube(S, p0, [s.x, cy, s.z], 0.7, 0.7, 4, k(cu, 0.85), cu);
        const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
        if (m[1] > s.y - 2) colliders.add({ shape: 'sphere', x: m[0], y: m[1], z: m[2], r: 2.6, flags: COLLIDER.SOLID });
      }
      tube(S, [s.x - ux * 2, cy, s.z - uz * 2], [s.x + ux * 2, cy, s.z + uz * 2], 3.2, 3.2, 8, k(cu, 0.8), cu);
      addClear(clear, s.x, s.z, R + 6);
      finish('iron_ring', S, s.x, s.z, s.y, R * 0.6, { glossy: true });
    }
  }

  // The Weeping Falls are not built (review): the height field has no cliff near the landmark and a ribbon on a
  // slope does not read as a fall. `falls` stays null; update() keeps the band animation for a future cliff fall.

  return {
    /** Diagnostics and the gallery: id, position and a look height per place. */
    list() {
      return list.map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, lookUp: p.lookUp }));
    },
    /** Animate the falls (bands scrolling down at ~12 Hz). @param {number} t seconds */
    update(t) {
      if (!falls || Math.abs(t - falls.t) < 0.08) return;
      falls.t = t;
      const a = falls.attr.array;
      const b = falls.base;
      for (let v = falls.v0; v < falls.v1; v++) {
        const s = 0.82 + 0.28 * (0.5 + 0.5 * Math.sin(falls.phase[v] + t * 6));
        a[v * 3] = b[v * 3] * s;
        a[v * 3 + 1] = b[v * 3 + 1] * s;
        a[v * 3 + 2] = b[v * 3 + 2] * s;
      }
      falls.attr.needsUpdate = true;
    },
    dispose() {
      for (const p of list) {
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
      for (const m of mats) m.dispose();
      list.length = 0;
    },
  };
}
