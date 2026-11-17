/**
 * Spatial queries `ctx.spatial` (ARCHITECTURE 3.5): a uniform 2D hash on x,z with 32 m cells over the
 * world square (positions outside it clamp to the border cells).
 *
 * The grid is rebuilt from `ents.all()` by `core.spatial` (post phase, order -100), so it reflects the
 * positions at the end of the previous post phase. Queries look a margin of cells further and then test
 * the entities' current positions, so an entity that moved since the rehash is still found; entities
 * created since the rehash are scanned directly.
 * Only entities with `alive === true` match. Results are written into `out` from index 0 in id order and
 * `out.length` is set to the count. Nothing allocates after the cells have warmed up.
 * @module core/spatial
 */

import { SPATIAL_CELL, WORLD_HALF, WORLD_SIZE } from './constants.js';
import { KIND_MASK } from './ents.js';

/** Cells per side of the world square. */
const N = Math.ceil(WORLD_SIZE / SPATIAL_CELL);
/** Extra search distance in metres for entities that moved since the last rehash (fast flyers move about 2 m per tick). */
const MOVE_MARGIN = 8;

/** @param {number} v @returns {number} */
function cellOf(v) {
  const c = Math.floor((v + WORLD_HALF) / SPATIAL_CELL);
  return c < 0 ? 0 : c >= N ? N - 1 : c;
}

/**
 * Squared distance from point p to the vertical capsule axis of `e` (segment from pos.y + radius to pos.y + height - radius).
 * @param {any} e @param {number} x @param {number} y @param {number} z
 */
function distSqToAxis(e, x, y, z) {
  const r = e.radius;
  const y0 = e.pos.y + r;
  const y1 = Math.max(y0, e.pos.y + e.height - r);
  const cy = y < y0 ? y0 : y > y1 ? y1 : y;
  const dx = x - e.pos.x;
  const dy = y - cy;
  const dz = z - e.pos.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Squared distance between segment AB and the vertical capsule axis of `e`.
 * @param {any} e
 */
function segAxisDistSq(e, ax, ay, az, bx, by, bz) {
  const r = e.radius;
  const y0 = e.pos.y + r;
  const y1 = Math.max(y0, e.pos.y + e.height - r);
  const px = e.pos.x, pz = e.pos.z;
  // Segment 1: A + s*d1, segment 2: Q + t*d2 with Q = (px, y0, pz), d2 = (0, y1 - y0, 0).
  const d1x = bx - ax, d1y = by - ay, d1z = bz - az;
  const d2y = y1 - y0;
  const rx = ax - px, ry = ay - y0, rz = az - pz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e2 = d2y * d2y;
  const f = d2y * ry;
  let s;
  let t;
  if (a <= 1e-12 && e2 <= 1e-12) {
    s = 0; t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = clamp01(f / e2);
  } else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (e2 <= 1e-12) {
      t = 0;
      s = clamp01(-cc / a);
    } else {
      const b = d1y * d2y;
      const denom = a * e2 - b * b;
      s = denom > 1e-12 ? clamp01((b * f - cc * e2) / denom) : 0;
      t = (b * s + f) / e2;
      if (t < 0) {
        t = 0;
        s = clamp01(-cc / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - cc) / a);
      }
    }
  }
  const dx = ax + d1x * s - px;
  const dy = ay + d1y * s - (y0 + d2y * t);
  const dz = az + d1z * s - pz;
  return dx * dx + dy * dy + dz * dz;
}

/** @param {number} v */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sort `out[0..n)` by entity id (insertion sort, no allocation).
 * @param {any[]} out @param {number} n
 */
function sortById(out, n) {
  for (let i = 1; i < n; i++) {
    const v = out[i];
    let j = i - 1;
    while (j >= 0 && out[j].id > v.id) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = v;
  }
}

/**
 * @typedef {object} Spatial
 * @property {(x:number, z:number, r:number, out:any[], kindMask:number) => number} query
 *   Entities whose capsule overlaps the vertical cylinder of radius r around (x, z) (horizontal distance <= r + ent.radius).
 * @property {(x:number, y:number, z:number, r:number, out:any[], kindMask:number) => number} querySphere
 *   Entities whose capsule overlaps the sphere.
 * @property {(ax:number, ay:number, az:number, bx:number, by:number, bz:number, r:number, out:any[], kindMask:number) => number} querySegment
 *   Capsule sweep of radius r from A to B against entity capsules. Results in id order (not sorted along the segment).
 * @property {(x:number, y:number, z:number, r:number, kindMask:number, filterFn?:(ent:any)=>boolean) => any|null} nearest
 *   Entity with the smallest distance from the point to its capsule surface within r; ties go to the lower id.
 * @property {() => void} rehash   `core.spatial` internal: rebuild the grid from `ents.all()`.
 */

/**
 * Create the spatial hash.
 * @param {object} ctx Context read at call time for `ctx.ents`.
 * @returns {Spatial}
 */
export function createSpatial(ctx) {
  const c = /** @type {any} */ (ctx);
  /** @type {Array<any[]|null>} */
  const cells = new Array(N * N).fill(null);
  /** @type {number[]} */
  const occupied = [];
  let maxRadius = 0;
  /** Highest entity id in the grid; newer entities are scanned directly until the next rehash. */
  let hashedMaxId = 0;
  /** @type {any[]} */
  const scratch = [];

  const kindBit = /** @type {Record<string, number>} */ ({
    player: KIND_MASK.player, enemy: KIND_MASK.enemy, boss: KIND_MASK.boss, npc: KIND_MASK.npc,
    projectile: KIND_MASK.projectile, pickup: KIND_MASK.pickup, object: KIND_MASK.object,
  });

  /**
   * Collect candidates from the cells covering [minX, maxX] x [minZ, maxZ] into `scratch`; returns the count.
   * Falls back to the full entity list when that is cheaper than visiting the cells.
   */
  function gather(minX, minZ, maxX, maxZ, kindMask) {
    const pad = maxRadius + MOVE_MARGIN;
    const cx0 = cellOf(minX - pad), cx1 = cellOf(maxX + pad);
    const cz0 = cellOf(minZ - pad), cz1 = cellOf(maxZ + pad);
    let n = 0;
    const all = c.ents.all();
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > all.length) {
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.alive && (kindBit[e.kind] & kindMask) !== 0) scratch[n++] = e;
      }
      return n;
    }
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = cells[cz * N + cx];
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (e.alive && (kindBit[e.kind] & kindMask) !== 0) scratch[n++] = e;
        }
      }
    }
    for (let i = all.length - 1; i >= 0 && all[i].id > hashedMaxId; i--) {
      const e = all[i];
      if (e.alive && (kindBit[e.kind] & kindMask) !== 0) scratch[n++] = e;
    }
    return n;
  }

  /** @param {any[]} out @param {number} n @param {number} n0 Candidates gathered. */
  function finish(out, n, n0) {
    out.length = n;
    sortById(out, n);
    for (let i = 0; i < n0; i++) scratch[i] = null;
    return n;
  }

  /** @type {Spatial} */
  const spatial = {
    query(x, z, r, out, kindMask) {
      const n0 = gather(x - r, z - r, x + r, z + r, kindMask);
      let n = 0;
      for (let i = 0; i < n0; i++) {
        const e = scratch[i];
        const dx = e.pos.x - x;
        const dz = e.pos.z - z;
        const rr = r + e.radius;
        if (dx * dx + dz * dz <= rr * rr) out[n++] = e;
      }
      return finish(out, n, n0);
    },

    querySphere(x, y, z, r, out, kindMask) {
      const n0 = gather(x - r, z - r, x + r, z + r, kindMask);
      let n = 0;
      for (let i = 0; i < n0; i++) {
        const e = scratch[i];
        const rr = r + e.radius;
        if (distSqToAxis(e, x, y, z) <= rr * rr) out[n++] = e;
      }
      return finish(out, n, n0);
    },

    querySegment(ax, ay, az, bx, by, bz, r, out, kindMask) {
      const n0 = gather(Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r, kindMask);
      let n = 0;
      for (let i = 0; i < n0; i++) {
        const e = scratch[i];
        const rr = r + e.radius;
        if (segAxisDistSq(e, ax, ay, az, bx, by, bz) <= rr * rr) out[n++] = e;
      }
      return finish(out, n, n0);
    },

    nearest(x, y, z, r, kindMask, filterFn) {
      const n0 = gather(x - r, z - r, x + r, z + r, kindMask);
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < n0; i++) {
        const e = scratch[i];
        const d = Math.max(0, Math.sqrt(distSqToAxis(e, x, y, z)) - e.radius);
        if (d > r) continue;
        if (d < bestD || (d === bestD && best !== null && e.id < best.id)) {
          if (filterFn && !filterFn(e)) continue;
          best = e;
          bestD = d;
        }
      }
      for (let i = 0; i < n0; i++) scratch[i] = null;
      return best;
    },

    rehash() {
      for (let i = 0; i < occupied.length; i++) /** @type {any[]} */ (cells[occupied[i]]).length = 0;
      occupied.length = 0;
      maxRadius = 0;
      const all = c.ents.all();
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (!e.alive) continue;
        const idx = cellOf(e.pos.z) * N + cellOf(e.pos.x);
        let cell = cells[idx];
        if (!cell) {
          cell = [];
          cells[idx] = cell;
        }
        if (cell.length === 0) occupied.push(idx);
        cell.push(e);
        if (e.radius > maxRadius) maxRadius = e.radius;
      }
      hashedMaxId = all.length > 0 ? all[all.length - 1].id : hashedMaxId;
    },
  };
  return spatial;
}
