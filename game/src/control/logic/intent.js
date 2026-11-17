/**
 * Player intent (ARCHITECTURE 4.6 "Player intent"): camera-relative stick, jump and take-off, ascend and descend,
 * sprint and boost from a `dash` hold of 0.2 s or more, the touch boost latch and camera-pitch flight.
 * Pure: the control.player system fills an IntentInput from ctx.input and the camera each tick.
 * @module control/logic/intent
 */

/** A `dash` hold of at least this long sets sprint (s). */
export const SPRINT_HOLD = 0.2;
/** A second `dash` press within this window latches boost on touch (s). */
export const LATCH_WINDOW = 0.3;
/** Stick magnitude under which the stick counts as neutral. */
export const STICK_NEUTRAL = 0.12;

/**
 * @typedef {{ ax:number, ay:number, dashDown:boolean, dashHeld:number, dashPressed:boolean, jumpPressed:boolean,
 *   jumpDown:boolean, descendDown:boolean, touch:boolean, pitchFlight:boolean, flying:boolean, t:number,
 *   fwdX:number, fwdZ:number, rightX:number, rightZ:number, pitch:number }} IntentInput
 *   ax, ay: stick (-1..1, ay forward); t: sim seconds; fwd/right: horizontal camera basis; pitch: camera pitch (rad, + up).
 */

/** @returns {IntentInput} */
export function createIntentInput() {
  return {
    ax: 0, ay: 0, dashDown: false, dashHeld: 0, dashPressed: false, jumpPressed: false, jumpDown: false, descendDown: false,
    touch: false, pitchFlight: false, flying: false, t: 0, fwdX: 0, fwdZ: 1, rightX: -1, rightZ: 0, pitch: 0,
  };
}

/** Latch state. @returns {{ on:boolean, armed:boolean, lastPress:number }} */
export function createLatch() {
  return { on: false, armed: false, lastPress: -1000 };
}

/** @param {{ on:boolean, armed:boolean, lastPress:number }} l */
export function resetLatch(l) {
  l.on = false;
  l.armed = false;
  l.lastPress = -1000;
}

/**
 * Compute the player's intent for this tick.
 * @param {IntentInput} inp
 * @param {{ on:boolean, armed:boolean, lastPress:number }} latch mutated
 * @param {{ mx:number, mz:number, up:number, jump:boolean, sprint:boolean, flyToggle:boolean, faceYaw:number|null }} out intent (mutated)
 */
export function computeIntent(inp, latch, out) {
  const ax = inp.ax;
  const ay = inp.ay;
  const stick = Math.sqrt(ax * ax + ay * ay);
  let mx = inp.fwdX * ay + inp.rightX * ax;
  let mz = inp.fwdZ * ay + inp.rightZ * ax;

  // Touch boost latch: a second Dash press within the window latches sprint until the stick returns to neutral
  // (after it was deflected) or Dash is pressed again. The press itself still belongs to combat (Flicker Step).
  if (inp.dashPressed) {
    if (latch.on) {
      latch.on = false;
      latch.lastPress = -1000;
    } else if (inp.touch && inp.t - latch.lastPress <= LATCH_WINDOW + 1e-9) {
      latch.on = true;
      latch.armed = stick > STICK_NEUTRAL;
      latch.lastPress = -1000;
    } else {
      latch.lastPress = inp.t;
    }
  }
  if (latch.on) {
    if (stick > STICK_NEUTRAL) latch.armed = true;
    else if (latch.armed) latch.on = false;
  }

  const buttons = (inp.jumpDown ? 1 : 0) - (inp.descendDown ? 1 : 0);
  let up = buttons;
  if (inp.flying && inp.pitchFlight) {
    // Camera-pitch flight: the stick's forward amount flies along the view direction, pitch included.
    const sp = Math.sin(inp.pitch);
    const cp = Math.cos(inp.pitch);
    up = sp * ay + buttons;
    if (up > 1) up = 1;
    else if (up < -1) up = -1;
    // Only the forward component tilts; strafing stays level.
    const fx = inp.fwdX * ay * cp + inp.rightX * ax;
    const fz = inp.fwdZ * ay * cp + inp.rightZ * ax;
    mx = fx;
    mz = fz;
  }
  out.mx = mx;
  out.mz = mz;
  out.up = up;
  out.jump = out.jump || inp.jumpPressed;
  out.sprint = (inp.dashDown && inp.dashHeld >= SPRINT_HOLD - 1e-9) || latch.on;
  out.faceYaw = null;
  return out;
}
