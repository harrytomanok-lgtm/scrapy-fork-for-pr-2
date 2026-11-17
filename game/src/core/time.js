/**
 * The deterministic sim clock `ctx.time` (ARCHITECTURE 3.2): tick count, gameplay time,
 * hit-stop, slow motion and pause reasons. It never reads a wall clock.
 * @module core/time
 */

import { SIM_DT, SIM_HZ, TICK_MS } from './constants.js';

/** Concurrent slow-motion requests tracked at once; a new one beyond this replaces the one ending first. */
const SLOW_SLOTS = 8;

/**
 * @typedef {object} Time
 * @property {number} tick     Number of sim steps run.
 * @property {number} now      Seconds of gameplay time (advances by SIM_DT * scale, not during hit-stop).
 * @property {number} real     Seconds of unscaled sim time (tick * SIM_DT).
 * @property {number} scale    Current gameplay time scale (1 normally): base scale times the lowest active slow-mo.
 * @property {boolean} frozen  True while hit-stop ticks remain.
 * @property {boolean} paused  True while any pause reason is active.
 * @property {(ms:number) => void} hitStop
 *   Freeze the gameplay phases for round(ms / 16.667) ticks, starting with the next step. Calls do not stack; the longer remaining wins.
 * @property {(scale:number, seconds:number) => void} slowMo
 *   Gameplay dt *= scale for `seconds` of unscaled sim time, starting with the next step. The lowest active scale wins.
 * @property {(reason:string) => void} pause    Add a pause reason ('menu', 'dialogue', 'cine', 'hidden', 'debug'); emits game:paused.
 * @property {(reason:string) => void} resume   Remove a pause reason; emits game:paused.
 * @property {(reason:string) => boolean} isPaused  True when `reason` is active.
 * @property {(ignored:string) => boolean} pausedExcept  True when any reason other than `ignored` is active.
 * @property {() => string[]} reasons           Active pause reasons (a new array; diagnostics only).
 * @property {(s:number) => void} setBaseScale  Debug time scale (`__GAME__.setTimeScale`), multiplied with slow motion. Clamped to [0, 4].
 * @property {() => boolean} beginStep  Loop internal: start a step, refresh `scale`; returns true when this step is frozen.
 * @property {() => void} endStep       Loop internal: finish a step (advance tick, real, now, hit-stop count).
 */

/**
 * Create the sim clock.
 * @param {object} [ctx] Context read at call time for `ctx.bus` (game:paused).
 * @returns {Time}
 */
export function createTime(ctx) {
  const slowScale = new Float64Array(SLOW_SLOTS);
  const slowUntil = new Float64Array(SLOW_SLOTS);
  /** @type {Set<string>} */
  const pauseSet = new Set();
  let hitStopLeft = 0;
  let frozenThisStep = false;
  let baseScale = 1;

  function minSlow() {
    let m = 1;
    for (let i = 0; i < SLOW_SLOTS; i++) if (slowUntil[i] > time.tick && slowScale[i] < m) m = slowScale[i];
    return m;
  }

  /** @param {string} reason */
  function emitPaused(reason) {
    const bus = ctx && /** @type {any} */ (ctx).bus;
    if (bus) bus.emit('game:paused', { paused: time.paused, reason });
  }

  /** @type {Time} */
  const time = {
    tick: 0,
    now: 0,
    real: 0,
    scale: 1,
    frozen: false,
    paused: false,

    hitStop(ms) {
      const n = Math.round(ms / TICK_MS);
      if (!(n > hitStopLeft)) return;
      hitStopLeft = n;
      time.frozen = true;
    },

    slowMo(scale, seconds) {
      if (!(seconds > 0) || !(scale >= 0)) return;
      const s = scale > 1 ? 1 : scale;
      const until = time.tick + Math.round(seconds * SIM_HZ);
      let slot = 0;
      for (let i = 0; i < SLOW_SLOTS; i++) {
        if (slowUntil[i] <= time.tick) { slot = i; break; }
        if (slowUntil[i] < slowUntil[slot]) slot = i;
      }
      slowScale[slot] = s;
      slowUntil[slot] = until;
    },

    pause(reason) {
      if (pauseSet.has(reason)) return;
      pauseSet.add(reason);
      time.paused = true;
      emitPaused(reason);
    },

    resume(reason) {
      if (!pauseSet.delete(reason)) return;
      time.paused = pauseSet.size > 0;
      emitPaused(reason);
    },

    isPaused(reason) {
      return pauseSet.has(reason);
    },

    pausedExcept(ignored) {
      return pauseSet.size > (pauseSet.has(ignored) ? 1 : 0);
    },

    reasons() {
      return Array.from(pauseSet);
    },

    setBaseScale(s) {
      baseScale = s > 4 ? 4 : s > 0 ? s : 0;
      time.scale = baseScale * minSlow();
    },

    beginStep() {
      time.scale = baseScale * minSlow();
      frozenThisStep = hitStopLeft > 0;
      return frozenThisStep;
    },

    endStep() {
      if (!frozenThisStep) time.now += SIM_DT * time.scale;
      time.tick++;
      time.real = time.tick * SIM_DT;
      if (frozenThisStep && hitStopLeft > 0) hitStopLeft--;
      frozenThisStep = false;
      time.frozen = hitStopLeft > 0;
    },
  };
  return time;
}
