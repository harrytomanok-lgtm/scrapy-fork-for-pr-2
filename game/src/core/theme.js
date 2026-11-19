/**
 * Theme tokens and base CSS (ARCHITECTURE 3.9, ART_UX 6.1 and 7.1): colour tokens and font stacks on `#app`,
 * `height: 100%` sizing, the layer stack, safe-area custom properties, gesture hygiene on the game layers,
 * the cancelled context menu, and the styles of the foundation's fallback loading and fatal layers.
 * `baseCss()` is pure (tools/build.mjs inlines it into the HTML shells); `applyTheme` installs it at boot.
 * @module core/theme
 */

/** The single external stylesheet of the game (ART_UX 7.1). The page must look right when it fails to load. */
export const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Secular+One&display=swap';

/** Colour tokens of ART_UX 7.1 (CSS custom properties without the leading dashes). */
export const THEME_TOKENS = Object.freeze({
  ink: '#1B1626',
  paper: '#F3EBDD',
  'paper-dim': '#D9CDB8',
  panel: 'rgba(27,22,38,0.86)',
  line: '#4A3F5C',
  accent: '#7FF2E0',
  warn: '#FFB547',
  danger: '#E8505B',
  ok: '#7FD18B',
  hp: '#E8505B',
  'rarity-c': '#F3EBDD',
  'rarity-f': '#7FD18B',
  'rarity-r': '#5FB6FF',
});

/** Font stacks of ART_UX 7.1. */
export const FONT_STACKS = Object.freeze({
  body: '"Rubik", "Noto Sans Hebrew", "Arial Hebrew", "Segoe UI", system-ui, sans-serif',
  display: '"Secular One", "Rubik", "Arial Hebrew", system-ui, sans-serif',
});

/** Type scale in rem (ART_UX 7.1). */
export const TYPE_SCALE = Object.freeze({ banner: 2.5, title: 1.75, h2: 1.25, body: 1, small: 0.8125 });

/** Layers that receive the gesture hygiene of ART_UX 6.1. */
const GAME_LAYERS = ['canvas', 'touch', 'hud'];

/**
 * The base stylesheet. Line heights are fixed so a failed font load never shifts layout.
 * @returns {string}
 */
export function baseCss() {
  const tokens = Object.entries(THEME_TOKENS).map(([k, v]) => `--${k}:${v};`).join('');
  const scale = Object.entries(TYPE_SCALE).map(([k, v]) => `--fs-${k}:calc(${v}rem * var(--text-scale));`).join('');
  const hygiene = GAME_LAYERS.map((n) => `.k-layer-${n}`).join(',');
  return [
    // overflow:clip (after the hidden fallback) forbids programmatic scrolling too: a focus() or scrollIntoView()
    // inside a screen must never shift the whole game, which overflow:hidden allows.
    'html,body{height:100%;margin:0;padding:0;overflow:hidden;overflow:clip;background:#1B1626;overscroll-behavior:none;}',
    'body{-webkit-text-size-adjust:100%;text-size-adjust:100%;}',
    `#app{${tokens}${scale}--text-scale:1;--font-body:${FONT_STACKS.body};--font-display:${FONT_STACKS.display};`,
    '--safe-top:max(16px, env(safe-area-inset-top));--safe-bottom:max(16px, env(safe-area-inset-bottom));',
    '--safe-left:max(16px, env(safe-area-inset-left));--safe-right:max(16px, env(safe-area-inset-right));',
    'position:relative;width:100%;height:100%;overflow:hidden;overflow:clip;background:var(--ink);color:var(--paper);',
    'font-family:var(--font-body);font-size:var(--fs-body);line-height:1.4;font-variant-numeric:tabular-nums;',
    'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}',
    '#app *,#app *::before,#app *::after{box-sizing:border-box;}',
    // Layers let pointer events through except on interactive elements, so a full-size HUD container never
    // blocks the touch controls below it; an open screen or the fatal layer takes all pointer input.
    '.k-layer{position:absolute;inset:0;pointer-events:none;}',
    '.k-layer [data-action],.k-layer button,.k-layer input,.k-layer textarea,.k-layer select,.k-layer a,.k-layer .k-hit,.k-layer .k-select{pointer-events:auto;}',
    '.k-layer-canvas,.k-layer-screens:not(:empty),.k-layer-fatal:not(:empty){pointer-events:auto;}',
    '.k-layer-canvas canvas{display:block;width:100%;height:100%;}',
    `${hygiene}{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;`,
    '-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}',
    '.k-select,.k-select *{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;}',
    '.flip-rtl:dir(rtl){transform:scaleX(-1);}',
    // fallback loading layer (3.1)
    '.k-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:16px;background:var(--ink);color:var(--paper);}',
    '.k-loading-title{font-family:var(--font-display);font-size:var(--fs-title);line-height:1.2;letter-spacing:0.02em;}',
    '.k-loading-ring{width:96px;height:96px;}',
    '.k-loading-ring circle{fill:none;stroke-width:6;}',
    '.k-loading-track{stroke:var(--line);}',
    '.k-loading-fill{stroke:var(--accent);stroke-linecap:round;transition:stroke-dashoffset 120ms linear;}',
    '.k-loading-text{font-size:var(--fs-small);line-height:1.4;min-height:1.4em;color:var(--paper-dim);}',
    '.k-loading-title:empty{min-height:calc(var(--fs-title) * 1.2);}',
    // indeterminate ring of the static splash, until the script reports progress
    '.k-loading-ring.k-spin{animation:k-spin 1.1s linear infinite;}',
    '@keyframes k-spin{to{transform:rotate(360deg);}}',
    // fallback fatal layer (3.1)
    '.k-fatal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);',
    'background:rgba(27,22,38,0.94);}',
    '.k-fatal-panel{max-width:560px;width:100%;background:var(--panel);border:2px solid var(--paper);padding:20px;',
    'clip-path:polygon(12px 0,100% 0,100% 100%,0 100%,0 12px);display:flex;flex-direction:column;gap:12px;}',
    '.k-fatal-title{font-family:var(--font-display);font-size:var(--fs-h2);line-height:1.3;margin:0;}',
    '.k-fatal-body{margin:0;line-height:1.4;}',
    '.k-fatal-msg{margin:0;padding:10px;max-height:40vh;overflow:auto;background:var(--ink);border:1px solid var(--line);',
    'font-family:ui-monospace,monospace;font-size:var(--fs-small);line-height:1.4;white-space:pre-wrap;word-break:break-word;direction:ltr;text-align:left;}',
    '.k-fatal-actions{display:flex;flex-wrap:wrap;gap:8px;}',
    '.k-btn{min-height:48px;min-width:48px;padding:0 18px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);',
    'font-family:var(--font-display);font-size:var(--fs-body);line-height:1;cursor:pointer;}',
    '.k-btn:active{transform:scale(0.94);}',
    // debug overlay and benchmark panel (foundation diagnostics)
    '.k-debug{position:absolute;top:var(--safe-top);left:var(--safe-left);padding:4px 8px;background:var(--panel);',
    'font-family:ui-monospace,monospace;font-size:12px;line-height:1.35;white-space:pre;direction:ltr;pointer-events:none;}',
    '.k-bench{position:absolute;inset:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);display:flex;flex-direction:column;gap:8px;',
    'padding:12px;background:var(--panel);border:2px solid var(--paper);direction:ltr;}',
    '.k-bench pre{flex:1;margin:0;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;line-height:1.35;}',
    '@media (prefers-reduced-motion: reduce){.k-loading-fill{transition:none;}.k-loading-ring.k-spin{animation:none;}}',
  ].join('\n');
}

/**
 * Install the base CSS and the gesture hygiene: cancels `contextmenu` on `#app` (except inside `.k-select`
 * text blocks) and registers a non-passive `touchstart` with preventDefault on the canvas layer.
 * The touch and HUD layers get the CSS half here; their owners register their own non-passive listeners.
 * @param {import('./dom.js').Dom} dom
 */
export function applyTheme(dom) {
  dom.addStyle('core.theme', baseCss());
  dom.root.addEventListener('contextmenu', (e) => {
    const t = /** @type {Element|null} */ (e.target);
    if (!(t && typeof t.closest === 'function' && t.closest('.k-select'))) e.preventDefault();
  });
  dom.guardTouch(dom.layer('canvas'));
  // Safety net behind overflow:clip: nothing may leave the page or the game root scrolled (an on-screen keyboard
  // or a focus call can scroll roots that are not scrollable by the user), or the whole game would sit shifted.
  const doc = dom.root.ownerDocument;
  const win = doc && doc.defaultView;
  if (doc && win && typeof win.addEventListener === 'function') {
    const unscroll = () => {
      const se = doc.scrollingElement || doc.documentElement;
      if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
      if (doc.body && (doc.body.scrollTop || doc.body.scrollLeft)) { doc.body.scrollTop = 0; doc.body.scrollLeft = 0; }
      if (dom.root.scrollTop || dom.root.scrollLeft) { dom.root.scrollTop = 0; dom.root.scrollLeft = 0; }
    };
    dom.root.addEventListener('scroll', unscroll, { passive: true });
    win.addEventListener('scroll', unscroll, { passive: true });
  }
}

/**
 * Apply the text-size setting (ART_UX 7.1: 90 / 100 / 115 / 130%).
 * @param {import('./dom.js').Dom} dom
 * @param {number} scale 0.9..1.3
 */
export function setTextScale(dom, scale) {
  const s = Number.isFinite(scale) ? Math.min(1.3, Math.max(0.9, scale)) : 1;
  dom.root.style.setProperty('--text-scale', String(s));
}

/** Radius of the loading ring in its 96 x 96 view box. */
export const RING_R = 42;
/** Circumference of the loading ring. */
export const RING_LEN = 2 * Math.PI * RING_R;

/**
 * Markup of the static boot splash that tools/build.mjs puts inside `#app`, so the loading screen is painted with
 * the HTML, before the script is downloaded and parsed (ARCHITECTURE 7.1 boot budget). It is the foundation's
 * loading layer in its initial state: `dom.layer('overlay')` adopts the layer and `createLoadingLayer` the
 * `.k-loading` node, which then shows the title and the real progress. Language-neutral (no text): the
 * language is known only once the script reads the flags and settings. Pure.
 * @returns {string}
 */
export function splashMarkup() {
  const c = (cls, extra) => `<circle class="${cls}" cx="48" cy="48" r="${RING_R}"${extra}></circle>`;
  const len = RING_LEN.toFixed(2);
  return [
    '<div class="k-layer k-layer-overlay" data-layer="overlay" style="z-index:50">',
    '<div class="k-loading" role="status" aria-busy="true">',
    '<div class="k-loading-title"></div>',
    '<svg class="k-loading-ring k-spin" viewBox="0 0 96 96" aria-hidden="true">',
    c('k-loading-track', ''),
    c('k-loading-fill', ` transform="rotate(-90 48 48)" stroke-dasharray="${len}" stroke-dashoffset="${(RING_LEN * 0.72).toFixed(2)}"`),
    '</svg>',
    '<div class="k-loading-text"></div>',
    '</div>',
    '</div>',
  ].join('');
}
