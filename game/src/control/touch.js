/**
 * Touch controls (ARCHITECTURE 4.7, ART_UX 6.1-6.3), registered as input source 'touch'.
 *
 * Floating stick in the move zone (dead zone 10%, travel 48 px, the base follows a thumb that overshoots), camera
 * drag zone (0.25 deg per px; a short tap locks on through `combat.pickAtScreen`), the action arc with Attack,
 * Bolt, Dash (lit ring while the boost latch is on), Guard and Jump, Descend only in flight, Gather and Item on the
 * left thumb, Tech 1 and 2 with cooldown rings, Form (long-press cycles), Ultimate at full Surge. Positions come
 * from the pure layout (logic/touchLayout.js) measured against the safe-area insets; the left-handed setting swaps
 * sides. Every control carries `data-action`. Gesture hygiene on the whole layer. Controls hide in menus,
 * dialogue and cinematics.
 * @module control/touch
 */

import { touchLayout, TOUCH_BUTTONS } from './logic/touchLayout.js';
import { isFlick } from './logic/gesture.js';

const ID = 'touch';
const LOOK_DEG_PER_PX = 0.25;
const DEAD_ZONE = 0.1;
const TAP_PX = 12;
const TAP_MS = 280;
const LONG_MS = 450;
/** Buttons whose long press sends another action instead of the tap action. */
const LONG_ACTIONS = { form: 'formNext', item: 'itemNext' };
/** Form colours (palette tokens of ART_UX 7.1 / core palette). */
const FORM_COLORS = { ember: '#FFB070', tempest: '#8FA8FF', zenith: '#F4F1FF' };

/** Inline SVG icons (24 x 24, stroke = currentColor). */
const ICONS = {
  attack: '<path d="M12 2.5l2.4 5.6 6 .6-4.6 4 1.4 5.9L12 15.5l-5.2 3.1 1.4-5.9-4.6-4 6-.6z"/><circle cx="12" cy="11.6" r="2" class="ctl-fill"/>',
  bolt: '<circle cx="15" cy="9" r="4.2"/><circle cx="15" cy="9" r="1.6" class="ctl-fill"/><path d="M3.5 19.5l7-6M3 14.5l6-3.5M8.5 21l3.8-5.2"/>',
  dash: '<path d="M4 6l6 6-6 6M11.5 6l6 6-6 6"/>',
  guard: '<path d="M12 3l7.5 3v5.2c0 4.6-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5.2-7.5-9.8V6z"/><path d="M12 7v10"/>',
  jump: '<path d="M6 13l6-6 6 6M6 18l6-6 6 6"/>',
  descend: '<path d="M6 6l6 6 6-6M6 11l6 6 6-6"/>',
  gather: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3.2"/><circle cx="12" cy="12" r="2.6" class="ctl-fill"/><path d="M12 5.5v2.5M12 16v2.5M5.5 12H8M16 12h2.5"/>',
  item: '<path d="M9.5 3h5M10.5 3v5.5L5.6 17a2.2 2.2 0 0 0 1.9 3.3h9a2.2 2.2 0 0 0 1.9-3.3l-4.9-8.5V3"/><path d="M7.4 14.5h9.2"/>',
  tech1: '<path d="M12 3l8 9-8 9-8-9z"/><circle cx="12" cy="12" r="1.8" class="ctl-fill"/>',
  tech2: '<path d="M12 3l8 9-8 9-8-9z"/><circle cx="9.6" cy="12" r="1.6" class="ctl-fill"/><circle cx="14.4" cy="12" r="1.6" class="ctl-fill"/>',
  form: '<path d="M12 2.5c3.2 3.8 6.2 6.4 6.2 11.2a6.2 6.2 0 0 1-12.4 0c0-3 1.7-5 3-7 .9 1.9 1.2 3 3 4.2.4-2.9-.2-5.6.2-8.4z"/>',
  ultimate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M4.9 4.9l2.5 2.5M16.6 16.6l2.5 2.5M4.9 19.1l2.5-2.5M16.6 7.4l2.5-2.5"/>',
};

const CSS = `
.ctl-touch{position:absolute;inset:0;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;display:none;z-index:0}
.ctl-touch.ctl-on{display:block}
.ctl-touch *{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none}
.ctl-zone{position:absolute;pointer-events:auto;touch-action:none}
.ctl-deck{position:absolute;inset-inline:0;bottom:0;pointer-events:none;
  background:linear-gradient(to bottom,rgba(15,12,24,0),rgba(15,12,24,.35))}
.ctl-ring{position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;box-sizing:border-box}
.ctl-ghost{border:2px solid rgba(243,235,221,.22);background:radial-gradient(circle,rgba(243,235,221,.08) 0 30%,rgba(27,22,38,.10) 31%)}
.ctl-ghost::after{content:"";position:absolute;inset:34%;border-radius:50%;background:rgba(243,235,221,.18)}
.ctl-base{border:2px solid rgba(243,235,221,.5);background:rgba(27,22,38,.22);opacity:0}
.ctl-knob{background:radial-gradient(circle at 40% 35%,rgba(255,255,255,.95),rgba(243,235,221,.8) 60%,rgba(217,205,184,.75));
  box-shadow:0 2px 10px rgba(15,12,24,.35);opacity:0}
.ctl-stick-on .ctl-base,.ctl-stick-on .ctl-knob{opacity:1}
.ctl-stick-on .ctl-ghost{opacity:0}
.ctl-btn{position:absolute;left:0;top:0;pointer-events:auto;touch-action:none;border-radius:50%;box-sizing:border-box;
  display:flex;align-items:center;justify-content:center;color:#F3EBDD;
  background:radial-gradient(circle at 50% 38%,rgba(74,63,92,.55),rgba(27,22,38,.62));
  border:2px solid rgba(243,235,221,.62);box-shadow:0 2px 8px rgba(15,12,24,.32),inset 0 1px 0 rgba(243,235,221,.18);
  transition:background-color .08s,border-color .12s}
.ctl-btn svg{inline-size:46%;block-size:46%;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;
  pointer-events:none;overflow:visible;filter:drop-shadow(0 1px 1px rgba(15,12,24,.5));transition:transform .08s ease-out}
.ctl-btn svg .ctl-fill{fill:currentColor;stroke:none}
.ctl-btn.ctl-attack{border-color:rgba(127,242,224,.8);border-width:3px}
.ctl-btn.ctl-attack svg{inline-size:50%;block-size:50%}
.ctl-btn.ctl-down svg:first-child{transform:scale(.86)}
.ctl-btn.ctl-down{border-color:#7FF2E0;background:radial-gradient(circle at 50% 40%,rgba(127,242,224,.55),rgba(27,22,38,.6))}
.ctl-btn.ctl-hide{display:none}
.ctl-btn.ctl-latched{border-color:#7FF2E0;box-shadow:0 0 0 3px rgba(127,242,224,.45),0 0 16px rgba(127,242,224,.55)}
.ctl-btn.ctl-ult{border-color:#FFB547;animation:ctl-pulse 1.1s ease-in-out infinite}
@keyframes ctl-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,181,71,.6)}50%{box-shadow:0 0 0 7px rgba(255,181,71,0)}}
.ctl-btn .ctl-cd{position:absolute;inset:-2px;inline-size:calc(100% + 4px);block-size:calc(100% + 4px);transform:rotate(-90deg)}
.ctl-btn .ctl-cd circle{fill:none;stroke:#7FF2E0;stroke-width:3;stroke-linecap:round}
.ctl-btn .ctl-cd .ctl-cd-bg{stroke:rgba(27,22,38,.5)}
.ctl-btn.ctl-cool > svg:first-child{opacity:.5}
.ctl-btn .ctl-count{position:absolute;inset-block-end:-4px;inset-inline-end:-4px;min-inline-size:20px;block-size:20px;padding:0 4px;
  box-sizing:border-box;border-radius:10px;background:#1B1626;border:1.5px solid rgba(243,235,221,.7);color:#F3EBDD;
  font:700 12px/17px system-ui,sans-serif;text-align:center}
.ctl-btn.ctl-small svg{inline-size:52%;block-size:52%}
`;

/**
 * Create the touch source.
 * @param {any} ctx
 * @param {any} shared package-private state ({ latch })
 * @returns {{ poll:(input:any, dt:number)=>void, dispose:()=>void, layout:()=>any }}
 */
export function createTouch(ctx, shared) {
  const dom = ctx.dom;
  if (!dom || typeof document === 'undefined' || typeof window === 'undefined') {
    return { poll() {}, dispose() {}, layout: () => null };
  }
  dom.addStyle('control-touch', CSS);
  const root = document.createElement('div');
  // `sti-root` keeps the foundation smoke selector working; touch controls never mirror in Hebrew (ART_UX 6.1).
  root.className = 'ctl-touch sti-root';
  root.setAttribute('dir', 'ltr');
  const deck = document.createElement('div');
  deck.className = 'ctl-deck';
  const look = document.createElement('div');
  look.className = 'ctl-zone ctl-look';
  look.setAttribute('data-action', 'look');
  const moveZone = document.createElement('div');
  moveZone.className = 'ctl-zone ctl-move';
  moveZone.setAttribute('data-action', 'move');
  const ghost = document.createElement('div');
  ghost.className = 'ctl-ring ctl-ghost';
  const base = document.createElement('div');
  base.className = 'ctl-ring ctl-base';
  const knob = document.createElement('div');
  knob.className = 'ctl-ring ctl-knob';
  root.append(deck, look, moveZone, ghost, base, knob);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;inset:0 auto auto 0;inline-size:0;block-size:0;'
    + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  root.append(probe);

  /** @type {Record<string, { el:HTMLElement, pointer:number, downAt:number, longSent:boolean, cd:SVGCircleElement|null, count:HTMLElement|null, shown:boolean }>} */
  const btns = {};
  const SVGNS = 'http://www.w3.org/2000/svg';
  for (const action of TOUCH_BUTTONS) {
    const el = document.createElement('div');
    el.className = `ctl-btn ctl-${action} ctl-hide`;
    el.setAttribute('data-action', action);
    el.setAttribute('role', 'button');
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[action];
    el.append(svg);
    /** @type {SVGCircleElement|null} */
    let cd = null;
    if (action === 'tech1' || action === 'tech2' || action === 'ultimate') {
      const ring = document.createElementNS(SVGNS, 'svg');
      ring.setAttribute('viewBox', '0 0 36 36');
      ring.setAttribute('class', 'ctl-cd');
      ring.innerHTML = '<circle class="ctl-cd-bg" cx="18" cy="18" r="16.5"/><circle class="ctl-cd-fg" cx="18" cy="18" r="16.5" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/>';
      el.append(ring);
      cd = /** @type {any} */ (ring.querySelector('.ctl-cd-fg'));
    }
    /** @type {HTMLElement|null} */
    let count = null;
    if (action === 'item') {
      count = document.createElement('span');
      count.className = 'ctl-count';
      el.append(count);
    }
    root.append(el);
    btns[action] = { el, pointer: -1, downAt: 0, longSent: false, cd, count, shown: false };
  }

  /** @type {Array<[EventTarget, string, any, any]>} */
  const listeners = [];
  /** @param {EventTarget} t @param {string} type @param {any} fn @param {any} [opt] */
  function listen(t, type, fn, opt) {
    t.addEventListener(type, fn, opt);
    listeners.push([t, type, fn, opt]);
  }
  const input = () => ctx.input;

  /* ---------------------------------------------------------------- buttons -- */

  /** @param {string} action @param {any} b */
  function press(action, b) {
    b.el.classList.add('ctl-down', 'sti-down');
    if (!LONG_ACTIONS[action]) input().setButton(action, true, ID);
  }
  /** @param {string} action @param {any} b */
  function release(action, b) {
    b.el.classList.remove('ctl-down', 'sti-down');
    const long = LONG_ACTIONS[action];
    if (long) {
      if (!b.longSent) {
        input().setButton(action, true, ID);
        input().setButton(action, false, ID);
      }
    } else {
      input().setButton(action, false, ID);
    }
    b.pointer = -1;
    b.longSent = false;
  }
  for (const action of TOUCH_BUTTONS) {
    const b = btns[action];
    listen(b.el, 'pointerdown', (/** @type {PointerEvent} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.pointer >= 0) return;
      b.pointer = e.pointerId;
      b.downAt = e.timeStamp || 0;
      b.longSent = false;
      try { b.el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      press(action, b);
    });
    const up = (/** @type {PointerEvent} */ e) => {
      if (b.pointer !== e.pointerId) return;
      release(action, b);
    };
    listen(b.el, 'pointerup', up);
    listen(b.el, 'pointercancel', up);
  }

  /* ---------------------------------------------------------------- stick -- */

  /** @type {ReturnType<typeof touchLayout>|null} */
  let L = null;
  const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  /** @param {HTMLElement} el @param {number} x @param {number} y @param {number} d */
  function place(el, x, y, d) {
    el.style.transform = `translate3d(${(x - d / 2).toFixed(1)}px,${(y - d / 2).toFixed(1)}px,0)`;
  }
  let rootLeft = 0;
  let rootTop = 0;
  function measureRoot() {
    const r = root.getBoundingClientRect();
    rootLeft = r.left;
    rootTop = r.top;
  }
  /** @param {PointerEvent} e */
  function stickMove(e) {
    if (!L) return;
    const x = e.clientX - rootLeft;
    const y = e.clientY - rootTop;
    const T = L.travel;
    let dx = x - stick.ox;
    let dy = y - stick.oy;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len > T) {
      // The base follows a thumb that overshoots, so a direction change never needs to travel back across it.
      const k = (len - T) / len;
      stick.ox += dx * k;
      stick.oy += dy * k;
      dx = x - stick.ox;
      dy = y - stick.oy;
      len = T;
      place(base, stick.ox, stick.oy, L.stickBase);
    }
    place(knob, stick.ox + dx, stick.oy + dy, L.stickKnob);
    const n = len / T;
    let ax = 0;
    let ay = 0;
    if (n > DEAD_ZONE && len > 0) {
      const m = (n - DEAD_ZONE) / (1 - DEAD_ZONE);
      ax = (dx / len) * m;
      ay = (-dy / len) * m;
    }
    input().setAxis('moveX', ax, ID);
    input().setAxis('moveY', ay, ID);
  }
  listen(moveZone, 'pointerdown', (/** @type {PointerEvent} */ e) => {
    e.preventDefault();
    if (stick.id >= 0 || !L) return;
    measureRoot();
    stick.id = e.pointerId;
    try { moveZone.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    stick.ox = e.clientX - rootLeft;
    stick.oy = e.clientY - rootTop;
    place(base, stick.ox, stick.oy, L.stickBase);
    place(knob, stick.ox, stick.oy, L.stickKnob);
    root.classList.add('ctl-stick-on');
  });
  listen(moveZone, 'pointermove', (/** @type {PointerEvent} */ e) => {
    if (e.pointerId === stick.id) stickMove(e);
  });
  const stickUp = (/** @type {PointerEvent} */ e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = -1;
    root.classList.remove('ctl-stick-on');
    input().setAxis('moveX', 0, ID);
    input().setAxis('moveY', 0, ID);
  };
  listen(moveZone, 'pointerup', stickUp);
  listen(moveZone, 'pointercancel', stickUp);

  /* ---------------------------------------------------------------- camera drag -- */

  const lookP = { id: -1, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: 0 };
  listen(look, 'pointerdown', (/** @type {PointerEvent} */ e) => {
    e.preventDefault();
    if (lookP.id >= 0) return;
    lookP.id = e.pointerId;
    lookP.x = e.clientX; lookP.y = e.clientY;
    lookP.sx = e.clientX; lookP.sy = e.clientY;
    lookP.t = e.timeStamp || 0;
    lookP.moved = 0;
    try { look.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
  });
  listen(look, 'pointermove', (/** @type {PointerEvent} */ e) => {
    if (e.pointerId !== lookP.id) return;
    const dx = e.clientX - lookP.x;
    const dy = e.clientY - lookP.y;
    lookP.x = e.clientX;
    lookP.y = e.clientY;
    lookP.moved = Math.max(lookP.moved, Math.hypot(e.clientX - lookP.sx, e.clientY - lookP.sy));
    // A tap that barely moves stays a tap: small jitter is not sent as look.
    if (lookP.moved < 4) return;
    input().addLook(dx * LOOK_DEG_PER_PX, -dy * LOOK_DEG_PER_PX, ID);
  });
  const lookUp = (/** @type {PointerEvent} */ e) => {
    if (e.pointerId !== lookP.id) return;
    lookP.id = -1;
    const quick = (e.timeStamp || 0) - lookP.t < TAP_MS;
    if (e.type === 'pointerup' && quick && lookP.moved < TAP_PX) {
      // Tap-to-lock: combat picks the enemy under the finger (CSS px relative to #app).
      const app = dom.root || root;
      const r = app.getBoundingClientRect();
      const combat = ctx.combat;
      if (combat && typeof combat.pickAtScreen === 'function') combat.pickAtScreen(e.clientX - r.left, e.clientY - r.top);
    } else if (e.type === 'pointerup') {
      // A flick while locked switches the target toward the flick (left or right as seen on screen).
      const combat = ctx.combat;
      const fdx = e.clientX - lookP.sx;
      const fdy = e.clientY - lookP.sy;
      const ms = (e.timeStamp || 0) - lookP.t;
      if (combat && typeof combat.target === 'function' && combat.target() && isFlick(fdx, fdy, ms)) combat.cycleTarget(fdx > 0 ? 1 : -1);
    }
  };
  listen(look, 'pointerup', lookUp);
  listen(look, 'pointercancel', lookUp);
  listen(root, 'touchstart', (/** @type {TouchEvent} */ e) => { e.preventDefault(); }, { passive: false });
  listen(root, 'touchmove', (/** @type {TouchEvent} */ e) => { e.preventDefault(); }, { passive: false });
  listen(root, 'contextmenu', (/** @type {Event} */ e) => { e.preventDefault(); });
  dom.layer('touch').append(root);

  /* ---------------------------------------------------------------- layout -- */

  // The layout is recomputed only when something it depends on may have changed: a resize, an orientation change,
  // a visual viewport resize, the left-handed setting, or the controls being shown. The safe-area insets come from
  // getComputedStyle (a forced style recalculation), so they are cached and re-read only on those events.
  let dirty = true;
  let insetsDirty = true;
  const last = { w: -1, h: -1, l: -1, r: -1, t: -1, b: -1, lh: false };
  const inset = { l: 0, r: 0, t: 0, b: 0 };
  /** Mark the layout (and the cached safe-area insets) stale. */
  function invalidate() {
    dirty = true;
    insetsDirty = true;
  }
  function relayout() {
    dirty = false;
    // The viewport size, not the layer's: the layer follows #app, which the renderer may resize later this frame.
    const W = window.innerWidth || root.clientWidth;
    const H = window.innerHeight || root.clientHeight;
    if (insetsDirty) {
      insetsDirty = false;
      const cs = getComputedStyle(probe);
      inset.l = parseFloat(cs.paddingLeft) || 0;
      inset.r = parseFloat(cs.paddingRight) || 0;
      inset.t = parseFloat(cs.paddingTop) || 0;
      inset.b = parseFloat(cs.paddingBottom) || 0;
    }
    const sl = inset.l;
    const sr = inset.r;
    const st = inset.t;
    const sb = inset.b;
    const settings = ctx.save && ctx.save.settings;
    const lh = !!(settings && settings.leftHanded);
    if (W === last.w && H === last.h && sl === last.l && sr === last.r && st === last.t && sb === last.b && lh === last.lh) return;
    last.w = W; last.h = H; last.l = sl; last.r = sr; last.t = st; last.b = sb; last.lh = lh;
    L = touchLayout({ w: W, h: H, safeL: sl, safeR: sr, safeT: st, safeB: sb, leftHanded: lh });
    for (const b of L.buttons) {
      const el = btns[b.action].el;
      el.style.width = b.d + 'px';
      el.style.height = b.d + 'px';
      place(el, b.x, b.y, b.d);
      el.classList.toggle('ctl-small', b.d <= 50);
    }
    const zone = (/** @type {HTMLElement} */ el, /** @type {any} */ r) => {
      el.style.left = r.x + 'px';
      el.style.top = r.y + 'px';
      el.style.width = r.w + 'px';
      el.style.height = r.h + 'px';
    };
    zone(moveZone, L.move);
    zone(look, L.look);
    if (L.deck) {
      deck.style.display = 'block';
      deck.style.height = L.deck.h + 'px';
    } else {
      deck.style.display = 'none';
    }
    ghost.style.width = L.ghost.d + 'px';
    ghost.style.height = L.ghost.d + 'px';
    place(ghost, L.ghost.x, L.ghost.y, L.ghost.d);
    base.style.width = L.stickBase + 'px';
    base.style.height = L.stickBase + 'px';
    knob.style.width = L.stickKnob + 'px';
    knob.style.height = L.stickKnob + 'px';
  }

  const onResize = () => {
    invalidate();
    if (shown) relayout();
  };
  listen(window, 'resize', onResize);
  listen(window, 'orientationchange', onResize);
  const vv = /** @type {any} */ (window).visualViewport;
  if (vv && typeof vv.addEventListener === 'function') listen(vv, 'resize', onResize);
  /** @param {any} p settings:changed */
  function onSettings(p) {
    if (p && p.key === 'leftHanded') dirty = true;
  }

  /** @param {string} action @param {boolean} on */
  function show(action, on) {
    const b = btns[action];
    if (b.shown === on) return;
    b.shown = on;
    b.el.classList.toggle('ctl-hide', !on);
    if (!on && b.pointer >= 0) release(action, b);
  }

  function relabel() {
    const t = ctx.i18n;
    if (!t) return;
    for (const action of TOUCH_BUTTONS) btns[action].el.setAttribute('aria-label', t.t('ctl.btn.' + action));
    moveZone.setAttribute('aria-label', t.t('ctl.zone.move'));
    look.setAttribute('aria-label', t.t('ctl.zone.look'));
  }
  relabel();

  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  // A phone has no keyboard: on a coarse pointer the active device starts as 'touch', so the first prompts show
  // touch glyphs, and any real touch, also on a menu, makes touch the active device. Not in test mode without
  // autoplay, where real devices are ignored.
  const flags = ctx.flags || {};
  if (!(flags.test && !flags.autoplay)) {
    const markTouch = () => {
      const inp = input();
      if (inp && inp.device !== 'touch') inp.setDevice('touch');
    };
    if (coarse) markTouch();
    listen(window, 'pointerdown', (/** @type {PointerEvent} */ e) => { if (e.pointerType === 'touch') markTouch(); }, { capture: true, passive: true });
  }
  // A tap anywhere skips a skippable in-game camera shot (the transformation, the ultimate, a boss intro): a phone
  // has no Enter key, and the touch controls are hidden while the shot plays.
  listen(window, 'pointerdown', () => {
    const cam = ctx.cam;
    const inp = input();
    if (cam && cam.busy && inp && inp.context === 'cine' && typeof cam.skip === 'function') cam.skip();
  }, { capture: true, passive: true });
  let shown = false;
  let disposed = false;
  let slowT = 1;
  let surgeFull = false;
  let latched = false;
  let lastCount = '';
  let formColor = '';
  /** @type {Record<string, number>} */
  const cdShown = { tech1: -1, tech2: -1, ultimate: -1 };

  /** Release every held control (hide, context change, dispose). */
  function releaseAll() {
    for (const action of TOUCH_BUTTONS) {
      const b = btns[action];
      if (b.pointer >= 0) {
        b.longSent = true;
        release(action, b);
      }
    }
    if (stick.id >= 0) {
      stick.id = -1;
      root.classList.remove('ctl-stick-on');
      input().setAxis('moveX', 0, ID);
      input().setAxis('moveY', 0, ID);
    }
    lookP.id = -1;
  }

  /** Contextual visibility and button states, at about 10 Hz. */
  function refresh() {
    const p = ctx.player;
    const rpg = ctx.rpg;
    const flying = !!(p && p.move && p.move.mode === 'fly');
    show('attack', true);
    show('bolt', true);
    show('dash', true);
    show('guard', true);
    show('jump', true);
    show('descend', flying);
    let gather = false;
    let item = false;
    let tech1 = null;
    let tech2 = null;
    let ult = null;
    let forms = 0;
    try {
      if (rpg) {
        gather = typeof rpg.hasTech === 'function' && !!rpg.hasTech('gather');
        const q = rpg.quickItem;
        const n = q && typeof rpg.count === 'function' ? rpg.count(q) : 0;
        item = !!q;
        const cs = String(n);
        if (cs !== lastCount && btns.item.count) {
          lastCount = cs;
          btns.item.count.textContent = cs;
          btns.item.el.classList.toggle('ctl-cool', n <= 0);
        }
        const sl = typeof rpg.slots === 'function' ? rpg.slots() : null;
        if (sl) {
          tech1 = sl.slots ? sl.slots[0] : null;
          tech2 = sl.slots ? sl.slots[1] : null;
          ult = sl.ultimate || null;
        }
        const f = typeof rpg.forms === 'function' ? rpg.forms() : null;
        forms = f ? f.length : 0;
      }
    } catch (err) {
      /* rpg may not be ready during boot */
    }
    show('gather', gather);
    show('item', item);
    show('tech1', !!tech1);
    show('tech2', !!tech2);
    show('form', forms > 0);
    show('ultimate', !!ult && surgeFull);
    const ultEl = btns.ultimate.el;
    if (ultEl.classList.contains('ctl-ult') !== surgeFull) ultEl.classList.toggle('ctl-ult', surgeFull);
    // Form colour.
    const fid = p && p.combat && p.combat.formId ? p.combat.formId : '';
    const fc = FORM_COLORS[fid] || '';
    if (fc !== formColor) {
      formColor = fc;
      btns.form.el.style.borderColor = fc;
      btns.form.el.style.color = fc;
    }
    // Cooldown rings.
    cooldown('tech1', tech1, p);
    cooldown('tech2', tech2, p);
  }

  /** @param {string} action @param {string|null} techId @param {any} p */
  function cooldown(action, techId, p) {
    const b = btns[action];
    if (!b.cd) return;
    let frac = 0;
    if (techId && p && p.combat && p.combat.cooldowns) {
      const left = p.combat.cooldowns[techId] || 0;
      if (left > 0) {
        const def = ctx.defs && typeof ctx.defs.find === 'function' ? ctx.defs.find('technique', techId) : null;
        const total = def && def.cooldown > 0 ? def.cooldown : left;
        frac = Math.min(1, left / total);
      }
    }
    const q = Math.round(frac * 50) / 50;
    if (q === cdShown[action]) return;
    cdShown[action] = q;
    b.cd.setAttribute('stroke-dashoffset', String(100 - q * 100));
    b.el.classList.toggle('ctl-cool', q > 0);
  }

  /** @param {any} e */
  function onSurge(e) {
    surgeFull = !!(e && e.full);
  }
  function onLang() {
    relabel();
  }
  const bus = ctx.bus;
  bus.on('combat:surge', onSurge, 'control');
  bus.on('lang:changed', onLang, 'control');
  bus.on('settings:changed', onSettings, 'control');
  // Safety net for a missed resize event: the viewport size (not the insets) is compared once a second.
  let sizeCheckT = 0;

  return {
    /** @param {any} inp @param {number} dt */
    poll(inp, dt) {
      if (disposed) return;
      const cam = ctx.cam;
      const want = (inp.device === 'touch' || (coarse && inp.device !== 'pad')) && inp.context === 'game' && !(cam && cam.busy);
      if (want !== shown) {
        shown = want;
        root.classList.toggle('ctl-on', want);
        if (!want) releaseAll();
        else {
          invalidate();
          slowT = 1;
        }
      }
      if (!shown) return;
      if (dirty) relayout();
      // Long presses (Form cycles, Item switches).
      for (const action in LONG_ACTIONS) {
        const b = btns[action];
        if (b.pointer >= 0 && !b.longSent && performance.now() - b.downAt >= LONG_MS) {
          b.longSent = true;
          const long = LONG_ACTIONS[action];
          inp.setButton(long, true, ID);
          inp.setButton(long, false, ID);
        }
      }
      // Descend follows the flight state at once (the flight sub-layout); the rest refreshes at 10 Hz.
      const pl = ctx.player;
      show('descend', !!(pl && pl.move && pl.move.mode === 'fly'));
      const on = !!(shared.latch && shared.latch.on);
      if (on !== latched) {
        latched = on;
        btns.dash.el.classList.toggle('ctl-latched', on);
      }
      slowT += dt > 0 ? dt : 1 / 60;
      sizeCheckT += dt > 0 ? dt : 1 / 60;
      if (sizeCheckT >= 1) {
        sizeCheckT = 0;
        dirty = true;
      }
      if (slowT >= 0.1) {
        slowT = 0;
        refresh();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseAll();
      for (const [t, type, fn, opt] of listeners) t.removeEventListener(type, fn, opt);
      bus.off('combat:surge', onSurge);
      bus.off('lang:changed', onLang);
      bus.off('settings:changed', onSettings);
      if (root.parentElement) root.parentElement.removeChild(root);
    },
    /** The current layout (tests). */
    layout: () => L,
  };
}
