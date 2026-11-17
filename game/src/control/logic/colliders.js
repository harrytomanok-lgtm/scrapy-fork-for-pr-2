/**
 * Capsule versus static collider push-out (ARCHITECTURE 4.1 Collider, 4.6). Pure: no three, no DOM.
 * The actor is a vertical capsule standing on `pos` (feet) with `radius` and `height`.
 * Collider shapes: sphere (centre x,y,z, radius r), capsule (vertical, base y, radius r, height h),
 * box (centre x,z, base y, half extents hx,hz, height h, rotated by yaw), disc (vertical cylinder, base y, radius r, height h).
 * Only colliders with the SOLID flag push. Low tops (at most `STEP_UP` above the feet) are stepped onto instead of
 * pushing sideways, so kerbs and plinths never snag.
 * @module control/logic/colliders
 */

/** Collider flags (mirror of world COLLIDER, ARCHITECTURE 4.1). */
export const CFLAG = Object.freeze({ SOLID: 1, PLATFORM: 2, DESTRUCTIBLE: 4, NO_CAMERA: 8 });

/** Step height that resolves upward instead of sideways (m). */
export const STEP_UP = 0.45;
/** Push-out iterations (ARCHITECTURE 4.6). */
export const ITERATIONS = 3;

/**
 * Contact result of {@link pushOut}: the deepest contact of the last pass.
 * @typedef {{ hit:boolean, nx:number, ny:number, nz:number, depth:number, id:number, propKey:number, total:number }} Contact
 */

/** @returns {Contact} */
export function createContact() {
  return { hit: false, nx: 0, ny: 0, nz: 0, depth: 0, id: 0, propKey: 0, total: 0 };
}

// Scratch result of one shape test (module scope, reused).
const R = { pen: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Penetration of the capsule into one collider; writes R. @returns {boolean} true when penetrating
 * @param {any} c @param {number} x @param {number} y @param {number} z @param {number} r @param {number} h
 */
function test(c, x, y, z, r, h) {
  const top = y + h;
  switch (c.shape) {
    case 'sphere': {
      // Closest point on the capsule axis to the sphere centre.
      const a = y + Math.min(r, h * 0.5);
      const b = top - Math.min(r, h * 0.5);
      const py = c.y < a ? a : c.y > b ? b : c.y;
      const dx = x - c.x;
      const dy = py - c.y;
      const dz = z - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const pen = r + c.r - d;
      if (pen <= 0) return false;
      R.pen = pen;
      if (d > 1e-6) { R.nx = dx / d; R.ny = dy / d; R.nz = dz / d; } else { R.nx = 0; R.ny = 1; R.nz = 0; }
      return true;
    }
    case 'capsule': {
      const ea = y + Math.min(r, h * 0.5);
      const eb = top - Math.min(r, h * 0.5);
      const ca = c.y + Math.min(c.r, c.h * 0.5);
      const cb = c.y + c.h - Math.min(c.r, c.h * 0.5);
      let dy = 0;
      if (ea > cb) dy = ea - cb;
      else if (eb < ca) dy = eb - ca;
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const pen = r + c.r - d;
      if (pen <= 0) return false;
      R.pen = pen;
      if (d > 1e-6) { R.nx = dx / d; R.ny = dy / d; R.nz = dz / d; } else { R.nx = 1; R.ny = 0; R.nz = 0; }
      return true;
    }
    case 'disc': {
      const ctop = c.y + c.h;
      if (top <= c.y || y >= ctop) return false;
      const dx = x - c.x;
      const dz = z - c.z;
      const dh = Math.sqrt(dx * dx + dz * dz);
      const pen = r + c.r - dh;
      if (pen <= 0) return false;
      const up = ctop - y;
      if (up <= STEP_UP && up < pen) {
        R.pen = up; R.nx = 0; R.ny = 1; R.nz = 0;
        return true;
      }
      R.pen = pen;
      if (dh > 1e-6) { R.nx = dx / dh; R.ny = 0; R.nz = dz / dh; } else { R.nx = 1; R.ny = 0; R.nz = 0; }
      return true;
    }
    case 'box': {
      const ctop = c.y + c.h;
      if (top <= c.y || y >= ctop) return false;
      const cs = Math.cos(c.yaw || 0);
      const sn = Math.sin(c.yaw || 0);
      const dx = x - c.x;
      const dz = z - c.z;
      const lx = dx * cs - dz * sn;
      const lz = dx * sn + dz * cs;
      const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
      const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
      const ex = lx - qx;
      const ez = lz - qz;
      const d = Math.sqrt(ex * ex + ez * ez);
      let pen;
      let nlx;
      let nlz;
      if (d > 1e-6) {
        pen = r - d;
        if (pen <= 0) return false;
        nlx = ex / d;
        nlz = ez / d;
      } else {
        const px = c.hx - Math.abs(lx);
        const pz = c.hz - Math.abs(lz);
        if (px < pz) { pen = px + r; nlx = lx >= 0 ? 1 : -1; nlz = 0; } else { pen = pz + r; nlx = 0; nlz = lz >= 0 ? 1 : -1; }
      }
      const up = ctop - y;
      if (up <= STEP_UP && up < pen) {
        R.pen = up; R.nx = 0; R.ny = 1; R.nz = 0;
        return true;
      }
      R.pen = pen;
      R.nx = nlx * cs + nlz * sn;
      R.ny = 0;
      R.nz = -nlx * sn + nlz * cs;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Push a capsule out of the SOLID colliders in `list[0..n)`, at most {@link ITERATIONS} passes.
 * Moves `pos` and removes the velocity component into each contact normal (when `vel` is given).
 * @param {{x:number,y:number,z:number}} pos feet position (mutated)
 * @param {{x:number,y:number,z:number}|null} vel velocity (mutated) or null
 * @param {number} radius @param {number} height
 * @param {any[]} list colliders @param {number} n count
 * @param {Contact} out deepest contact; out.total = summed push distance
 * @returns {boolean} true when anything pushed
 */
export function pushOut(pos, vel, radius, height, list, n, out) {
  out.hit = false;
  out.depth = 0;
  out.total = 0;
  out.id = 0;
  out.propKey = 0;
  for (let it = 0; it < ITERATIONS; it++) {
    let any = false;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c || (c.flags & CFLAG.SOLID) === 0) continue;
      if (!test(c, pos.x, pos.y, pos.z, radius, height)) continue;
      any = true;
      pos.x += R.nx * R.pen;
      pos.y += R.ny * R.pen;
      pos.z += R.nz * R.pen;
      out.total += R.pen;
      if (vel) {
        const vn = vel.x * R.nx + vel.y * R.ny + vel.z * R.nz;
        if (vn < 0 && it === 0 && R.pen > out.depth) {
          // Remember the impact speed into the surface of the first pass for slam detection.
          out.depth = R.pen;
          out.hit = true;
          out.nx = R.nx; out.ny = R.ny; out.nz = R.nz;
          out.id = c.id || 0;
          out.propKey = c.propKey || 0;
        }
        if (vn < 0) {
          vel.x -= vn * R.nx;
          vel.y -= vn * R.ny;
          vel.z -= vn * R.nz;
        }
      } else if (R.pen > out.depth) {
        out.depth = R.pen;
        out.hit = true;
        out.nx = R.nx; out.ny = R.ny; out.nz = R.nz;
        out.id = c.id || 0;
        out.propKey = c.propKey || 0;
      }
    }
    if (!any) break;
  }
  return out.total > 0;
}
