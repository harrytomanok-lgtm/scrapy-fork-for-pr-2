/**
 * Error traps and the fallback fatal layer (ARCHITECTURE 3.1 and 3.9).
 *
 * Traps: `window` error and unhandledrejection, and `console.error`, all recorded through `log` (so they appear
 * in `__GAME__.errors`) and reported as `error { message, fatal:false }` once a context exists.
 * WebGL context loss pauses the sim (pause reason 'context'), shows a 'restoring' toast and `render.restore()` runs
 * on restore; when no restore comes within CONTEXT_RESTORE_MS of visible time the fatal screen replaces the frozen
 * canvas (the timer never runs while the page is hidden). The running journey is saved before the fatal screen.
 * Fatal errors: the ui package's `fatal` screen once it is installed; before that, or when `ui.open` throws,
 * the foundation's own fatal layer in `dom.layer('fatal')`.
 * @module core/errors
 */

import { STRINGS } from './strings.js';

/** Pause reason used while the WebGL context is lost. */
export const CONTEXT_PAUSE = 'context';
/** How long a lost WebGL context may stay lost before the fatal screen is shown (ms). */
export const CONTEXT_RESTORE_MS = 8000;
/** A context lost for longer than this shows the 'restoring' toast (ms). */
export const CONTEXT_NOTICE_MS = 1000;
/**
 * Optional string key of the fatal layer's "try low quality" button (ART_UX 7.2). The button is shown only when a
 * string table defines it, so the fallback layer works with any foundation string set.
 */
const LOW_QUALITY_KEY = 'core.fatal.lowQuality';

/**
 * @typedef {object} ErrorService
 * @property {(ctx:object) => void} attach        give the traps a context (bus, i18n, ui, time, render, loop)
 * @property {(err:unknown) => void} fatal         stop the game and show the fatal screen; never throws
 * @property {(message:string) => HTMLElement|null} showFatalLayer   the foundation's fallback fatal layer
 * @property {(canvas:HTMLCanvasElement) => void} watchContext       webglcontextlost / restored handling for the game canvas
 * @property {boolean} fatalShown
 * @property {() => void} dispose                  remove the traps (tests)
 */

/** @param {unknown} err @returns {string} */
export function errorMessage(err) {
  if (err instanceof Error) return err.stack && err.stack.indexOf(err.message) >= 0 ? err.stack : err.name + ': ' + err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

/**
 * Install the error traps.
 * @param {{ log:import('./log.js').Log, dom:import('./dom.js').Dom|null, lang?:'he'|'en', win?:any, doc?:any, restoreMs?:number }} opts
 *   restoreMs: overrides CONTEXT_RESTORE_MS (tests); doc: replaces `document` for the visibility checks (tests)
 * @returns {ErrorService}
 */
export function createErrors(opts) {
  const log = opts.log;
  const win = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? window : null;
  /** @type {any} */
  let ctx = null;
  /** @type {Array<() => void>} */
  const undo = [];

  /** @param {string} key @returns {string} */
  function t(key) {
    const i18n = ctx && ctx.i18n;
    if (i18n && i18n.has(key)) return i18n.t(key);
    const lang = (i18n && i18n.lang) || opts.lang || 'he';
    const table = /** @type {Record<string, Record<string, string>>} */ (STRINGS)[lang] || STRINGS.en;
    return table[key] || '';
  }

  /** @param {string} message @param {boolean} fatal */
  function report(message, fatal) {
    const bus = ctx && ctx.bus;
    if (!bus) return;
    try {
      bus.emit('error', { message, fatal });
    } catch (e) {
      // the error event itself failed (strict bus during shutdown); the message is already recorded
    }
  }

  if (win && typeof win.addEventListener === 'function') {
    /** @param {ErrorEvent} e */
    const onError = (e) => {
      const msg = e && e.error ? errorMessage(e.error) : (e && e.message) || 'unknown error';
      log.error('uncaught', msg);
      report(msg, false);
    };
    /** @param {PromiseRejectionEvent} e */
    const onRejection = (e) => {
      const msg = errorMessage(e ? e.reason : 'unknown rejection');
      log.error('unhandledrejection', msg);
      report(msg, false);
    };
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    undo.push(() => {
      win.removeEventListener('error', onError);
      win.removeEventListener('unhandledrejection', onRejection);
    });
  }

  const con = /** @type {any} */ (log.console);
  if (con && typeof con.error === 'function') {
    const original = con.error;
    const trapped = function trappedConsoleError(...args) {
      original.apply(con, args);
      const parts = [];
      for (const a of args) parts.push(a instanceof Error ? a.name + ': ' + a.message : String(a));
      log.record('[console] ' + parts.join(' '));
    };
    con.error = trapped;
    undo.push(() => {
      if (con.error === trapped) con.error = original;
    });
  }

  /** @type {ErrorService} */
  const service = {
    fatalShown: false,

    attach(c) {
      ctx = c;
    },

    showFatalLayer(message) {
      const dom = opts.dom;
      if (!dom) return null;
      const layer = dom.layer('fatal');
      dom.clear(layer);
      const wrap = dom.el('div', 'k-fatal', layer);
      wrap.setAttribute('role', 'alertdialog');
      const panel = dom.el('div', 'k-fatal-panel', wrap);
      dom.el('h1', 'k-fatal-title', panel, t('core.fatal.title'));
      dom.el('p', 'k-fatal-body', panel, t('core.fatal.body'));
      dom.el('pre', 'k-fatal-msg k-select', panel, message);
      const actions = dom.el('div', 'k-fatal-actions', panel);
      const reload = /** @type {HTMLButtonElement} */ (dom.el('button', 'k-btn', actions, t('core.fatal.reload')));
      reload.type = 'button';
      reload.addEventListener('click', () => {
        if (win && win.location) win.location.reload();
      });
      if (t(LOW_QUALITY_KEY)) {
        const low = /** @type {HTMLButtonElement} */ (dom.el('button', 'k-btn', actions, t(LOW_QUALITY_KEY)));
        low.type = 'button';
        low.addEventListener('click', () => {
          if (!win || !win.location) return;
          const url = new URL(win.location.href);
          url.searchParams.set('quality', 'low');
          win.location.href = url.toString();
        });
      }
      service.fatalShown = true;
      return layer;
    },

    fatal(err) {
      const message = errorMessage(err);
      log.error('fatal', message);
      report(message, true);
      // The fatal screen's only way out is a reload: keep the running journey first (save.load puts the
      // player back at the respawn Ringstone).
      if (ctx && ctx.session && ctx.session.running && ctx.save && ctx.player && !service.fatalShown) {
        try {
          ctx.save.write('fatal');
        } catch (e) {
          log.warn('fatal', 'save before the fatal screen failed', errorMessage(e));
        }
      }
      if (ctx) {
        try {
          if (ctx.loop) ctx.loop.stop();
        } catch (e) {
          // the loop may be half-built when boot fails; the fatal screen below still shows
        }
      }
      const owner = ctx && ctx.providers ? ctx.providers.ui : null;
      const realUi = ctx && ctx.ui && typeof owner === 'string' && owner.indexOf('standin:') !== 0;
      if (realUi) {
        try {
          ctx.ui.open('fatal', { message });
          service.fatalShown = true;
          return;
        } catch (e) {
          log.error('fatal', 'ui.open(fatal) threw:', errorMessage(e));
        }
      }
      service.showFatalLayer(message);
    },

    watchContext(canvas) {
      /** @type {any} */
      let giveUp = null;
      /** @type {any} */
      let notice = null;
      let lost = false;
      const restoreMs = typeof opts.restoreMs === 'number' ? opts.restoreMs : CONTEXT_RESTORE_MS;
      const doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
      const hidden = () => !!(doc && doc.hidden);
      const clearGiveUp = () => {
        if (giveUp !== null) clearTimeout(giveUp);
        giveUp = null;
      };
      const clearTimers = () => {
        clearGiveUp();
        if (notice !== null) clearTimeout(notice);
        notice = null;
      };
      // Android drops the GPU context of a background tab and restores it only once the page is visible again:
      // the give-up timer runs only while the page is visible, and starts afresh each time it becomes visible.
      const armGiveUp = () => {
        if (giveUp !== null || !lost || hidden() || service.fatalShown) return;
        giveUp = setTimeout(() => {
          giveUp = null;
          if (!lost || hidden() || service.fatalShown) return;
          service.fatal(t('core.fatal.contextGone'));
        }, restoreMs);
      };
      const onVisibility = () => {
        if (hidden()) clearGiveUp();
        else armGiveUp();
      };
      const onLost = (e) => {
        e.preventDefault();
        log.warn('webgl', 'context lost');
        if (ctx && ctx.time) ctx.time.pause(CONTEXT_PAUSE);
        if (lost) return;
        lost = true;
        // Most restores take a few frames: the 'restoring' toast appears only when the loss lasts.
        notice = setTimeout(() => {
          notice = null;
          try {
            if (ctx && ctx.bus) ctx.bus.emit('ui:toast', { key: 'core.fatal.contextLost', args: null, kind: 'warn' });
          } catch (err) {
            // the toast is a courtesy; the restore does not depend on it
          }
        }, CONTEXT_NOTICE_MS);
        armGiveUp();
      };
      const onRestored = () => {
        lost = false;
        clearTimers();
        log.warn('webgl', 'context restored');
        try {
          if (ctx && ctx.render) ctx.render.restore();
        } catch (e) {
          service.fatal(e);
          return;
        }
        if (ctx && ctx.time) ctx.time.resume(CONTEXT_PAUSE);
      };
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
      if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
      undo.push(() => {
        clearTimers();
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
      });
    },

    dispose() {
      while (undo.length) /** @type {() => void} */ (undo.pop())();
    },
  };
  return service;
}
