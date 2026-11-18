/**
 * Boot timestamps (ARCHITECTURE 7.1: boot to title <= 8 s on the phone). `src/main.js` imports this module
 * first, so its module body runs when the bundle starts evaluating: the first mark ('script') is the moment the
 * script was downloaded and parsed. boot.js adds one mark per boot stage; `__GAME__.bootTimes()` reports them.
 * All times are milliseconds since navigation start (`performance.now()`).
 * @module core/bootclock
 */

/** @returns {number} */
function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}

/** @type {Array<[string, number]>} [stage, ms since navigation start] in order */
const marks = [['script', now()]];

/**
 * Record the end of a boot stage. Later marks with the same name are ignored (a stage ends once).
 * @param {string} stage
 */
export function markBoot(stage) {
  for (let i = 0; i < marks.length; i++) if (marks[i][0] === stage) return;
  marks.push([stage, now()]);
}

/**
 * @typedef {object} BootTimes
 * @property {Array<{ stage:string, at:number, ms:number }>} stages   at: ms since navigation; ms: since the previous mark
 * @property {number} total          ms from navigation start to the last mark
 * @property {number|null} firstPaint            paint timing (null when the browser has none)
 * @property {number|null} firstContentfulPaint
 */

/**
 * The boot stages so far (rounded to 0.1 ms).
 * @returns {BootTimes}
 */
export function bootTimes() {
  const r = (v) => Math.round(v * 10) / 10;
  const stages = [];
  let prev = 0;
  for (const [stage, at] of marks) {
    stages.push({ stage, at: r(at), ms: r(at - prev) });
    prev = at;
  }
  /** @type {number|null} */
  let fp = null;
  /** @type {number|null} */
  let fcp = null;
  try {
    for (const e of performance.getEntriesByType('paint')) {
      if (e.name === 'first-paint') fp = r(e.startTime);
      else if (e.name === 'first-contentful-paint') fcp = r(e.startTime);
    }
  } catch (e) {
    // no paint timing (Node, old browsers)
  }
  return { stages, total: r(prev), firstPaint: fp, firstContentfulPaint: fcp };
}
