/**
 * The main loop `ctx.loop` (ARCHITECTURE 3.2): fixed 60 Hz sim steps from an accumulator, at most
 * MAX_STEPS per animation frame (the excess is dropped), then one frame pass with an interpolation
 * factor. The sim never reads a wall clock; real time only feeds the accumulator and the stats.
 * @module core/loop
 */

import { SIM_DT, MAX_STEPS, MAX_FRAME_DT } from './constants.js';

/** Tolerance so that frames of exactly SIM_DT always yield one step despite float rounding. */
const EPS = 1e-9;
/** Smoothing factor of the frame-time average in `loop.stats`. */
const STATS_SMOOTH = 0.1;

/**
 * @typedef {object} LoopStats
 * @property {number} fps      Smoothed frames per second of the real-time loop.
 * @property {number} frameMs  Smoothed duration of the last frame pass (ms).
 * @property {number} simMs    Smoothed duration of the sim steps of a frame (ms).
 */

/**
 * @typedef {object} Loop
 * @property {() => void} start          Start the requestAnimationFrame loop (no-op when running or when rAF is unavailable).
 * @property {() => void} stop
 * @property {(n:number) => number} stepSim
 *   Run n sim steps synchronously (tests and `__GAME__.step`). Runs only while no pause reason other than 'debug'
 *   is active; returns the number of steps run.
 * @property {() => void} renderNow      Run one frame pass with dt = 0.
 * @property {(realDt:number) => void} frame  One animation frame worth of work given the real seconds since the last frame (used by the rAF driver; callable from tests).
 * @property {boolean} running
 * @property {number} alpha              Interpolation factor of the last frame pass.
 * @property {LoopStats} stats
 */

/**
 * @typedef {object} LoopOptions
 * @property {(cb:(t:number)=>void) => number} [raf]   Defaults to `requestAnimationFrame`.
 * @property {(id:number) => void} [caf]               Defaults to `cancelAnimationFrame`.
 * @property {() => number} [now]                      Millisecond clock for the stats only; defaults to `performance.now`.
 */

/**
 * Create the loop.
 * @param {object} ctx Context read at call time for `time`, `systems` and `flags`.
 * @param {LoopOptions} [opts]
 * @returns {Loop}
 */
export function createLoop(ctx, opts = {}) {
  const c = /** @type {any} */ (ctx);
  const g = /** @type {any} */ (globalThis);
  const raf = opts.raf || (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame.bind(g) : null);
  const caf = opts.caf || (typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame.bind(g) : null);
  const clock = opts.now || (g.performance && typeof g.performance.now === 'function' ? () => g.performance.now() : () => 0);
  let acc = 0;
  let rafId = 0;
  let lastT = -1;

  /** True when real time feeds the accumulator (not in test mode, unless autoplay). */
  function fed() {
    const f = c.flags;
    return !(f && f.test && !f.autoplay);
  }

  function step() {
    const time = c.time;
    const frozen = time.beginStep();
    c.systems.runStep(SIM_DT * time.scale, frozen);
    time.endStep();
  }

  /** @param {number} dt @param {number} alpha */
  function framePass(dt, alpha) {
    const t0 = clock();
    loop.alpha = alpha;
    c.systems.runFrame(dt, alpha);
    loop.stats.frameMs += (clock() - t0 - loop.stats.frameMs) * STATS_SMOOTH;
  }

  /** @param {number} t rAF timestamp in ms */
  function onFrame(t) {
    if (!loop.running) return;
    rafId = /** @type {any} */ (raf)(onFrame);
    const dt = lastT < 0 ? 0 : (t - lastT) / 1000;
    lastT = t;
    if (dt > 0) loop.stats.fps += (1 / dt - loop.stats.fps) * STATS_SMOOTH;
    loop.frame(dt);
  }

  /** @type {Loop} */
  const loop = {
    running: false,
    alpha: 1,
    stats: { fps: 0, frameMs: 0, simMs: 0 },

    start() {
      if (loop.running || !raf) return;
      loop.running = true;
      lastT = -1;
      rafId = raf(onFrame);
    },

    stop() {
      loop.running = false;
      if (caf && rafId) caf(rafId);
      rafId = 0;
    },

    frame(realDt) {
      const dt = realDt > MAX_FRAME_DT ? MAX_FRAME_DT : realDt > 0 ? realDt : 0;
      const live = fed();
      if (live) {
        if (c.time.paused) {
          acc = 0;
        } else {
          acc += dt;
          const t0 = clock();
          let steps = 0;
          while (acc >= SIM_DT - EPS && steps < MAX_STEPS) {
            acc -= SIM_DT;
            step();
            steps++;
          }
          if (acc < 0) acc = 0;
          if (acc >= SIM_DT) acc %= SIM_DT;
          loop.stats.simMs += (clock() - t0 - loop.stats.simMs) * STATS_SMOOTH;
        }
      }
      framePass(dt, live ? acc / SIM_DT : 1);
    },

    stepSim(n) {
      const time = c.time;
      const t0 = clock();
      let ran = 0;
      for (let i = 0; i < n; i++) {
        if (time.pausedExcept('debug')) break;
        step();
        ran++;
      }
      if (ran > 0) loop.stats.simMs += ((clock() - t0) / ran - loop.stats.simMs) * STATS_SMOOTH;
      return ran;
    },

    renderNow() {
      framePass(0, fed() ? acc / SIM_DT : 1);
    },
  };
  return loop;
}
