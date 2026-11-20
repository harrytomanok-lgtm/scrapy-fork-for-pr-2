/**
 * URL flags (ARCHITECTURE 2.6), read once into `ctx.flags`.
 * `parseFlags` is pure (Node tests); `readFlags` reads `location.search` when a browser is present.
 * @module core/flags
 */

/**
 * @typedef {object} SpawnFlag
 * @property {string|null} landmark  landmark or POI id (`spawn=<id>`), or null for coordinates
 * @property {number} x              metres (0 when `landmark` is set)
 * @property {number} z
 */

/**
 * @typedef {object} Flags
 * @property {boolean} test          test mode: no title, no autosave, memory-only storage, step-driven sim
 * @property {boolean} autoplay      with test: run the sim in real time
 * @property {'low'|'high'|null} quality   forced quality tier
 * @property {number|null} res       fixed render scale 0.3..2 (on the low tier it is the pixel ratio; disables dynamic resolution)
 * @property {number|null} seed      seed of rng.sim and rng.fx (test mode defaults to 1)
 * @property {number|null} worldseed world seed override (default WORLD_SEED)
 * @property {'he'|'en'|null} lang   forced language (null: the saved setting, default 'he')
 * @property {4|8|null} grid         forced height-grid cell size
 * @property {SpawnFlag|null} spawn  start position
 * @property {number|null} hour      start hour 0..24; the clock is frozen
 * @property {0|1} tutorial          1: play MQ1; 0: the tutorial=0 shortcut (default 1, 0 in test mode)
 * @property {boolean} nosave        memory-only storage (also implied by test and bench)
 * @property {boolean} noaudio       no AudioContext
 * @property {boolean} debug         debug overlay
 * @property {boolean} fps           FPS counter
 * @property {boolean} bench         run the benchmark of 7.3 after boot
 * @property {boolean} fpscap        frame cap on (default); `fpscap=0` presents every vsync (benchmarks)
 * @property {Record<string, string>} raw   every query parameter as given (package-specific extras)
 */

/** @param {string|null} v @returns {boolean} */
function bool(v) {
  return v !== null && v !== '0' && v !== 'false' && v !== 'off';
}

/** @param {string|null} v @returns {number|null} an integer, or null */
function int(v) {
  if (v === null || !/^-?\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** @param {string|null} v @returns {number|null} a finite number, or null */
function num(v) {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {string|null} v @returns {SpawnFlag|null} */
function spawnOf(v) {
  if (v === null) return null;
  const s = v.trim();
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { landmark: null, x: Number(m[1]), z: Number(m[2]) };
  return /^[a-z][a-z0-9_]*$/.test(s) ? { landmark: s, x: 0, z: 0 } : null;
}

/**
 * Parse a query string into flags. Unknown or malformed values fall back to the defaults.
 * @param {string} [search=''] e.g. '?test=1&seed=123'
 * @returns {Flags}
 */
export function parseFlags(search = '') {
  const q = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search);
  const get = (k) => q.get(k);
  const test = bool(get('test'));
  const bench = bool(get('bench'));
  const quality = get('quality');
  const lang = get('lang');
  const gridN = int(get('grid'));
  const resN = num(get('res'));
  const hourN = num(get('hour'));
  const tut = get('tutorial');
  /** @type {Record<string, string>} */
  const raw = {};
  for (const [k, v] of q) raw[k] = v;
  return {
    test,
    autoplay: test && bool(get('autoplay')),
    quality: quality === 'low' || quality === 'high' ? quality : null,
    res: resN === null ? null : Math.min(2, Math.max(0.3, resN)),
    seed: int(get('seed')),
    worldseed: int(get('worldseed')),
    lang: lang === 'he' || lang === 'en' ? lang : null,
    grid: gridN === 4 || gridN === 8 ? gridN : null,
    spawn: spawnOf(get('spawn')),
    hour: hourN === null ? null : ((hourN % 24) + 24) % 24,
    tutorial: tut === '0' || tut === '1' ? /** @type {0|1} */ (Number(tut)) : test ? 0 : 1,
    nosave: test || bench || bool(get('nosave')),
    noaudio: bool(get('noaudio')),
    debug: bool(get('debug')),
    fps: bool(get('fps')),
    bench,
    fpscap: get('fpscap') === null ? true : bool(get('fpscap')),
    raw,
  };
}

/**
 * Read the flags of the current page (`location.search`), or the defaults outside a browser.
 * @returns {Flags}
 */
export function readFlags() {
  const loc = typeof location !== 'undefined' ? location : null;
  return parseFlags(loc && typeof loc.search === 'string' ? loc.search : '');
}
