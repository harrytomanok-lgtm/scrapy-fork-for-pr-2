/**
 * Static colliders on a 64 m grid (ARCHITECTURE 4.1) and the ray, sweep and ground queries against terrain and
 * colliders. Collider objects are pooled; queries are allocation-free. Pure.
 * @module world/gen/colliders
 */

import { WORLD_HALF, WORLD_SIZE } from '../../core/constants.js';

/** Static collider flags (4.1). */
export const COLLIDER = Object.freeze({ SOLID: 1, PLATFORM: 2, DESTRUCTIBLE: 4, NO_CAMERA: 8 });

const CELL = 64;
const CN = WORLD_SIZE / CELL;
const MAX = 8192;

/**
 * @typedef {{ id:number, shape:'sphere'|'capsule'|'box'|'disc', x:number, y:number, z:number, r:number, h:number,
 *   hx:number, hz:number, yaw:number, flags:number, propKey:number, mark:number, live:boolean, cs:number, sn:number }} Collider
 */

/** @returns {Collider} */
function blank() {
  return { id: 0, shape: 'sphere', x: 0, y: 0, z: 0, r: 0, h: 0, hx: 0, hz: 0, yaw: 0, flags: 0, propKey: 0, mark: 0, live: false, cs: 1, sn: 0 };
}

/** Horizontal reach of a collider. @param {Collider} c */
export function reach(c) {
  return c.shape === 'box' ? Math.sqrt(c.hx * c.hx + c.hz * c.hz) : c.r;
}

/**
 * Inside test of a point against a collider inflated by `inflate`; writes the outward normal to `n[0..2]`.
 * @param {Collider} c @param {number} px @param {number} py @param {number} pz @param {number} inflate @param {Float64Array|number[]} n
 */
export function insideCollider(c, px, py, pz, inflate, n) {
  const dx = px - c.x;
  const dz = pz - c.z;
  if (c.shape === 'sphere' || c.shape === 'capsule') {
    let dy;
    if (c.shape === 'sphere') dy = py - c.y;
    else {
      const y0 = c.y + c.r;
      const y1 = Math.max(y0, c.y + c.h - c.r);
      dy = py - (py < y0 ? y0 : py > y1 ? y1 : py);
    }
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= c.r + inflate) return false;
    if (d > 1e-6) {
      n[0] = dx / d; n[1] = dy / d; n[2] = dz / d;
    } else {
      n[0] = 0; n[1] = 1; n[2] = 0;
    }
    return true;
  }
  if (py < c.y - inflate || py > c.y + c.h + inflate) return false;
  if (c.shape === 'disc') {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= c.r + inflate) return false;
    const side = c.r + inflate - d;
    const top = c.y + c.h + inflate - py;
    if (top < side) {
      n[0] = 0; n[1] = 1; n[2] = 0;
    } else {
      const inv = d > 1e-6 ? 1 / d : 0;
      n[0] = dx * inv; n[1] = 0; n[2] = d > 1e-6 ? dz * inv : 1;
    }
    return true;
  }
  const lx = dx * c.cs - dz * c.sn;
  const lz = dx * c.sn + dz * c.cs;
  const ex = c.hx + inflate - Math.abs(lx);
  const ez = c.hz + inflate - Math.abs(lz);
  if (ex <= 0 || ez <= 0) return false;
  const top = c.y + c.h + inflate - py;
  if (top < ex && top < ez) {
    n[0] = 0; n[1] = 1; n[2] = 0;
    return true;
  }
  const nlx = ex < ez ? (lx < 0 ? -1 : 1) : 0;
  const nlz = ex < ez ? 0 : (lz < 0 ? -1 : 1);
  n[0] = nlx * c.cs + nlz * c.sn;
  n[1] = 0;
  n[2] = -nlx * c.sn + nlz * c.cs;
  return true;
}

/**
 * Create the collider store and the physics queries over a height function.
 * @param {(x:number, z:number) => number} heightAt
 * @param {(x:number, z:number, out:{x:number,y:number,z:number}) => any} normalAt
 */
export function createColliders(heightAt, normalAt) {
  /** @type {Collider[]} */
  const pool = [];
  for (let i = 0; i < MAX; i++) pool.push(blank());
  /** @type {Collider[]} */
  const free = pool.slice().reverse();
  /** id -> collider */
  const byId = new Map();
  /** @type {Collider[][]} */
  const cells = [];
  for (let i = 0; i < CN * CN; i++) cells.push([]);
  let nextId = 1;
  let stamp = 1;
  let count = 0;
  /** @type {Collider[]} */
  const cand = [];
  let candN = 0;
  const nS = new Float64Array(3);
  const nTmp = { x: 0, y: 1, z: 0 };
  /** Collider of the last `blocked` hit. @type {Collider|null} */
  let hitC = null;

  /** Visit the grid cells overlapped by a box; calls fn(cellArray). */
  function cellRange(minX, minZ, maxX, maxZ) {
    let i0 = Math.floor((minX + WORLD_HALF) / CELL);
    let i1 = Math.floor((maxX + WORLD_HALF) / CELL);
    let j0 = Math.floor((minZ + WORLD_HALF) / CELL);
    let j1 = Math.floor((maxZ + WORLD_HALF) / CELL);
    i0 = i0 < 0 ? 0 : i0 >= CN ? CN - 1 : i0;
    i1 = i1 < 0 ? 0 : i1 >= CN ? CN - 1 : i1;
    j0 = j0 < 0 ? 0 : j0 >= CN ? CN - 1 : j0;
    j1 = j1 < 0 ? 0 : j1 >= CN ? CN - 1 : j1;
    range[0] = i0; range[1] = i1; range[2] = j0; range[3] = j1;
  }
  const range = new Int32Array(4);

  /**
   * Gather live colliders whose reach overlaps the box into `cand` (deduplicated), filtered by flags mask.
   * @returns {number}
   */
  function gather(minX, minZ, maxX, maxZ, mask) {
    stamp++;
    candN = 0;
    cellRange(minX, minZ, maxX, maxZ);
    for (let j = range[2]; j <= range[3]; j++) {
      for (let i = range[0]; i <= range[1]; i++) {
        const list = cells[j * CN + i];
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.mark === stamp) continue;
          c.mark = stamp;
          if ((c.flags & mask) === 0) continue;
          const r = reach(c);
          if (c.x + r < minX || c.x - r > maxX || c.z + r < minZ || c.z - r > maxZ) continue;
          cand[candN++] = c;
        }
      }
    }
    return candN;
  }

  const store = {
    COLLIDER,
    /** @returns {number} live colliders */
    count: () => count,
    /** @param {number} id @returns {Collider|null} */
    get: (id) => byId.get(id) || null,

    /** @param {any} def @returns {number} id, 0 when full */
    add(def) {
      const c = free.pop();
      if (!c) return 0;
      c.id = nextId++;
      c.shape = def.shape || 'sphere';
      c.x = def.x || 0; c.y = def.y || 0; c.z = def.z || 0;
      c.r = def.r || 0; c.h = def.h || 0; c.hx = def.hx || 0; c.hz = def.hz || 0;
      c.yaw = def.yaw || 0;
      c.cs = Math.cos(c.yaw); c.sn = Math.sin(c.yaw);
      c.flags = def.flags !== undefined ? def.flags : COLLIDER.SOLID;
      c.propKey = def.propKey || 0;
      c.live = true;
      const r = reach(c);
      cellRange(c.x - r, c.z - r, c.x + r, c.z + r);
      for (let j = range[2]; j <= range[3]; j++) for (let i = range[0]; i <= range[1]; i++) cells[j * CN + i].push(c);
      byId.set(c.id, c);
      count++;
      return c.id;
    },

    /** @param {number} id */
    remove(id) {
      const c = byId.get(id);
      if (!c) return;
      byId.delete(id);
      const r = reach(c);
      cellRange(c.x - r, c.z - r, c.x + r, c.z + r);
      for (let j = range[2]; j <= range[3]; j++) {
        for (let i = range[0]; i <= range[1]; i++) {
          const list = cells[j * CN + i];
          const k = list.indexOf(c);
          if (k >= 0) {
            list[k] = list[list.length - 1];
            list.length--;
          }
        }
      }
      c.live = false;
      c.id = 0;
      free.push(c);
      count--;
    },

    /** @param {number} x @param {number} z @param {number} r @param {Collider[]} out @returns {number} */
    query(x, z, r, out) {
      gather(x - r, z - r, x + r, z + r, 0xffff);
      let n = 0;
      for (let k = 0; k < candN; k++) {
        const c = cand[k];
        const rr = reach(c) + r;
        const dx = c.x - x;
        const dz = c.z - z;
        if (dx * dx + dz * dz <= rr * rr) out[n++] = c;
      }
      out.length = n;
      return n;
    },

    /** Highest walkable surface at or below y + 1: terrain or a PLATFORM top. */
    groundAt(x, y, z) {
      let g = heightAt(x, z);
      gather(x, z, x, z, COLLIDER.PLATFORM);
      for (let k = 0; k < candN; k++) {
        const c = cand[k];
        const top = c.shape === 'sphere' ? c.y + c.r : c.y + c.h;
        if (top > y + 1 || top <= g) continue;
        if (c.shape === 'sphere') {
          const dx = x - c.x;
          const dz = z - c.z;
          const d2 = c.r * c.r - dx * dx - dz * dz;
          if (d2 <= 0) continue;
          const t = c.y + Math.sqrt(d2);
          if (t <= y + 1 && t > g) g = t;
          continue;
        }
        if (insideCollider(c, x, top - 0.01, z, 0, nS)) g = top;
      }
      return g;
    },

    /** True when a SOLID collider contains the point inflated by `clearance`. */
    blocked(x, y, z, clearance) {
      gather(x - clearance, z - clearance, x + clearance, z + clearance, COLLIDER.SOLID);
      for (let k = 0; k < candN; k++) if (insideCollider(cand[k], x, y, z, clearance, nS)) return true;
      return false;
    },

    /**
     * Destroy DESTRUCTIBLE colliders touching the sphere: calls onHit(collider) before removing each.
     * @returns {number}
     */
    damage(x, y, z, radius, onHit) {
      gather(x - radius, z - radius, x + radius, z + radius, COLLIDER.DESTRUCTIBLE);
      let n = 0;
      // Iterate a stable snapshot: removal does not touch `cand`.
      const total = candN;
      for (let k = 0; k < total; k++) {
        const c = cand[k];
        if (!c.live || !insideCollider(c, x, y, z, radius, nS)) continue;
        onHit(c);
        store.remove(c.id);
        n++;
      }
      return n;
    },

    /**
     * March a sphere from a to b against terrain and SOLID colliders; fill `out` (Hit) with the first contact.
     * @returns {boolean}
     */
    march(ax, ay, az, bx, by, bz, radius, out) {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      out.hit = false; out.t = 1; out.x = bx; out.y = by; out.z = bz; out.nx = 0; out.ny = 1; out.nz = 0;
      out.kind = null; out.colliderId = 0; out.propKey = 0;
      if (!(len > 1e-6)) return false;
      const pad = radius + 1;
      gather(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, COLLIDER.SOLID);
      const stepLen = Math.min(4, Math.max(0.25, len / 256));
      const steps = Math.ceil(len / stepLen);
      let prevT = 0;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        if (blockedAt(ax + dx * t, ay + dy * t, az + dz * t, radius) === 0) {
          prevT = t;
          continue;
        }
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) * 0.5;
          if (blockedAt(ax + dx * m, ay + dy * m, az + dz * m, radius) !== 0) hi = m;
          else lo = m;
        }
        const px = ax + dx * hi;
        const py = ay + dy * hi;
        const pz = az + dz * hi;
        const kind = blockedAt(px, py, pz, radius);
        out.hit = true;
        out.t = hi;
        out.x = px; out.y = py; out.z = pz;
        if (kind === 2 && hitC) {
          out.nx = nS[0]; out.ny = nS[1]; out.nz = nS[2];
          out.kind = 'collider';
          out.colliderId = hitC.id;
          out.propKey = hitC.propKey;
        } else {
          normalAt(px, pz, nTmp);
          out.nx = nTmp.x; out.ny = nTmp.y; out.nz = nTmp.z;
          out.kind = 'terrain';
        }
        return true;
      }
      return false;
    },
  };

  /** 0 free, 1 terrain, 2 collider (normal in nS, collider in hitC). Uses the gathered candidates. */
  function blockedAt(px, py, pz, radius) {
    if (py - radius <= heightAt(px, pz)) return 1;
    for (let i = 0; i < candN; i++) {
      if (insideCollider(cand[i], px, py, pz, radius, nS)) {
        hitC = cand[i];
        return 2;
      }
    }
    return 0;
  }

  return store;
}
