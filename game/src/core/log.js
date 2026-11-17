/**
 * Logging (ARCHITECTURE 3.9): `log.info / warn / error(tag, ...args)`. Every error is recorded as a string in
 * `log.errors`, which is the same array as `__GAME__.errors`; tests assert it stays empty.
 * @module core/log
 */

/** Recorded error strings are cut to this many characters. */
const MAX_MESSAGE = 600;
/** At most this many errors are kept; later ones only increase `log.dropped`. */
const MAX_ERRORS = 500;

/**
 * @typedef {object} Log
 * @property {(tag:string, ...args:any[]) => void} info    console.info in dev and test builds only
 * @property {(tag:string, ...args:any[]) => void} warn
 * @property {(tag:string, ...args:any[]) => void} error   recorded in `errors`
 * @property {(message:string) => void} record             record an error string without printing (console.error trap, assertions)
 * @property {string[]} errors                             every recorded error, oldest first
 * @property {number} dropped                              errors not kept because `errors` was full
 * @property {(fn:(message:string) => void) => () => void} onError   called after each recorded error; returns an unsubscribe
 * @property {Console|null} console                        the console methods captured at creation (unpatched)
 */

/**
 * Turn log arguments into one readable line.
 * @param {any[]} args
 * @returns {string}
 */
export function formatArgs(args) {
  const parts = [];
  for (const a of args) {
    if (a instanceof Error) parts.push(a.name + ': ' + a.message);
    else if (typeof a === 'string') parts.push(a);
    else if (a === undefined || a === null || typeof a !== 'object') parts.push(String(a));
    else {
      try {
        parts.push(JSON.stringify(a));
      } catch (e) {
        parts.push(Object.prototype.toString.call(a));
      }
    }
  }
  const s = parts.join(' ');
  return s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE) + '…' : s;
}

/**
 * Create the logger.
 * @param {{ dev?:boolean, console?:Console|null }} [opts]  dev: print `info` lines; console: defaults to globalThis.console
 * @returns {Log}
 */
export function createLog(opts = {}) {
  const con = opts.console !== undefined ? opts.console : typeof console !== 'undefined' ? console : null;
  // Capture the methods now so a later console.error trap (errors.js) does not record log.error twice.
  const out = con
    ? { info: con.info.bind(con), warn: con.warn.bind(con), error: con.error.bind(con) }
    : null;
  const dev = !!opts.dev;
  /** @type {Array<(message:string) => void>} */
  let listeners = [];

  /** @type {Log} */
  const log = {
    errors: [],
    dropped: 0,
    console: con,

    info(tag, ...args) {
      if (dev && out) out.info('[' + tag + ']', ...args);
    },

    warn(tag, ...args) {
      if (out) out.warn('[' + tag + ']', ...args);
    },

    error(tag, ...args) {
      if (out) out.error('[' + tag + ']', ...args);
      log.record('[' + tag + '] ' + formatArgs(args));
    },

    record(message) {
      const m = String(message);
      if (log.errors.length < MAX_ERRORS) log.errors.push(m.length > MAX_MESSAGE ? m.slice(0, MAX_MESSAGE) + '…' : m);
      else log.dropped++;
      for (const fn of listeners) {
        try {
          fn(m);
        } catch (e) {
          // a failing error listener must never recurse into the logger
        }
      }
    },

    onError(fn) {
      listeners = listeners.concat([fn]);
      return () => {
        listeners = listeners.filter((f) => f !== fn);
      };
    },
  };
  return log;
}
