/**
 * The HUD (ART_UX 6.6) for portrait, landscape, short landscape and desktop: medallion with level, Surge ring and
 * points badge; HP bar with trailing chip; Ora bar with 25-Ora ticks and the Burnout hatch; Resonance with a digit
 * roll; XP line; compass with ticks, POI pips, the Spire and the quest diamond; target frame (swipe = switch, tap =
 * release) and boss bar with phase notches; quest tracker; pooled damage numbers; toasts; banners; interact pill;
 * tutorial prompt with device glyphs and a ghost ring over the real touch control; Pause and Map buttons;
 * session-only warning; save icon; quick-item chip (keyboard and gamepad); low-HP vignette; auto-fade; letterbox
 * and fades. Event-driven and polled in the `ui` frame phase: bars by `transform: scaleX` every frame, text at
 * 15 Hz, nothing allocated per frame (pools, preallocated scratch objects).
 * @module ui/hud
 */

import { BALANCE } from '../core/balance.js';
import { icon, itemIcon } from './icons.js';
import { quantize, formatInt, formatCompact } from './logic/format.js';
import { createRoll, setTarget as rollTo, advance as rollAdvance } from './logic/digitRoll.js';
import { placePip, tickPositions, compassYaw, PIP_RANGE } from './logic/compass.js';
import { createSlotPool, acquire, release } from './logic/slotPool.js';
import { hudMode } from './logic/layout.js';
import { bodyBox, placeAround } from './logic/placement.js';

const TEXT_PERIOD = 1 / 15;
const TOAST_SECONDS = 3;
/** Banner hold (the 240 ms entrance and 260 ms exit come on top: under 2 s in all). */
const BANNER_SECONDS = 1.5;
/** Gap between two queued centre messages. */
const BANNER_GAP = 0.3;
/** Combat call-outs (Break!, Perfect!, Finisher!) are brief and sit beside the action. */
const CALLOUT_SECONDS = 0.9;
const CALLOUTS = Object.freeze({ break: 1, perfect: 1, danger: 1, finisher: 1 });
const KICKERS = Object.freeze({ region: 'ui.banner.regionKicker', level: 'ui.banner.levelKicker', quest: 'ui.banner.questKicker',
  tech: 'ui.banner.techKicker', form: 'ui.banner.formKicker', boss: 'ui.banner.bossKicker' });
const DMG_LIFE = 0.7;
const DMG_COUNT = 24;
const PIP_COUNT = 10;
const FADE_AFTER = 4;
const CHIP_DELAY = 0.4;
const RING_R = 22;
const RING_LEN = 2 * Math.PI * RING_R;
const CARDINAL = Object.freeze({ 0: 'ui.compass.n', 6: 'ui.compass.e', 12: 'ui.compass.s', 18: 'ui.compass.w' });
const PIP_TYPES = Object.freeze(['ringstone', 'shrine', 'siphon', 'chest', 'race', 'camp']);

/**
 * @param {any} ctx
 * @param {import('./kit.js').Kit} kit
 * @param {{ open(id:string, params?:any):void, top():string }} ui
 */
export function createHud(ctx, kit, ui) {
  const dom = ctx.dom;
  const doc = dom.doc;
  const hudLayer = dom.layer('hud');
  const overlay = dom.layer('overlay');
  hudLayer.addEventListener('touchstart', (e) => {
    const tg = /** @type {any} */ (e.target);
    if (tg && typeof tg.closest === 'function' && tg.closest('button,.k-hit')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const root = kit.el('div', 'ui-hud', hudLayer);
  root.hidden = true;
  if (ctx.flags && ctx.flags.test) root.classList.add('ui-test');
  /** @param {HTMLElement} n @param {string} name */
  const piece = (n, name) => {
    n.dataset.hud = name;
    return n;
  };

  // ---------------------------------------------------------------- bar block
  const block = kit.el('div', 'ui-block ui-fadeable', root);
  const med = piece(kit.el('div', 'ui-med k-hit', block), 'medallion');
  kit.attr(med, 'aria-label', 'ui.hud.character');
  const NS = 'http://www.w3.org/2000/svg';
  const ring = doc.createElementNS(NS, 'svg');
  ring.setAttribute('viewBox', '0 0 48 48');
  ring.setAttribute('class', 'ui-med-ring');
  const ringTrack = doc.createElementNS(NS, 'circle');
  const ringFill = doc.createElementNS(NS, 'circle');
  for (const c of [ringTrack, ringFill]) {
    c.setAttribute('cx', '24');
    c.setAttribute('cy', '24');
    c.setAttribute('r', String(RING_R));
    ring.appendChild(c);
  }
  ringTrack.setAttribute('class', 'ui-ring-track');
  ringFill.setAttribute('class', 'ui-ring-fill');
  ringFill.setAttribute('stroke-dasharray', RING_LEN.toFixed(2));
  ringFill.setAttribute('stroke-dashoffset', RING_LEN.toFixed(2));
  med.appendChild(ring);
  const medLv = kit.el('bdi', 'ui-med-lv', med);
  const badge = kit.el('i', 'ui-badge', med);
  med.addEventListener('click', () => {
    if (ui.top() === 'hud' && ctx.player && ctx.player.alive) ui.open('character', {});
  });
  const bars = kit.el('div', 'ui-bars', block);
  const hpBar = piece(kit.el('div', 'ui-bar ui-hp', bars), 'hp');
  const hpChip = kit.el('div', 'ui-fill ui-chipfill', hpBar);
  const hpFill = kit.el('div', 'ui-fill', hpBar);
  const oraBar = piece(kit.el('div', 'ui-bar ui-ora', bars), 'ora');
  const oraFill = kit.el('div', 'ui-fill', oraBar);
  const oraTicks = kit.el('div', 'ui-ticks', oraBar);
  const res = piece(kit.el('div', 'ui-res', block), 'resonance');
  kit.el('span', 'ui-res-label', res, 'core.term.res');
  const resNum = kit.num(res, 'ui-res-num');
  const xp = piece(kit.el('div', 'ui-xp', root), 'xp');
  const xpFill = kit.el('div', 'ui-fill', xp);

  // ---------------------------------------------------------------- end buttons
  const endbar = kit.el('div', 'ui-endbar', root);
  const warn = piece(kit.el('div', 'ui-warn k-hit', endbar), 'warn');
  warn.appendChild(icon(doc, 'warn'));
  kit.attr(warn, 'aria-label', 'core.save.memoryOnly');
  kit.attr(warn, 'title', 'core.save.memoryOnly');
  warn.addEventListener('click', () => {
    if (ui.top() === 'hud') ui.open('savecode', { tab: 'copy' });
  });
  const mapBtn = /** @type {HTMLButtonElement} */ (piece(kit.el('button', 'ui-hbtn', endbar), 'map'));
  mapBtn.type = 'button';
  mapBtn.dataset.ui = 'map';
  mapBtn.appendChild(icon(doc, 'map'));
  kit.attr(mapBtn, 'aria-label', 'ui.tab.map');
  mapBtn.addEventListener('click', () => {
    if (ui.top() === 'hud' && ctx.player) ui.open('map', {});
  });
  const pauseBtn = /** @type {HTMLButtonElement} */ (piece(kit.el('button', 'ui-hbtn', endbar), 'pause'));
  pauseBtn.type = 'button';
  pauseBtn.dataset.ui = 'pause';
  pauseBtn.appendChild(icon(doc, 'pause'));
  kit.attr(pauseBtn, 'aria-label', 'ui.hud.pause');
  pauseBtn.addEventListener('click', () => {
    if (ui.top() === 'hud' && ctx.player) ui.open('pause', {});
  });

  // ---------------------------------------------------------------- compass
  const compass = piece(kit.el('div', 'ui-compass', root), 'compass');
  /** @type {HTMLElement[]} */
  const ticks = [];
  for (let k = 0; k < 24; k++) {
    const m = kit.el('div', 'ui-cmk', compass);
    if (CARDINAL[k]) {
      m.classList.add('ui-card');
      if (k === 0) m.classList.add('ui-north');
      kit.el('b', '', m, CARDINAL[k]);
    }
    ticks.push(m);
  }
  kit.el('div', 'ui-ccenter', compass);
  /** @type {HTMLElement[]} */
  const pips = [];
  for (let i = 0; i < PIP_COUNT; i++) {
    const p = kit.el('div', 'ui-pip', compass);
    p.hidden = true;
    pips.push(p);
  }
  const spirePip = kit.el('div', 'ui-pip ui-pip-spire', compass);
  const questPip = kit.el('div', 'ui-quest', compass);
  questPip.appendChild(icon(doc, 'diamond'));
  questPip.hidden = true;
  const tickXs = new Float32Array(24);
  const pipOut = { x: 0, on: false, dist: 0, rel: 0 };

  // ---------------------------------------------------------------- target frame / boss bar
  const target = piece(kit.el('div', 'ui-target', root), 'target');
  target.hidden = true;
  const tName = kit.el('div', 'ui-tname', target);
  const tNameText = kit.el('span', '', tName);
  const tLv = kit.el('bdi', 'ui-tlv', tName);
  const tBar = kit.el('div', 'ui-bar', target);
  const tChip = kit.el('div', 'ui-fill ui-chipfill', tBar);
  const tFill = kit.el('div', 'ui-fill', tBar);
  /** @type {HTMLElement[]} */
  const notches = [];
  for (let i = 0; i < 4; i++) {
    const n = kit.el('i', 'ui-notch', tBar);
    n.hidden = true;
    notches.push(n);
  }
  const tPoise = kit.el('div', 'ui-bar ui-tpoise', target);
  const tPoiseFill = kit.el('div', 'ui-fill', tPoise);
  let swipeX = 0;
  let swipeId = -1;
  target.addEventListener('pointerdown', (e) => {
    swipeX = e.clientX;
    swipeId = e.pointerId;
  });
  target.addEventListener('pointerup', (e) => {
    if (e.pointerId !== swipeId) return;
    swipeId = -1;
    const dx = e.clientX - swipeX;
    const c = ctx.combat;
    if (!c) return;
    if (Math.abs(dx) > 24) c.cycleTarget(dx > 0 ? 1 : -1);
    else c.setTarget(0);
  });

  // ---------------------------------------------------------------- tracker
  const tracker = piece(kit.el('div', 'ui-tracker ui-fadeable', root), 'tracker');
  tracker.hidden = true;
  const trTitle = kit.el('div', 'ui-tr-title', tracker);
  trTitle.appendChild(icon(doc, 'diamond'));
  const trTitleText = kit.el('span', '', trTitle);
  const trObj = kit.el('div', 'ui-tr-obj', tracker);
  tracker.addEventListener('click', () => {
    if (mode === 'portrait') tracker.classList.toggle('ui-open');
  });

  // ---------------------------------------------------------------- toasts, banner, pill, prompt
  // The centre lane: interact pill (lowest, nearest the thumb), tutorial prompt and, in portrait, the toasts. It is
  // placed from the hero's projected screen box (logic/placement.js) so nothing ever covers the hero or the target.
  const lane = kit.el('div', 'ui-lane', root);
  const toastBox = kit.el('div', 'ui-toasts', root);
  const toastPool = createSlotPool(3);
  /** @type {Array<{ node:HTMLElement, text:HTMLElement, until:number }>} */
  const toasts = [];
  for (let i = 0; i < 3; i++) {
    const n = piece(kit.el('div', 'ui-toast', toastBox), 'toast');
    n.hidden = true;
    toasts.push({ node: n, text: kit.el('span', '', n), until: 0 });
  }
  const bwrap = kit.el('div', 'ui-bwrap', root);
  const banner = kit.el('div', 'ui-banner', bwrap);
  const bannerKicker = kit.el('div', 'ui-banner-kicker', banner);
  const bannerMain = kit.el('div', 'ui-banner-main', banner);
  const bannerSub = kit.el('div', 'ui-banner-sub', banner);
  bannerSub.hidden = true;
  let bannerUntil = 0;
  /** Clock time before which the next queued message waits (the exit of the last one). */
  let bannerFree = 0;
  /** @typedef {{ kind:string, key:string, args:any, sub:string|null, subArgs:any }} BannerMsg */
  /** @type {BannerMsg|null} */
  let bannerNow = null;
  /** Centre messages wait their turn: one at a time, never stacked. @type {BannerMsg[]} */
  const bannerQueue = [];
  const cwrap = kit.el('div', 'ui-cwrap', root);
  const callout = kit.el('div', 'ui-callout', cwrap);
  let calloutUntil = 0;

  const pill = /** @type {HTMLButtonElement} */ (piece(kit.el('button', 'ui-pill', lane), 'pill'));
  pill.type = 'button';
  pill.hidden = true;
  const pillGlyph = kit.el('span', 'ui-glyph', pill);
  const pillText = kit.el('span', '', pill);
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ctx.quests && ui.top() === 'hud') ctx.quests.use();
  });

  const prompt = piece(kit.el('div', 'ui-prompt', lane), 'prompt');
  prompt.hidden = true;
  const promptGlyph = kit.el('span', 'ui-glyph', prompt);
  const promptText = kit.el('span', '', prompt);
  const ghost = kit.el('div', 'ui-ghost', root);
  ghost.hidden = true;

  const chip = piece(kit.el('div', 'ui-chip', root), 'quickItem');
  chip.hidden = true;
  const chipIco = kit.el('span', '', chip);
  const chipCount = kit.num(chip, '');
  const chipGlyph = kit.el('span', 'ui-glyph', chip);
  let chipItem = '';

  const saveIco = kit.el('div', 'ui-saveico', root);
  let saveUntil = 0;
  const vignette = kit.el('div', 'ui-vignette', root);

  // ---------------------------------------------------------------- moments: combo, gains, pickups, skip hint, flash
  const combo = piece(kit.el('div', 'ui-combo', root), 'combo');
  combo.hidden = true;
  const comboNum = kit.num(combo, 'ui-combo-n');
  const comboLbl = kit.el('div', 'ui-combo-l', combo, 'ui.combo.hits');
  const comboRank = kit.el('div', 'ui-combo-r', combo);
  let comboRankNow = 0;
  let comboLast = -1;
  let comboHideAt = 0;
  let comboRankId = '';

  const gain = kit.el('span', 'ui-gain', res);
  const gainXp = kit.num(gain, 'ui-gain-xp');
  const gainSh = kit.el('span', 'ui-gain-sh', gain);
  gainSh.appendChild(icon(doc, 'shell'));
  const gainShN = kit.num(gainSh, '');
  let gainUntil = 0;
  let xpAdd = 0;
  let xpShown = 0;
  let shAdd = 0;
  let shShown = 0;
  const lastGain = { xp: '', sh: '' };

  const FLY = 6;
  const flyNodes = [];
  const flyT = new Float32Array(FLY);
  let flyNext = 0;
  for (let i = 0; i < FLY; i++) {
    const n = kit.el('i', 'ui-fly', root);
    n.hidden = true;
    flyNodes.push(n);
  }

  const skip = piece(kit.el('div', 'ui-skip', overlay), 'skip');
  skip.hidden = true;
  skip.appendChild(icon(doc, 'next'));
  const skipText = kit.el('span', '', skip);
  const flash = kit.el('div', 'ui-flashfx', overlay);

  /** Reward line of a quest from its definition (XP, Shells, TP, items, Forms, techniques). @param {string} questId */
  function rewardText(questId) {
    const def = ctx.defs.find('quest', questId);
    const list = def && Array.isArray(def.rewards) ? def.rewards : [];
    let out = '';
    for (const r of list) {
      let t = '';
      if (r.op === 'giveXp') t = kit.t('ui.gain.xpLong', { n: formatInt(r.amount) });
      else if (r.op === 'giveShells') t = kit.t('ui.gain.shellsLong', { n: formatInt(r.amount) });
      else if (r.op === 'giveTp') t = kit.t('ui.gain.tp', { n: formatInt(r.amount) });
      else if (r.op === 'giveItem' && ctx.i18n.has('item.' + r.item + '.name')) t = kit.t('item.' + r.item + '.name');
      else if (r.op === 'unlockForm' && ctx.i18n.has('form.' + r.form + '.name')) t = kit.t('form.' + r.form + '.name');
      else if (r.op === 'unlockTech' && ctx.i18n.has('tech.' + r.tech + '.name')) t = kit.t('tech.' + r.tech + '.name');
      if (t) out += (out ? '  ·  ' : '') + t;
    }
    return out;
  }

  /** Count the XP and Shells tickers up (text rate). @param {number} d */
  function frameGains(d) {
    if (!gainUntil) return;
    if (clock >= gainUntil) {
      gainUntil = 0;
      xpAdd = xpShown = shAdd = shShown = 0;
      gain.classList.remove('ui-on');
      return;
    }
    const k = Math.min(1, d * 6);
    xpShown = xpAdd - xpShown < 1 ? xpAdd : xpShown + Math.max(1, (xpAdd - xpShown) * k);
    shShown = shAdd - shShown < 1 ? shAdd : shShown + Math.max(1, (shAdd - shShown) * k);
    const xt = xpAdd > 0 ? kit.t('ui.gain.xp', { n: formatInt(Math.round(xpShown)) }) : '';
    if (xt !== lastGain.xp) {
      lastGain.xp = xt;
      gainXp.textContent = xt;
      gainXp.hidden = !xt;
    }
    const st = shAdd > 0 ? '+' + formatInt(Math.round(shShown)) : '';
    if (st !== lastGain.sh) {
      lastGain.sh = st;
      gainShN.textContent = st;
      gainSh.hidden = !st;
    }
  }

  /** Pickup dots fly from the hero to the ticker. @param {number} d */
  function frameFly(d) {
    for (let i = 0; i < FLY; i++) {
      if (flyT[i] <= 0) continue;
      flyT[i] -= d;
      if (flyT[i] <= 0) flyNodes[i].hidden = true;
    }
  }

  // ---------------------------------------------------------------- damage numbers
  const dmgBox = kit.el('div', '', root);
  const dmgPool = createSlotPool(DMG_COUNT);
  /** @type {HTMLElement[]} */
  const dmgNodes = [];
  const dmgX = new Float32Array(DMG_COUNT);
  const dmgY = new Float32Array(DMG_COUNT);
  const dmgZ = new Float32Array(DMG_COUNT);
  const dmgT = new Float32Array(DMG_COUNT);
  const dmgDx = new Float32Array(DMG_COUNT);
  for (let i = 0; i < DMG_COUNT; i++) {
    const n = kit.el('div', 'ui-dmg', dmgBox);
    n.hidden = true;
    dmgNodes.push(n);
  }
  const proj = { x: 0, y: 0, visible: false, depth: 0 };
  const proj2 = { x: 0, y: 0, visible: false, depth: 0 };

  // ---------------------------------------------------------------- keep-out boxes and centre placement
  const heroBox = { x: 0, y: 0, w: 0, h: 0, on: false };
  const tgtBox = { x: 0, y: 0, w: 0, h: 0, on: false };
  const keeps = [heroBox, tgtBox];
  const laneBase = { x: 0, y: 0, w: 0, h: 0 };
  const laneAt = { dx: 0, dy: 0 };
  const bnrBase = { x: 0, y: 0, w: 0, h: 0 };
  const bnrAt = { dx: 0, dy: 0 };
  const comboBase = { x: 0, y: 0, w: 0, h: 0 };
  const comboAt = { dx: 0, dy: 0 };
  let comboDirty = true;
  const placed = { dx: 0, dy: 0, moved: false };
  const lim = { minTop: 0, minX: 8, maxX: 0 };
  let laneDirty = true;
  let bnrDirty = true;
  /** Top of the free band under the top HUD rows (CSS px), measured on relayout. */
  let topBand = 0;

  // ---------------------------------------------------------------- overlay: letterbox and fade
  const letterTop = kit.el('div', 'ui-letter ui-top', overlay);
  const letterBot = kit.el('div', 'ui-letter ui-bot', overlay);
  const fadeNode = kit.el('div', 'ui-fade', overlay);
  let letterOn = false;

  // ---------------------------------------------------------------- state
  let hudVisible = true;
  let cineHidden = false;
  let clock = 0;
  let lastTick = -1;
  let textAcc = TEXT_PERIOD;
  let slowAcc = 1;
  /** @type {import('./logic/layout.js').HudMode} */
  let mode = 'landscape';
  let touch = false;
  let compassW = 0;
  let viewW = 0;
  let viewH = 0;
  let layoutDirty = true;
  /** Text ticks left to retry placing the tutorial ghost (a control can appear a few frames after its prompt). */
  let ghostRetry = 0;
  let fadeT = 0;
  let faded = false;
  let chipVal = 1;
  let chipHold = 0;
  let tChipVal = 1;
  let tChipHold = 0;
  let tId = 0;
  let bossDefId = '';
  let focusKey = '';
  /** @type {string|null} */
  let tutAction = null;
  /** @type {string|null} */
  let tutKey = null;
  let pointsBadge = false;
  let trackerDirty = true;
  let lastLevel = -1;
  const roll = createRoll(0);
  let rollInit = false;
  let resFlashUntil = 0;
  const last = { hp: -1, chip: -1, ora: -1, xp: -1, surge: -1, tick: -1, t: -1, tc: -1, tp: -1, burn: false, low: false, full: false, res: '' };
  let coarse = false;
  try {
    coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch (e) {
    coarse = false;
  }

  /** @param {HTMLElement} node @param {string} key @param {number} v */
  function scale(node, key, v) {
    const q = quantize(v);
    if (last[key] === q) return;
    last[key] = q;
    node.style.transform = 'scaleX(' + q + ')';
  }

  function relayout() {
    layoutDirty = false;
    ghostRetry = 8;
    const w = window.innerWidth || dom.root.clientWidth;
    const h = window.innerHeight || dom.root.clientHeight;
    const dev = ctx.input.device;
    const t = dev === 'touch' || (coarse && dev !== 'pad');
    const m = hudMode(w, h, t);
    if (m !== mode || t !== touch || w !== viewW || h !== viewH) {
      root.classList.remove('ui-m-' + mode);
      mode = m;
      touch = t;
      viewW = w;
      viewH = h;
      root.classList.add('ui-m-' + mode);
      root.classList.toggle('ui-touch', touch);
    }
    compassW = compass.clientWidth || 200;
    // Portrait: the toasts join the centre lane above the control deck; elsewhere they sit at the top centre.
    if (mode === 'portrait') {
      if (toastBox.parentNode !== lane) lane.appendChild(toastBox);
    } else if (toastBox.parentNode !== root) root.insertBefore(toastBox, lane);
    topBand = mode === 'portrait' ? compass.offsetTop + 60 : compass.offsetTop + 64;
    laneDirty = true;
    bnrDirty = true;
    comboDirty = true;
    renderPrompt();
    renderPill();
  }

  // ---------------------------------------------------------------- toasts and banners
  /** @param {string} key @param {any} args @param {string} kind */
  function showToast(key, args, kind) {
    const max = mode === 'desktop' ? 3 : 2;
    let i = acquire(toastPool);
    if (i >= max) {
      release(toastPool, i);
      // Recycle the oldest visible one of the first `max` slots.
      let oldest = 0;
      for (let k = 1; k < max; k++) if (toastPool.born[k] < toastPool.born[oldest]) oldest = k;
      i = oldest;
      toastPool.born[i] = ++toastPool.serial;
      toastPool.busy[i] = 1;
    }
    const s = toasts[i];
    s.text.textContent = kit.t(key, args);
    s.node.className = 'ui-toast' + (kind === 'good' ? ' ui-good' : kind === 'warn' ? ' ui-warnk' : '');
    s.node.hidden = false;
    laneDirty = true;
    // Newest last in reading order.
    toastBox.appendChild(s.node);
    void s.node.offsetWidth;
    s.node.classList.add('ui-on');
    // A toast that arrives under a big banner gets its full time after the banner.
    s.until = clock + TOAST_SECONDS + (bannerUntil > clock && root.classList.contains('ui-bnr') ? bannerUntil - clock : 0);
  }

  /**
   * Queue a centre message (level, quest, region, new technique or Form, boss card). Call-outs go to their own slot.
   * @param {string} kind @param {string} key @param {any} args @param {string|null} [sub] @param {any} [subArgs]
   */
  function showBanner(kind, key, args, sub, subArgs) {
    if (CALLOUTS[kind]) {
      showCallout(kind, key, args);
      return;
    }
    if (bannerQueue.length >= 4) bannerQueue.shift();
    bannerQueue.push({ kind, key, args: args || null, sub: sub || null, subArgs: subArgs || null });
  }
  /** Start the next queued message when the centre is free and the HUD shows. */
  function nextBanner() {
    if (bannerNow || clock < bannerFree || !bannerQueue.length) return;
    const m = /** @type {BannerMsg} */ (bannerQueue.shift());
    bannerNow = m;
    renderBanner();
    banner.className = 'ui-banner ui-k-' + m.kind;
    bwrap.className = 'ui-bwrap ui-bk-' + m.kind;
    bwrap.style.transform = '';
    bnrAt.dx = 0;
    bnrAt.dy = 0;
    bnrDirty = true;
    void banner.offsetWidth;
    banner.classList.add('ui-on');
    if (m.kind === 'level') {
      med.classList.remove('ui-burst');
      void med.offsetWidth;
      med.classList.add('ui-burst');
    }
    // Big messages share the top band with the toasts outside portrait: the toasts wait out of sight meanwhile.
    root.classList.add('ui-bnr');
    bannerUntil = clock + BANNER_SECONDS + (m.kind === 'boss' ? 0.3 : 0);
  }
  function renderBanner() {
    if (!bannerNow) return;
    const k = bannerNow.kind;
    const kickerKey = KICKERS[k] || '';
    bannerKicker.textContent = kickerKey ? kit.t(kickerKey) : '';
    bannerKicker.hidden = !kickerKey;
    bannerMain.textContent = kit.t(bannerNow.key, bannerNow.args);
    const sub = bannerNow.sub;
    bannerSub.hidden = !sub;
    bannerSub.textContent = !sub ? '' : sub.indexOf('@q:') === 0 ? rewardText(sub.slice(3)) : kit.t(sub, bannerNow.subArgs);
    // A boss whose title is its name (as in Hebrew) shows it once.
    if (sub && bannerSub.textContent === bannerMain.textContent) bannerSub.hidden = true;
  }
  /** @param {string} kind @param {string} key @param {any} args */
  function showCallout(kind, key, args) {
    callout.textContent = kit.t(key, args);
    callout.className = 'ui-callout ui-k-' + kind;
    cwrap.className = 'ui-cwrap ui-ck-' + kind;
    void callout.offsetWidth;
    callout.classList.add('ui-on');
    calloutUntil = clock + CALLOUT_SECONDS;
  }

  // ---------------------------------------------------------------- pill and prompt
  /** @param {HTMLElement} node @param {string} action */
  function glyphInto(node, action) {
    const g = ctx.input.glyph(action);
    dom.clear(node);
    if (g.device === 'touch') {
      node.className = 'ui-glyph ui-tap';
      node.appendChild(icon(doc, 'hand'));
    } else {
      node.className = 'ui-glyph';
      node.textContent = g.label || '?';
    }
  }
  function renderPill() {
    if (!focusKey) {
      if (!pill.hidden) laneDirty = true;
      pill.hidden = true;
      return;
    }
    glyphInto(pillGlyph, 'interact');
    pillText.textContent = kit.t(focusKey);
    pill.hidden = false;
    laneDirty = true;
  }
  function renderPrompt() {
    laneDirty = true;
    if (!tutKey && !tutAction) {
      prompt.hidden = true;
      ghost.hidden = true;
      return;
    }
    if (tutAction) {
      promptGlyph.hidden = false;
      glyphInto(promptGlyph, tutAction);
    } else promptGlyph.hidden = true;
    promptText.textContent = tutKey ? kit.t(tutKey) : kit.t('ui.action.' + tutAction);
    prompt.hidden = false;
    ghostRetry = 8;
    placeGhost();
  }
  /** Ring the real touch control of the prompted action (layout read on events only). */
  function placeGhost() {
    ghost.hidden = true;
    if (!tutAction || !touch) return;
    const sel = '[data-action="' + tutAction + '"]';
    const el = /** @type {HTMLElement|null} */ (dom.root.querySelector(sel));
    let x = 0;
    let y = 0;
    let d = 0;
    if (el && tutAction !== 'move' && tutAction !== 'look') {
      const r = el.getBoundingClientRect();
      if (r.width < 2) return;
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
      d = r.width + 12;
    } else if (tutAction === 'move') {
      const sb = 16;
      d = mode === 'portrait' ? 108 : 120;
      x = 16 + 28 + d / 2;
      y = viewH - sb - 28 - d / 2;
    } else return;
    ghost.style.width = d + 'px';
    ghost.style.height = d + 'px';
    ghost.style.setProperty('--gt', 'translate(' + Math.round(x - d / 2) + 'px,' + Math.round(y - d / 2) + 'px)');
    ghost.style.transform = 'translate(' + Math.round(x - d / 2) + 'px,' + Math.round(y - d / 2) + 'px)';
    ghost.hidden = false;
  }

  // ---------------------------------------------------------------- tracker
  function renderTracker() {
    trackerDirty = false;
    const q = ctx.quests;
    let qid = q ? q.tracked : null;
    if (!q) {
      tracker.hidden = true;
      return;
    }
    let row = null;
    const rows = q.active();
    for (const r of rows) if (r.questId === qid) row = r;
    if (!row && rows.length) {
      for (const r of rows) if (!row && r.questId.indexOf('mq') === 0) row = r;
      if (!row) row = rows[0];
      qid = row.questId;
    }
    if (!row) {
      tracker.hidden = true;
      tracker.dataset.quest = '';
      return;
    }
    tracker.dataset.quest = qid;
    trTitleText.textContent = kit.t('quest.' + qid + '.title');
    trObj.textContent = kit.t(row.objectiveKey, row.objectiveArgs);
    tracker.hidden = false;
  }

  // ---------------------------------------------------------------- per-frame parts
  /** @param {any} p player */
  function frameBars(p, dt) {
    const st = p.stats;
    const hpK = st.hp / (st.hpMax > 0 ? st.hpMax : 1);
    scale(hpFill, 'hp', hpK);
    if (hpK < chipVal) {
      chipHold += dt;
      if (chipHold > CHIP_DELAY) chipVal = Math.max(hpK, chipVal - dt * 0.9);
    } else {
      chipVal = hpK;
      chipHold = 0;
    }
    scale(hpChip, 'chip', chipVal);
    const low = hpK > 0 && hpK < 0.25;
    if (low !== last.low) {
      last.low = low;
      hpBar.classList.toggle('ui-low', low);
      vignette.classList.toggle('ui-on', low);
    }
    scale(oraFill, 'ora', st.ora / (st.oraMax > 0 ? st.oraMax : 1));
    if (last.tick !== st.oraMax) {
      last.tick = st.oraMax;
      oraTicks.style.setProperty('--tick', ((25 / Math.max(25, st.oraMax)) * 100).toFixed(3) + '%');
    }
    const burn = !!(p.combat && p.combat.burnoutT > 0);
    if (burn !== last.burn) {
      last.burn = burn;
      oraBar.classList.toggle('ui-burn', burn);
    }
    const rpg = ctx.rpg;
    scale(xpFill, 'xp', rpg ? rpg.xp / Math.max(1, rpg.xpToNext()) : 0);
    // Auto-fade: full HP and Ora and no combat for 4 s.
    const calm = hpK >= 0.999 && st.ora >= st.oraMax - 0.5 && !(ctx.combat && ctx.combat.inCombat);
    fadeT = calm ? fadeT + dt : 0;
    const f = fadeT >= FADE_AFTER;
    if (f !== faded) {
      faded = f;
      root.classList.toggle('ui-faded', f);
    }
  }

  /** @param {any} p */
  function frameCompass(p) {
    const cam = ctx.cam;
    const heading = cam && typeof cam.yaw === 'number' ? cam.yaw : p.yaw;
    tickPositions(heading, tickXs);
    const w = compassW;
    for (let k = 0; k < 24; k++) {
      const x = tickXs[k];
      const n = ticks[k];
      if (x !== x) {
        if (!n.hidden) n.hidden = true;
      } else {
        if (n.hidden) n.hidden = false;
        n.style.transform = 'translateX(' + (x * w).toFixed(1) + 'px)';
      }
    }
    // The Spire is always shown (pinned to the edge when behind).
    const sp = ctx.world && ctx.world.landmark ? ctx.world.landmark('wellspring_spire') : null;
    placePip(p.pos.x, p.pos.z, heading, sp ? sp.x : 0, sp ? sp.z : 0, pipOut, true);
    spirePip.style.transform = 'translateX(' + (pipOut.x * w).toFixed(1) + 'px) rotate(45deg)';
    // Quest diamond from the tracked quest's marker.
    const q = ctx.quests;
    let shown = false;
    if (q && typeof q.markers === 'function') {
      const ms = q.markers();
      const want = q.tracked;
      let m = null;
      for (let i = 0; i < ms.length; i++) {
        const r = ms[i];
        if (r.kind === 'giver') continue;
        if (!m || r.questId === want) m = r;
        if (r.questId === want) break;
      }
      if (m) {
        placePip(p.pos.x, p.pos.z, heading, m.x, m.z, pipOut, true);
        questPip.style.transform = 'translateX(' + (pipOut.x * w).toFixed(1) + 'px)';
        const edge = !pipOut.on;
        if (questPip.classList.contains('ui-edge') !== edge) questPip.classList.toggle('ui-edge', edge);
        shown = true;
      }
    }
    if (questPip.hidden === shown) questPip.hidden = !shown;
  }

  /** POI pips within 400 m, at 15 Hz. @param {any} p */
  function framePips(p) {
    const cam = ctx.cam;
    const heading = cam && typeof cam.yaw === 'number' ? cam.yaw : p.yaw;
    const w = compassW;
    let used = 0;
    const world = ctx.world;
    if (world && typeof world.pois === 'function') {
      for (let t = 0; t < PIP_TYPES.length && used < PIP_COUNT; t++) {
        const list = world.pois(PIP_TYPES[t]);
        for (let i = 0; i < list.length && used < PIP_COUNT; i++) {
          const poi = list[i];
          const dx = poi.x - p.pos.x;
          const dz = poi.z - p.pos.z;
          if (dx * dx + dz * dz > PIP_RANGE * PIP_RANGE) continue;
          placePip(p.pos.x, p.pos.z, heading, poi.x, poi.z, pipOut, false);
          if (!pipOut.on) continue;
          const n = pips[used++];
          const cls = 'ui-pip ui-pip-' + (t === 0 ? 'ring' : PIP_TYPES[t]);
          if (n.className !== cls) n.className = cls;
          n.style.transform = 'translateX(' + (pipOut.x * w).toFixed(1) + 'px)';
          if (n.hidden) n.hidden = false;
        }
      }
    }
    for (let i = used; i < PIP_COUNT; i++) if (!pips[i].hidden) pips[i].hidden = true;
  }

  /** @param {any} p @param {number} dt */
  function frameTarget(p, dt) {
    const ai = ctx.ai;
    const boss = ai && ai.boss && ai.boss.alive ? ai.boss : null;
    const combat = ctx.combat;
    let e = boss;
    if (!e && combat) {
      let id = combat.target();
      if (!id) {
        const s = combat.softTarget();
        const se = s ? ctx.ents.get(s) : null;
        if (se && se.alive) {
          const dx = se.pos.x - p.pos.x;
          const dz = se.pos.z - p.pos.z;
          if (dx * dx + dz * dz <= 625) id = s;
        }
      }
      e = id ? ctx.ents.get(id) : null;
    }
    if (!e || !e.alive || !e.stats) {
      if (!target.hidden) {
        target.hidden = true;
        root.classList.remove('ui-tgt');
        syncTrackerVisibility();
      }
      tId = 0;
      return;
    }
    if (target.hidden) {
      target.hidden = false;
      // The nameplate owns the top band: banners drop below it (never both in the same place).
      root.classList.add('ui-tgt');
      syncTrackerVisibility();
    }
    const isBoss = e === boss;
    if (tId !== e.id) {
      tId = e.id;
      target.classList.toggle('ui-boss', isBoss);
      target.dataset.hud = isBoss ? 'boss' : 'target';
      tChipVal = e.stats.hp / Math.max(1, e.stats.hpMax);
      renderTargetName(e, isBoss);
      placeNotches(isBoss ? e.defId : '');
    }
    const k = e.stats.hp / Math.max(1, e.stats.hpMax);
    scale(tFill, 't', k);
    if (k < tChipVal) {
      tChipHold += dt;
      if (tChipHold > CHIP_DELAY) tChipVal = Math.max(k, tChipVal - dt * 0.9);
    } else {
      tChipVal = k;
      tChipHold = 0;
    }
    scale(tChip, 'tc', tChipVal);
    const hasPoise = e.stats.poiseMax > 0;
    if (tPoise.hidden === hasPoise) tPoise.hidden = !hasPoise;
    if (hasPoise) scale(tPoiseFill, 'tp', e.stats.poise / e.stats.poiseMax);
  }
  /** @param {any} e @param {boolean} isBoss */
  function renderTargetName(e, isBoss) {
    let key = e.nameKey;
    if (isBoss && ctx.i18n.has('boss.' + e.defId + '.title')) key = 'boss.' + e.defId + '.title';
    tNameText.textContent = key ? kit.t(key) : e.defId;
    tLv.textContent = kit.t('ui.hud.level', { level: formatInt(e.level) });
  }
  /** @param {string} bossId */
  function placeNotches(bossId) {
    const def = bossId ? ctx.defs.find('boss', bossId) : null;
    const ph = def && Array.isArray(def.phases) ? def.phases : null;
    bossDefId = bossId;
    for (let i = 0; i < notches.length; i++) {
      const at = ph && ph[i + 1] ? ph[i + 1].hpBelow : -1;
      const n = notches[i];
      if (at > 0 && at < 1) {
        n.style.insetInlineStart = (at * 100).toFixed(1) + '%';
        n.hidden = false;
      } else n.hidden = true;
    }
  }
  function syncTrackerVisibility() {
    // Portrait: the target or boss frame replaces the one-line tracker.
    tracker.classList.toggle('ui-under', mode === 'portrait' && !target.hidden);
    if (mode === 'portrait' && !target.hidden) tracker.hidden = true;
    else trackerDirty = true;
  }

  /** @param {number} dt */
  function frameDamage(dt) {
    if (dmgPool.live === 0) return;
    const r = ctx.render;
    for (let i = 0; i < DMG_COUNT; i++) {
      if (!dmgPool.busy[i]) continue;
      dmgT[i] += dt;
      const t = dmgT[i];
      const n = dmgNodes[i];
      if (t >= DMG_LIFE) {
        release(dmgPool, i);
        n.hidden = true;
        continue;
      }
      if (r && typeof r.project === 'function') r.project(dmgX[i], dmgY[i] + 0.8 + t * 1.2, dmgZ[i], proj);
      else proj.visible = false;
      if (!proj.visible) {
        n.style.opacity = '0';
        continue;
      }
      const u = t / DMG_LIFE;
      const pop = u < 0.15 ? 0.6 + (u / 0.15) * 0.55 : 1.15 - Math.min(0.15, (u - 0.15) * 0.6);
      n.style.opacity = u < 0.6 ? '1' : (1 - (u - 0.6) / 0.4).toFixed(2);
      n.style.transform = 'translate(' + (proj.x + dmgDx[i]).toFixed(1) + 'px,' + (proj.y - u * 28).toFixed(1) + 'px) translate(-50%,-50%) scale(' + pop.toFixed(2) + ')';
    }
  }

  /**
   * Keep-out boxes: the hero and the locked target, from their projected feet and heads (text rate).
   * @param {any} p
   */
  function frameKeep(p) {
    const r = ctx.render;
    heroBox.on = false;
    tgtBox.on = false;
    if (!r || typeof r.project !== 'function') return;
    r.project(p.pos.x, p.pos.y, p.pos.z, proj);
    r.project(p.pos.x, p.pos.y + (p.height || 1.8), p.pos.z, proj2);
    if (proj.visible || proj2.visible) bodyBox(proj.x, proj.y, proj2.x, proj2.y, heroBox);
    const c = ctx.combat;
    const id = c && typeof c.target === 'function' ? c.target() : 0;
    const e = id ? ctx.ents.get(id) : null;
    if (e && e.alive) {
      r.project(e.pos.x, e.pos.y, e.pos.z, proj);
      r.project(e.pos.x, e.pos.y + (e.height || 1.8), e.pos.z, proj2);
      if (proj.visible || proj2.visible) bodyBox(proj.x, proj.y, proj2.x, proj2.y, tgtBox);
    }
    // A body filling most of the screen (camera pressed in, a towering boss) cannot be kept clear: no keep-out.
    if (heroBox.h > viewH * 0.6) heroBox.on = false;
    if (tgtBox.h > viewH * 0.6) tgtBox.on = false;
  }

  /** Move the centre lane and the banner off the keep-out boxes (transform writes only, on change). */
  function placeCentre() {
    lim.maxX = viewW - 8;
    if (laneDirty) {
      laneDirty = false;
      laneBase.w = lane.offsetWidth;
      laneBase.h = lane.offsetHeight;
      laneBase.x = lane.offsetLeft - laneBase.w * 0.5;
      laneBase.y = lane.offsetTop;
    }
    lim.minTop = topBand;
    if (mode !== 'portrait' && toastBox.childElementCount && !toastBox.hidden) {
      const tb = toastBox.offsetTop + toastBox.offsetHeight + 6;
      if (tb > lim.minTop) lim.minTop = tb;
    }
    placeAround(laneBase, keeps, lim, placed);
    if (Math.abs(placed.dx - laneAt.dx) > 2 || Math.abs(placed.dy - laneAt.dy) > 2) {
      laneAt.dx = placed.dx;
      laneAt.dy = placed.dy;
      lane.style.transform = 'translate(calc(-50% + ' + Math.round(placed.dx) + 'px),' + Math.round(placed.dy) + 'px)';
    }
    if (!combo.hidden) {
      if (comboDirty) {
        comboDirty = false;
        comboBase.x = combo.offsetLeft;
        comboBase.y = combo.offsetTop;
        comboBase.w = combo.offsetWidth;
        comboBase.h = combo.offsetHeight;
      }
      lim.minTop = topBand - 20;
      placeAround(comboBase, keeps, lim, placed);
      if (Math.abs(placed.dx - comboAt.dx) > 2 || Math.abs(placed.dy - comboAt.dy) > 2) {
        comboAt.dx = placed.dx;
        comboAt.dy = placed.dy;
        // The independent `translate` property, so the counter's own pop and fade transforms stay untouched.
        combo.style.translate = Math.round(placed.dx) + 'px ' + Math.round(placed.dy) + 'px';
      }
    }
    if (!bannerNow) return;
    if (bnrDirty) {
      bnrDirty = false;
      bnrBase.w = banner.offsetWidth;
      bnrBase.h = banner.offsetHeight;
      bnrBase.x = bwrap.offsetLeft + banner.offsetLeft;
      bnrBase.y = bwrap.offsetTop + banner.offsetTop;
    }
    lim.minTop = topBand - 20;
    // Never up onto the target frame or the boss bar.
    if (!target.hidden) lim.minTop = Math.max(lim.minTop, target.offsetTop + target.offsetHeight + 6);
    placeAround(bnrBase, keeps, lim, placed);
    if (Math.abs(placed.dx - bnrAt.dx) > 2 || Math.abs(placed.dy - bnrAt.dy) > 2) {
      bnrAt.dx = placed.dx;
      bnrAt.dy = placed.dy;
      bwrap.style.transform = 'translate(' + Math.round(placed.dx) + 'px,' + Math.round(placed.dy) + 'px)';
    }
  }

  // ---------------------------------------------------------------- public
  const hud = {
    root,
    /** @param {boolean} v */
    setVisible(v) {
      hudVisible = !!v;
    },
    /** @param {boolean} on */
    letterbox(on) {
      letterOn = !!on;
      overlay.classList.toggle('ui-letterbox', letterOn);
      letterTop.classList.toggle('ui-on', letterOn);
      dom.root.classList.toggle('ui-letterbox', letterOn);
    },
    /** @param {number} alpha @param {number} seconds @returns {Promise<void>} */
    fade(alpha, seconds) {
      const s = Math.max(0, Number(seconds) || 0);
      const test = !!(ctx.flags && ctx.flags.test);
      fadeNode.style.transitionDuration = test ? '0ms' : Math.round(s * 1000) + 'ms';
      fadeNode.style.opacity = String(Math.max(0, Math.min(1, Number(alpha) || 0)));
      return new Promise((resolve) => {
        if (s <= 0 || test || typeof setTimeout !== 'function') resolve();
        else setTimeout(resolve, s * 1000);
      });
    },
    toast: showToast,
    banner: showBanner,
    markLayout() {
      layoutDirty = true;
    },
    get mode() {
      return mode;
    },
    /** The hero's and the locked target's screen boxes that centre pieces keep clear of (scenarios). */
    keepOut() {
      const out = [];
      if (heroBox.on) out.push({ name: 'hero', x: heroBox.x, y: heroBox.y, w: heroBox.w, h: heroBox.h });
      if (tgtBox.on) out.push({ name: 'target', x: tgtBox.x, y: tgtBox.y, w: tgtBox.w, h: tgtBox.h });
      return out;
    },
    /** Transient centre messages on show: the banner and the call-out (scenarios). */
    centre() {
      const out = [];
      if (bannerNow) {
        const r = banner.getBoundingClientRect();
        out.push({ name: 'banner', kind: bannerNow.kind, x: r.left, y: r.top, w: r.width, h: r.height, queued: bannerQueue.length });
      }
      if (calloutUntil) {
        const r = callout.getBoundingClientRect();
        out.push({ name: 'callout', x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    },
    /** Rectangles of every visible HUD piece (scenarios). */
    pieces() {
      const out = [];
      const list = root.querySelectorAll('[data-hud]');
      for (let i = 0; i < list.length; i++) {
        const n = /** @type {HTMLElement} */ (list[i]);
        if (n.hidden || n.closest('[hidden]')) continue;
        const r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        out.push({ name: n.dataset.hud, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      return out;
    },

    /** The `ui` frame system body. @param {any} c @param {number} dt */
    frame(c, dt) {
      // Real seconds, or simulated seconds when frames run with dt = 0 (test mode drives time with step(n)).
      const tick = c.time.tick;
      let d = dt > 0 ? dt : 0;
      if (d === 0 && lastTick >= 0 && tick > lastTick) d = Math.min(0.5, (tick - lastTick) / 60);
      lastTick = tick;
      clock += d;
      const p = c.player;
      const show = !!p && hudVisible && !cineHidden && !ui.isBlocking();
      if (root.hidden === show) {
        root.hidden = !show;
        if (show) layoutDirty = true;
      }
      slowAcc += d;
      if (slowAcc >= 0.5) {
        slowAcc = 0;
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w !== viewW || h !== viewH) layoutDirty = true;
      }
      if (layoutDirty && show) relayout();
      // Timers run while hidden too.
      for (let i = 0; i < toasts.length; i++) {
        const s = toasts[i];
        if (toastPool.busy[i] && s.until <= clock) {
          release(toastPool, i);
          s.node.classList.remove('ui-on');
          s.node.hidden = true;
          laneDirty = true;
        }
      }
      if (bannerUntil && bannerUntil <= clock) {
        bannerUntil = 0;
        bannerNow = null;
        bannerFree = clock + BANNER_GAP;
        banner.classList.remove('ui-on');
        med.classList.remove('ui-burst');
        root.classList.remove('ui-bnr');
      }
      if (calloutUntil && calloutUntil <= clock) {
        calloutUntil = 0;
        callout.classList.remove('ui-on');
      }
      if (show) nextBanner();
      if (saveUntil && saveUntil <= clock) {
        saveUntil = 0;
        saveIco.classList.remove('ui-on');
      }
      if (!show || !p.stats) return;
      frameBars(p, d);
      frameCompass(p);
      frameTarget(p, d);
      frameDamage(d);
      if (rollAdvance(roll, d)) textAcc = TEXT_PERIOD;
      frameFly(d);
      if (comboHideAt && clock >= comboHideAt) {
        comboHideAt = 0;
        combo.hidden = true;
        combo.classList.remove('ui-out');
        comboLast = -1;
        comboRankNow = 0;
      }
      textAcc += d;
      if (textAcc < TEXT_PERIOD && dt > 0) return;
      const tt = textAcc > 0 ? textAcc : d;
      textAcc = 0;
      frameGains(tt);
      if (ghostRetry > 0 && !prompt.hidden) {
        ghostRetry--;
        placeGhost();
      }
      framePips(p);
      frameKeep(p);
      placeCentre();
      const surge = p.combat ? Math.min(1, p.combat.surge / BALANCE.surge.max) : 0;
      if (last.surge !== surge) {
        last.surge = surge;
        ringFill.setAttribute('stroke-dashoffset', (RING_LEN * (1 - surge)).toFixed(2));
        const full = surge >= 1;
        if (full !== last.full) {
          last.full = full;
          med.classList.toggle('ui-full', full);
        }
      }
      const rpg = c.rpg;
      if (rpg) {
        if (rpg.level !== lastLevel) {
          lastLevel = rpg.level;
          medLv.textContent = formatInt(rpg.level);
        }
        const r = rpg.resonance();
        if (!rollInit) {
          rollInit = true;
          roll.shown = roll.from = roll.to = Math.round(r);
        } else rollTo(roll, r);
        const txt = formatInt(roll.shown);
        if (txt !== last.res) {
          last.res = txt;
          resNum.textContent = txt;
        }
        if (resFlashUntil && clock > resFlashUntil) {
          resFlashUntil = 0;
          res.classList.remove('ui-flash');
        }
      }
      const mo = !!(c.save && c.save.memoryOnly);
      if (warn.hidden === mo) warn.hidden = !mo;
      if (trackerDirty && !(mode === 'portrait' && !target.hidden)) renderTracker();
      // Quick-item chip for keyboard and gamepad.
      const wantChip = !touch && mode !== 'portrait' && !!rpg;
      if (wantChip) {
        const id = rpg.quickItem;
        if (id !== chipItem) {
          chipItem = id || '';
          dom.clear(chipIco);
          chipIco.appendChild(icon(doc, itemIcon(id ? c.defs.find('item', id) : null)));
          glyphInto(chipGlyph, 'item');
        }
        const n = id ? rpg.count(id) : 0;
        const nt = formatInt(n);
        if (chipCount.textContent !== nt) chipCount.textContent = nt;
      }
      if (chip.hidden === wantChip) chip.hidden = !wantChip;
    },

    // ---------------------------------------------------------------- event handlers
    on: {
      /** @param {any} e actor:damaged */
      damaged(e) {
        const p = ctx.player;
        if (p && e.targetId === p.id) {
          if (e.amount > 0) fadeT = 0;
          hint.hurt(e);
        }
        const s = ctx.save && ctx.save.settings;
        if (s && s.damageNumbers === false) return;
        if (!(e.amount > 0) && !e.blocked) return;
        const i = acquire(dmgPool);
        dmgX[i] = e.x;
        dmgY[i] = e.y;
        dmgZ[i] = e.z;
        dmgT[i] = 0;
        dmgDx[i] = ((dmgPool.serial * 37) % 41) - 20;
        const n = dmgNodes[i];
        const hurt = !!(p && e.targetId === p.id);
        n.className = 'ui-dmg' + (hurt ? ' ui-hurt' : e.blocked ? ' ui-blocked' : e.crit ? ' ui-crit' : '');
        n.textContent = e.amount > 0 ? formatCompact(e.amount) : '0';
        n.style.opacity = '0';
        n.hidden = false;
      },
      /** @param {any} p ui:toast */
      toast(p) {
        showToast(p.key, p.args, p.kind);
      },
      /** @param {any} p ui:banner */
      banner(p) {
        showBanner(p.kind || 'quest', p.key, p.args);
      },
      /** @param {any} p rpg:levelUp */
      levelUp(p) {
        const manual = p.statPoints > 0 && ctx.store.state.player.autoStyle === 'manual';
        // The stat points call-out rides on the level banner; with an automatic style the points are already spent.
        showBanner('level', 'ui.banner.levelUp', { level: formatInt(p.level) },
          manual ? (p.statPoints === 1 ? 'ui.toast.pointsOne' : 'ui.toast.points') : p.tp > 0 ? 'ui.gain.tp' : null,
          manual ? { n: formatInt(p.statPoints) } : { n: formatInt(p.tp) });
        hud.on.badge();
      },
      /** @param {any} p combat:combo */
      combo(p) {
        if (p.expired || p.count < 2) {
          if (!combo.hidden && !comboHideAt) {
            combo.classList.add('ui-out');
            comboHideAt = clock + 0.35;
          }
          return;
        }
        comboHideAt = clock + 6;
        combo.classList.remove('ui-out');
        if (combo.hidden) {
          combo.hidden = false;
          combo.classList.remove('ui-in');
          void combo.offsetWidth;
          combo.classList.add('ui-in');
        }
        if (p.count !== comboLast) {
          comboLast = p.count;
          comboNum.textContent = formatInt(p.count);
          comboDirty = true;
          comboNum.classList.remove('ui-pop');
          void comboNum.offsetWidth;
          comboNum.classList.add('ui-pop');
        }
        if (p.rankId !== comboRankId) {
          comboRankId = p.rankId || '';
          comboRank.textContent = comboRankId ? kit.t('combat.rank.' + comboRankId) : '';
          combo.dataset.rank = String(p.rank || 0);
          comboDirty = true;
        }
        if (p.rank > comboRankNow) {
          combo.classList.remove('ui-rankup');
          void combo.offsetWidth;
          combo.classList.add('ui-rankup');
        }
        comboRankNow = p.rank || 0;
      },
      /** @param {any} p rpg:xp */
      xp(p) {
        if (!(p.amount > 0)) return;
        xpAdd += p.amount;
        gainUntil = clock + 2.2;
        gain.classList.add('ui-on');
      },
      /** @param {any} p rpg:shells */
      shells(p) {
        if (!(p.amount > 0)) return;
        shAdd += p.amount;
        gainUntil = clock + 2.2;
        gain.classList.add('ui-on');
      },
      /** @param {any} p pickup:collected */
      pickup(p) {
        if (root.hidden || !heroBox.on) return;
        const to = (p.kind === 'shells' ? gainSh : p.kind === 'xp' ? gainXp : med).getBoundingClientRect();
        const n = flyNodes[flyNext];
        flyT[flyNext] = 0.6;
        flyNext = (flyNext + 1) % FLY;
        n.className = 'ui-fly ui-fly-' + (p.kind === 'shells' ? 'sh' : p.kind === 'item' ? 'item' : 'ora');
        n.hidden = false;
        n.style.transition = 'none';
        n.style.transform = 'translate(' + Math.round(heroBox.x + heroBox.w * 0.5) + 'px,' + Math.round(heroBox.y + heroBox.h * 0.45) + 'px) scale(1.4)';
        void n.offsetWidth;
        n.style.transition = '';
        n.style.transform = 'translate(' + Math.round(to.left + Math.min(to.width, 24) * 0.5) + 'px,' + Math.round(to.top + to.height * 0.5) + 'px) scale(.6)';
      },
      /** @param {any} p rpg:techLearned */
      techLearned(p) {
        hud.on.badge();
        if (p.techId && p.rank <= 1 && ctx.i18n.has('tech.' + p.techId + '.name')) showBanner('tech', 'tech.' + p.techId + '.name', null);
      },
      /** @param {any} p rpg:formUnlocked */
      formUnlocked(p) {
        if (ctx.i18n.has('form.' + p.formId + '.name')) showBanner('form', 'form.' + p.formId + '.name', null);
      },
      /** @param {any} p boss:phase */
      bossPhase(p) {
        void p;
        target.classList.remove('ui-phase');
        void target.offsetWidth;
        target.classList.add('ui-phase');
      },
      /** @param {any} p fx:impact (pooled: read now) */
      impact(p) {
        if (p.classId !== 'finisher') return;
        flash.classList.remove('ui-on');
        void flash.offsetWidth;
        flash.classList.add('ui-on');
        showCallout('finisher', 'ui.callout.finisher', null);
      },
      /** @param {any} p quest:step */
      questStep(p) {
        trackerDirty = true;
        if (p.index > 0) showToast('ui.toast.questStep', { title: kit.t('quest.' + p.questId + '.title') }, 'good');
      },
      badge() {
        const rpg = ctx.rpg;
        let on = false;
        if (rpg) {
          on = rpg.statPoints > 0;
          if (!on && rpg.tp > 0) for (const r of rpg.nodes()) if (r.state === 'available') on = true;
        }
        pointsBadge = on;
        badge.classList.toggle('ui-on', pointsBadge);
      },
      /** @param {any} p rpg:resonance */
      resonance(p) {
        if (p.milestone || p.value > p.prev * 1.5) {
          res.classList.remove('ui-flash');
          void res.offsetWidth;
          res.classList.add('ui-flash');
          resFlashUntil = clock + 0.8;
        }
      },
      /** @param {any} p quest:started */
      questStarted(p) {
        showToast('ui.toast.questStarted', { title: kit.t('quest.' + p.questId + '.title') }, 'info');
        trackerDirty = true;
      },
      /** @param {any} p quest:completed */
      questDone(p) {
        showBanner('quest', 'quest.' + p.questId + '.title', null, '@q:' + p.questId);
        trackerDirty = true;
      },
      questChanged() {
        trackerDirty = true;
      },
      /** @param {any} p world:regionEnter */
      region(p) {
        if (p.first) showBanner('region', 'region.' + p.regionId + '.name', null);
      },
      /** @param {any} p world:poiDiscovered */
      discovered(p) {
        if (ctx.i18n.has('ui.poi.' + p.type)) showToast('ui.toast.discovered', { name: kit.t('ui.poi.' + p.type) }, 'info');
      },
      /** @param {any} p actor:staggered */
      staggered(p) {
        if (!p.broken) return;
        showBanner('break', 'ui.banner.break', null);
        hint.once('break');
      },
      /** @param {any} p combat:perfect */
      perfect(p) {
        if (ctx.player && p.entId === ctx.player.id) showBanner('perfect', 'ui.banner.perfect', null);
      },
      /** @param {any} p combat:burnout */
      burnout(p) {
        if (ctx.player && p.entId === ctx.player.id) hint.once('burnout');
      },
      /** @param {any} p combat:telegraph */
      telegraph(p) {
        hint.telegraph(p);
      },
      /** @param {any} p ringstone:activated */
      ringstone(p) {
        if (p.first) showToast('ui.toast.ringstone', null, 'good');
      },
      /** @param {any} p save:written */
      saved(p) {
        if (!p.ok) return;
        saveUntil = clock + 1;
        saveIco.classList.add('ui-on');
      },
      /** @param {any} p interact:focus */
      focus(p) {
        focusKey = p.promptKey || '';
        renderPill();
      },
      /** @param {any} p tutorial:prompt */
      tutorial(p) {
        tutKey = p.textKey || null;
        tutAction = p.action || null;
        renderPrompt();
      },
      /** @param {any} p cine:start */
      cineStart(p) {
        if (p.id === 'title' || p.id === 'dialogue' || p.id === 'title_end' || p.id === 'ui_char') return;
        skip.hidden = !p.skippable;
        if (p.skippable) skipText.textContent = kit.t(touch || coarse ? 'ui.skip.tap' : 'ui.skip.key', { key: ctx.input.glyph('skip').label || '' });
        cineHidden = true;
        hud.letterbox(true);
      },
      /** @param {any} p cine:end */
      cineEnd(p) {
        skip.hidden = true;
        if (p.id === 'title' || p.id === 'dialogue' || p.id === 'title_end' || p.id === 'ui_char') return;
        cineHidden = false;
        hud.letterbox(false);
      },
      /** @param {any} p boss:start */
      bossStart(p) {
        tId = 0;
        const k = 'boss.' + p.bossId + '.name';
        if (ctx.i18n.has(k)) showBanner('boss', k, null, ctx.i18n.has('boss.' + p.bossId + '.title') ? 'boss.' + p.bossId + '.title' : null);
      },
      device() {
        layoutDirty = true;
        chipItem = '\u0000';
        renderPill();
        renderPrompt();
      },
      lang() {
        tId = 0;
        lastLevel = -1;
        last.res = '';
        trackerDirty = true;
        textAcc = TEXT_PERIOD;
        renderBanner();
        renderPill();
        renderPrompt();
        for (const s of toasts) if (!s.node.hidden) s.node.classList.add('ui-on');
      },
      loaded() {
        rollInit = false;
        lastLevel = -1;
        trackerDirty = true;
        chipVal = 1;
        fadeT = 0;
        hud.on.badge();
        hint.reset();
      },
      ended() {
        focusKey = '';
        tutKey = null;
        tutAction = null;
        renderPill();
        renderPrompt();
        for (let i = 0; i < DMG_COUNT; i++) {
          if (dmgPool.busy[i]) release(dmgPool, i);
          dmgNodes[i].hidden = true;
        }
        cineHidden = false;
        hud.letterbox(false);
      },
    },
    dispose() {
      root.remove();
      letterTop.remove();
      letterBot.remove();
      fadeNode.remove();
    },
  };

  // ---------------------------------------------------------------- hints (ART_UX 8.1)
  const hint = (() => {
    /** @type {Record<string, number>} */
    const hits = { white: 0, red: 0, violet: 0 };
    /** @type {Record<string, boolean>} */
    const shown = {};
    let lastKind = '';
    let lastAt = -10;
    return {
      reset() {
        hits.white = 0;
        hits.red = 0;
        hits.violet = 0;
        lastKind = '';
      },
      /** @param {string} id */
      once(id) {
        if (shown[id]) return;
        shown[id] = true;
        showToast('ui.hint.' + id, null, 'warn');
      },
      /** @param {any} p combat:telegraph */
      telegraph(p) {
        const pl = ctx.player;
        if (!pl || p.entId === pl.id || !(p.kind in hits)) return;
        lastKind = p.kind;
        lastAt = ctx.time.now + (p.seconds || 0);
      },
      /** @param {any} e actor:damaged on the player */
      hurt(e) {
        if (!lastKind || e.amount <= 0 || e.blocked) return;
        if (ctx.time.now - lastAt > 0.6) return;
        hits[lastKind]++;
        if (hits[lastKind] >= 3) this.once('tele_' + lastKind);
        lastKind = '';
      },
    };
  })();

  return hud;
}
