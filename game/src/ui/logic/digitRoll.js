/**
 * Resonance digit roll (ART_UX 6.6): when the value changes, the counter rolls from the old to the new value
 * with an ease-out over a duration that grows with the size of the change, then lands exactly on the target.
 * A roll is a small mutable state object, so the HUD advances it every frame without allocating.
 * Pure module.
 * @module ui/logic/digitRoll
 */

/** Shortest and longest roll, seconds. The Ora Awakening (176 -> 880) takes the long one. */
export const ROLL_MIN = 0.35;
export const ROLL_MAX = 1.2;

/**
 * @typedef {{ from:number, to:number, t:number, dur:number, shown:number, rolling:boolean }} Roll
 */

/** @param {number} [value=0] @returns {Roll} */
export function createRoll(value = 0) {
  const v = Math.round(value);
  return { from: v, to: v, t: 0, dur: 0, shown: v, rolling: false };
}

/**
 * Roll duration for a change.
 * @param {number} from @param {number} to
 * @returns {number}
 */
export function rollDuration(from, to) {
  const d = Math.abs(to - from);
  if (d === 0) return 0;
  return Math.min(ROLL_MAX, ROLL_MIN + Math.log10(1 + d) * 0.28);
}

/**
 * Point the roll at a new target. Rolling restarts from the value currently shown.
 * @param {Roll} r @param {number} to
 * @returns {boolean} true when the target changed
 */
export function setTarget(r, to) {
  const v = Math.round(to);
  if (v === r.to) return false;
  r.from = r.shown;
  r.to = v;
  r.t = 0;
  r.dur = rollDuration(r.from, v);
  r.rolling = r.dur > 0;
  if (!r.rolling) r.shown = v;
  return true;
}

/**
 * Advance the roll.
 * @param {Roll} r @param {number} dt seconds
 * @returns {boolean} true when the shown integer changed
 */
export function advance(r, dt) {
  if (!r.rolling) return false;
  r.t += dt > 0 ? dt : 0;
  const prev = r.shown;
  if (r.t >= r.dur) {
    r.shown = r.to;
    r.rolling = false;
  } else {
    const u = r.t / r.dur;
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    r.shown = Math.round(r.from + (r.to - r.from) * e);
  }
  return r.shown !== prev;
}

/**
 * The integers a roll shows at a fixed frame rate, first frame excluded, last = target (tests, previews).
 * @param {number} from @param {number} to @param {number} [fps=30]
 * @returns {number[]}
 */
export function rollSteps(from, to, fps = 30) {
  const r = createRoll(from);
  setTarget(r, to);
  const out = [];
  let guard = 0;
  while (r.rolling && guard++ < 1000) {
    if (advance(r, 1 / fps)) out.push(r.shown);
  }
  if (!out.length || out[out.length - 1] !== r.to) out.push(r.to);
  return out;
}
