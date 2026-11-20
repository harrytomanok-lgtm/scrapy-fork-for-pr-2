/**
 * Combo counter and style rank (pure). The combo counts the player's landed hits without a gap longer than
 * STYLE.gap. The style score rises with variety (a technique other than the last few), air time (the hero or the
 * target airborne), kills, slams and perfect defences; it drains while nothing lands and drops hard when the
 * player is hit. Ranks are thresholds on the score. Each rank reached for the first time in a combo pays a little
 * Surge. No allocation after creation: the engine calls these from the step path.
 * @module combat/logic/style
 */

/** Tuning of the combo and the style rank. */
export const STYLE = Object.freeze({
  /** Seconds between two landed hits that keep the combo alive. */
  gap: 2.0,
  /** Score thresholds of ranks 1..5 (rank 0 below the first). */
  ranks: Object.freeze([6, 15, 28, 45, 66]),
  /** Rank ids (i18n `combat.rank.<id>`), index = rank - 1. */
  rankIds: Object.freeze(['glint', 'gleam', 'blaze', 'radiant', 'dawn']),
  /** Points of one landed hit before multipliers. */
  hit: 1,
  /** A technique not among the last `memory` landed techniques multiplies the hit by `fresh`. */
  memory: 3,
  fresh: 2.5,
  /** The same technique landing more than `repeatFrom` times in a row is worth `repeat`. */
  repeatFrom: 6,
  repeat: 0.35,
  /** Multipliers when the hero is airborne and when the target is airborne (juggles). */
  heroAir: 1.5,
  targetAir: 1.3,
  /** Flat points. */
  kill: 3,
  slam: 4,
  perfect: 6,
  /** Score drained per second once `drainAfter` seconds passed without a landed hit. */
  drainAfter: 1.2,
  drain: 6,
  /** Being hit keeps this fraction of the score and drops at least one rank. */
  hurtKeep: 0.45,
  /** Surge paid the first time a combo reaches a rank: `surgePerRank` x rank. */
  surgePerRank: 1.5,
  /** Score cap (a little above the top rank). */
  max: 80,
});

/** Technique ids are interned to small integers so the memory ring holds numbers. */
const IDS = new Map();
/** @param {string|null} id @returns {number} */
function intern(id) {
  if (!id) return 0;
  let n = IDS.get(id);
  if (n === undefined) {
    n = IDS.size + 1;
    IDS.set(id, n);
  }
  return n;
}

/**
 * @typedef {{ count:number, gapT:number, idleT:number, score:number, rank:number, paid:number, ring:Int32Array,
 *   ringN:number, last:number, sameRun:number, best:number }} StyleState
 */

/** @returns {StyleState} */
export function createStyle() {
  return { count: 0, gapT: 0, idleT: 0, score: 0, rank: 0, paid: 0, ring: new Int32Array(STYLE.memory), ringN: 0, last: 0, sameRun: 0, best: 0 };
}

/** @param {StyleState} s */
export function resetStyle(s) {
  s.count = 0; s.gapT = 0; s.idleT = 0; s.score = 0; s.rank = 0; s.paid = 0; s.ringN = 0; s.last = 0; s.sameRun = 0;
  s.ring.fill(0);
}

/** Rank for a score. @param {number} score @returns {number} 0..5 */
export function rankOf(score) {
  const r = STYLE.ranks;
  let k = 0;
  while (k < r.length && score >= r[k]) k++;
  return k;
}

/**
 * Raise the score; returns the Surge earned by a rank reached for the first time in this combo.
 * @param {StyleState} s @param {number} pts
 * @returns {number}
 */
function gain(s, pts) {
  s.score = Math.min(STYLE.max, s.score + pts);
  s.rank = rankOf(s.score);
  let surge = 0;
  while (s.paid < s.rank) {
    s.paid++;
    surge += STYLE.surgePerRank * s.paid;
  }
  return surge;
}

/**
 * A player hit landed (amount > 0).
 * @param {StyleState} s @param {string|null} techId @param {boolean} heroAir @param {boolean} targetAir
 * @returns {number} Surge earned
 */
export function styleHit(s, techId, heroAir, targetAir) {
  s.count = s.gapT > 0 ? s.count + 1 : 1;
  if (s.count === 1 && s.score <= 0) s.paid = 0;
  s.gapT = STYLE.gap;
  s.idleT = 0;
  if (s.count > s.best) s.best = s.count;
  const id = intern(techId);
  let mult = 1;
  let seen = false;
  for (let i = 0; i < s.ringN; i++) if (s.ring[i] === id) seen = true;
  if (id !== s.last) {
    s.sameRun = 1;
    // Only a change of technique remembers the new one: a long string does not flush the memory.
    if (!seen) mult = STYLE.fresh;
    for (let i = s.ring.length - 1; i > 0; i--) s.ring[i] = s.ring[i - 1];
    s.ring[0] = id;
    if (s.ringN < s.ring.length) s.ringN++;
    s.last = id;
  } else {
    s.sameRun++;
    if (s.sameRun > STYLE.repeatFrom) mult = STYLE.repeat;
  }
  if (heroAir) mult *= STYLE.heroAir;
  if (targetAir) mult *= STYLE.targetAir;
  return gain(s, STYLE.hit * mult);
}

/**
 * A flat bonus (kill, slam, perfect defence). Keeps the combo alive.
 * @param {StyleState} s @param {number} pts @returns {number} Surge earned
 */
export function styleBonus(s, pts) {
  s.idleT = 0;
  if (s.gapT > 0) s.gapT = STYLE.gap;
  return gain(s, pts);
}

/**
 * The player was hit: the rank drops.
 * @param {StyleState} s
 * @returns {boolean} true when the rank changed
 */
export function styleHurt(s) {
  const before = s.rank;
  if (s.score <= 0) return false;
  let score = s.score * STYLE.hurtKeep;
  if (before > 0) {
    const floor = before >= 2 ? STYLE.ranks[before - 2] : 0;
    const cap = STYLE.ranks[before - 1] - 0.01;
    score = Math.min(score, cap);
    if (score < floor) score = floor;
  }
  s.score = score;
  s.rank = rankOf(score);
  if (s.paid > s.rank) s.paid = s.rank;
  return s.rank !== before;
}

/**
 * Advance timers.
 * @param {StyleState} s @param {number} dt
 * @returns {number} bit 1: the combo expired this step; bit 2: the rank changed
 */
export function styleStep(s, dt) {
  let out = 0;
  if (s.gapT > 0) {
    s.gapT -= dt;
    if (s.gapT <= 0) {
      s.gapT = 0;
      if (s.count > 0) out |= 1;
    }
  }
  s.idleT += dt;
  if (s.idleT > STYLE.drainAfter && s.score > 0) {
    const before = s.rank;
    s.score = Math.max(0, s.score - STYLE.drain * dt);
    s.rank = rankOf(s.score);
    if (s.rank !== before) out |= 2;
    if (s.score <= 0) {
      s.paid = 0;
      s.ringN = 0;
      s.last = 0;
      s.sameRun = 0;
    }
  }
  return out;
}
