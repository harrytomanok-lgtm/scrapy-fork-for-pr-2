/**
 * Calibration of the phone tier's pixel ratio (render polish, item 1). Pure and allocation-free after creation.
 *
 * The low tier used to render at device pixel ratio 1 and stretch the image 2-3x on a phone. Calibration finds the
 * pixel ratio (up to min(devicePixelRatio, 2)) the device can afford and hands it to the dynamic resolution
 * controller as its ceiling.
 *
 * Two reports from a real phone shaped the rules:
 * 1. The first version decided once, in the first second of the title screen, the busiest of the session. One
 *    uneven window left a capable phone at ratio 1, a blurry picture, for good. So: the start is ignored, loading
 *    hitches are not verdicts, negative verdicts need confirming, and resting is never final.
 * 2. The second version climbed while a cautious prediction stayed above the 30 fps target, and the same phone then
 *    ran ratio 2 at an average of 50 under a 60 cap: sharp, but unevenly paced. So: smoothness comes first.
 *    Sharpness is taken only when it is nearly free.
 *
 * The rules now, per decision window (WINDOW s of presented frames, after SETTLE s following any change):
 * - Slow (under target - 3, by the presented rate or by the CPU cost): at a level it has not moved from it needs
 *   CONFIRM windows; a level above the lowest comes down first; only at the lowest level the shadows are shed, and
 *   after that it rests (dynamic resolution lowers the scale, never below 0.6). Shadows are never the price of
 *   sharpness.
 * - A raise is tried, not predicted: the presented rate is capped by the loop, so a device at the cap says nothing
 *   about its head-room. It steps up when the rate is at the cap (AT_CAP of it), or, below the cap at a level it
 *   cannot come down from, once as a test (a device bound by its CPU gets sharpness for free). The raised level is
 *   kept only if the rate stays at the cap or within KEEP of the rate the climb started from; otherwise the raise is
 *   taken back at once. A slow CPU (cost under target + 8) blocks raises: resolution would not be the reason.
 * - Under DOWN_FIRST of the cap at a level above the lowest, it tries one level down. Coming down is kept only if
 *   it helps (GAIN times the rate above); then it goes on down until the rate is at the cap. If it does not help,
 *   the resolution was not the cost: it goes back up and stays.
 * - A frame longer than HITCH is a loading hitch: when the frames around it hold the target, its window is
 *   discarded (a window whose other frames are slow too is judged as it is). HITCH_MAX such windows in a row end
 *   the probe for now.
 * - Resting is not final. While the game runs uncapped and dynamic resolution sits at the ceiling, a timer runs;
 *   after `retry` seconds it probes again from the level it rests at, carefully (CONFIRM windows for every step).
 *   A re-probe comes down only when the rate has fallen under DOWN_AT of the rate the level was accepted at (a
 *   heavier scene, a warm phone), and climbs back later. A re-probe that changes nothing only measures. A re-probe
 *   never sheds the shadows.
 * - A level that turned out too costly is blocked for BLOCK_FIRST seconds, twice as long after each further
 *   failure (up to BLOCK_MAX), so a phone at its limit is rarely disturbed; a raise that holds clears the count.
 *   A step down that did not help blocks further tries from that level the same way.
 * - Windows under a frame cap below UNCAPPED (a 30 fps menu) and held time are discarded.
 * - It starts at the level it is given (`startRatio`: what an earlier session rested at; 1.0 otherwise) and ignores
 *   the first SETTLE_START seconds. The first probe ends after MAX_TIME seconds of measured time at the latest.
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
/** The presented rate the loop is assumed to cap at when it reports no cap (frames per second). */
export const CAP_DEFAULT = 60;
/** A frame longer than this (seconds) is a loading hitch: the window it falls in is discarded. */
export const HITCH = 0.1;
/** Windows discarded for hitches in a row after which a probe stops and tries again later. */
export const HITCH_MAX = 6;
/** Windows in a row a verdict needs at a level the probe has not moved from, and every step of a re-probe. */
export const CONFIRM = 2;
/** Share of the frame cap that counts as "at the cap": the device holds the smooth rate. */
export const AT_CAP = 0.95;
/** A raised level is kept when the rate stays within this share of the rate the climb started from. */
export const KEEP = 0.92;
/** Coming down a level is kept when the rate grows by this factor. */
export const GAIN = 1.08;
/** The first probe tries one level down when the rate is under this share of the frame cap. */
export const DOWN_FIRST = 0.9;
/** A re-probe comes down when the rate has fallen under this share of the frame cap. */
export const DOWN_AT = 0.85;
/** Seconds of uncapped play at the ceiling before the first re-probe, and after a probe that changed the level. */
export const RETRY_FIRST = 10;
/** The longest wait between re-probes (seconds). A re-probe that changes nothing only measures, which is free. */
export const RETRY_MAX = 30;
/** Seconds a level stays blocked after it turned out too costly (or a step down from it did not help), first time. */
export const BLOCK_FIRST = 30;
/** The longest block of a level (seconds); each failure in a row doubles the block up to this. */
export const BLOCK_MAX = 1800;

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
 * @property {() => string} describe  the rate last measured at each level visited, e.g. "1.5:60 1.75:58 2:50"
 *   (diagnostics; allocates)
 */

/**
 * @param {{ maxRatio:number, target:number, shadows:boolean, startRatio?:number }} opts
 * @returns {Calib}
 */
export function createCalib(opts) {
  const levels = new Float32Array(LADDER.length + 1);
  /** The rate last measured at each level (0: never). */
  const rates = new Float32Array(LADDER.length + 1);
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
  let midN = 0;
  let headN = 0;
  let okN = 0;
  let hitchN = 0;
  /** 0: measuring a level; 1: verifying a raise against `ref`; -1: judging a step down against `above`. */
  let mode = 0;
  /** The rate at the level a climb started from. */
  let ref = 0;
  /** The rate at the level above, before stepping down. */
  let above = 0;
  /** A re-probe (careful) rather than the first probe. */
  let reprobe = false;
  /** The level changed during this probe. */
  let moved = false;
  /** Coming down from a start that turned out slow (no raises in this probe). */
  let descending = false;
  /** Per level: the rate it was accepted at (0: never), failed raises to it and until when it is blocked. */
  const kept = new Float32Array(LADDER.length + 1);
  const upN = new Uint8Array(LADDER.length + 1);
  const upBlock = new Float64Array(LADDER.length + 1);
  /** Per level: step-downs from it that did not help, and until when further tries are blocked. */
  const downN = new Uint8Array(LADDER.length + 1);
  const downBlock = new Float64Array(LADDER.length + 1);
  /** Seconds fed since configure (the clock of the blocks). */
  let clockT = 0;
  /** The test raise from the lowest level, under the cap, was taken (once per session). */
  let freeTried = false;
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
    midN = 0;
    headN = 0;
    okN = 0;
    hitchN = 0;
  }

  /** @param {number} i */
  function setLevel(i) {
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
    descending = false;
    mode = 0;
    clearCounts();
    clearWindow();
  }

  /** The wait after a probe that changed nothing or failed: twice the last one. */
  function longer() {
    return Math.min(RETRY_MAX, Math.max(RETRY_FIRST, c.retry) * 2);
  }

  /** Level `i` turned out too costly: block raises to it. @param {number} i */
  function blockUp(i) {
    if (upN[i] < 12) upN[i]++;
    upBlock[i] = clockT + Math.min(BLOCK_MAX, BLOCK_FIRST * Math.pow(2, upN[i] - 1));
  }

  /** A step down from level `i` did not help: block further tries from it. @param {number} i */
  function blockDown(i) {
    if (downN[i] < 12) downN[i]++;
    downBlock[i] = clockT + Math.min(BLOCK_MAX, BLOCK_FIRST * Math.pow(2, downN[i] - 1));
  }

  /** @param {number} i @returns {boolean} a raise to level `i` may be tried now */
  function mayRaise(i) {
    return i < nLevels && clockT >= upBlock[i];
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
      rates.fill(0);
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
      descending = false;
      mode = 0;
      ref = 0;
      above = 0;
      kept.fill(0);
      upN.fill(0);
      upBlock.fill(0);
      downN.fill(0);
      downBlock.fill(0);
      clockT = 0;
      freeTried = false;
      clearCounts();
      clearWindow();
    },
    finish() {
      if (c.phase !== 'done') rest(c.retry);
    },
    describe() {
      let s = '';
      for (let i = 0; i < nLevels; i++) {
        if (rates[i] > 0) s += (s ? ' ' : '') + Math.round(levels[i] * 100) / 100 + ':' + Math.round(rates[i]);
      }
      return s;
    },
    update(dt, held, costMs = 0, cap = 0, atCeiling = true) {
      if (!(dt > 0)) return false;
      clockT += dt;
      const capped = cap > 0 && cap < UNCAPPED;
      if (c.phase === 'done') {
        // resting: count steady play toward the next re-probe
        if (nLevels < 2) return false;
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
          descending = false;
          mode = 0;
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
        const calm = winT - winHitchT;
        const between = calm > 0.3 ? (winFrames - winHitchN) / calm : 0;
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
      rates[level] = shown;
      const capRate = cap > 0 ? cap : CAP_DEFAULT;
      const atCap = shown >= capRate * AT_CAP;
      const cpuOk = costFps <= 0 || costFps >= target + 8;
      const need = reprobe ? CONFIRM : 1;

      // ---- slow: under the target itself
      if (shown < target - 3 || (costFps > 0 && costFps < target - 3)) {
        headN = 0;
        midN = 0;
        okN = 0;
        slowN++;
        if (mode === 1 && level > 0) {
          // the raised level does not hold at all: take it back (the shadows are never the price of sharpness)
          blockUp(level);
          setLevel(level - 1);
          rest(longer());
          return true;
        }
        if (reprobe) {
          // slow at the level it rested at: dynamic resolution's business
          rest(longer());
          return false;
        }
        if (slowN < (moved ? 1 : CONFIRM)) return false;
        slowN = 0;
        if (level > 0) {
          // above the lowest level (an earlier session's ratio, or a level reached on the way down): come down
          // before anything else
          descending = true;
          mode = 0;
          setLevel(level - 1);
          return true;
        }
        if (c.shadows) {
          c.shadows = false;
          settle = SETTLE;
          return true;
        }
        rest(RETRY_FIRST * 2);
        return false;
      }
      slowN = 0;
      if (descending) {
        // the first level that holds the target on the way down from a slow start
        rest(RETRY_FIRST * 2);
        return false;
      }

      // ---- verifying a raise: kept only when it is nearly free
      if (mode === 1) {
        if (atCap || shown >= ref * KEEP) {
          if (++okN < need) return false;
          upN[level] = 0;
          kept[level] = shown;
          if (mayRaise(level + 1) && cpuOk && !(measured >= MAX_TIME && !reprobe)) {
            setLevel(level + 1);
            return true;
          }
          rest(RETRY_FIRST);
          return false;
        }
        blockUp(level);
        setLevel(level - 1);
        rest(longer());
        return true;
      }

      // ---- judging a step down: kept only when it helped
      if (mode === -1) {
        if (shown >= above * GAIN) {
          if (++okN < need) return false;
          // the level above costs frame rate here and now
          blockUp(level + 1);
          kept[level] = shown;
          if (atCap || level === 0) {
            rest(RETRY_FIRST);
            return false;
          }
          above = shown;
          setLevel(level - 1);
          return true;
        }
        // the resolution was not the cost: go back up and stay
        blockDown(level + 1);
        kept[level + 1] = above;
        setLevel(level + 1);
        rest(longer());
        return true;
      }

      // ---- measuring the level it stands at
      if (atCap) {
        midN = 0;
        if (mayRaise(level + 1) && cpuOk) {
          if (++headN < need) return false;
          kept[level] = shown;
          ref = shown;
          mode = 1;
          setLevel(level + 1);
          return true;
        }
        // at the cap with nowhere to go (the top level, a slow CPU, or the level above is blocked)
        if (++headN < (moved ? 1 : CONFIRM)) return false;
        kept[level] = shown;
        let wait = reprobe ? longer() : c.retry;
        if (level + 1 < nLevels && cpuOk) {
          // the level above is only blocked for a while: look again when the block ends
          const left = upBlock[level + 1] - clockT + 0.5;
          if (left < wait) wait = left > 2 ? left : 2;
        }
        rest(wait);
        return false;
      }
      headN = 0;
      // under the cap, over the target
      if (++midN < CONFIRM) return false;
      midN = 0;
      // a re-probe compares with the rate this level was accepted at (a device that never reaches the cap is not
      // sent down for it); the first probe, which has no such rate yet, compares with the cap
      const was = kept[level] > 0 ? Math.min(capRate, kept[level]) : capRate;
      if (level > 0 && clockT >= downBlock[level] && shown < (reprobe ? was * DOWN_AT : capRate * DOWN_FIRST)) {
        // would one level down be smoother?
        above = shown;
        mode = -1;
        setLevel(level - 1);
        return true;
      }
      if (level === 0 && mayRaise(1) && cpuOk && !freeTried) {
        // it cannot come down: is the resolution even the cost? One test raise per session, kept only when nearly
        // free (a device bound by its CPU, or by a 30 Hz frame callback, gets its sharpness this way).
        freeTried = true;
        ref = shown;
        mode = 1;
        setLevel(level + 1);
        return true;
      }
      if (kept[level] <= 0) kept[level] = shown;
      rest(reprobe ? longer() : c.retry);
      return false;
    },
  };
  c.configure(opts);
  return c;
}
