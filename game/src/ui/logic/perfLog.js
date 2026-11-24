/**
 * Rolling log of presented frame intervals during play, for the device report in Settings (pure; Node-tested).
 * It answers "how does the game run on this phone" with numbers the player can send back: average frames per
 * second, the 1% low, the worst frame and the share of slow frames over the last minute of play.
 * @module ui/logic/perfLog
 */

/** Frames longer than this (ms) count as slow: below 30 frames per second. */
export const SLOW_FRAME_MS = 34;

/**
 * @typedef {object} PerfSummary
 * @property {number} frames    samples in the window
 * @property {number} seconds   play time the window covers
 * @property {number} avgFps    average frames per second
 * @property {number} lowFps    the "1% low": frames per second of the 99th-percentile frame time
 * @property {number} worstMs   the longest frame
 * @property {number} slowPct   percent of frames longer than SLOW_FRAME_MS
 * @property {number} at60      percent of frames at 60 a second or faster (up to PACE_60_MS)
 * @property {number} at40      percent of frames between that and 40 a second (up to PACE_40_MS)
 * @property {number} at30      percent of frames between that and 30 a second (up to SLOW_FRAME_MS)
 */

/** Longest frame (ms) that still counts as 60 a second, and as 40 a second (three refreshes of a 120 Hz screen). */
export const PACE_60_MS = 19;
export const PACE_40_MS = 27;

/**
 * @param {number} [capacity=3600]  frames kept (one minute at 60 frames per second)
 */
export function createPerfLog(capacity = 3600) {
  const buf = new Float32Array(capacity);
  const sorted = new Float32Array(capacity);
  let n = 0;
  let head = 0;
  return {
    /** Record one presented frame. Pauses and tab switches (over one second) are not frames. @param {number} dtSec */
    push(dtSec) {
      if (!(dtSec > 0) || dtSec > 1) return;
      buf[head] = dtSec * 1000;
      head = (head + 1) % capacity;
      if (n < capacity) n++;
    },
    clear() {
      n = 0;
      head = 0;
    },
    /** @returns {PerfSummary} */
    summary() {
      if (n === 0) return { frames: 0, seconds: 0, avgFps: 0, lowFps: 0, worstMs: 0, slowPct: 0, at60: 0, at40: 0, at30: 0 };
      let sum = 0;
      let worst = 0;
      let slow = 0;
      let c60 = 0;
      let c40 = 0;
      for (let i = 0; i < n; i++) {
        const v = buf[i];
        sorted[i] = v;
        sum += v;
        if (v > worst) worst = v;
        if (v > SLOW_FRAME_MS) slow++;
        else if (v <= PACE_60_MS) c60++;
        else if (v <= PACE_40_MS) c40++;
      }
      const s = sorted.subarray(0, n);
      s.sort();
      const p99 = s[Math.min(n - 1, Math.floor(n * 0.99))];
      return {
        frames: n, seconds: sum / 1000, avgFps: 1000 / (sum / n), lowFps: 1000 / p99, worstMs: worst, slowPct: (slow / n) * 100,
        at60: (c60 / n) * 100, at40: (c40 / n) * 100, at30: ((n - c60 - c40 - slow) / n) * 100,
      };
    },
  };
}

/**
 * The report text (left-to-right, plain numbers, the same in both languages so it can be read back by anyone).
 * @param {PerfSummary} p
 * @param {Record<string, any>} d  device facts gathered by the caller
 * @returns {string}
 */
export function formatDeviceReport(p, d) {
  const f = (/** @type {number} */ v, k = 0) => (Number.isFinite(v) ? v.toFixed(k) : '-');
  const lines = [];
  lines.push('KETHRA device report');
  lines.push('gpu: ' + (d.gpu || 'unknown'));
  lines.push(`screen: ${d.cssW}x${d.cssH} css, dpr ${f(d.dpr, 2)}, canvas ${d.canvasW}x${d.canvasH}, scale ${f(d.scale, 2)}, tier ${d.tier}`);
  if (d.ratioState) {
    lines.push(`sharpness: ratio ${f(d.ratio, 2)} of ${f(d.ratioTop, 2)}, ${d.ratioState}, ${d.ratioSteps} steps, ${d.ratioProbes} re-probes`
      + (d.ratioSaved > 0 ? `, remembered ${f(d.ratioSaved, 2)}` : '') + `; shadows ${d.shadows || '-'}`);
    if (d.ratioRates) lines.push('measured (ratio:fps): ' + d.ratioRates);
  }
  lines.push(p.frames < 120
    ? 'fps: not enough play yet (play for a minute, then open this page from the pause menu)'
    : `fps (last ${f(p.seconds)} s of play): avg ${f(p.avgFps)}, 1% low ${f(p.lowFps)}, worst frame ${f(p.worstMs)} ms, slow frames ${f(p.slowPct, 1)}%`);
  if (p.frames >= 120 && Number.isFinite(p.at60)) {
    lines.push(`pacing: ${f(p.at60)}% of frames at 60, ${f(p.at40)}% at 40-50, ${f(p.at30)}% at 30, ${f(p.slowPct, 1)}% slower`);
  }
  lines.push(`frame cost: ${f(d.costMs, 1)} ms (sim + draw, JS), cap ${d.cap || '-'}` + (d.hz > 0 ? `, display ${f(d.hz)} Hz` : ''));
  lines.push(`draw calls ${d.drawCalls}, triangles ${f(d.triangles / 1000)}k, shaders ${d.programs - d.linkFailures}/${d.programs} ok, heap ${d.heapMb ? f(d.heapMb) + ' MB' : '-'}`);
  lines.push(`audio ${d.audio}, storage ${d.storage}, world bake ${d.bake}, input ${d.device}`);
  lines.push('ua: ' + String(d.ua || '').slice(0, 110));
  return lines.join('\n');
}
