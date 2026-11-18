/**
 * Frame pacing (frame cap) for the rAF driver of core/loop: decides on each vsync whether to present a frame so that
 * at most `capFps` frames per second are presented, evenly spread over the display's vsyncs.
 *
 * A time accumulator collects the real time of every vsync. A frame is presented when the accumulator reaches the
 * cap interval minus half a vsync (rounding to the nearest vsync, so timestamp jitter never drops a frame); the
 * interval is then subtracted, which keeps the long-run average at the cap (60 Hz: every vsync; 120 Hz: every second
 * vsync; 90 Hz: 2-1-2-1 vsyncs; 144 Hz: 2-3-2-3...). The carried remainder is clamped to half a vsync so a long frame
 * never causes a burst. The vsync period is estimated from the rAF intervals (smoothed; dropped-frame intervals are
 * ignored). Pure and allocation-free: Node tests drive it with synthetic intervals.
 * @module core/pacing
 */

/** Frame cap during play (frames per second). */
export const PLAY_FPS_CAP = 60;
/** Frame cap while the game is paused or a blocking screen is open (frames per second). */
export const PAUSED_FPS_CAP = 30;

/**
 * @typedef {object} Pacer
 * @property {number} acc        accumulated real seconds toward the next presented frame
 * @property {number} elapsed    real seconds since the last presented frame (handed to the frame pass)
 * @property {number} vsync      estimated display refresh period in seconds (0 until the first interval)
 */

/** @returns {Pacer} */
export function createPacer() {
  return { acc: 0, elapsed: 0, vsync: 0 };
}

/** @param {Pacer} p */
export function resetPacer(p) {
  p.acc = 0;
  p.elapsed = 0;
}

/**
 * Feed one vsync (rAF) interval.
 * @param {Pacer} p
 * @param {number} dt      real seconds since the previous rAF callback
 * @param {number} capFps  frames per second to present at most; 0 (or less) presents every vsync
 * @returns {number} the real seconds to hand to the frame pass when this vsync presents a frame, or -1 to skip it
 */
export function paceFrame(p, dt, capFps) {
  if (!(dt > 0)) dt = 0;
  if (dt > 0) {
    // Refresh estimate: follow shorter intervals quickly, longer ones slowly, and ignore dropped frames.
    if (p.vsync <= 0) p.vsync = dt;
    else if (dt < p.vsync) p.vsync += (dt - p.vsync) * 0.5;
    else if (dt < p.vsync * 1.5) p.vsync += (dt - p.vsync) * 0.05;
  }
  p.elapsed += dt;
  if (!(capFps > 0)) {
    p.acc = 0;
    const e = p.elapsed;
    p.elapsed = 0;
    return e;
  }
  const interval = 1 / capFps;
  const half = p.vsync * 0.5;
  p.acc += dt;
  if (p.acc < interval - half - 1e-6) return -1;
  p.acc -= interval;
  if (p.acc > half) p.acc = half;
  else if (p.acc < -half) p.acc = -half;
  const e = p.elapsed;
  p.elapsed = 0;
  return e;
}
