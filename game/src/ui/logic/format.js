/**
 * Number and text formatting for the HUD and the menus (ART_UX 7.1: tabular, left-to-right numbers inside <bdi>).
 * Pure module: no DOM, no three.
 * @module ui/logic/format
 */

/**
 * Western digits with comma thousands separators, rounded to an integer (1,240). Negative numbers keep a minus.
 * @param {number} n
 * @returns {string}
 */
export function formatInt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const r = Math.round(n);
  const neg = r < 0;
  let s = String(Math.abs(r));
  let out = '';
  while (s.length > 3) {
    out = ',' + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  return (neg ? '-' : '') + s + out;
}

/**
 * Compact form for damage numbers and big counts: below 10,000 the full integer, then 12.3k, 123k, 1.2M.
 * @param {number} n
 * @returns {string}
 */
export function formatCompact(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a < 10000) return formatInt(n);
  if (a < 100000) return sign + trim1(a / 1000) + 'k';
  if (a < 1000000) return sign + Math.round(a / 1000) + 'k';
  if (a < 10000000) return sign + trim1(a / 1000000) + 'M';
  return sign + Math.round(a / 1000000) + 'M';
}

/** One decimal without a trailing '.0'. @param {number} v */
function trim1(v) {
  const r = Math.floor(v * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

/**
 * Seconds as m:ss (race timers, play time under an hour) or h:mm:ss.
 * @param {number} seconds
 * @returns {string}
 */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (/** @type {number} */ v) => (v < 10 ? '0' : '') + v;
  return h > 0 ? h + ':' + two(m) + ':' + two(ss) : m + ':' + two(ss);
}

/**
 * Percent 0..1 to an integer string without the sign ('64').
 * @param {number} k
 * @returns {string}
 */
export function formatPct(k) {
  const v = Number.isFinite(k) ? k : 0;
  return String(Math.round(Math.min(1, Math.max(0, v)) * 100));
}

/**
 * A signed delta for comparison sheets: '+4', '-2', '0'.
 * @param {number} d
 * @returns {string}
 */
export function formatDelta(d) {
  if (!Number.isFinite(d) || Math.round(d) === 0) return '0';
  return (d > 0 ? '+' : '') + formatInt(d);
}

/**
 * Characters of a dialogue line visible after `t` seconds of typing at `cps` characters per second.
 * @param {number} length @param {number} t @param {number} [cps=45]
 * @returns {number}
 */
export function typedChars(length, t, cps = 45) {
  if (!(t > 0)) return 0;
  return Math.min(length, Math.floor(t * cps));
}

/**
 * Scale 0..1 quantised to 1/500 so unchanged bars never rewrite their transform.
 * @param {number} v
 * @returns {number}
 */
export function quantize(v) {
  const c = v > 1 ? 1 : v > 0 ? v : 0;
  return Math.round(c * 500) / 500;
}
