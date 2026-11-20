/**
 * Start-up calibration of the phone tier (render polish, item 1). Pure and allocation-free after creation.
 *
 * The low tier used to render at device pixel ratio 1 and stretch the image 2-3x on a phone. Calibration finds the
 * highest pixel ratio (up to min(devicePixelRatio, 2)) the device holds at the target rate, during the first seconds
 * of play (the title flyover is the usual scene), then hands a ceiling to the dynamic resolution controller.
 *
 * - It starts from the safe ratio of before (1.0) with the shadow map on (when the device may have it).
 * - Every window (WINDOW s of presented frames, after SETTLE s following any change) it judges the presented rate
 *   and the CPU cost: under target - 3 is slow. A slow window first sheds the shadows (the order of sacrifices:
 *   shadows, then resolution), then steps one level back down and ends; a slow window at the start ratio with the
 *   shadows already off ends at once (dynamic resolution then lowers the scale as before, never below 0.6).
 * - With head-room it steps one level up the ladder. The prediction is conservative: the frame is assumed to be
 *   entirely fill-bound, so the rate expected at the next level is shown x (s / s')^2, and it must reach target + 3
 *   (and the CPU cost must leave target + 8). The presented rate is capped by the loop (60 fps), so a device that
 *   reaches the cap at every level climbs one level per window to the top.
 * - Windows under a frame cap below UNCAPPED (a 30 fps menu) and held time (teleport, hidden) are discarded.
 * - It ends after MAX_TIME seconds of measured time at the latest; `ceiling` is then the ratio reached.
 * @module render/logic/calib
 */

/** Ladder of pixel ratios (device pixels per CSS pixel) the calibration may visit, ascending. */
export const LADDER = Object.freeze([1, 1.25, 1.5, 1.75, 2]);
/** Seconds of presented frames per decision window. */
export const WINDOW = 1;
/** Seconds ignored after the start and after each change (resize and first-use hitches). */
export const SETTLE = 0.75;
/** Measured seconds after which the calibration ends whatever it found. */
export const MAX_TIME = 14;
/** A window under a frame cap below this does not measure head-room (a capped menu); it is discarded. */
export const UNCAPPED = 50;

/**
 * @typedef {object} Calib
 * @property {'probe'|'done'} phase
 * @property {number} scale     current pixel ratio
 * @property {number} ceiling   the highest ratio validated (equals scale when done)
 * @property {boolean} shadows  shadows wanted (false once shed)
 * @property {number} steps     level changes made (diagnostics)
 * @property {(dt:number, held:boolean, costMs?:number, cap?:number) => boolean} update  true when scale or shadows changed
 * @property {(o:{ maxRatio:number, target:number, shadows:boolean }) => void} configure  restart the calibration
 * @property {() => void} finish  end now (keeps the current level)
 */

/**
 * @param {{ maxRatio:number, target:number, shadows:boolean }} opts
 * @returns {Calib}
 */
export function createCalib(opts) {
  const levels = new Float32Array(LADDER.length + 1);
  let nLevels = 1;
  let level = 0;
  let target = 30;
  let settle = SETTLE;
  let winT = 0;
  let winFrames = 0;
  let winCost = 0;
  let winCostN = 0;
  let measured = 0;

  function clearWindow() {
    winT = 0;
    winFrames = 0;
    winCost = 0;
    winCostN = 0;
  }

  /** @param {number} i */
  function setLevel(i) {
    level = i;
    c.scale = levels[i];
    if (c.scale > c.ceiling || c.phase === 'done') c.ceiling = c.scale;
    settle = SETTLE;
    c.steps++;
  }

  function end() {
    c.phase = 'done';
    c.ceiling = c.scale;
  }

  const c = {
    phase: /** @type {'probe'|'done'} */ ('probe'),
    scale: 1,
    ceiling: 1,
    shadows: true,
    steps: 0,
    configure(o) {
      const maxR = Math.max(0.6, Math.min(2, o.maxRatio > 0 ? o.maxRatio : 1));
      nLevels = 0;
      // the start level: 1.0, or the device's own ratio when it is below 1
      levels[nLevels++] = Math.min(1, maxR);
      for (let i = 1; i < LADDER.length; i++) {
        if (LADDER[i] < maxR - 0.02) levels[nLevels++] = LADDER[i];
      }
      if (maxR > levels[nLevels - 1] + 0.02) levels[nLevels++] = maxR;
      target = o.target > 0 ? o.target : 30;
      level = 0;
      c.scale = levels[0];
      c.ceiling = levels[0];
      c.shadows = !!o.shadows;
      c.phase = nLevels > 1 || c.shadows ? 'probe' : 'done';
      c.steps = 0;
      settle = SETTLE;
      measured = 0;
      clearWindow();
    },
    finish() {
      if (c.phase !== 'done') end();
    },
    update(dt, held, costMs = 0, cap = 0) {
      if (c.phase === 'done' || !(dt > 0)) return false;
      if (held || (cap > 0 && cap < UNCAPPED)) {
        clearWindow();
        return false;
      }
      if (settle > 0) {
        settle -= dt;
        return false;
      }
      measured += dt;
      winT += dt;
      winFrames++;
      if (costMs > 0) {
        winCost += costMs;
        winCostN++;
      }
      if (winT < WINDOW) return false;
      const shown = winFrames / winT;
      const costFps = winCostN > 0 ? 1000 / (winCost / winCostN) : 0;
      clearWindow();
      const slow = shown < target - 3 || (costFps > 0 && costFps < target - 3);
      if (slow) {
        if (c.shadows) {
          c.shadows = false;
          settle = SETTLE;
          return true;
        }
        if (level > 0) {
          setLevel(level - 1);
          end();
          return true;
        }
        end();
        return false;
      }
      if (level + 1 < nLevels) {
        const r = levels[level] / levels[level + 1];
        const predicted = shown * r * r;
        const cpuOk = costFps <= 0 || costFps >= target + 8;
        if (predicted >= target + 3 && cpuOk) {
          setLevel(level + 1);
          if (measured >= MAX_TIME) end();
          return true;
        }
        end();
        return false;
      }
      end();
      return false;
    },
  };
  c.configure(opts);
  return c;
}
