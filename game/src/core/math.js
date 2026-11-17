/**
 * Allocation-free math helpers and shared scratch objects (ARCHITECTURE 3.9).
 *
 * This module is on the pure list of 2.2 (no `three` import, no DOM), so the scratch
 * objects in {@link TMP} are created by {@link initTmp}, which `src/core/ents.js` calls when it
 * loads (and therefore every context). Pure `logic/` code must not use `TMP`.
 * @module core/math
 */

const PI = Math.PI;
const TAU = Math.PI * 2;

/**
 * Clamp `v` to [lo, hi].
 * @param {number} v @param {number} lo @param {number} hi @returns {number}
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Linear interpolation from `a` to `b` by `t` (not clamped).
 * @param {number} a @param {number} b @param {number} t @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Inverse of {@link lerp}: where `v` lies between `a` and `b` (not clamped). Returns 0 when a === b.
 * @param {number} a @param {number} b @param {number} v @returns {number}
 */
export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

/**
 * Hermite smoothstep of `x` between edges `e0` and `e1`, clamped to [0, 1].
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number}
 */
export function smoothstep(e0, e1, x) {
  const t = clamp(invLerp(e0, e1, x), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential approach of `current` towards `target`.
 * @param {number} current @param {number} target
 * @param {number} lambda Rate (1/s); larger is faster.
 * @param {number} dt Seconds.
 * @returns {number}
 */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * Wrap an angle in radians to (-PI, PI].
 * @param {number} a @returns {number}
 */
export function wrapAngle(a) {
  let r = (a + PI) % TAU;
  if (r < 0) r += TAU;
  r -= PI;
  return r === -PI ? PI : r;
}

/**
 * Shortest signed angle in radians that turns `a` into `b`, in (-PI, PI].
 * @param {number} a @param {number} b @returns {number}
 */
export function angleDelta(a, b) {
  return wrapAngle(b - a);
}

/**
 * Move `v` towards `target` by at most `maxDelta` (never overshoots).
 * @param {number} v @param {number} target @param {number} maxDelta @returns {number}
 */
export function approach(v, target, maxDelta) {
  if (v < target) return v + maxDelta >= target ? target : v + maxDelta;
  return v - maxDelta <= target ? target : v - maxDelta;
}

/**
 * Shared scratch objects: `v1..v8` are `Vector3`, `q1..q2` are `Quaternion`, `m1` is a `Matrix4`.
 * Never hold one across a function call. Filled by {@link initTmp}.
 * @type {{ v1:any, v2:any, v3:any, v4:any, v5:any, v6:any, v7:any, v8:any, q1:any, q2:any, m1:any }}
 */
export const TMP = { v1: null, v2: null, v3: null, v4: null, v5: null, v6: null, v7: null, v8: null, q1: null, q2: null, m1: null };

/**
 * Create the {@link TMP} scratch objects from the given three classes. Idempotent.
 * @param {{ Vector3:Function, Quaternion:Function, Matrix4:Function }} three
 */
export function initTmp(three) {
  if (TMP.v1) return;
  const V = /** @type {any} */ (three.Vector3);
  const Q = /** @type {any} */ (three.Quaternion);
  const M = /** @type {any} */ (three.Matrix4);
  TMP.v1 = new V(); TMP.v2 = new V(); TMP.v3 = new V(); TMP.v4 = new V();
  TMP.v5 = new V(); TMP.v6 = new V(); TMP.v7 = new V(); TMP.v8 = new V();
  TMP.q1 = new Q(); TMP.q2 = new Q();
  TMP.m1 = new M();
}
