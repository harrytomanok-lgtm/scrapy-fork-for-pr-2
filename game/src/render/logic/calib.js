/**
 * Calibration of the phone tier's pixel ratio (render polish, item 1). Pure and allocation-free after creation.
 *
 * The low tier used to render at device pixel ratio 1 and stretch the image 2-3x on a phone. Calibration finds the
 * highest pixel ratio (up to min(devicePixelRatio, 2)) the device holds at the target rate and hands it to the
 * dynamic resolution controller as its ceiling.
 *
 * The first version decided once, in the first second of the title screen. On a real phone that second is the
 * busiest of the session (the world is still streaming in), so one uneven window left a capable phone at ratio 1,
 * a blurry picture, for the whole session. The rules now:
 *
 * - It starts at the level it is given (`startRatio`: what an earlier session reached; 1.0 otherwise) with the
 *   shadow map on (when the device may have it), and ignores the first SETTLE_START seconds. A start above the
 *   lowest level that turns out slow comes down one level per slow window, before it touches the shadows, and
 *   rests at the first level that holds.
 * - A frame longer than HITCH is a loading hitch, not the steady rate: when the frames around it hold the target,
 *   its window is discarded (a window whose other frames are slow too is judged as it is). A probe that sees only
 *   hitch windows (HITCH_MAX in a row) stops for now and tries again later.
 * - Every window (WINDOW s of presented frames, after SETTLE s following any change) it judges the presented rate
 *   and the CPU cost: under target - 3 is slow. With head-room it steps one level up the ladder. The prediction is
 *   conservative: the frame is assumed to be entirely fill-bound, so the rate expected at the next level is
 *   shown x (s / s')^2, and it must reach target + 3 (and the CPU cost must leave target + 8). The presented rate is
 *   capped by the loop (60 fps), so a device that reaches the cap at every level climbs one level per window.
 * - A negative verdict at a level it has not moved from needs CONFIRM windows in a row. Slow: it first sheds the
 *   shadows (the order of sacrifices: shadows, then resolution), then steps one level back down and rests; slow at
 *   the lowest level with the shadows already off rests at once (dynamic resolution then lowers the scale, never
 *   below 0.6). Neither slow nor head-room: it rests at this level.
 * - Resting is not final. While it rests below the top level, the game runs uncapped and dynamic resolution sits at
 *   the ceiling, a timer runs; after `retry` seconds it probes again from the level it rests at. A re-probe is
 *   careful: a step up needs CONFIRM windows of head-room, and a raised level that turns out slow is taken back at
 *   once and doubles the wait (up to RETRY_MAX), so a phone at its limit is not disturbed again and again. A
 *   re-probe never touches the shadows.
 * - Windows under a frame cap below UNCAPPED (a 30 fps menu) and held time are discarded.
 * - The first probe ends after MAX_TIME seconds of measured time at the latest.
 * @module render/logic/calib
 */

/** Ladder of pixel ratios (device pixels per CSS pixel) the calibration may visit, ascending. */
export const LADDER = Object.freeze([1, 1.25, 1.5, 1.75, 2]);
/** Seconds of presented frames per decision window. */
export const WINDOW = 1;
/** Seconds ignored after each change (resize and first-use hitches). */
export const SETTLE = 0.75;
/** Seconds ignored at the very start: the world around the title camera is still streaming in. */
export const SETTLE_START = 2.5;
/** Measured seconds after which the first probe ends whatever it found. */
export const MAX_TIME = 14;
/** A window under a frame cap below this does not measure head-room (a capped menu); it is discarded. */
export const UNCAPPED = 50;
/** A frame longer than this (seconds) is a loading hitch: the window it falls in is discarded. */
export const HITCH = 0.1;
/** Windows discarded for hitches in a row after which a probe stops and tries again later. */
export const HITCH_MAX = 6;
/** Windows in a row a negative verdict needs at a level the probe has not moved from; also a careful step up. */
export const CONFIRM = 2;
/** Seconds of uncapped play at the ceiling before the first re-probe, and after a re-probe that raised the level. */
export const RETRY_FIRST = 10;
/** The longest wait between re-probes (seconds). */
export const RETRY_MAX = 240;

/**
 * @typedef {object} Calib
 * @property {'probe'|'done'} phase  'done' is resting: the caller's dynamic resolution rules, and a re-probe may follow
 * @property {number} scale     current pixel ratio
 * @property {number} ceiling   the highest ratio validated (equals scale while resting)
 * @property {number} top       the highest ratio of the ladder on this device
 * @property {boolean} shadows  shadows wanted (false once shed)
 * @property {number} steps     level changes made (diagnostics)
 * @property {number} reprobes  re-probes started (diagnostics)
 * @property {number} retry     seconds of steady play before the next re-probe (diagnostics)
 * @property {(dt:number, held:boolean, costMs?:number, cap?:number, atCeiling?:boolean) => boolean} update
 *   feed one presented frame; true when scale or shadows changed. While resting it only counts toward the next
 *   re-probe (and only when `atCeiling`: dynamic resolution has not lowered the scale); the caller watches `phase`.
 * @property {(o:{ maxRatio:number, target:number, shadows:boolean, startRatio?:number }) => void} configure  restart
 * @property {() => void} finish  rest now (keeps the current level)
 */

/**
 * @param {{ maxRatio:number, target:number, shadows:boolean, startRatio?:number }} opts
 * @returns {Calib}
 */
export function createCalib(opts) {
  const levels = new Float32Array(LADDER.length + 1);
  let nLevels = 1;
  let level = 0;
  let target = 30;
  let settle = SETTLE_START;
  let winT = 0;
  let winFrames = 0;
  let winCost = 0;
  let winCostN = 0;
  let winHitchN = 0;
  let winHitchT = 0;
  let measured = 0;
  let slowN = 0;
  let flatN = 0;
  let headN = 0;
  let hitchN = 0;
  let verifyN = 0;
  /** A re-probe (careful) rather than the first probe. */
  let reprobe = false;
  /** The level changed during this probe. */
  let moved = false;
  /** The level was raised during this probe. */
  let raised = false;
  /** The level was just raised by a re-probe and has not yet held CONFIRM windows. */
  let unverified = false;
  /** The probe started above the lowest level (an earlier session's ratio) and is coming down from it. */
  let descending = false;
  let restT = 0;

  function clearWindow() {
    winT = 0;
    winFrames = 0;
    winCost = 0;
    winCostN = 0;
    winHitchN = 0;
    winHitchT = 0;
  }

  function clearCounts() {
    slowN = 0;
    flatN = 0;
    headN = 0;
    hitchN = 0;
    verifyN = 0;
  }

  /** @param {number} i */
  function setLevel(i) {
    if (i > level) raised = true;
    level = i;
    c.scale = levels[i];
    if (c.scale > c.ceiling || c.phase === 'done') c.ceiling = c.scale;
    settle = SETTLE;
    moved = true;
    c.steps++;
    clearCounts();
    clearWindow();
  }

  /** Rest at the current level. @param {number} wait seconds of steady play before the next re-probe */
  function rest(wait) {
    c.phase = 'done';
    c.ceiling = c.scale;
    c.retry = wait;
    restT = 0;
    reprobe = false;
    moved = false;
    raised = false;
    unverified = false;
    descending = false;
    clearCounts();
    clearWindow();
  }

  /** The wait after a probe that changed nothing or failed: twice the last one. */
  function longer() {
    return Math.min(RETRY_MAX, Math.max(RETRY_FIRST, c.retry) * 2);
  }

  const c = {
    phase: /** @type {'probe'|'done'} */ ('probe'),
    scale: 1,
    ceiling: 1,
    top: 1,
    shadows: true,
    steps: 0,
    reprobes: 0,
    retry: RETRY_FIRST,
    configure(o) {
      const maxR = Math.max(0.6, Math.min(2, o.maxRatio > 0 ? o.maxRatio : 1));
      nLevels = 0;
      // the lowest level: 1.0, or the device's own ratio when it is below 1
      levels[nLevels++] = Math.min(1, maxR);
      for (let i = 1; i < LADDER.length; i++) {
        if (LADDER[i] < maxR - 0.02) levels[nLevels++] = LADDER[i];
      }
      if (maxR > levels[nLevels - 1] + 0.02) levels[nLevels++] = maxR;
      c.top = levels[nLevels - 1];
      target = o.target > 0 ? o.target : 30;
      level = 0;
      const start = typeof o.startRatio === 'number' && o.startRatio > 0 ? o.startRatio : 0;
      for (let i = 1; i < nLevels; i++) if (levels[i] <= start + 0.02) level = i;
      c.scale = levels[level];
      c.ceiling = levels[level];
      c.shadows = !!o.shadows;
      c.phase = nLevels > 1 || c.shadows ? 'probe' : 'done';
      c.steps = 0;
      c.reprobes = 0;
      c.retry = RETRY_FIRST;
      settle = SETTLE_START;
      measured = 0;
      restT = 0;
      reprobe = false;
      moved = false;
      raised = false;
      unverified = false;
      descending = false;
      clearCounts();
      clearWindow();
    },
    finish() {
      if (c.phase !== 'done') rest(c.retry);
    },
    update(dt, held, costMs = 0, cap = 0, atCeiling = true) {
      if (!(dt > 0)) return false;
      const capped = cap > 0 && cap < UNCAPPED;
      if (c.phase === 'done') {
        // resting: count steady play toward the next re-probe
        if (level + 1 >= nLevels) return false;
        if (!atCeiling) {
          restT = 0;
          return false;
        }
        if (held || capped || dt > HITCH) return false;
        restT += dt;
        if (restT >= c.retry) {
          c.phase = 'probe';
          reprobe = true;
          moved = false;
          raised = false;
          unverified = false;
          settle = SETTLE;
          c.reprobes++;
          clearCounts();
          clearWindow();
        }
        return false;
      }
      if (held || capped) {
        clearWindow();
        return false;
      }
      if (settle > 0) {
        settle -= dt;
        return false;
      }
      if (dt > HITCH) {
        winHitchN++;
        winHitchT += dt;
      }
      measured += dt;
      winT += dt;
      winFrames++;
      if (costMs > 0) {
        winCost += costMs;
        winCostN++;
      }
      if (winT < WINDOW) return false;
      if (winHitchN > 0) {
        // Loading hitches say nothing about the steady rate: when the frames between them hold the target, the
        // window is discarded. When they do not (or every frame is that long), the device is simply slow, and the
        // window is judged as it is.
        const restT2 = winT - winHitchT;
        const between = restT2 > 0.3 ? (winFrames - winHitchN) / restT2 : 0;
        if (between >= target - 3) {
          clearWindow();
          hitchN++;
          if (hitchN >= HITCH_MAX) rest(reprobe ? longer() : c.retry);
          return false;
        }
      }
      const shown = winFrames / winT;
      const costFps = winCostN > 0 ? 1000 / (winCost / winCostN) : 0;
      clearWindow();
      hitchN = 0;
      const slow = shown < target - 3 || (costFps > 0 && costFps < target - 3);
      if (slow) {
        headN = 0;
        flatN = 0;
        slowN++;
        if (reprobe) {
          if (unverified && level > 0) {
            // the raised level does not hold: take it back and wait longer before trying again
            const wait = longer();
            setLevel(level - 1);
            rest(wait);
            return true;
          }
          // slow at the level it rested at: dynamic resolution's business
          rest(longer());
          return false;
        }
        if (slowN < (moved ? 1 : CONFIRM)) return false;
        slowN = 0;
        if (level > 0 && (descending || !moved)) {
          // it started at an earlier session's ratio and that does not hold now: come down before anything else
          descending = true;
          setLevel(level - 1);
          return true;
        }
        if (c.shadows) {
          c.shadows = false;
          settle = SETTLE;
          return true;
        }
        if (level > 0) {
          setLevel(level - 1);
          rest(RETRY_FIRST * 2);
          return true;
        }
        rest(RETRY_FIRST * 2);
        return false;
      }
      slowN = 0;
      if (descending) {
        // the first level that holds on the way down
        rest(RETRY_FIRST * 2);
        return false;
      }
      if (unverified && ++verifyN >= CONFIRM) unverified = false;
      let head = false;
      if (level + 1 < nLevels) {
        const r = levels[level] / levels[level + 1];
        const predicted = shown * r * r;
        const cpuOk = costFps <= 0 || costFps >= target + 8;
        head = predicted >= target + 3 && cpuOk;
      }
      if (head) {
        flatN = 0;
        headN++;
        if (headN < (reprobe ? CONFIRM : 1) || unverified) return false;
        setLevel(level + 1);
        if (reprobe) {
          unverified = true;
        } else if (measured >= MAX_TIME) {
          rest(RETRY_FIRST);
        }
        return true;
      }
      // neither slow nor head-room: this level is the one, for now
      headN = 0;
      flatN++;
      if (unverified) return false;
      if (flatN < (moved ? 1 : CONFIRM)) return false;
      rest(raised ? RETRY_FIRST : reprobe ? longer() : c.retry);
      return false;
    },
  };
  c.configure(opts);
  return c;
}
