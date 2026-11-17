/**
 * The full gamepad source (ARCHITECTURE 4.8, ART_UX 6.5), registered as input source 'pad' in place of the
 * foundation's basic one. Standard mapping: face buttons with the LT modifier (LT+X Tech 1, LT+Y Tech 2, LT+A Form,
 * LT+B Ultimate), shoulders, analog RT for Descend, R3 lock-on, a right-stick flick while locked switches target
 * (and does not turn the camera), D-pad, View and Menu, a 0.18 radial dead zone with rescale on both sticks and a
 * response curve on the camera stick, and the UI navigation mapping. `navigator.getGamepads` is called inside
 * try/catch; if it throws or is missing, the source turns itself off and pad glyphs are never shown.
 * @module control/pad
 */

import { ACTIONS, PAD, PAD_BINDINGS } from '../core/actions.js';
import { PAD_DEAD_ZONE, PAD_LOOK_DEG_PER_S } from '../core/constants.js';

const ID = 'pad';
const NA = ACTIONS.length;
const FLICK_ON = 0.75;
const FLICK_OFF = 0.35;
const TRIGGER = 0.35;

/**
 * @param {any} ctx
 * @returns {{ poll:(input:any, dt:number)=>void, dispose:()=>void }}
 */
export function createPad(ctx) {
  const index = new Map(ACTIONS.map((a, i) => [a, i]));
  const managed = new Uint8Array(NA);
  for (const b of PAD_BINDINGS) managed[index.get(b[1])] = 1;
  managed[index.get('lockNext')] = 1;
  managed[index.get('lockPrev')] = 1;
  const want = new Uint8Array(NA);
  const cur = new Uint8Array(NA);
  const stick = new Float64Array(2);
  const iLockNext = index.get('lockNext');
  const iLockPrev = index.get('lockPrev');
  const iDescend = index.get('descend');
  let off = false;
  let active = false;
  let flickArmed = true;

  /** @param {any} pad @param {number} i */
  function btn(pad, i) {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  }

  /** @param {any} inp */
  function releaseAll(inp) {
    for (let i = 0; i < NA; i++) {
      if (cur[i]) inp.setButton(ACTIONS[i], false, ID);
      cur[i] = 0;
    }
    inp.setAxis('moveX', 0, ID);
    inp.setAxis('moveY', 0, ID);
    active = false;
  }

  /** Radial dead zone with rescale into `stick`. @param {number} x @param {number} y */
  function deadZone(x, y) {
    const m = Math.sqrt(x * x + y * y);
    if (m < PAD_DEAD_ZONE) {
      stick[0] = 0;
      stick[1] = 0;
      return 0;
    }
    const n = Math.min(1, (m - PAD_DEAD_ZONE) / (1 - PAD_DEAD_ZONE));
    stick[0] = (x / m) * n;
    stick[1] = (y / m) * n;
    return n;
  }

  return {
    /** @param {any} inp @param {number} dt */
    poll(inp, dt) {
      if (off) return;
      let pads = null;
      try {
        if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') throw new Error('no Gamepad API');
        pads = navigator.getGamepads();
      } catch (err) {
        off = true;
        inp.padAvailable = false;
        releaseAll(inp);
        return;
      }
      let pad = null;
      if (pads) {
        for (let i = 0; i < pads.length; i++) {
          const p = pads[i];
          if (p && p.connected && p.mapping === 'standard') {
            pad = p;
            break;
          }
        }
      }
      if (!pad) {
        if (active) releaseAll(inp);
        return;
      }
      active = true;
      const lt = btn(pad, PAD.LT);
      want.fill(0);
      for (let i = 0; i < PAD_BINDINGS.length; i++) {
        const b = PAD_BINDINGS[i];
        if (b[1] === 'descend') continue;
        if (!btn(pad, b[0])) continue;
        if (b[2] === 2 || (b[2] === 0 && !lt) || (b[2] === 1 && lt)) want[index.get(b[1])] = 1;
      }
      // Analog RT: Descend from a light squeeze.
      const rt = pad.buttons[PAD.RT];
      if (rt && (rt.pressed || rt.value > TRIGGER)) want[iDescend] = 1;
      // Right stick: camera, or a flick to switch target while locked.
      const ax = pad.axes;
      const rx = ax[2] || 0;
      const ry = ax[3] || 0;
      const combat = ctx.combat;
      const locked = !!(combat && typeof combat.target === 'function' && combat.target());
      let flicked = false;
      if (locked) {
        if (flickArmed && Math.abs(rx) > FLICK_ON && Math.abs(ry) < 0.6) {
          want[rx > 0 ? iLockNext : iLockPrev] = 1;
          flickArmed = false;
          flicked = true;
        } else if (Math.abs(rx) < FLICK_OFF) {
          flickArmed = true;
        }
        if (!flickArmed) flicked = true;
      } else {
        flickArmed = true;
      }
      for (let i = 0; i < NA; i++) {
        if (managed[i] === 0 || want[i] === cur[i]) continue;
        cur[i] = want[i];
        inp.setButton(ACTIONS[i], want[i] === 1, ID);
      }
      deadZone(ax[0] || 0, ax[1] || 0);
      inp.setAxis('moveX', stick[0], ID);
      inp.setAxis('moveY', -stick[1], ID);
      if (!flicked) {
        const n = deadZone(rx, ry);
        if (n > 0) {
          // Response curve: fine aim near the centre, full speed at the rim.
          const curve = (0.35 + 0.65 * n) * PAD_LOOK_DEG_PER_S * dt;
          inp.addLook(stick[0] * curve, -stick[1] * curve, ID);
        }
      }
    },
    dispose() {
      if (ctx.input) releaseAll(ctx.input);
    },
  };
}
