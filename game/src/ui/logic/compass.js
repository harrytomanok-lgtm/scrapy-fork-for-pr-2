/**
 * Compass strip maths (ART_UX 6.6): bearings in the world's yaw convention, the relative angle to the camera
 * heading, and the horizontal placement of ticks and pips on the strip.
 * World convention (ARCHITECTURE 1): +x east, +z south, forward(yaw) = (sin yaw, cos yaw); yaw 0 faces south and
 * yaw pi faces north. The camera's right is (-cos yaw, sin yaw), so a positive relative angle lies to the LEFT.
 * Pure module.
 * @module ui/logic/compass
 */

export const TAU = Math.PI * 2;
/** Degrees of heading visible across the whole strip. */
export const COMPASS_SPAN_DEG = 150;
/** Tick spacing in degrees. */
export const TICK_DEG = 15;
/** POI pips appear within this horizontal distance (metres). */
export const PIP_RANGE = 400;

/**
 * Wrap an angle to (-pi, pi].
 * @param {number} a
 * @returns {number}
 */
export function wrapPi(a) {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/**
 * Yaw that faces from the origin along (dx, dz).
 * @param {number} dx @param {number} dz
 * @returns {number}
 */
export function bearing(dx, dz) {
  return Math.atan2(dx, dz);
}

/**
 * Angle of a target relative to the heading: 0 ahead, positive to the left, in (-pi, pi].
 * @param {number} headingYaw @param {number} targetYaw
 * @returns {number}
 */
export function relative(headingYaw, targetYaw) {
  return wrapPi(targetYaw - headingYaw);
}

/**
 * Horizontal position on the strip, 0 = physical left edge, 1 = right edge, for a relative angle.
 * Values outside 0..1 are off the strip.
 * @param {number} rel relative angle (radians, positive left)
 * @param {number} [spanDeg=COMPASS_SPAN_DEG]
 * @returns {number}
 */
export function stripX(rel, spanDeg = COMPASS_SPAN_DEG) {
  const half = (spanDeg * Math.PI) / 360;
  return 0.5 - rel / (2 * half);
}

/**
 * Place a world point on the strip. Writes `out.x` (0..1, clamped to the edge when `clampEdge`), `out.on`
 * (inside the visible span), `out.dist` (horizontal metres) and `out.rel`.
 * @param {number} px @param {number} pz  viewer position
 * @param {number} headingYaw
 * @param {number} tx @param {number} tz  target position
 * @param {{ x:number, on:boolean, dist:number, rel:number }} out
 * @param {boolean} [clampEdge=false]  keep off-strip targets pinned at the nearest edge (the quest diamond)
 * @param {number} [spanDeg]
 * @returns {{ x:number, on:boolean, dist:number, rel:number }}
 */
export function placePip(px, pz, headingYaw, tx, tz, out, clampEdge = false, spanDeg = COMPASS_SPAN_DEG) {
  const dx = tx - px;
  const dz = tz - pz;
  out.dist = Math.sqrt(dx * dx + dz * dz);
  out.rel = relative(headingYaw, bearing(dx, dz));
  const x = stripX(out.rel, spanDeg);
  out.on = x >= 0 && x <= 1;
  out.x = clampEdge ? (x < 0 ? 0 : x > 1 ? 1 : x) : x;
  return out;
}

/**
 * Cardinal and tick marks visible on the strip for a heading, written into preallocated arrays.
 * Each tick k (0..23) is the world yaw for heading `k * 15` degrees clockwise from north.
 * @param {number} headingYaw
 * @param {Float32Array} xs   out: strip x of each tick (NaN when off the strip), length 24
 * @param {number} [spanDeg]
 * @returns {number} number of ticks on the strip
 */
export function tickPositions(headingYaw, xs, spanDeg = COMPASS_SPAN_DEG) {
  let n = 0;
  for (let k = 0; k < 24; k++) {
    const x = stripX(relative(headingYaw, compassYaw(k * TICK_DEG)), spanDeg);
    if (x >= 0 && x <= 1) {
      xs[k] = x;
      n++;
    } else xs[k] = NaN;
  }
  return n;
}

/**
 * World yaw of a compass heading in degrees clockwise from north (0 N, 90 E, 180 S, 270 W).
 * North is yaw pi and east is yaw pi/2, so clockwise headings lower the yaw.
 * @param {number} deg
 * @returns {number}
 */
export function compassYaw(deg) {
  return wrapPi(Math.PI - (deg * Math.PI) / 180);
}

/**
 * Compass heading (degrees clockwise from north, 0..360) of a world yaw.
 * @param {number} yaw
 * @returns {number}
 */
export function headingDeg(yaw) {
  let d = ((Math.PI - yaw) * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
}
