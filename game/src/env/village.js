/**
 * Village dressing (world pass: villages that look lived in). Given a settlement's buildings, it lays out the plan
 * around them, baked into the settlement's one merged mesh:
 * - a cobbled square (tinted cobbles, a stone kerb, a terracotta ring at the Ringstone) instead of a painted disc;
 * - lanes from the square to every door, and roads out of the village toward the paths, with lamp posts;
 * - gardens beside the houses (soil rows, crops, a fence and a gate), crates and barrels by stalls and doors,
 *   benches on the square, a signpost at each road out;
 * - pools of warm light under the lanterns (the POOL slot: ground-coloured by day, lantern light after dusk).
 * Every surface is kept bare of tufts and vegetation through `world.keepClear`; props stay clear of the spots, the
 * spawn points and each other. Pure layout from the definition (hash-varied, no rng streams).
 * @module env/village
 */

import { PALETTE } from '../core/palette.js';
import { SLOT, frame, prim, mat } from './kit.js';
import { FOOTPRINT } from './data/settlements.js';

/** @param {number} i @param {number} k @returns {number} 0..1 */
function h01(i, k) {
  let x = (i * 374761393 + k * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const COBBLE = [0xf2e6d2, 0xe0d0b8, 0xd6c4a8, 0xece0cc];

/**
 * @param {any} B builder
 * @param {{ x:number, z:number, plazaR:number, style:string, banner:number[], seed:number,
 *   buildings:Array<{ kind:string, x:number, z:number, yaw:number }>, spots:Array<{ x:number, z:number }>,
 *   exits:Array<{ x:number, z:number }>, heightAt:(x:number,z:number)=>number, addCollider:(c:any)=>void,
 *   keepClear:(x:number,z:number,r:number,bare:boolean)=>void, lantern:(B:any,f:any)=>void }} o
 * @returns {{ lanterns:number }}
 */
export function dressVillage(B, o) {
  const H = o.heightAt;
  const cx = o.x;
  const cz = o.z;
  const R = o.plazaR;
  const P = PALETTE;
  /** Occupied discs (buildings, props, spots) to keep new props apart. */
  const occ = [];
  for (const b of o.buildings) occ.push([b.x, b.z, (FOOTPRINT[b.kind] || 0.5) + 1.2]);
  for (const s of o.spots) occ.push([s.x, s.z, 1.6]);
  const free = (x, z, r) => {
    for (const q of occ) {
      const dx = x - q[0];
      const dz = z - q[1];
      if (dx * dx + dz * dz < (r + q[2]) * (r + q[2])) return false;
    }
    return true;
  };
  const claim = (x, z, r) => occ.push([x, z, r]);
  const camp = o.style === 'camp' || o.style === 'ledge';
  let lanterns = 0;

  // ---------------------------------------------------------------- the square
  // an irregular square: its edge wanders with three seeded waves, cobbles are tinted per stone, not in bands
  const ph1 = h01(o.seed, 1) * 6.28;
  const ph2 = h01(o.seed, 2) * 6.28;
  const ph3 = h01(o.seed, 3) * 6.28;
  const edgeR = (a) => R * (0.86 + 0.1 * Math.sin(3 * a + ph1) + 0.06 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(2 * a + ph3));
  if (!camp) {
    // radius of ring k at angle a: an absolute stone base, then fractions of the wandering edge
    const ringR = (k, a) => (k === 0 ? 0 : k === 1 ? 2.6 : edgeR(a) * [0, 0, 0.42, 0.62, 0.8, 0.93, 1][k]);
    const rings = 7;
    const seg = 36;
    const pt = (rr, a) => {
      const px = cx + Math.sin(a) * rr;
      const pz = cz + Math.cos(a) * rr;
      return [px, H(px, pz) + 0.14, pz];
    };
    for (let k = 0; k < rings - 1; k++) {
      const n = k < 1 ? 12 : seg;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        let slot = SLOT.PATH;
        let tint = COBBLE[Math.floor(h01(i * 7 + k * 131, o.seed) * 4)];
        if (k === 0) { slot = SLOT.STONE; tint = 0xe8e8e8; }
        else if (k === rings - 2) { slot = SLOT.STONE; tint = h01(i, o.seed + 9) < 0.5 ? 0xf0d8b8 : 0xe0c8a8; }
        if (k === 0) {
          B.tri(pt(0, 0), pt(ringR(1, a0), a0), pt(ringR(1, a1), a1), slot, tint);
          continue;
        }
        const p00 = pt(ringR(k, a0), a0);
        const p01 = pt(ringR(k, a1), a1);
        const p10 = pt(ringR(k + 1, a0), a0);
        const p11 = pt(ringR(k + 1, a1), a1);
        B.tri(p00, p10, p11, slot, tint);
        B.tri(p00, p11, p01, slot, tint);
      }
    }
    o.keepClear(cx, cz, R * 0.7, true);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const e = edgeR(a);
      o.keepClear(cx + Math.sin(a) * e * 0.8, cz + Math.cos(a) * e * 0.8, e * 0.22 + 0.6, true);
    }
  }

  // ---------------------------------------------------------------- more houses close around the square
  if (o.house && (o.style === 'village' || o.style === 'town' || o.style === 'outpost' || o.style === 'mountain' || o.style === 'beacon')) {
    const want = o.style === 'town' ? 11 : 8;
    const isHouse = (k) => k === 'house_s' || k === 'house_m' || k === 'house_l';
    let near = 0;
    for (const b of o.buildings) if (isHouse(b.kind) && Math.hypot(b.x - cx, b.z - cz) < R + 30) near++;
    const exitA = o.exits.map((e) => Math.atan2(e.x - cx, e.z - cz));
    const kinds = ['house_m', 'house_s', 'house_l', 'house_s', 'house_m', 'house_s'];
    let ki = Math.floor(h01(o.seed, 5) * kinds.length);
    for (let pass = 0; pass < 2 && near < want; pass++) {
      for (let i = 0; i < 24 && near < want; i++) {
        const a = (i / 24) * Math.PI * 2 + h01(o.seed, 6) * 0.26 + pass * 0.13;
        // keep the roads out open
        let onRoad = false;
        for (const ea of exitA) if (Math.abs(Math.atan2(Math.sin(a - ea), Math.cos(a - ea))) < 0.42) onRoad = true;
        if (onRoad) continue;
        const kind = kinds[ki % kinds.length];
        const r = FOOTPRINT[kind];
        const d = edgeR(a) + 5.5 + r + pass * 7 + h01(i, o.seed + 7) * 2;
        const x = cx + Math.sin(a) * d;
        const z = cz + Math.cos(a) * d;
        if (!free(x, z, r + 1.6)) continue;
        const yaw = Math.atan2(cx - x, cz - z);
        if (!o.house(B, x, z, yaw, kind)) continue;
        o.buildings.push({ kind, x, z, yaw });
        claim(x, z, r + 1.2);
        near++;
        ki++;
      }
    }
    // low stone walls tying neighbouring houses together behind them (never across a road out)
    const ring = o.buildings.filter((b) => isHouse(b.kind) && Math.hypot(b.x - cx, b.z - cz) < R + 34)
      .map((b) => ({ b, a: Math.atan2(b.x - cx, b.z - cz), d: Math.hypot(b.x - cx, b.z - cz) }))
      .sort((p, q) => p.a - q.a);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      let da = q.a - p.a;
      if (da <= 0) da += Math.PI * 2;
      if (da > 1.2 || ring.length < 2) continue;
      let cross = false;
      for (const ea of exitA) {
        let de = ea - p.a;
        if (de < 0) de += Math.PI * 2;
        if (de < da + 0.2) cross = true;
      }
      if (cross) continue;
      const rp = FOOTPRINT[p.b.kind] * 0.8;
      const rq = FOOTPRINT[q.b.kind] * 0.8;
      const x0 = p.b.x + Math.sin(p.a + 0.7) * rp;
      const z0 = p.b.z + Math.cos(p.a + 0.7) * rp;
      const x1 = q.b.x + Math.sin(q.a - 0.7) * rq;
      const z1 = q.b.z + Math.cos(q.a - 0.7) * rq;
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 2 || L > 22) continue;
      const wy = Math.atan2(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(L / 3));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const wx = x0 + (x1 - x0) * t;
        const wz = z0 + (z1 - z0) * t;
        const g = H(wx, wz);
        B.add(prim.box(0.55, 0.95, L / n + 0.08), mat(wx, g - 0.35, wz, wy), SLOT.STONE, 0xe6d6c0, 0.35);
        B.add(prim.box(0.68, 0.12, L / n + 0.1), mat(wx, g + 0.6, wz, wy), SLOT.TERRA);
      }
      o.addCollider({ shape: 'box', x: (x0 + x1) / 2, y: H((x0 + x1) / 2, (z0 + z1) / 2) - 0.35, z: (z0 + z1) / 2, hx: 0.3, hz: L / 2, h: 1.0, yaw: wy });
    }
  }

  // ---------------------------------------------------------------- the square's centrepiece and awnings
  if (!camp && o.style !== 'monastery') {
    // beside the Ringstone: a shade tree in a ring bench (or a well where the definition has none nearby)
    for (let i = 0; i < 8; i++) {
      const a = h01(o.seed, 11) * 6.28 + i * 0.785;
      const d = edgeR(a) * 0.55;
      const x = cx + Math.sin(a) * d;
      const z = cz + Math.cos(a) * d;
      if (!free(x, z, 2.6)) continue;
      const g = H(x, z);
      const leaf = o.style === 'mountain' ? P.biome.frostspine.foliage : o.style === 'outpost' ? P.biome.rustdune.foliage : P.flora.redLeaf;
      B.add(prim.drum(2.3, 2.4, 0.45, 12), mat(x, g - 0.05, z), SLOT.STONE, 0xe0d0b8, 0.3);
      B.add(prim.drum(2.45, 2.45, 0.08, 12, true), mat(x, g + 0.42, z), SLOT.WOOD_LIGHT);
      B.add(prim.drum(0.28, 0.4, 3.6, 6), mat(x, g + 0.3, z), SLOT.WOOD, undefined, 0.3);
      B.add(prim.gem(2.0), mat(x, g + 4.6, z, 0.3, 0, 0, 1.3, 0.9, 1.3), SLOT.CLOTH, leaf);
      B.add(prim.gem(1.5), mat(x + 0.9, g + 5.6, z - 0.4, 0.8, 0, 0, 1.1, 0.8, 1.1), SLOT.CLOTH, leaf);
      o.addCollider({ shape: 'disc', x, y: g - 0.1, z, r: 2.4, h: 0.6 });
      claim(x, z, 2.6);
      break;
    }
    // two awnings on poles at the square's edge, in the banner colours
    let made = 0;
    for (let i = 0; i < 12 && made < 2; i++) {
      const a = h01(o.seed, 21) * 6.28 + i * 0.52;
      const d = edgeR(a) - 1.6;
      const x = cx + Math.sin(a) * d;
      const z = cz + Math.cos(a) * d;
      if (!free(x, z, 2.2)) continue;
      const f = frame(x, H(x, z), z, a + Math.PI);
      for (const sx of [-1.4, 1.4]) for (const sz of [-0.9, 0.9]) B.add(prim.box(0.1, sz > 0 ? 2.3 : 2.6, 0.1), f.m(sx, -0.1, sz), SLOT.WOOD);
      for (let s = 0; s < 4; s++) B.add(prim.cbox(0.72, 0.06, 2.3), f.m(-1.08 + s * 0.72, 2.45, 0, 0, 0.12), SLOT.CLOTH, o.banner[s % 2]);
      B.add(prim.box(2.4, 0.8, 0.6), f.m(0, -0.05, 0.4), SLOT.WOOD_LIGHT, undefined, 0.3);
      o.addCollider({ shape: 'box', x: f.wx(0, 0.4), y: f.y, z: f.wz(0, 0.4), hx: 1.2, hz: 0.3, h: 0.8, yaw: f.yaw });
      claim(x, z, 2.2);
      made++;
    }
  }

  // ---------------------------------------------------------------- lanes and roads
  /**
   * A cobbled lane from (x0, z0) to (x1, z1), width w, conformed to the ground: a gentle curve (a quadratic bend of
   * up to 12% of its length to one side), tinted cobbles and a darker trodden edge.
   */
  function lane(x0, z0, x1, z1, w, salt, straight) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1) return;
    const bend = straight ? 0 : (h01(salt, o.seed + 11) - 0.5) * 0.24 * L;
    const mx = (x0 + x1) / 2 - ((z1 - z0) / L) * bend;
    const mz = (z0 + z1) / 2 + ((x1 - x0) / L) * bend;
    const n = Math.max(2, Math.ceil(L / 2.2));
    const qx = (t) => (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
    const qz = (t) => (1 - t) * (1 - t) * z0 + 2 * (1 - t) * t * mz + t * t * z1;
    const p = (x, z) => [x, H(x, z) + 0.13, z];
    const hw = w / 2;
    const ew = hw + 0.3;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const ax = qx(t0);
      const az = qz(t0);
      const bx = qx(t1);
      const bz = qz(t1);
      const sl = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / sl;
      const nz = (bx - ax) / sl;
      const tint = COBBLE[Math.floor(h01(i + salt * 97, o.seed + 3) * 4)];
      // cobbles (winding up), then a trodden darker edge on each side
      B.tri(p(ax - nx * hw, az - nz * hw), p(bx + nx * hw, bz + nz * hw), p(bx - nx * hw, bz - nz * hw), SLOT.PATH, tint);
      B.tri(p(ax - nx * hw, az - nz * hw), p(ax + nx * hw, az + nz * hw), p(bx + nx * hw, bz + nz * hw), SLOT.PATH, tint);
      B.tri(p(ax + nx * hw, az + nz * hw), p(bx + nx * ew, bz + nz * ew), p(bx + nx * hw, bz + nz * hw), SLOT.PATH, 0xc8b49a);
      B.tri(p(ax + nx * hw, az + nz * hw), p(ax + nx * ew, az + nz * ew), p(bx + nx * ew, bz + nz * ew), SLOT.PATH, 0xc8b49a);
      B.tri(p(ax - nx * ew, az - nz * ew), p(bx - nx * hw, bz - nz * hw), p(bx - nx * ew, bz - nz * ew), SLOT.PATH, 0xc8b49a);
      B.tri(p(ax - nx * ew, az - nz * ew), p(ax - nx * hw, az - nz * hw), p(bx - nx * hw, bz - nz * hw), SLOT.PATH, 0xc8b49a);
      o.keepClear(ax, az, ew + 0.3, true);
    }
    o.keepClear(x1, z1, ew + 0.3, true);
  }

  // a branching lane network: every door joins the square or, when it is nearer, the door of a house closer in
  // (houses face the square: their door is at local +z)
  /** @type {number[][]} */
  const nodes = [];
  const doors = [];
  for (const b of o.buildings) {
    const k = b.kind;
    if (k !== 'house_s' && k !== 'house_m' && k !== 'house_l' && k !== 'windmill' && k !== 'kiteTower' && k !== 'beacon' && k !== 'well' && k !== 'tent') continue;
    const r = (FOOTPRINT[k] || 2) + (k === 'well' ? 0.6 : 0.4);
    const dx = b.x + Math.sin(b.yaw) * r;
    const dz = b.z + Math.cos(b.yaw) * r;
    doors.push([dx, dz, Math.hypot(dx - cx, dz - cz), k === 'house_s' || k === 'well' || k === 'tent' ? 1.6 : 2]);
  }
  doors.sort((a, b) => a[2] - b[2]);
  let li = 0;
  for (const d of doors) {
    const edge = camp ? 4 : edgeR(Math.atan2(d[0] - cx, d[1] - cz)) - 0.4;
    if (d[2] <= edge + 1) continue;
    let tx = cx + ((d[0] - cx) / d[2]) * edge;
    let tz = cz + ((d[1] - cz) / d[2]) * edge;
    let best = Math.hypot(d[0] - tx, d[1] - tz);
    for (const nd of nodes) {
      if (nd[2] >= d[2] - 4) continue;
      const dd = Math.hypot(d[0] - nd[0], d[1] - nd[1]);
      if (dd < best * 0.8) {
        best = dd;
        tx = nd[0];
        tz = nd[1];
      }
    }
    lane(d[0], d[1], tx, tz, d[3], li++);
    nodes.push([(d[0] + tx) / 2, (d[1] + tz) / 2, Math.hypot((d[0] + tx) / 2 - cx, (d[1] + tz) / 2 - cz)]);
    nodes.push(d);
  }
  // roads out toward the paths, with a signpost and lamp posts
  for (let e = 0; e < o.exits.length; e++) {
    const ex = o.exits[e];
    const vx = ex.x - cx;
    const vz = ex.z - cz;
    const vd = Math.hypot(vx, vz) || 1;
    const ux = vx / vd;
    const uz = vz / vd;
    const start = camp ? 5 : edgeR(Math.atan2(ux, uz)) - 0.4;
    const end = Math.min(vd, start + 46);
    lane(cx + ux * start, cz + uz * start, cx + ux * end, cz + uz * end, 3.0, 50 + e, true);
    // signpost at the start of the road, to the right
    const sx = cx + ux * (start + 3) - uz * 2.8;
    const sz = cz + uz * (start + 3) + ux * 2.8;
    if (free(sx, sz, 0.6)) {
      const f = frame(sx, H(sx, sz), sz, Math.atan2(ux, uz));
      B.add(prim.drum(0.09, 0.11, 2.6, 5), f.m(0, -0.1, 0), SLOT.WOOD, undefined, 0.2);
      B.add(prim.cbox(1.2, 0.3, 0.06), f.m(0.45, 2.1, 0, 0.3), SLOT.WOOD_LIGHT);
      B.add(prim.cbox(1.0, 0.28, 0.06), f.m(-0.4, 1.7, 0, -0.5), SLOT.WOOD_LIGHT);
      B.add(prim.cone(0.16, 0.18, 5), f.m(0, 2.5, 0), SLOT.COPPER);
      o.addCollider({ shape: 'capsule', x: sx, y: H(sx, sz), z: sz, r: 0.2, h: 2.6 });
      claim(sx, sz, 0.6);
    }
    // lamp posts along the road
    for (let d = start + 12; d < end; d += 14) {
      const side = ((d / 14) | 0) % 2 ? 1 : -1;
      const lx = cx + ux * d - uz * 2.0 * side;
      const lz = cz + uz * d + ux * 2.0 * side;
      if (!free(lx, lz, 0.5)) continue;
      const f = frame(lx, H(lx, lz), lz, Math.atan2(-uz * side, ux * side));
      o.lantern(B, f);
      pool(cx + ux * d, cz + uz * d, 1.7);
      claim(lx, lz, 0.5);
      lanterns++;
    }
  }

  /** A pool of lantern light on the ground. */
  function pool(x, z, r) {

    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (rr, a) => {
        const px = x + Math.sin(a) * rr;
        const pz = z + Math.cos(a) * rr;
        return [px, H(px, pz) + 0.16, pz];
      };
      B.tri(p(0, 0), p(r * 0.55, a0), p(r * 0.55, a1), SLOT.POOL);
      B.tri(p(r * 0.55, a0), p(r, a0), p(r, a1), SLOT.POOL, 0xb4b4b4);
      B.tri(p(r * 0.55, a0), p(r, a1), p(r * 0.55, a1), SLOT.POOL, 0xb4b4b4);
    }
  }
  // pools under the authored lantern posts
  for (const b of o.buildings) {
    if (b.kind === 'lantern' && !camp && Math.hypot(b.x - cx, b.z - cz) < R + 1) pool(b.x + Math.sin(b.yaw) * 0.5, b.z + Math.cos(b.yaw) * 0.5, 2.4);
  }

  // ---------------------------------------------------------------- gardens beside the houses
  if (o.style !== 'monastery' && o.style !== 'beacon') {
    let gi = 0;
    for (const b of o.buildings) {
      if (b.kind !== 'house_m' && b.kind !== 'house_l' && b.kind !== 'house_s') continue;
      const r = FOOTPRINT[b.kind];
      // try the house's right, then its left
      for (const side of [1, -1]) {
        const gx = b.x + Math.cos(b.yaw) * (r + 5.2) * side;
        const gz = b.z - Math.sin(b.yaw) * (r + 5.2) * side;
        const gw = 2.4;
        const gd = 3.2;
        if (Math.hypot(gx - cx, gz - cz) < R + 4 || !free(gx, gz, 3.4)) continue;
        claim(gx, gz, 3.4);
        const gy = H(gx, gz);
        const f = frame(gx, gy, gz, b.yaw);
        const mountain = o.style === 'mountain';
        const desert = o.style === 'outpost';
        // soil bed and rows of crops
        B.add(prim.box(gw * 2, 0.22, gd * 2), f.m(0, -0.1, 0), SLOT.WOOD, 0x8a6a50, 0.4);
        const crop = desert ? P.biome.rustdune.foliage : mountain ? P.biome.frostspine.foliage : P.biome.meadows.foliage;
        for (let row = 0; row < 3; row++) {
          for (let c = 0; c < 4; c++) {
            const lx = -gw + 0.6 + c * ((gw * 2 - 1.2) / 3);
            const lz = -gd + 0.9 + row * ((gd * 2 - 1.8) / 2);
            const hh = h01(gi * 31 + row * 7 + c, o.seed);
            if (hh < 0.25 && !desert) B.add(prim.ball(0.28, 5, 3), f.m(lx, 0.32, lz), SLOT.CLOTH, row === 1 ? P.flora.redLeaf : P.biome.meadows.accent);
            else B.add(prim.cone(0.32 + 0.12 * hh, 0.55 + 0.4 * hh, 5), f.m(lx, 0.1, lz, hh * 3), SLOT.CLOTH, crop);
          }
        }
        // a low fence with a gate gap at the front
        const post = (lx, lz) => B.add(prim.box(0.12, 0.85, 0.12), f.m(lx, -0.05, lz), SLOT.WOOD_LIGHT);
        const rail = (x0, z0, x1, z1) => {
          const L = Math.hypot(x1 - x0, z1 - z0);
          const a = Math.atan2(x1 - x0, z1 - z0);
          B.add(prim.cbox(0.06, 0.08, L), f.m((x0 + x1) / 2, 0.62, (z0 + z1) / 2, a), SLOT.WOOD_LIGHT);
          B.add(prim.cbox(0.06, 0.08, L), f.m((x0 + x1) / 2, 0.3, (z0 + z1) / 2, a), SLOT.WOOD_LIGHT);
        };
        const fx = gw + 0.3;
        const fz = gd + 0.3;
        for (const [ax, az] of [[-fx, -fz], [fx, -fz], [fx, fz], [-fx, fz], [-0.7, fz], [0.7, fz]]) post(ax, az);
        rail(-fx, -fz, fx, -fz);
        rail(fx, -fz, fx, fz);
        rail(-fx, -fz, -fx, fz);
        rail(-fx, fz, -0.7, fz);
        rail(0.7, fz, fx, fz);
        o.keepClear(gx, gz, 3.6, true);
        gi++;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- crates and barrels, benches
  /** @param {number} x @param {number} z @param {number} yaw @param {number} seed */
  function goods(x, z, yaw, seed) {
    const f = frame(x, H(x, z), z, yaw);
    const n = 2 + Math.floor(h01(seed, 1) * 3);
    for (let i = 0; i < n; i++) {
      const lx = (i % 2) * 0.95 - 0.4;
      const lz = Math.floor(i / 2) * 0.95 - 0.3;
      if (h01(seed, i + 2) < 0.5) {
        B.add(prim.box(0.85, 0.8, 0.85), f.m(lx, -0.02, lz, h01(seed, i + 9) * 0.6), SLOT.WOOD_LIGHT, undefined, 0.3);
        B.add(prim.cbox(0.87, 0.08, 0.1), f.m(lx, 0.4, lz, h01(seed, i + 9) * 0.6), SLOT.WOOD);
      } else {
        B.add(prim.drum(0.36, 0.33, 0.95, 7), f.m(lx, -0.02, lz), SLOT.WOOD, undefined, 0.25);
        B.add(prim.drum(0.38, 0.38, 0.08, 7), f.m(lx, 0.2, lz), SLOT.IRON);
        B.add(prim.drum(0.38, 0.38, 0.08, 7), f.m(lx, 0.68, lz), SLOT.IRON);
      }
    }
    if (n > 2 && h01(seed, 20) < 0.5) B.add(prim.box(0.6, 0.55, 0.6), f.m(-0.1, 0.8, -0.2, 0.4), SLOT.WOOD_LIGHT, undefined, 0.3);
    o.addCollider({ shape: 'box', x: f.wx(0.08, 0.2), y: f.y, z: f.wz(0.08, 0.2), hx: 0.95, hz: 0.95, h: 0.9, yaw });
    claim(x, z, 1.5);
  }
  let gs = 0;
  for (const b of o.buildings) {
    if (b.kind === 'stall') {
      // beside the stall
      for (const side of [1, -1]) {
        const x = b.x + Math.cos(b.yaw) * 2.9 * side;
        const z = b.z - Math.sin(b.yaw) * 2.9 * side;
        if (free(x, z, 1.4)) {
          goods(x, z, b.yaw, gs++ + o.seed);
          break;
        }
      }
    } else if ((b.kind === 'house_m' || b.kind === 'house_l' || b.kind === 'tent') && h01(gs + 40, o.seed) < 0.65) {
      // beside the door
      const r = FOOTPRINT[b.kind] + 1.4;
      const x = b.x + Math.sin(b.yaw + 0.7) * r;
      const z = b.z + Math.cos(b.yaw + 0.7) * r;
      if (free(x, z, 1.4)) goods(x, z, b.yaw + 0.7, gs++ + o.seed);
      else gs++;
    }
  }
  if (!camp) {
    // benches on the square, facing the Ringstone
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.75;
      const x = cx + Math.sin(a) * (edgeR(a) - 2.2);
      const z = cz + Math.cos(a) * (edgeR(a) - 2.2);
      if (!free(x, z, 1.3)) continue;
      const f = frame(x, H(x, z), z, a + Math.PI);
      B.add(prim.box(1.9, 0.1, 0.55), f.m(0, 0.42, 0), SLOT.WOOD_LIGHT);
      B.add(prim.box(1.9, 0.5, 0.08), f.m(0, 0.5, -0.27), SLOT.WOOD_LIGHT);
      for (const sx of [-0.8, 0.8]) B.add(prim.box(0.12, 0.45, 0.45), f.m(sx, -0.02, 0), SLOT.STONE);
      claim(x, z, 1.3);
    }
  }
  return { lanterns };
}

