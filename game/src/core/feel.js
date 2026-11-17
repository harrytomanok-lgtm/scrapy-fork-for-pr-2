/**
 * The game feel table (ART_UX section 4). `ctx.fx.impact(classId)` applies one row.
 * Pure data module.
 * @module core/feel
 */

/**
 * @typedef {object} FeelRow
 * @property {number} hitStop       milliseconds of gameplay freeze (time.hitStop)
 * @property {number} shake         trauma added to the camera (cam.shake), before the shake setting
 * @property {number} fov           FOV kick in degrees (peak); negative narrows
 * @property {number} fovSeconds    duration of the kick and its return (cam.fovKick seconds)
 * @property {boolean} fovHold      true: the kick is held until released with fovKick(0, s) (boost, beam)
 * @property {number} fovSettle     degrees a held kick settles to after the peak (0 = stays at `fov`)
 * @property {number} slowScale     gameplay time scale of the slow motion (1 = none)
 * @property {number} slowSeconds   seconds of unscaled sim time the slow motion lasts (0 = none)
 * @property {number|number[]} vibrate  navigator.vibrate argument: milliseconds or a pattern; 0 = none
 * @property {[number, number, number]} rumble  gamepad [strong, weak, ms] (P1: input.rumble is a no-op in P0)
 */

/** @param {object} o @returns {object} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/**
 * @param {number} hitStop @param {number} shake @param {number} fov @param {number} fovSeconds
 * @param {number} slowScale @param {number} slowSeconds @param {number|number[]} vibrate
 * @param {[number, number, number]} rumble @param {boolean} [fovHold] @param {number} [fovSettle]
 * @returns {FeelRow}
 */
function row(hitStop, shake, fov, fovSeconds, slowScale, slowSeconds, vibrate, rumble, fovHold = false, fovSettle = 0) {
  return { hitStop, shake, fov, fovSeconds, fovHold, fovSettle, slowScale, slowSeconds, vibrate, rumble };
}

/** Default FOV kick duration (seconds) where the table names no duration. */
const KICK = 0.25;

/** @type {Readonly<Record<string, FeelRow>>} */
export const FEEL = deepFreeze({
  lightHit: row(45, 0.08, 0, 0, 1, 0, 10, [0, 0.3, 60]),
  heavyHit: row(90, 0.20, -2, KICK, 1, 0, 25, [0.5, 0.2, 120]),
  finisher: row(140, 0.35, -4, KICK, 0.5, 0.2, 40, [0.8, 0.3, 180]),
  boltHit: row(0, 0.03, 0, 0, 1, 0, 0, [0, 0.15, 40]),
  beamTick: row(0, 0.06, 6, KICK, 1, 0, 15, [0.6, 0.6, 100], true),
  burst: row(60, 0.30, 5, KICK, 1, 0, 35, [0.7, 0.3, 200]),
  ultimate: row(200, 0.80, 12, 0.6, 0.35, 1.0, [60, 40, 90], [1.0, 1.0, 500]),
  hurtLight: row(40, 0.12, 0, 0, 1, 0, 15, [0, 0.4, 80]),
  hurtHeavy: row(100, 0.40, -3, KICK, 1, 0, 50, [0.9, 0.4, 250]),
  perfectGuard: row(120, 0.10, -2, KICK, 0.6, 0.25, 20, [0, 0.6, 80]),
  perfectFlicker: row(0, 0, 4, KICK, 0.4, 0.5, 8, [0, 0.2, 40]),
  flicker: row(0, 0.03, 3, KICK, 1, 0, 0, [0, 0.2, 40]),
  boostStart: row(0, 0.05, 8, KICK, 1, 0, 0, [0, 0.2, 60], true),
  sonicBoom: row(0, 0.25, 14, KICK, 1, 0, 30, [0.6, 0.3, 150], true, 10),
  wallSlam: row(70, 0.25, 0, 0, 1, 0, 20, [0.4, 0.2, 100]),
  transform: row(0, 0.60, 10, KICK, 0.1, 0.9, [30, 30, 80], [1.0, 0.6, 400]),
  bossDeath: row(300, 0.70, 8, KICK, 0.25, 2.0, [80, 60, 120], [1.0, 1.0, 800]),
  levelUp: row(0, 0.10, 3, KICK, 0.5, 0.3, 20, [0, 0.5, 200]),
  landHeavy: row(0, 0.15, 0, 0, 1, 0, 15, [0.3, 0.1, 80]),
  craterBig: row(0, 0.45, 4, KICK, 1, 0, 40, [0.8, 0.4, 250]),
});

/**
 * Rules around the table (ART_UX section 4 and ARCHITECTURE 4.15).
 * shake: trauma-squared shake with max offset (m), max roll (deg) and decay (trauma per s).
 * reducedMotion: multipliers applied to shake and FOV kicks when Reduced Motion is on.
 * hurtHeavyFraction: a hit on the player of at least this fraction of hpMax uses `hurtHeavy`.
 * landHeavySpeed: player landing speed (m/s) above which `landHeavy` plays.
 * craterBigRadius: crater radius (m) at or above which `craterBig` plays.
 */
export const FEEL_RULES = deepFreeze({
  shake: { maxOffset: 0.6, maxRollDeg: 3, decay: 1.4 },
  reducedMotion: { shake: 0.25, fov: 0.3 },
  hurtHeavyFraction: 0.15,
  landHeavySpeed: 20,
  craterBigRadius: 10,
});
