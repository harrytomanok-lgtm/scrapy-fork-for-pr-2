/**
 * Camera math (ART_UX 5): the mode table, critically damped springs, shake noise, FOV kick envelope, framing
 * offsets and lock-on framing. Pure: no three, no DOM.
 * @module control/logic/camMath
 */

const D2R = Math.PI / 180;

/**
 * ART_UX 5 mode table. dist m, height m, pitch deg, fov landscape, fov portrait.
 * @type {Readonly<Record<string, { dist:number, height:number, pitch:number, fovL:number, fovP:number }>>}
 */
export const CAM_MODES = Object.freeze({
  explore: { dist: 5.5, height: 1.6, pitch: -12, fovL: 60, fovP: 72 },
  flight: { dist: 7.5, height: 1.2, pitch: -6, fovL: 66, fovP: 78 },
  boost: { dist: 9, height: 1.0, pitch: -6, fovL: 76, fovP: 88 },
  lock: { dist: 6.5, height: 1.8, pitch: -15, fovL: 62, fovP: 74 },
  combat: { dist: 7, height: 2.0, pitch: -15, fovL: 64, fovP: 76 },
  dialogue: { dist: 2.2, height: 1.6, pitch: 0, fovL: 40, fovP: 40 },
  cinematic: { dist: 6, height: 1.6, pitch: -10, fovL: 50, fovP: 50 },
});

/** Camera tunables of ART_UX 5. */
export const CAM = Object.freeze({
  pitchMin: -70 * D2R,
  pitchMax: 70 * D2R,
  recentreDelay: 1.5,
  recentreDelayTouch: 1.0,
  recentreRate: 70 * D2R,
  lookAhead: 2,
  portraitRise: 0.6,
  portraitPullBack: 1.5,
  /** Player height on screen measured from the bottom (0..1). */
  frameLandscape: 0.55,
  framePortrait: 0.62,
  flightRoll: 6 * D2R,
  boostLag: 0.12,
  lockMaxDist: 14,
  lockEase: 0.25,
  levelMagnet: 8 * D2R,
  flightPitchRest: -6 * D2R,
  flightPitchReturn: 1.5,
  collideRadius: 0.3,
  minDist: 1.2,
  traumaDecay: 1.4,
  shakeMetres: 0.45,
  shakeRollDeg: 2.5,
  threatOffscreen: 1.0,
});

/**
 * Critically damped spring toward `target` (exact for constant targets, frame-rate independent).
 * @param {{ x:number, v:number }} s state (mutated) @param {number} target @param {number} omega stiffness (1/s) @param {number} dt
 * @returns {number} the new value
 */
export function spring(s, target, omega, dt) {
  if (dt <= 0) return s.x;
  const e = Math.exp(-omega * dt);
  const change = s.x - target;
  const temp = (s.v + omega * change) * dt;
  s.v = (s.v - omega * temp) * e;
  s.x = target + (change + temp) * e;
  return s.x;
}

/**
 * Spring on an angle: the target is unwrapped next to the current value so it always takes the short way.
 * @param {{ x:number, v:number }} s @param {number} target @param {number} omega @param {number} dt
 */
export function springAngle(s, target, omega, dt) {
  let d = target - s.x;
  d = d - Math.PI * 2 * Math.floor((d + Math.PI) / (Math.PI * 2));
  return spring(s, s.x + d, omega, dt);
}

/**
 * Smooth pseudo-noise in -1..1 (sum of incommensurate sines), deterministic in t.
 * @param {number} t @param {number} seed
 */
export function noise1(t, seed) {
  return (Math.sin(t * 1.7 + seed * 12.9898) * 0.5 + Math.sin(t * 3.1 + seed * 78.233) * 0.3 + Math.sin(t * 5.3 + seed * 37.719) * 0.2);
}

/**
 * FOV kick envelope: 60 ms attack, then linear release over `dur` (or held at the peak).
 * @param {number} peak deg @param {number} elapsed s @param {number} dur s @param {boolean} hold
 */
export function kickEnvelope(peak, elapsed, dur, hold) {
  if (peak === 0 || elapsed < 0) return 0;
  const attack = 0.06;
  if (elapsed < attack) return peak * (elapsed / attack);
  if (hold) return peak;
  const k = 1 - (elapsed - attack) / (dur > 0.01 ? dur : 0.01);
  return k > 0 ? peak * k : 0;
}

/**
 * Vertical shift of the camera along its up axis that puts the pivot at `frame` of the screen height measured
 * from the bottom (0.5 = centre). Negative values move the camera down.
 * @param {number} frame 0..1 @param {number} dist m @param {number} fovDeg vertical FOV
 */
export function frameShift(frame, dist, fovDeg) {
  const ndc = frame * 2 - 1;
  return -ndc * dist * Math.tan((fovDeg * D2R) / 2);
}

/**
 * Horizontal FOV in radians from the vertical FOV and the aspect.
 * @param {number} fovDeg @param {number} aspect
 */
export function horizontalFov(fovDeg, aspect) {
  return 2 * Math.atan(Math.tan((fovDeg * D2R) / 2) * aspect);
}

/**
 * Lock-on framing: the orbit yaw, distance and pivot blend for a player at (px,pz) and a target at (tx,tz).
 * The camera sits behind the player looking toward the target, turned by `sideAngle` so the player stands on one
 * third and the target on the opposite third; the distance widens from 6.5 m to 14 m with separation.
 * @param {number} px @param {number} pz @param {number} tx @param {number} tz @param {number} side -1 or 1
 * @param {boolean} portrait
 * @param {{ yaw:number, dist:number, blend:number }} out
 */
export function lockFraming(px, pz, tx, tz, side, portrait, out) {
  const dx = tx - px;
  const dz = tz - pz;
  const sep = Math.sqrt(dx * dx + dz * dz);
  const bearing = Math.atan2(dx, dz);
  const base = CAM_MODES.lock.dist + (portrait ? CAM.portraitPullBack : 0);
  const w = sep <= 4 ? 0 : sep >= 34 ? 1 : (sep - 4) / 30;
  out.dist = base + w * (CAM.lockMaxDist - CAM_MODES.lock.dist);
  // Turn less when far apart (both already fit), more when close (so the player never hides the target).
  out.yaw = bearing + side * (14 - 6 * w) * D2R;
  out.blend = sep < 1 ? 0 : Math.min(0.4, 2.5 / sep + 0.15);
  return out;
}

/**
 * Pitch for camera-pitch flight when the stick is idle: back to the rest pitch over about `seconds`.
 * @param {number} pitch @param {number} rest @param {number} seconds @param {number} dt
 */
export function easeToward(pitch, rest, seconds, dt) {
  const k = 1 - Math.exp((-3 / seconds) * dt);
  return pitch + (rest - pitch) * k;
}
