/**
 * Pure touch gesture rules: the target-switch flick on the camera zone and the stick response curve.
 * The DOM layer (control/touch.js) and the Node tests call the same functions.
 * @module control/logic/gesture
 */

/** A flick is at least this far sideways (CSS px), mostly horizontal, and faster than FLICK_MS. */
export const FLICK_PX = 40;
export const FLICK_MS = 300;
/** Horizontal travel must exceed the vertical travel by this ratio. */
export const FLICK_RATIO = 1.5;

/**
 * Is a camera-zone stroke a target-switch flick?
 * @param {number} dx @param {number} dy total travel (CSS px) @param {number} ms stroke duration
 * @returns {boolean}
 */
export function isFlick(dx, dy, ms) {
  const ax = Math.abs(dx);
  return ms > 0 && ms <= FLICK_MS && ax >= FLICK_PX && ax >= Math.abs(dy) * FLICK_RATIO;
}

/** Stick dead zone (fraction of travel) and the curve that shapes the rest. */
export const STICK = Object.freeze({
  deadZone: 0.1,
  /** Deflection at or above which the output is full (a thumb rarely reaches the rim exactly). */
  fullAt: 0.88,
  /** Exponent of the response: above 1 widens the slow-walk band near the centre. */
  exponent: 1.6,
});

/**
 * Stick response: 0 inside the dead zone, then a curve that keeps the first half of the travel for walking
 * (fine control) and reaches full speed before the rim, so a sprint never needs the thumb at the very edge.
 * @param {number} n deflection 0..1 (distance / travel)
 * @returns {number} output magnitude 0..1
 */
export function stickResponse(n) {
  if (!(n > STICK.deadZone)) return 0;
  const u = (n - STICK.deadZone) / (STICK.fullAt - STICK.deadZone);
  if (u >= 1) return 1;
  return Math.pow(u, STICK.exponent);
}
