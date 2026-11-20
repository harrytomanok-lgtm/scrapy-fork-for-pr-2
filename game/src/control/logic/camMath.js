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
  /** Player body centre on screen measured from the bottom (0..1). */
  frameLandscape: 0.55,
  /**
   * Portrait: the body centre just under the middle, so the feet sit about 40% up from the bottom, just above the
   * control deck, with the horizon near the upper third (with portraitPitch). Was 0.62, which pulled the camera down
   * to about 0.5 m over the ground and filled the lower half with near ground under the touch controls.
   */
  framePortrait: 0.48,
  /** Portrait: the rest pitch of the ground modes (explore, combat, lock) is this much steeper (radians). */
  portraitPitch: -3 * D2R,
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
  /** Group combat: an enemy closer than flankRange (m) within flankAngle of the view centre is eased to the side. */
  flankRange: 9,
  flankAngle: 20 * D2R,
});

/**
 * Rest pitch of a mode in radians: the mode table's pitch, steepened in portrait for the ground modes.
 * @param {string} mode @param {boolean} portrait
 * @returns {number}
 */
export function restPitch(mode, portrait) {
  const row = CAM_MODES[mode] || CAM_MODES.explore;
  const ground = mode === 'explore' || mode === 'combat' || mode === 'lock';
  return row.pitch * D2R + (portrait && ground ? CAM.portraitPitch : 0);
}

/**
 * The at-rest follow framing of the rig in cam.js (no collision, no look-ahead), for tests and tuning: the camera
 * height above the feet, its horizontal distance, and where the feet, the head and the horizon land on screen
 * (fractions of the height measured from the bottom).
 * @param {string} mode @param {boolean} portrait @param {number} bodyH body height (m)
 * @returns {{ pitch:number, camHeight:number, camBack:number, feet:number, head:number, horizon:number }}
 */
export function restFraming(mode, portrait, bodyH) {
  const row = CAM_MODES[mode] || CAM_MODES.explore;
  const pitch = restPitch(mode, portrait);
  const dist = row.dist + (portrait ? CAM.portraitPullBack : 0);
  const pivotH = row.height + (portrait ? CAM.portraitRise : 0);
  const fov = portrait ? row.fovP : row.fovL;
  const frame = portrait ? CAM.framePortrait : CAM.frameLandscape;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const shift = frameShift(frame, dist, fov) - (pivotH - bodyH * 0.5) * cp;
  // camera relative to the feet, in the vertical plane of the view (forward horizontal, up)
  const camBack = dist * cp + sp * shift;
  const camHeight = pivotH - sp * dist + cp * shift;
  const t = Math.tan((fov * D2R) / 2);
  /** @param {number} y height of a point above the feet, straight ahead of the camera by camBack */
  const at = (y) => {
    const dy = y - camHeight;
    const fwd = camBack * cp + dy * sp;
    const upc = -camBack * sp + dy * cp;
    return 0.5 + 0.5 * (upc / fwd) / t;
  };
  return { pitch, camHeight, camBack, feet: at(0), head: at(bodyH), horizon: 0.5 + 0.5 * Math.tan(-pitch) / t };
}

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
  // Turn less when far apart (both already fit), more when close (so the player never hides the target): up to
  // 28 degrees at 2 m, 14 at 8 m, 8 at 34 m.
  const close = sep >= 8 ? 0 : (8 - (sep < 2 ? 2 : sep)) / 6;
  out.yaw = bearing + side * (14 - 6 * w + 14 * close) * D2R;
  out.blend = sep < 1 ? 0 : Math.min(0.4, 2.5 / sep + 0.15);
  return out;
}

/**
 * Render-time camera angle between the previous and the current sim step's angle (radians), the short way round:
 * the orbit turns in 60 Hz steps, and the frame pass shows it at `alpha` between them so dragging stays smooth at
 * any display rate and on frames that ran 0 or 2 steps.
 * @param {number} prev angle at the start of the last step @param {number} cur angle after it @param {number} alpha 0..1
 * @returns {number} in (-PI, PI]
 */
export function interpAngle(prev, cur, alpha) {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  let d = (cur - prev) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  let r = (prev + d * a) % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/**
 * Pitch for camera-pitch flight when the stick is idle: back to the rest pitch over about `seconds`.
 * @param {number} pitch @param {number} rest @param {number} seconds @param {number} dt
 */
export function easeToward(pitch, rest, seconds, dt) {
  const k = 1 - Math.exp((-3 / seconds) * dt);
  return pitch + (rest - pitch) * k;
}

/**
 * Lock-on readability band (screen fractions from the centre, + up): the locked target's body centre is kept
 * below `top` (the HUD target frame sits at the top centre) and above `bottom` (the hero and, in portrait, the
 * control deck fill the lower part).
 */
export const LOCK_BAND = Object.freeze({ top: 0.3, bottom: -0.3, topPortrait: 0.36, bottomPortrait: -0.12 });

/**
 * Pitch that keeps a point at elevation `elev` (radians, seen from the camera) inside the band [bottom, top] of a
 * view with vertical half-FOV `half`: the nearest pitch to `pitch` that does.
 * @param {number} pitch @param {number} elev @param {number} half @param {number} top @param {number} bottom
 * @returns {number}
 */
export function lockPitch(pitch, elev, half, top, bottom) {
  const th = Math.tan(half);
  // Screen offset y = tan(elev - pitch) / tan(half); solve for the pitch at both edges.
  const lo = elev - Math.atan(top * th);
  const hi = elev - Math.atan(bottom * th);
  return pitch < lo ? lo : pitch > hi ? hi : pitch;
}

/**
 * Lock-on safe area in screen units from the centre (v up, u right, -1..1 at the edges): everything of the hero and
 * the locked target stays inside it. `top` keeps clear of the HUD target frame, `bottom` of the touch deck (portrait:
 * it fills the lower quarter; landscape: it sits at the sides). `heroV` and `heroU` are where the hero's body centre
 * goes when nothing forces it elsewhere (portrait: the lower part of the middle third, just over the deck; the hero
 * on one side and the target toward the other).
 */
export const LOCK_SAFE = Object.freeze({
  portrait: { top: 0.62, bottom: -0.5, side: 0.8, heroV: -0.2, heroU: 0.12 },
  landscape: { top: 0.62, bottom: -0.8, side: 0.7, heroV: -0.28, heroU: 0.2 },
});

/** Lock rig search: the nearest back distance (m, before the portrait pull-back), the farthest, the step. */
const LOCK_B0 = 6;
const LOCK_BMAX = 60;
const LOCK_BSTEP = 0.5;
/** The lowest camera, in metres above the hero's feet. */
export const LOCK_CMIN = 0.6;
/** Camera heights tried at each distance, as offsets (m per m of back distance) around the preferred one. */
const LOCK_C_TRIES = Object.freeze([0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0]);

/**
 * Elevation of a point seen from the camera, in the vertical plane of the view (exact for a pinhole camera: the
 * point's sideways offset does not change its screen height).
 * @param {number} s forward distance along the view's heading @param {number} dy height above the camera
 */
function elev(s, dy) {
  return Math.atan2(dy, s);
}

/**
 * Lock-on rig: where the camera goes so that the hero and the locked target are both inside {@link LOCK_SAFE},
 * for any separation (2 m to 30 m and more) and height difference (a flyer above, an enemy below a ledge). The view
 * heading is `yaw` (from {@link lockFraming}); the camera sits `back` metres behind the hero's feet along it,
 * `height` metres above them and `lateral` metres to the right, and looks down at `pitch`. Pulls back only as far as
 * needed; `pitchLo`..`pitchHi` is the pitch range that keeps everything inside at that place (look input may nudge
 * within it). Positions are relative to the hero's feet; heights of the bodies in metres. No allocation.
 * @param {number} tdx @param {number} tdy @param {number} tdz target feet minus hero feet (m)
 * @param {number} heroH @param {number} targetH body heights (m) @param {number} yaw view heading (rad)
 * @param {number} side -1 or 1 (the target's side of the screen) @param {number} vfovDeg @param {number} aspect width / height
 * @param {{ back:number, height:number, lateral:number, pitch:number, pitchLo:number, pitchHi:number, fit:boolean }} out
 */
export function lockRig(tdx, tdy, tdz, heroH, targetH, yaw, side, vfovDeg, aspect, out) {
  const portrait = aspect < 1;
  const S = portrait ? LOCK_SAFE.portrait : LOCK_SAFE.landscape;
  const tv = Math.tan((vfovDeg * D2R) / 2);
  const th = tv * aspect;
  const aTop = Math.atan(S.top * tv);
  const aBot = Math.atan(S.bottom * tv);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Screen right is (-cos yaw, 0, sin yaw) for a camera looking along (sin yaw, ., cos yaw).
  const ts = tdx * fx + tdz * fz;
  const tl = -tdx * fz + tdz * fx;
  const rest = restPitch('lock', portrait);
  const hc = heroH * 0.5;
  const heroU = -side * S.heroU;
  for (let B = LOCK_B0 + (portrait ? CAM.portraitPullBack : 0); B <= LOCK_BMAX; B += LOCK_BSTEP) {
    // Preferred camera height: the hero's body centre at heroV with the rest pitch.
    const eH = rest + Math.atan(S.heroV * tv);
    const c0 = hc - B * Math.tan(eH);
    for (let k = 0; k < LOCK_C_TRIES.length; k++) {
      // Never under the hero's feet (the ground is there): a flyer high above is framed from farther back instead.
      const C = Math.max(LOCK_CMIN, c0 + LOCK_C_TRIES[k] * B);
      const st = ts + B;
      if (st < 0.5) continue;
      // The pitch range that keeps all four points (feet and head of both) between the bottom and top edges.
      let lo = -1e9;
      let hi = 1e9;
      const e1 = elev(B, -C);
      const e2 = elev(B, heroH - C);
      const e3 = elev(st, tdy - C);
      const e4 = elev(st, tdy + targetH - C);
      lo = Math.max(lo, e1 - aTop, e2 - aTop, e3 - aTop, e4 - aTop);
      hi = Math.min(hi, e1 - aBot, e2 - aBot, e3 - aBot, e4 - aBot);
      if (lo > hi) continue;
      // Prefer the hero at heroV, else the rest pitch, inside the range.
      const want = elev(B, hc - C) - Math.atan(S.heroV * tv);
      const pitch = want < lo ? lo : want > hi ? hi : want;
      if (pitch < CAM.pitchMin || pitch > CAM.pitchMax) continue;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // Sideways: the hero toward its side (the camera shifts the other way), and the target must fit too.
      const dH = B * cp + (hc - C) * sp;
      const lateral = -heroU * dH * th;
      const dT = st * cp + (tdy + targetH * 0.5 - C) * sp;
      if (dT < 0.5) continue;
      const uT = (tl - lateral) / (dT * th);
      const uH = (0 - lateral) / (dH * th);
      if (Math.abs(uT) > S.side || Math.abs(uH) > S.side) continue;
      out.back = B;
      out.height = C;
      out.lateral = lateral;
      out.pitch = pitch;
      out.pitchLo = lo;
      out.pitchHi = hi;
      out.fit = true;
      return out;
    }
  }
  // Nothing fits (a target far out of reach): the farthest place, looking between them.
  const B = LOCK_BMAX;
  out.back = B;
  out.height = Math.max(LOCK_CMIN, hc + tdy * 0.5);
  out.lateral = 0;
  out.pitch = elev(ts + B, tdy * 0.5 - out.height + hc);
  out.pitchLo = out.pitch;
  out.pitchHi = out.pitch;
  out.fit = false;
  return out;
}

/**
 * Where a point lands on screen for the camera of {@link lockRig} (tests): u right and v up, -1..1 at the edges.
 * @param {{ back:number, height:number, lateral:number }} rig @param {number} pitch @param {number} yaw
 * @param {number} x @param {number} y @param {number} z the point relative to the hero's feet
 * @param {number} vfovDeg @param {number} aspect @param {{ u:number, v:number, depth:number }} out
 */
export function lockProject(rig, pitch, yaw, x, y, z, vfovDeg, aspect, out) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const s = x * fx + z * fz + rig.back;
  const l = -x * fz + z * fx - rig.lateral;
  const dy = y - rig.height;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const depth = s * cp + dy * sp;
  const upc = -s * sp + dy * cp;
  const tv = Math.tan((vfovDeg * D2R) / 2);
  out.depth = depth;
  out.v = upc / (depth * tv);
  out.u = l / (depth * tv * aspect);
  return out;
}

/**
 * Auto-recentre step (radians this tick): eases in over `ramp` seconds once the idle delay has passed and slows
 * within 25 degrees of the heading, so it never starts or stops with a jerk.
 * @param {number} delta signed angle still to turn @param {number} rate max rad/s
 * @param {number} sinceDelay idle seconds past the delay @param {number} dt @param {number} [ramp]
 * @returns {number}
 */
export function recentreStep(delta, rate, sinceDelay, dt, ramp = 0.6) {
  if (!(sinceDelay > 0)) return 0;
  const u = sinceDelay >= ramp ? 1 : sinceDelay / ramp;
  const ease = u * u * (3 - 2 * u);
  const ad = Math.abs(delta);
  const near = ad < 0.436 ? Math.max(0.2, ad / 0.436) : 1;
  const step = rate * ease * near * dt;
  return ad <= step ? delta : delta > 0 ? step : -step;
}
