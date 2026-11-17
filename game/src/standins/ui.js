/**
 * Stand-in `ctx.ui` (ARCHITECTURE 4.13, 8.0; ART_UX 6.6 and 7.1): a plain but real HUD (medallion with level and
 * Surge ring, HP and Ora bars, Resonance, XP line, target or boss frame, toasts, banners, interact pill,
 * tutorial line, Pause button, session-only warning) and the screens `loading`, `title` (Continue, New Journey,
 * language), `pause` (stats and allocation), `dialogue`, `death` and `confirm`, plus `registerScreen` for
 * package screens. Opening any screen pauses the sim (`time.pause('menu')`) and sets input context 'ui'; all
 * UI input comes from `input.onPress` and DOM events. A level-up is a banner, never a screen. All text goes
 * through `ctx.i18n`; layout uses logical properties and safe-area insets; bars fill from the start side.
 * Frame system: `standin.ui.hud` (phase ui). Replaced by the ui package.
 * @module standins/ui
 */

import { BALANCE } from '../core/balance.js';
import { UI_STRINGS } from './strings.js';

const OWNER = 'standin:ui';
const TEXT_PERIOD = 1 / 15;
const TOASTS = 2;
const TOAST_SECONDS = 3;
const BANNER_SECONDS = 2.2;
const RING = 2 * Math.PI * 27;

const CSS = `
.ui-hud{position:absolute;inset:0;pointer-events:none;font-family:var(--font-body);color:var(--paper)}
.ui-hud[hidden]{display:none}
.ui-top{position:absolute;inset-block-start:var(--safe-top);inset-inline-start:var(--safe-left);display:flex;gap:8px;align-items:flex-start}
.ui-med{position:relative;inline-size:48px;block-size:48px;flex:none;border-radius:50%;background:var(--panel);border:2px solid var(--paper);
  display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:1.25rem;line-height:1}
.ui-med svg{position:absolute;inset:-5px;inline-size:calc(100% + 10px);block-size:calc(100% + 10px);transform:rotate(-90deg)}
.ui-med circle{fill:none;stroke-width:4}
.ui-ring-track{stroke:rgba(27,22,38,.6)}
.ui-ring-fill{stroke:var(--warn);stroke-linecap:round}
.ui-cols{display:flex;flex-direction:column;gap:4px;padding-block-start:2px}
.ui-bar{position:relative;inline-size:220px;block-size:12px;background:#2A2233;border:1px solid var(--ink);overflow:hidden}
.ui-bar.ui-ora{inline-size:200px;block-size:8px}
.ui-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(1)}
#app[dir=rtl] .ui-fill{transform-origin:right center}
.ui-hp .ui-fill{background:var(--hp)}
.ui-chip{background:#FFD0A0}
.ui-ora .ui-fill{background:var(--accent)}
.ui-ticks{position:absolute;inset:0;background-image:repeating-linear-gradient(to right,transparent 0,transparent calc(var(--tick) - 1px),rgba(27,22,38,.8) calc(var(--tick) - 1px),rgba(27,22,38,.8) var(--tick))}
#app[dir=rtl] .ui-ticks{background-image:repeating-linear-gradient(to left,transparent 0,transparent calc(var(--tick) - 1px),rgba(27,22,38,.8) calc(var(--tick) - 1px),rgba(27,22,38,.8) var(--tick))}
.ui-res{font-family:var(--font-display);font-size:18px;line-height:1.1;text-shadow:-1px -1px 0 var(--ink),1px -1px 0 var(--ink),-1px 1px 0 var(--ink),1px 1px 0 var(--ink),0 0 5px var(--ink)}
.ui-xp{position:absolute;inset-inline:0;inset-block-end:0;block-size:2px;background:rgba(27,22,38,.6)}
.ui-xp .ui-fill{background:var(--paper)}
.ui-end{position:absolute;inset-block-start:var(--safe-top);inset-inline-end:var(--safe-right);display:flex;gap:8px;align-items:center}
.ui-pausebtn{inline-size:48px;block-size:48px;min-inline-size:48px;padding:0;border:2px solid var(--paper);border-radius:50%;background:var(--panel);
  color:var(--paper);display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;touch-action:manipulation}
.ui-pausebtn i{display:block;inline-size:5px;block-size:16px;background:var(--paper);border-radius:1px}
.ui-pausebtn:active{transform:scale(.94)}
.ui-warn{inline-size:24px;block-size:24px;border-radius:50%;background:var(--warn);color:var(--ink);font-family:var(--font-display);
  display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1}
.ui-target{position:absolute;inset-block-start:calc(var(--safe-top) + 28px);left:50%;transform:translateX(-50%);inline-size:240px;
  display:flex;flex-direction:column;gap:3px;align-items:stretch;text-align:center;text-shadow:-1px -1px 0 var(--ink),1px -1px 0 var(--ink),-1px 1px 0 var(--ink),1px 1px 0 var(--ink),0 0 5px var(--ink)}
.ui-target[hidden]{display:none}
.ui-target-name{font-size:var(--fs-small);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ui-target .ui-bar{inline-size:100%;block-size:8px}
.ui-target .ui-fill{background:var(--hostile,#B06CFF)}
.ui-target.ui-boss .ui-fill{background:var(--danger)}
.ui-poise{block-size:4px!important}
.ui-poise .ui-fill{background:var(--paper-dim)!important}
.ui-toasts{position:absolute;inset-block-start:calc(var(--safe-top) + 68px);left:50%;transform:translateX(-50%);inline-size:240px;display:flex;flex-direction:column;gap:6px;align-items:center}
.ui-toast{max-inline-size:240px;padding:6px 12px;background:var(--panel);border:2px solid var(--paper);font-size:var(--fs-small);line-height:1.3;text-align:center;
  opacity:0;transition:opacity 180ms ease-out}
.ui-toast.ui-on{opacity:1}
.ui-toast.ui-good{border-color:var(--ok)}
.ui-toast.ui-warnk{border-color:var(--warn)}
.ui-banner{position:absolute;top:28%;left:50%;transform:translate(-50%,-50%);padding:8px 24px;background:var(--paper);color:var(--ink);
  font-family:var(--font-display);font-size:var(--fs-title);line-height:1.2;white-space:nowrap;opacity:0;transition:opacity 180ms ease-out;
  clip-path:polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)}
.ui-banner.ui-on{opacity:1}
.ui-pill{position:absolute;inset-block-end:calc(var(--safe-bottom) + 64px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;
  min-block-size:40px;padding:4px 14px 4px 6px;border:2px solid var(--paper);border-radius:22px;background:var(--panel);font-size:var(--fs-body);line-height:1.2;cursor:pointer}
.ui-pill[hidden]{display:none}
.ui-key{min-inline-size:28px;block-size:28px;padding:0 6px;border-radius:14px;background:var(--paper);color:var(--ink);font-family:var(--font-display);
  display:flex;align-items:center;justify-content:center;font-size:var(--fs-small)}
.ui-tut{position:absolute;inset-block-end:calc(var(--safe-bottom) + 116px);left:50%;transform:translateX(-50%);max-inline-size:80%;text-align:center;
  font-size:var(--fs-small);text-shadow:-1px -1px 0 var(--ink),1px -1px 0 var(--ink),-1px 1px 0 var(--ink),1px 1px 0 var(--ink),0 0 5px var(--ink)}
.ui-tut[hidden]{display:none}
.ui-letter{position:absolute;inset-inline:0;block-size:10%;background:#000;transition:transform 300ms}
.ui-letter[hidden]{display:none}
.ui-fade{position:absolute;inset:0;background:var(--ink);opacity:0;pointer-events:none;transition:opacity 300ms linear}
.ui-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);background:rgba(27,22,38,.55);pointer-events:auto}
.ui-screen[hidden]{display:none}
.ui-screen.ui-solid{background:var(--ink)}
.ui-screen.ui-low{align-items:flex-end;background:transparent}
.ui-panel{position:relative;inline-size:100%;max-inline-size:560px;max-block-size:100%;overflow:auto;padding:14px 16px;background:var(--panel);border:2px solid var(--paper);
  box-shadow:4px 4px 0 rgba(0,0,0,.45);display:flex;flex-direction:column;gap:10px;clip-path:polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)}
#app[dir=rtl] .ui-panel{clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
.ui-ribbon{align-self:flex-start;margin:0;padding:2px 14px;background:var(--paper);color:var(--ink);font-family:var(--font-display);font-size:var(--fs-h2);line-height:1.3}
.ui-big{margin:0;font-family:var(--font-display);font-size:var(--fs-banner);line-height:1.1;text-align:center}
.ui-sub{margin:0;text-align:center;color:var(--paper-dim);font-size:var(--fs-body);line-height:1.3}
.ui-row{display:flex;flex-wrap:wrap;gap:8px}
.ui-col{display:flex;flex-direction:column;gap:8px}
.ui-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.ui-stats{margin:0;display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:var(--fs-small);line-height:1.4}
.ui-stats dt{color:var(--paper-dim)}
.ui-stats dd{margin:0;text-align:end}
.ui-statrow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-small);min-block-size:40px}
.ui-plus{min-inline-size:40px;min-block-size:40px;padding:0;border:2px solid var(--ink);background:var(--accent);color:var(--ink);font-family:var(--font-display);font-size:1.2rem;cursor:pointer}
.ui-plus[disabled]{opacity:.35;cursor:default}
.ui-btn-wide{inline-size:100%}
.ui-stat2{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}
.ui-btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.ui-btns .k-btn{padding:0 10px;font-size:var(--fs-small)}
.k-btn[disabled]{opacity:.45;cursor:default}
.ui-speaker{margin:0;font-family:var(--font-display);color:var(--accent);font-size:var(--fs-body);line-height:1.3}
.ui-line{margin:0;font-size:var(--fs-body);line-height:1.45;min-block-size:2.9em}
.ui-dlg .ui-panel{max-inline-size:720px;cursor:pointer}
@media (max-width:500px){
  .ui-med{inline-size:40px;block-size:40px;font-size:1.05rem}
  .ui-bar{inline-size:180px;block-size:10px}
  .ui-bar.ui-ora{inline-size:160px}
  .ui-res{font-size:15px}
  .ui-target{inset-block-start:calc(var(--safe-top) + 76px);inline-size:200px}
  .ui-toasts{inset-block-start:auto;inset-block-end:calc(var(--safe-bottom) + 230px)}
  .ui-pill{inset-block-end:calc(var(--safe-bottom) + 190px)}
  .ui-tut{inset-block-end:calc(var(--safe-bottom) + 280px)}
  .ui-big{font-size:var(--fs-title)}
}
@media (max-height:420px){
  .ui-panel{padding:10px 12px;gap:8px}
  .ui-big{font-size:var(--fs-title)}
  .ui-grid{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
}
@media (prefers-reduced-motion:reduce){.ui-toast,.ui-banner,.ui-fade{transition:none}}
`;

/**
 * Create the stand-in ui service.
 * @param {any} ctx
 */
function createUi(ctx) {
  const dom = ctx.dom;
  const doc = dom.doc;
  /** @type {Array<{ node:HTMLElement, key:string, args:any, attr:string|null }>} */
  const bound = [];
  /** @param {string} key @param {any} [args] */
  const t = (key, args) => ctx.i18n.t(key, args);

  /**
   * Element with i18n text bound to the language.
   * @param {string} tag @param {string} cls @param {HTMLElement|null} parent @param {string} [key] @param {any} [args]
   */
  function el(tag, cls, parent, key, args) {
    const n = dom.el(tag, cls, parent || undefined);
    if (key) {
      n.textContent = t(key, args);
      bound.push({ node: n, key, args: args || null, attr: null });
    }
    return n;
  }
  /** Bind an attribute (aria-label, title) to a key. */
  function attr(node, name, key) {
    node.setAttribute(name, t(key));
    bound.push({ node, key, args: null, attr: name });
  }
  /** Set number text inside a <bdi>. */
  function numText(node, n) {
    node.textContent = ctx.i18n.num(n);
  }
  /** A button with a bound label. */
  function button(parent, key, onClick, cls) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'k-btn' + (cls ? ' ' + cls : ''), parent, key));
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  // ---------------------------------------------------------------- HUD
  dom.addStyle('standin-ui', CSS);
  const hudLayer = dom.layer('hud');
  const screensLayer = dom.layer('screens');
  // Gesture hygiene (ART_UX 6.1) without swallowing taps on HUD buttons.
  hudLayer.addEventListener('touchstart', (e) => {
    const tg = /** @type {any} */ (e.target);
    if (tg && typeof tg.closest === 'function' && tg.closest('button,.k-hit')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const hud = el('div', 'ui-hud', hudLayer);
  hud.hidden = true;
  const top = el('div', 'ui-top', hud);
  const med = el('div', 'ui-med', top);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  const ringTrack = doc.createElementNS(NS, 'circle');
  const ringFill = doc.createElementNS(NS, 'circle');
  for (const c of [ringTrack, ringFill]) {
    c.setAttribute('cx', '30'); c.setAttribute('cy', '30'); c.setAttribute('r', '27');
    svg.appendChild(c);
  }
  ringTrack.setAttribute('class', 'ui-ring-track');
  ringFill.setAttribute('class', 'ui-ring-fill');
  ringFill.setAttribute('stroke-dasharray', String(RING));
  ringFill.setAttribute('stroke-dashoffset', String(RING));
  med.appendChild(svg);
  const medNum = el('bdi', '', med);
  const cols = el('div', 'ui-cols', top);
  const hpBar = el('div', 'ui-bar ui-hp', cols);
  const hpChip = el('div', 'ui-fill ui-chip', hpBar);
  const hpFill = el('div', 'ui-fill', hpBar);
  const oraBar = el('div', 'ui-bar ui-ora', cols);
  const oraFill = el('div', 'ui-fill', oraBar);
  const oraTicks = el('div', 'ui-ticks', oraBar);
  const resRow = el('div', 'ui-res', cols);
  const resLabel = el('span', '', resRow, 'core.term.res');
  resRow.appendChild(doc.createTextNode(' '));
  const resNum = el('bdi', '', resRow);
  void resLabel;
  const xp = el('div', 'ui-xp', hud);
  const xpFill = el('div', 'ui-fill', xp);
  const end = el('div', 'ui-end', hud);
  const warn = el('div', 'ui-warn', end);
  warn.textContent = '!';
  attr(warn, 'title', 'core.save.memoryOnly');
  attr(warn, 'aria-label', 'core.save.memoryOnly');
  const pauseBtn = /** @type {HTMLButtonElement} */ (el('button', 'ui-pausebtn', end));
  pauseBtn.type = 'button';
  pauseBtn.dataset.ui = 'pause';
  el('i', '', pauseBtn);
  el('i', '', pauseBtn);
  attr(pauseBtn, 'aria-label', 'ui.hud.pause');
  pauseBtn.addEventListener('click', () => {
    if (ui.top() === 'hud' && ctx.player) ui.open('pause', {});
  });
  const target = el('div', 'ui-target', hud);
  target.hidden = true;
  const tName = el('div', 'ui-target-name', target);
  const tBar = el('div', 'ui-bar', target);
  const tFill = el('div', 'ui-fill', tBar);
  const tPoise = el('div', 'ui-bar ui-poise', target);
  const tPoiseFill = el('div', 'ui-fill', tPoise);
  const toastBox = el('div', 'ui-toasts', hud);
  const toasts = [];
  for (let i = 0; i < TOASTS; i++) {
    const n = el('div', 'ui-toast', toastBox);
    n.hidden = true;
    toasts.push({ node: n, realUntil: 0 });
  }
  const banner = el('div', 'ui-banner', hud);
  let bannerUntil = 0;
  const pill = el('div', 'ui-pill', hud);
  pill.hidden = true;
  pill.classList.add('k-hit');
  const pillKey = el('span', 'ui-key', pill);
  const pillText = el('span', '', pill);
  pill.addEventListener('click', () => {
    if (ctx.quests) ctx.quests.use();
  });
  const tut = el('div', 'ui-tut', hud);
  tut.hidden = true;
  const letterTop = el('div', 'ui-letter', hudLayer);
  const letterBottom = el('div', 'ui-letter', hudLayer);
  letterTop.style.insetBlockStart = '0';
  letterBottom.style.insetBlockEnd = '0';
  letterTop.hidden = true;
  letterBottom.hidden = true;
  const fadeNode = el('div', 'ui-fade', dom.layer('overlay'));

  let hudVisible = true;
  let focusKey = null;
  let tutKey = null;
  let tutAction = null;
  let deathAt = -1;
  let deathBoss = null;
  let textAcc = TEXT_PERIOD;
  const last = { hp: -1, ora: -1, xp: -1, surge: -1, t: -1, tp: -1, ticks: -1, chip: -1 };
  let chipVal = 1;
  let chipHold = 0;

  /** Write a scaleX transform when it changed. */
  function scale(node, key, v) {
    const q = Math.round(Math.max(0, Math.min(1, v)) * 500) / 500;
    if (last[key] === q) return;
    last[key] = q;
    node.style.transform = 'scaleX(' + q + ')';
  }

  // ---------------------------------------------------------------- screens
  /** @type {Map<string, Function>} */
  const factories = new Map();
  /** @type {Map<string, any>} */
  const screens = new Map();
  /** @type {string[]} */
  const stack = [];

  function screenOf(id) {
    let s = screens.get(id);
    if (s) return s;
    const f = factories.get(id);
    if (!f) return null;
    s = f(ctx);
    if (!s || !s.el) return null;
    s.el.hidden = true;
    screensLayer.appendChild(s.el);
    screens.set(id, s);
    return s;
  }

  /** A screen root with a panel. */
  function shell(extra) {
    const root = el('div', 'ui-screen' + (extra ? ' ' + extra : ''), null);
    const panel = el('div', 'ui-panel', root);
    return { root, panel };
  }

  // loading
  factories.set('loading', () => {
    const { root, panel } = shell('ui-solid');
    el('h1', 'ui-big', panel, 'core.game.title');
    const bar = el('div', 'ui-bar ui-btn-wide', panel);
    bar.style.inlineSize = '100%';
    const fill = el('div', 'ui-fill', bar);
    fill.style.background = 'var(--accent)';
    const line = el('p', 'ui-sub', panel);
    return {
      el: root,
      onOpen() {},
      onClose() {},
      /** @param {string} phase @param {number} p */
      update(phase, p) {
        fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)) + ')';
        const k = 'core.loading.' + phase;
        line.textContent = ctx.i18n.has(k) ? t(k) : t('core.loading.boot');
      },
    };
  });

  // title
  factories.set('title', () => {
    const { root, panel } = shell('ui-solid');
    el('h1', 'ui-big', panel, 'core.game.title');
    el('p', 'ui-sub', panel, 'core.game.subtitle');
    const col = el('div', 'ui-col', panel);
    const cont = button(col, 'ui.title.continue', () => {
      ui.close('title');
      if (!ctx.session.start({ slot: 1, newGame: false })) {
        ui.open('title', {});
        ui.toast('ui.title.noSave', null, 'warn');
      }
    }, 'ui-btn-wide');
    button(col, 'ui.title.newGame', () => {
      ui.close('title');
      ctx.session.start({ slot: 1, newGame: true });
    }, 'ui-btn-wide');
    const lang = button(col, 'ui.common.language', toggleLang, 'ui-btn-wide');
    const hint = el('p', 'ui-sub', panel, 'ui.title.noSave');
    const refresh = () => {
      let exists = false;
      try {
        const s = ctx.save.slots();
        exists = !!(s[0] && s[0].exists);
      } catch (err) {
        exists = false;
      }
      cont.disabled = !exists;
      hint.hidden = exists;
      lang.textContent = t('ui.common.language') + ': ' + t(ctx.i18n.lang === 'he' ? 'core.lang.en' : 'core.lang.he');
    };
    return {
      el: root,
      onOpen: refresh,
      onClose() {},
      onLang: refresh,
      onInput(action) {
        if (action === 'uiConfirm' && !cont.disabled) cont.click();
      },
    };
  });

  // pause
  factories.set('pause', () => {
    const { root, panel } = shell('');
    el('h2', 'ui-ribbon', panel, 'ui.pause.title');
    const grid = el('div', 'ui-grid', panel);
    const left = el('div', 'ui-col', grid);
    const dl = el('dl', 'ui-stats', left);
    const right = el('div', 'ui-col', grid);
    const points = el('div', 'ui-sub', right);
    const statRows = el('div', 'ui-stat2', right);
    const btns = el('div', 'ui-btns', panel);
    button(btns, 'ui.pause.resume', () => ui.close('pause'), 'ui-btn-wide');
    button(btns, 'ui.pause.save', () => {
      const ok = ctx.save.write('manual');
      ui.toast(ok ? 'core.save.saved' : 'core.save.failed', null, ok ? 'good' : 'warn');
    }, 'ui-btn-wide');
    const lang = button(btns, 'ui.common.language', () => {
      toggleLang();
      render();
    }, 'ui-btn-wide');
    button(btns, 'ui.pause.quit', () => {
      ctx.save.write('quit');
      ui.closeAll();
      ctx.session.end({ toTitle: true });
    }, 'ui-btn-wide');
    function row(labelKey, args, valueText) {
      el('dt', '', dl).textContent = t(labelKey, args);
      const dd = el('dd', '', dl);
      el('bdi', '', dd).textContent = valueText;
    }
    function render() {
      dom.clear(dl);
      dom.clear(statRows);
      const rpg = ctx.rpg;
      const p = ctx.player;
      const st = p && p.stats ? p.stats : rpg.stats();
      const num = (n) => ctx.i18n.num(Math.round(n));
      row('core.stat.level', { level: '' }, num(rpg.level));
      row('ui.pause.xp', { xp: num(rpg.xp), need: num(rpg.xpToNext()) }, '');
      if (st) {
        row('ui.pause.hp', { hp: num(st.hp), max: num(st.hpMax) }, '');
        row('ui.pause.ora', { ora: num(st.ora), max: num(st.oraMax) }, '');
      }
      row('core.term.resonance', null, num(rpg.resonance()));
      row('core.term.shells', null, num(rpg.shells));
      row('core.term.tp', null, num(rpg.tp));
      points.textContent = t('ui.pause.points', { n: num(rpg.statPoints) });
      const base = ctx.store.state.player.base;
      for (const k of ['mgt', 'spr', 'vit', 'swf']) {
        const r = el('div', 'ui-statrow', statRows);
        const name = el('span', '', r);
        name.textContent = t('core.stat.' + k) + ' ';
        el('bdi', '', name).textContent = num(base[k]);
        const plus = /** @type {HTMLButtonElement} */ (el('button', 'ui-plus', r));
        plus.type = 'button';
        plus.textContent = '+';
        plus.setAttribute('aria-label', t('ui.pause.add', { stat: t('core.stat.' + k) }));
        plus.disabled = rpg.statPoints <= 0;
        plus.addEventListener('click', () => {
          if (rpg.allocate(k, 1)) render();
        });
      }
      lang.textContent = t('ui.common.language') + ': ' + t(ctx.i18n.lang === 'he' ? 'core.lang.en' : 'core.lang.he');
    }
    return {
      el: root,
      onOpen: render,
      onClose() {},
      onLang: render,
      onInput(action) {
        if (action === 'pause' || action === 'uiBack') ui.close('pause');
      },
    };
  });

  // dialogue
  let dlgChoices = [];
  let dlgOpenFrame = -1;
  factories.set('dialogue', () => {
    const { root, panel } = shell('ui-low ui-dlg');
    const speaker = el('p', 'ui-speaker', panel);
    const line = el('p', 'ui-line', panel);
    const choices = el('div', 'ui-col', panel);
    const next = button(panel, 'ui.dialogue.next', () => advance(0), '');
    panel.addEventListener('click', () => {
      if (!dlgChoices.length) advance(0);
    });
    function advance(i) {
      if (ctx.quests) ctx.quests.advance(i);
    }
    return {
      el: root,
      onOpen() {
        dlgOpenFrame = frameNo;
      },
      onClose() {},
      /** @param {any} p dialogue:line */
      line(p) {
        const sp = p.speakerId;
        speaker.textContent = sp === 'tavi' ? t('core.player.name') : sp === 'system' || sp === 'villager' ? '' : t((ctx.defs.find('npc', sp) ? 'npc.' : 'enemy.') + sp + '.name');
        line.textContent = t(p.textKey);
        dom.clear(choices);
        dlgChoices = p.choices.map((c) => c.textKey);
        dlgChoices.forEach((k, i) => button(choices, k, () => advance(i), 'ui-btn-wide'));
        next.hidden = dlgChoices.length > 0;
      },
      onInput(action) {
        // The press that opened the dialogue reaches onPress after the tick that opened it: ignore it.
        if (frameNo === dlgOpenFrame) return;
        if ((action === 'uiConfirm' || action === 'interact' || action === 'attack') && !dlgChoices.length) advance(0);
      },
    };
  });

  // death
  factories.set('death', () => {
    const { root, panel } = shell('');
    el('h1', 'ui-big', panel, 'core.death.title');
    const rise = button(panel, 'ui.death.rise', () => {
      ui.close('death');
      if (ctx.rpg) ctx.rpg.respawn({ retry: !!deathBoss });
    }, 'ui-btn-wide');
    return {
      el: root,
      onOpen() {},
      onClose() {},
      onInput(action) {
        if (action === 'uiConfirm') rise.click();
      },
    };
  });

  // confirm
  let confirmResolve = null;
  factories.set('confirm', () => {
    const { root, panel } = shell('');
    const text = el('p', 'ui-line', panel);
    const row = el('div', 'ui-row', panel);
    const finish = (v) => {
      const r = confirmResolve;
      confirmResolve = null;
      ui.close('confirm');
      if (r) r(v);
    };
    button(row, 'ui.common.yes', () => finish(true), '');
    button(row, 'ui.common.close', () => finish(false), '');
    return {
      el: root,
      /** @param {any} p */
      onOpen(p) {
        text.textContent = p && p.key ? t(p.key, p.args) : '';
      },
      onClose() {
        if (confirmResolve) {
          const r = confirmResolve;
          confirmResolve = null;
          r(false);
        }
      },
      onInput(action) {
        if (action === 'uiConfirm') finish(true);
        else if (action === 'uiBack') finish(false);
      },
    };
  });

  function toggleLang() {
    const next = ctx.i18n.lang === 'he' ? 'en' : 'he';
    ctx.save.setSetting('lang', next);
    if (ctx.i18n.lang !== next) ctx.i18n.setLang(next);
  }

  function emitScreen(id, open) {
    ctx.bus.emit('ui:screen', { id, open });
  }

  const ui = {
    /** @param {string} screenId @param {any} [params] */
    open(screenId, params) {
      if (screenId === 'hud') {
        ui.closeAll();
        return;
      }
      const s = screenOf(screenId);
      if (!s) {
        ctx.log.warn('ui', 'unknown screen', screenId);
        return;
      }
      const i = stack.indexOf(screenId);
      if (i >= 0) stack.splice(i, 1);
      const first = stack.length === 0;
      stack.push(screenId);
      s.el.hidden = false;
      screensLayer.appendChild(s.el);
      if (first) {
        ctx.time.pause('menu');
        ctx.input.setContext('ui');
      }
      try {
        s.onOpen(params || {});
      } catch (err) {
        ctx.log.error('ui', 'screen onOpen threw', screenId, err);
      }
      emitScreen(screenId, true);
    },
    /** @param {string} [screenId] */
    close(screenId) {
      const id = screenId || stack[stack.length - 1];
      const i = id ? stack.indexOf(id) : -1;
      if (i < 0) return;
      stack.splice(i, 1);
      const s = screens.get(id);
      if (s) {
        s.el.hidden = true;
        try {
          s.onClose();
        } catch (err) {
          ctx.log.error('ui', 'screen onClose threw', id, err);
        }
      }
      if (stack.length === 0) {
        ctx.time.resume('menu');
        ctx.input.setContext('game');
      }
      emitScreen(id, false);
    },
    closeAll() {
      while (stack.length) ui.close(stack[stack.length - 1]);
    },
    top() {
      return stack.length ? stack[stack.length - 1] : 'hud';
    },
    /** @param {string} screenId */
    isOpen(screenId) {
      return screenId === 'hud' ? stack.length === 0 : stack.indexOf(screenId) >= 0;
    },
    /** @param {string} key @param {any} [args] @param {'info'|'good'|'warn'} [kind='info'] */
    toast(key, args, kind = 'info') {
      ctx.bus.emit('ui:toast', { key, args: args || null, kind });
    },
    /** @param {string} kind @param {string} key @param {any} [args] */
    banner(kind, key, args) {
      ctx.bus.emit('ui:banner', { kind, key, args: args || null });
    },
    /** @param {string} key @param {any} [args] @returns {Promise<boolean>} */
    confirm(key, args) {
      if (confirmResolve) confirmResolve(false);
      return new Promise((resolve) => {
        confirmResolve = resolve;
        ui.open('confirm', { key, args });
      });
    },
    /** @param {boolean} visible */
    setHudVisible(visible) {
      hudVisible = !!visible;
    },
    /** @param {boolean} on */
    letterbox(on) {
      letterTop.hidden = !on;
      letterBottom.hidden = !on;
    },
    /** @param {number} alpha @param {number} seconds @returns {Promise<void>} */
    fade(alpha, seconds) {
      const s = Math.max(0, seconds || 0);
      fadeNode.style.transitionDuration = Math.round(s * 1000) + 'ms';
      fadeNode.style.opacity = String(Math.max(0, Math.min(1, alpha)));
      return new Promise((resolve) => {
        if (s <= 0 || typeof setTimeout !== 'function') resolve();
        else setTimeout(resolve, s * 1000);
      });
    },
    /** @param {string} id @param {Function} factory */
    registerScreen(id, factory) {
      if (typeof factory !== 'function') return;
      const old = screens.get(id);
      if (old) {
        if (stack.indexOf(id) >= 0) ui.close(id);
        old.el.remove();
        screens.delete(id);
      }
      factories.set(id, factory);
    },
    /** Remove every DOM node and listener of the stand-in. */
    dispose() {
      stack.length = 0;
      ctx.time.resume('menu');
      for (const s of screens.values()) s.el.remove();
      screens.clear();
      hud.remove();
      letterTop.remove();
      letterBottom.remove();
      fadeNode.remove();
      offPress();
    },
  };

  // ---------------------------------------------------------------- HUD updates
  function showToast(key, args, kind) {
    let slot = toasts[0];
    for (const s of toasts) if (s.realUntil < slot.realUntil) slot = s;
    slot.node.textContent = t(key, args || undefined);
    slot.node.className = 'ui-toast ui-on' + (kind === 'good' ? ' ui-good' : kind === 'warn' ? ' ui-warnk' : '');
    slot.node.hidden = false;
    slot.realUntil = nowReal() + TOAST_SECONDS;
  }
  let bannerKey = '';
  let bannerArgs = null;
  function showBanner(key, args) {
    bannerKey = key;
    bannerArgs = args || null;
    banner.textContent = t(key, args || undefined);
    banner.classList.add('ui-on');
    bannerUntil = nowReal() + BANNER_SECONDS;
  }
  let realClock = 0;
  let frameNo = 0;
  const nowReal = () => realClock;

  function updateTarget(p) {
    const boss = ctx.ai ? ctx.ai.boss : null;
    const combat = ctx.combat;
    let id = combat.target();
    if (!id) {
      const s = combat.softTarget();
      const e = s ? ctx.ents.get(s) : null;
      if (e && (e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2 <= 25 * 25) id = s;
    }
    const e = boss || (id ? ctx.ents.get(id) : null);
    if (!e || !e.alive || !e.stats) {
      if (!target.hidden) target.hidden = true;
      last.t = -1;
      return;
    }
    if (target.hidden) target.hidden = false;
    target.classList.toggle('ui-boss', e === boss);
    if (last.t !== e.id) {
      last.t = e.id;
      tName.textContent = (e.nameKey ? t(e.nameKey) : e.defId) + ' · ' + t('ui.hud.level', { level: ctx.i18n.num(e.level) });
      last.tp = -1;
    }
    tFill.style.transform = 'scaleX(' + Math.max(0, e.stats.hp / Math.max(1, e.stats.hpMax)).toFixed(3) + ')';
    tPoise.hidden = !(e.stats.poiseMax > 0);
    tPoiseFill.style.transform = 'scaleX(' + (e.stats.poiseMax > 0 ? Math.max(0, e.stats.poise / e.stats.poiseMax) : 0).toFixed(3) + ')';
  }

  const hudSystem = {
    id: 'standin.ui.hud',
    phase: 'ui',
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      realClock += dt;
      frameNo++;
      const p = c.player;
      const show = !!p && hudVisible && stack.indexOf('title') < 0 && stack.indexOf('loading') < 0;
      if (hud.hidden === show) hud.hidden = !show;
      if (deathAt >= 0 && c.time.now >= deathAt && stack.indexOf('death') < 0) {
        deathAt = -1;
        ui.open('death', {});
      }
      if (!show || !p.stats) return;
      const st = p.stats;
      const hpK = st.hp / Math.max(1, st.hpMax);
      scale(hpFill, 'hp', hpK);
      if (hpK < chipVal) {
        chipHold += dt;
        if (chipHold > 0.4) chipVal = Math.max(hpK, chipVal - dt * 0.8);
      } else {
        chipVal = hpK;
        chipHold = 0;
      }
      scale(hpChip, 'chip', chipVal);
      scale(oraFill, 'ora', st.ora / Math.max(1, st.oraMax));
      if (last.ticks !== st.oraMax) {
        last.ticks = st.oraMax;
        oraTicks.style.setProperty('--tick', (25 / Math.max(25, st.oraMax)) * 100 + '%');
      }
      scale(xpFill, 'xp', ctx.rpg.xp / Math.max(1, ctx.rpg.xpToNext()));
      textAcc += dt;
      if (textAcc < TEXT_PERIOD) return;
      textAcc = 0;
      const surge = p.combat ? p.combat.surge / BALANCE.surge.max : 0;
      if (last.surge !== surge) {
        last.surge = surge;
        ringFill.setAttribute('stroke-dashoffset', String(RING * (1 - surge)));
      }
      const lvl = ctx.i18n.num(ctx.rpg.level);
      if (medNum.textContent !== lvl) medNum.textContent = lvl;
      const res = ctx.i18n.num(ctx.rpg.resonance());
      if (resNum.textContent !== res) resNum.textContent = res;
      warn.hidden = !ctx.save.memoryOnly;
      updateTarget(p);
      for (const s of toasts) {
        if (!s.node.hidden && s.realUntil <= realClock) {
          s.node.classList.remove('ui-on');
          s.node.hidden = true;
        }
      }
      if (bannerUntil && bannerUntil <= realClock) {
        bannerUntil = 0;
        banner.classList.remove('ui-on');
      }
    },
  };

  function renderPill() {
    if (!focusKey) {
      pill.hidden = true;
      return;
    }
    const g = ctx.input.glyph('interact');
    pillKey.textContent = g.device === 'touch' ? '●' : g.label || 'E';
    pillText.textContent = t(focusKey);
    pill.hidden = false;
  }
  function renderTut() {
    if (!tutKey && !tutAction) {
      tut.hidden = true;
      return;
    }
    const g = tutAction ? ctx.input.glyph(tutAction) : null;
    tut.textContent = (g && g.label ? '[' + g.label + '] ' : '') + (tutKey ? t(tutKey) : '');
    tut.hidden = false;
  }

  const on = {
    /** @param {any} p game:boot */
    boot(p) {
      if (stack.indexOf('loading') < 0 && p.progress < 1) ui.open('loading', {});
      const s = screens.get('loading');
      if (s) s.update(p.phase, p.progress);
    },
    ready() {
      ui.close('loading');
    },
    /** @param {any} p ui:toast */
    toast(p) {
      showToast(p.key, p.args, p.kind);
    },
    /** @param {any} p ui:banner */
    banner(p) {
      showBanner(p.key, p.args);
    },
    /** @param {any} p rpg:levelUp */
    levelUp(p) {
      ui.banner('level', 'ui.banner.levelUp', { level: ctx.i18n.num(p.level) });
      if (p.statPoints > 0) ui.toast('ui.toast.points', { n: ctx.i18n.num(p.statPoints) }, 'good');
    },
    /** @param {any} p quest:started */
    questStarted(p) {
      ui.toast('ui.toast.questStarted', { title: t('quest.' + p.questId + '.title') }, 'info');
    },
    questDone() {
      ui.banner('quest', 'ui.banner.questDone', null);
    },
    /** @param {any} p actor:staggered */
    staggered(p) {
      if (p.broken) ui.banner('break', 'ui.banner.break', null);
    },
    /** @param {any} p combat:perfect */
    perfect(p) {
      if (ctx.player && p.entId === ctx.player.id) ui.banner('perfect', 'ui.banner.perfect', null);
    },
    ringstone() {
      ui.toast('ui.toast.ringstone', null, 'good');
    },
    /** @param {any} p interact:focus */
    focus(p) {
      focusKey = p.promptKey;
      renderPill();
    },
    /** @param {any} p tutorial:prompt */
    tutorial(p) {
      tutKey = p.textKey;
      tutAction = p.action;
      renderTut();
    },
    /** @param {any} p player:died */
    died(p) {
      deathBoss = p.bossId;
      deathAt = ctx.time.now + BALANCE.death.slowSeconds;
    },
    respawned() {
      deathAt = -1;
      if (stack.indexOf('death') >= 0) ui.close('death');
    },
    dlgStart() {
      ui.open('dialogue', {});
    },
    /** @param {any} p dialogue:line */
    dlgLine(p) {
      const s = screenOf('dialogue');
      if (s) s.line(p);
    },
    dlgEnd() {
      ui.close('dialogue');
    },
    lang() {
      for (const b of bound) {
        const text = t(b.key, b.args || undefined);
        if (b.attr) b.node.setAttribute(b.attr, text);
        else b.node.textContent = text;
      }
      for (const id of stack) {
        const s = screens.get(id);
        if (s && s.onLang) s.onLang();
      }
      last.t = -1;
      textAcc = TEXT_PERIOD;
      if (bannerUntil) banner.textContent = t(bannerKey, bannerArgs || undefined);
      renderPill();
      renderTut();
    },
    device() {
      renderPill();
      renderTut();
    },
    ended() {
      deathAt = -1;
      focusKey = null;
      tutKey = null;
      tutAction = null;
      renderPill();
      renderTut();
      for (const id of ['dialogue', 'death', 'pause']) if (stack.indexOf(id) >= 0) ui.close(id);
    },
  };

  /** Frame-rate input for menus (input.onPress, 4.8). */
  const offPress = ctx.input.onPress((action) => {
    const id = ui.top();
    if (id === 'hud') {
      if (action === 'pause' && ctx.player && ctx.player.alive) ui.open('pause', {});
      return;
    }
    const s = screens.get(id);
    if (s && s.onInput) s.onInput(action);
    else if (action === 'uiBack' && id !== 'title' && id !== 'death' && id !== 'loading') ui.close(id);
  });

  return { ui, hudSystem, on };
}

/**
 * Install the stand-in ui service under the owner 'standin:ui'.
 * @param {any} ctx
 */
export function install(ctx) {
  ctx.i18n.addStrings(UI_STRINGS);
  const { ui, hudSystem, on } = createUi(ctx);
  ctx.provide('ui', ui, OWNER);
  ctx.systems.add(hudSystem);
  const b = ctx.bus;
  b.on('game:boot', on.boot, OWNER);
  b.on('game:ready', on.ready, OWNER);
  b.on('ui:toast', on.toast, OWNER);
  b.on('ui:banner', on.banner, OWNER);
  b.on('rpg:levelUp', on.levelUp, OWNER);
  b.on('quest:started', on.questStarted, OWNER);
  b.on('quest:completed', on.questDone, OWNER);
  b.on('actor:staggered', on.staggered, OWNER);
  b.on('combat:perfect', on.perfect, OWNER);
  b.on('ringstone:activated', on.ringstone, OWNER);
  b.on('interact:focus', on.focus, OWNER);
  b.on('tutorial:prompt', on.tutorial, OWNER);
  b.on('player:died', on.died, OWNER);
  b.on('player:respawned', on.respawned, OWNER);
  b.on('dialogue:start', on.dlgStart, OWNER);
  b.on('dialogue:line', on.dlgLine, OWNER);
  b.on('dialogue:end', on.dlgEnd, OWNER);
  b.on('lang:changed', on.lang, OWNER);
  b.on('input:device', on.device, OWNER);
  b.on('game:ended', on.ended, OWNER);
}
