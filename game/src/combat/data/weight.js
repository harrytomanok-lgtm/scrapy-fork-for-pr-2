/**
 * The weight of a hit, as one table (combat's side of the game feel). The core feel table (core/feel.js, ART_UX 4)
 * gives every damage class its hit-stop, shake, FOV kick and slow motion through `ctx.fx.impact`; combat chooses
 * the class of each hit (technique data) and adds what the core table cannot know: the haptic pattern, how hard
 * the struck body flinches and is shoved, the camera jolt and the input softness when the hero is hurt, and the
 * grace that keeps the hero out of stun-locks.
 *
 * Classes per hit (technique data):
 *   Strike String 1-3 lightHit (45 ms) | 4 heavyHit (90 ms) | 5 finisher (140 ms, push 10 m/s)
 *   Breaker launch and smash, Meteor Heel spike: finisher | Ora Bolt boltHit (no stop) | Dawn Lance beamTick
 *   Nova Ring burst | Ringfall heavyHit per target + one ultimate | enemy hits: hurtLight / hurtHeavy (core)
 *   Slams into scenery: wallSlam (70 ms). A kill by the player is at least heavyHit.
 * Hit-stop per String (1.4 s): 45 + 45 + 45 + 90 + 140 = 365 ms, the heavy beats on the last two hits only.
 * @module combat/data/weight
 */

/** navigator.vibrate patterns (ms on, off, on ...). Distinct rhythms, short enough to never blur together. */
export const HAPTICS = Object.freeze({
  /** One crisp tick. */
  light: Object.freeze([9]),
  /** A thump with a short echo. */
  heavy: Object.freeze([20, 28, 12]),
  /** A rolling rumble (slams, craters, launches and finishers). */
  slam: Object.freeze([36, 20, 26, 20, 14]),
  /** A long jolt with an aftershock (the hero is hurt). */
  hurt: Object.freeze([44, 34, 22]),
  /** Two bright taps and a hold (perfect guard and perfect Flicker). */
  perfect: Object.freeze([8, 44, 8, 44, 30]),
});

/**
 * Per damage class: `haptic` (a HAPTICS key or '' for none; the hero's own hits), `flinch` (actors.flinch
 * strength of the struck body), `shove` (m/s pushed into a grounded grunt that is not knocked).
 */
export const WEIGHT = Object.freeze({
  lightHit: Object.freeze({ haptic: 'light', flinch: 0.45, shove: 1.6 }),
  heavyHit: Object.freeze({ haptic: 'heavy', flinch: 0.9, shove: 2.8 }),
  finisher: Object.freeze({ haptic: 'slam', flinch: 1.0, shove: 0 }),
  boltHit: Object.freeze({ haptic: '', flinch: 0.35, shove: 0.9 }),
  beamTick: Object.freeze({ haptic: '', flinch: 0.25, shove: 0 }),
  burst: Object.freeze({ haptic: 'heavy', flinch: 1.0, shove: 0 }),
  ultimate: Object.freeze({ haptic: 'slam', flinch: 1.0, shove: 0 }),
  wallSlam: Object.freeze({ haptic: 'slam', flinch: 1.0, shove: 0 }),
});

/** The hero being hit. */
export const HURT = Object.freeze({
  /** Camera jolt (m) along the hit direction for a light and a heavy hit (heavy = at least 15% of max HP). */
  joltLight: 0.12,
  joltHeavy: 0.24,
  heavyFraction: 0.15,
  /** Input softness: movement at `softSlow` of its speed for `softSeconds` (only when nothing else holds it). */
  softSeconds: 0.2,
  softSlow: 0.55,
  /**
   * Stun-lock guard: after a knock or a stagger the hero keeps control for `graceSeconds` more (knocks only push,
   * red and violet hits do not stagger again). The longest loss of control is the guard break (1 s).
   */
  graceSeconds: 0.7,
});
