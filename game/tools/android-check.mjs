#!/usr/bin/env node
/**
 * Android check: the closest thing to a phone this machine can run. It is NOT a real device (the GPU is software and
 * there is no Android OS); it exercises everything else the way a phone does:
 *
 * - Chromium with Android device profiles (user agent, viewport, device pixel ratio, mobile mode, touch screen);
 * - the published fragment (dist/artifact-inline.html) inside a sandboxed iframe, as the artifact host serves it,
 *   in normal mode (no test flags): Hebrew, audio on, storage refused;
 * - REAL touch input through the browser's input pipeline (CDP Input.dispatchTouchEvent), several fingers at once,
 *   so that touch-action, scrolling, zooming, long-press menus and pointercancel behave as on a phone (the scenario
 *   suites dispatch synthetic PointerEvents, which never trigger browser gestures);
 * - rotation, going to the background and coming back, a soak with heap sampling;
 * - a 4x CPU slowdown for boot and frame cost;
 * - a WebGL2 context stripped of every optional extension, with a low-memory device, to prove the game needs
 *   nothing a WebGL2 phone may lack.
 *
 * Usage: node tools/android-check.mjs [--only <device>] [--quick]
 * Output: a table on stdout, tools/out/android/report.json and screenshots in tools/out/android/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureBuilt, loadPlaywright } from './lib/harness.mjs';
import { GAME_ROOT } from './gen-registry.mjs';
import { startServer } from './serve.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const quick = argv.includes('--quick');
const OUT = join(GAME_ROOT, 'tools', 'out', 'android');
mkdirSync(OUT, { recursive: true });

const DEVICES = ['Pixel 7', 'Galaxy S9+', 'Galaxy A55', 'Moto G4', 'Pixel 7 landscape'];
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

/** @type {{ device:string, check:string, ok:boolean, note:string }[]} */
const rows = [];
const add = (device, check, ok, note = '') => {
  rows.push({ device, check, ok: !!ok, note: String(note) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${device.padEnd(18)} ${check.padEnd(34)} ${note}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in every frame before any page script: counters for gesture leaks. */
function probeInit() {
  const w = /** @type {any} */ (window);
  w.__probe = { cancel: 0, ctxmenu: 0, scroll: 0, select: 0 };
  addEventListener('pointercancel', () => { w.__probe.cancel++; }, true);
  addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) w.__probe.ctxmenu++; }, false);
  addEventListener('scroll', () => { w.__probe.scroll++; }, true);
  document.addEventListener('selectionchange', () => {
    const s = document.getSelection();
    if (s && String(s).length > 0) w.__probe.select++;
  });
}

/** Runs before any page script: a bare WebGL2 context and a low-memory device. */
function bareInit() {
  const keep = { WEBGL_lose_context: 1 };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const ge = C.prototype.getExtension;
    C.prototype.getExtension = function (n) { return keep[n] ? ge.call(this, n) : null; };
    C.prototype.getSupportedExtensions = function () { return Object.keys(keep); };
  }
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 }); } catch (e) { /* fixed */ }
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }); } catch (e) { /* fixed */ }
}

function hostDoc() {
  const inline = readFileSync(join(GAME_ROOT, 'dist', 'artifact-inline.html'), 'utf8');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    + inline + '</body></html>';
}
const HOST = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head>'
  + '<body><iframe id="f" sandbox="allow-scripts" allow="autoplay"></iframe></body></html>';

/**
 * Open the fragment in a sandboxed iframe on a fresh page of `context`.
 * @returns {Promise<{ page:any, frame:any, errs:string[], reqs:string[], cdp:any }>}
 */
async function openSandboxed(context) {
  const page = await context.newPage();
  const errs = [];
  const reqs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|ERR_FAILED|net::ERR/.test(t + JSON.stringify(m.location()))) errs.push('[console] ' + t);
    if (/GL_INVALID|WebGL: INVALID|GL ERROR|context lost/i.test(t)) errs.push('[gl] ' + t);
  });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + (e && e.message)));
  page.on('dialog', (d) => { errs.push('[dialog] ' + d.type()); d.dismiss().catch(() => {}); });
  page.on('request', (rq) => {
    const u = rq.url();
    if (!/^(data:|blob:|about:)/.test(u) && !/fonts\.(googleapis|gstatic)\.com/.test(u)) reqs.push(u);
  });
  await page.route('**/*', (route) => (/^https?:/.test(route.request().url()) ? route.abort() : route.continue()));
  await page.setContent(HOST);
  const doc = hostDoc();
  await page.evaluate((d) => { /** @type {any} */ (document.getElementById('f')).srcdoc = d; }, doc);
  let frame = null;
  for (let i = 0; i < 200 && !frame; i++) {
    frame = page.frames().find((f) => f !== page.mainFrame() && f.url() !== 'about:blank') || null;
    if (!frame) await sleep(50);
  }
  if (!frame) throw new Error('no iframe');
  const cdp = await context.newCDPSession(page);
  return { page, frame, errs, reqs, cdp };
}

async function waitReady(frame, ms = 240000) {
  await frame.waitForFunction(() => {
    const g = /** @type {any} */ (window).__GAME__;
    return !!g && (g.isReady() || g.errors.length > 0);
  }, null, { timeout: ms, polling: 250 });
  return frame.evaluate(() => {
    const g = /** @type {any} */ (window).__GAME__;
    return { ready: g.isReady(), errors: g.errors.slice(0, 5), top: g.top() };
  });
}

/** Real touch helpers on a CDP session; coordinates are CSS px of the top page (the iframe fills it). */
function touch(cdp) {
  /** @type {Map<number, { x:number, y:number }>} */
  const pts = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: [...pts].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 0.5 })),
  });
  return {
    async down(id, x, y) { pts.set(id, { x, y }); await send(pts.size === 1 ? 'touchStart' : 'touchMove').catch(() => {}); if (pts.size > 1) await send('touchStart').catch(() => {}); },
    async move(id, x, y) { if (pts.has(id)) { pts.set(id, { x, y }); await send('touchMove'); } },
    async up(id) { pts.delete(id); await send(pts.size ? 'touchMove' : 'touchEnd'); if (pts.size === 0) return; },
    async tap(x, y, hold = 70) {
      const id = 90 + pts.size;
      pts.set(id, { x, y });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...pts].map(([i, p]) => ({ x: p.x, y: p.y, id: i })) });
      await sleep(hold);
      pts.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type: pts.size ? 'touchMove' : 'touchEnd', touchPoints: [...pts].map(([i, p]) => ({ x: p.x, y: p.y, id: i })) });
    },
    async releaseAll() { pts.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {}); },
  };
}

const rectOf = (frame, sel) => frame.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom };
}, sel);

const snap = (frame) => frame.evaluate(() => {
  const g = /** @type {any} */ (window).__GAME__;
  const c = g.ctx;
  const p = c.player;
  const vv = window.visualViewport;
  const st = c.loop && c.loop.stats ? c.loop.stats : {};
  return {
    top: g.top(),
    x: p ? p.pos.x : 0, y: p ? p.pos.y : 0, z: p ? p.pos.z : 0,
    mode: p && p.move ? p.move.mode : '',
    yaw: c.cam ? c.cam.yaw : 0,
    probe: { .../** @type {any} */ (window).__probe },
    zoom: vv ? vv.scale : 1,
    scrollY: (document.scrollingElement || document.documentElement).scrollTop,
    iw: innerWidth, ih: innerHeight,
    errors: g.errors.slice(0, 5),
    heap: /** @type {any} */ (performance).memory ? /** @type {any} */ (performance).memory.usedJSHeapSize : 0,
    cost: st.costMs || 0, cap: st.cap || 0,
    audio: c.audio && c.audio.debug ? (c.audio.debug().state || '') : '',
  };
});

/** Count events on the game bus from now on. */
const watchBus = (frame) => frame.evaluate(() => {
  const g = /** @type {any} */ (window).__GAME__;
  const w = /** @type {any} */ (window);
  if (w.__bus) return;
  w.__bus = { tech: 0, jump: 0, mode: [], paused: 0 };
  g.ctx.bus.on('combat:techStart', (e) => { if (g.ctx.player && e.entId === g.ctx.player.id) w.__bus.tech++; });
  g.ctx.bus.on('move:jump', () => { w.__bus.jump++; });
  g.ctx.bus.on('move:mode', (e) => { w.__bus.mode.push(e.mode); });
});
const bus = (frame) => frame.evaluate(() => JSON.parse(JSON.stringify(/** @type {any} */ (window).__bus || {})));

async function runDevice(pw, browser, name, doc) {
  const dev = pw.devices[name];
  const context = await browser.newContext({ ...dev });
  await context.addInitScript(probeInit);
  const { page, frame, errs, reqs, cdp } = await openSandboxed(context);
  const t = touch(cdp);
  const W = dev.viewport.width;
  const H = dev.viewport.height;
  const shot = async (n) => { await page.screenshot({ path: join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-')}-${n}.png`) }).catch(() => {}); };
  try {
    // ---- boot
    const t0 = Date.now();
    const r = await waitReady(frame);
    const boot = await frame.evaluate(() => {
      const g = /** @type {any} */ (window).__GAME__;
      const c = g.ctx;
      const cv = document.querySelector('canvas');
      const bt = g.bootTimes ? g.bootTimes() : null;
      return {
        tier: c.render.tier, scale: c.render.scale, cw: cv ? cv.width : 0, ch: cv ? cv.height : 0,
        css: cv ? [cv.clientWidth, cv.clientHeight] : [0, 0], dpr: devicePixelRatio, lang: c.i18n.lang, dir: document.documentElement.dir || document.body.dir || (document.querySelector('[dir]') || {}).dir,
        total: bt ? Math.round(bt.total) : 0, fcp: bt ? Math.round(bt.firstContentfulPaint || 0) : 0,
        bake: c.world && c.world.bakeMode, coarse: matchMedia('(pointer: coarse)').matches, ua: navigator.userAgent.slice(0, 60),
        storage: c.save && c.save.memoryOnly ? 'memory' : 'local', iw: innerWidth, ih: innerHeight,
      };
    });
    add(name, 'boot in sandboxed iframe', r.ready && r.errors.length === 0, `title in ${((Date.now() - t0) / 1000).toFixed(1)} s (game clock ${boot.total} ms), top=${r.top}${r.errors.length ? ' ' + r.errors[0] : ''}`);
    add(name, 'phone defaults', boot.tier === 'low' && boot.coarse && boot.lang === 'he', `tier ${boot.tier}, canvas ${boot.cw}x${boot.ch} for ${boot.css[0]}x${boot.css[1]} css at dpr ${boot.dpr}, lang ${boot.lang}, storage ${boot.storage}, bake ${boot.bake}`);
    add(name, 'viewport fills the screen', boot.iw === W && boot.ih === H && boot.css[0] === W && boot.css[1] === H, `inner ${boot.iw}x${boot.ih}, expected ${W}x${H}`);
    await shot('1-title');

    // ---- title -> new journey with real taps
    let b = await rectOf(frame, '[data-screen=title] .ui-menu .ui-btn:nth-child(2)');
    if (b) await t.tap(b.x, b.y);
    await sleep(900);
    let top = await frame.evaluate(() => /** @type {any} */ (window).__GAME__.top());
    add(name, 'tap New Journey', top === 'newgame', `top=${top}`);
    const fits = await frame.evaluate(() => {
      const s = document.querySelector('[data-screen=newgame]');
      if (!s) return 'no screen';
      const bad = [];
      for (const e of s.querySelectorAll('button,.ui-slot,.ui-chipbtn')) {
        const q = e.getBoundingClientRect();
        if (q.width < 2) continue;
        if (q.left < -1 || q.right > innerWidth + 1) bad.push('off-screen x');
        if (q.height < 40 && e.tagName === 'BUTTON') bad.push('small ' + Math.round(q.height));
      }
      return bad.slice(0, 3).join(', ');
    });
    add(name, 'new-journey screen fits', fits === '', fits);
    await shot('2-newgame');
    b = await rectOf(frame, '[data-screen=newgame] .ui-btn.ui-accent');
    if (b) {
      await t.tap(b.x, b.y);
    }
    // the opening: tap through dialogue until the HUD has the player moving freely
    let started = false;
    for (let i = 0; i < 90 && !started; i++) {
      await sleep(700);
      const s = await frame.evaluate(() => {
        const g = /** @type {any} */ (window).__GAME__;
        const c = g.ctx;
        return { top: g.top(), ctx: c.input && c.input.context ? (typeof c.input.context === 'function' ? c.input.context() : c.input.context) : '', hasMove: !!document.querySelector('.ctl-touch [data-action="move"]'), shown: getComputedStyle(document.querySelector('.ctl-touch') || document.body).display };
      });
      if (s.top === 'hud' && s.shown !== 'none' && (s.ctx === 'game' || s.ctx === '')) { started = true; break; }
      if (s.top === 'dialogue' || s.top === 'hud') await t.tap(W / 2, H * 0.55);
    }
    add(name, 'journey starts, controls shown', started, started ? '' : 'the HUD and touch controls did not appear');
    if (!started) throw new Error('journey did not start');
    await watchBus(frame);
    await sleep(600);
    await shot('3-game');
    const dv = await frame.evaluate(() => ({ device: /** @type {any} */ (window).__GAME__.ctx.input.device, prompt: (document.querySelector('.ui-prompt') || {}).innerText || '' }));
    add(name, 'starts as a touch device', dv.device === 'touch' && !/WASD|Space|Shift|LMB|RMB/i.test(dv.prompt), `device ${dv.device}, first prompt "${dv.prompt.replace(/\s+/g, ' ').slice(0, 40)}"`);

    // ---- layout of the real controls
    const lay = await frame.evaluate(() => {
      const out = { n: 0, bad: [] };
      const list = [...document.querySelectorAll('.ctl-touch .ctl-btn')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 2);
      out.n = list.length;
      const rs = list.map((e) => ({ a: e.getAttribute('data-action'), r: e.getBoundingClientRect() }));
      for (const q of rs) {
        if (q.r.left < 0 || q.r.top < 0 || q.r.right > innerWidth || q.r.bottom > innerHeight) out.bad.push(q.a + ' off-screen');
        if (Math.min(q.r.width, q.r.height) < 44) out.bad.push(q.a + ' small ' + Math.round(q.r.width));
      }
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i].r; const c = rs[j].r;
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.bad.push(rs[i].a + ' overlaps ' + rs[j].a);
      }
      return out;
    });
    add(name, 'touch buttons: size, no overlap', lay.n >= 5 && lay.bad.length === 0, `${lay.n} buttons${lay.bad.length ? ': ' + lay.bad.slice(0, 3).join(', ') : ''}`);

    // ---- real multi-touch: stick held, attack with a second finger, camera drag with a third
    const mv = await rectOf(frame, '.ctl-touch [data-action="move"]');
    const lk = await rectOf(frame, '.ctl-touch [data-action="look"]');
    const at = await rectOf(frame, '.ctl-touch [data-action="attack"]');
    const jp = await rectOf(frame, '.ctl-touch [data-action="jump"]');
    const s0 = await snap(frame);
    const sx = mv.l + Math.min(110, mv.w / 2);
    const sy = mv.b - Math.min(120, mv.h / 2);
    await t.down(1, sx, sy);
    for (let i = 1; i <= 6; i++) { await t.move(1, sx, sy - i * 10); await sleep(16); }
    await sleep(quick ? 900 : 1600);
    const s1 = await snap(frame);
    const moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
    add(name, 'stick drag moves the hero', moved > 1.5 && s1.probe.cancel === 0, `${moved.toFixed(1)} m, pointercancel ${s1.probe.cancel}`);
    // second finger: attack, three taps while the stick is held
    for (let i = 0; i < 3; i++) { await t.tap(at.x, at.y, 60); await sleep(180); }
    await sleep(300);
    const b1 = await bus(frame);
    const s2 = await snap(frame);
    const moved2 = Math.hypot(s2.x - s1.x, s2.z - s1.z);
    add(name, 'attack with a 2nd finger', b1.tech >= 1, `${b1.tech} technique starts, stick still held (hero moved ${moved2.toFixed(1)} m more)`);
    // third finger: camera drag while the stick is held
    const cx = lk.l + lk.w * 0.6;
    const cy = lk.t + lk.h * 0.35;
    await t.down(2, cx, cy);
    for (let i = 1; i <= 10; i++) { await t.move(2, cx - i * 14, cy + i * 2); await sleep(16); }
    await sleep(120);
    const s3 = await snap(frame);
    await t.up(2);
    let dyaw = Math.abs(s3.yaw - s2.yaw);
    if (dyaw > Math.PI) dyaw = Math.abs(dyaw - 2 * Math.PI);
    add(name, 'camera drag while moving', dyaw > 0.2 && s3.probe.cancel === 0, `yaw changed ${dyaw.toFixed(2)} rad, pointercancel ${s3.probe.cancel}`);
    await t.up(1);
    await sleep(200);

    // ---- jump twice = take off (tutorial may not allow flight yet: a jump is enough)
    await t.tap(jp.x, jp.y, 60);
    await sleep(250);
    await t.tap(jp.x, jp.y, 60);
    await sleep(500);
    const b2 = await bus(frame);
    add(name, 'jump button', b2.jump >= 1, `${b2.jump} jumps, modes ${b2.mode.slice(-3).join('>')}`);

    // ---- browser gestures must do nothing: long press, double tap, pinch, drag off the bottom edge
    await t.down(5, at.x, at.y);
    await sleep(900);
    await t.up(5);
    await t.tap(cx, cy, 40); await sleep(60); await t.tap(cx, cy, 40);
    await t.down(6, cx - 30, cy); await t.down(7, cx + 30, cy);
    for (let i = 1; i <= 8; i++) { await t.move(6, cx - 30 - i * 10, cy); await t.move(7, cx + 30 + i * 10, cy); await sleep(16); }
    await t.up(6); await t.up(7);
    await t.down(8, sx, sy);
    for (let i = 1; i <= 8; i++) { await t.move(8, sx, sy + i * 30); await sleep(16); }
    await t.up(8);
    await t.down(9, W / 2, 20);
    for (let i = 1; i <= 8; i++) { await t.move(9, W / 2, 20 + i * 40); await sleep(16); }
    await t.up(9);
    await sleep(300);
    const s4 = await snap(frame);
    const hostScroll = await page.evaluate(() => ({ y: scrollY, zoom: visualViewport ? visualViewport.scale : 1 }));
    const gest = s4.zoom === 1 && s4.scrollY === 0 && hostScroll.y === 0 && hostScroll.zoom === 1 && s4.probe.ctxmenu === 0 && s4.probe.select === 0;
    add(name, 'no zoom, scroll, menu, selection', gest, `zoom ${s4.zoom}/${hostScroll.zoom}, scroll ${s4.scrollY}/${hostScroll.y}, context menus ${s4.probe.ctxmenu}, selections ${s4.probe.select}, pointercancel ${s4.probe.cancel}`);

    // ---- pause with a real tap, and back
    const pz = await frame.evaluate(() => {
      const e = document.querySelector('[data-ui=pause]');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, on: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
    });
    // nothing may be scrolled, and the whole HUD must be on the screen
    const shifted = await frame.evaluate(() => {
      const bad = [];
      for (const e of [document.documentElement, document.body, document.getElementById('app'), ...document.querySelectorAll('.k-layer')]) {
        if (e && (e.scrollTop || e.scrollLeft)) bad.push((e.id || e.className || e.tagName) + ' scrolled ' + e.scrollTop);
      }
      const cv = document.querySelector('canvas').getBoundingClientRect();
      if (Math.abs(cv.top) > 0.5 || Math.abs(cv.left) > 0.5) bad.push('canvas at ' + cv.left + ',' + cv.top);
      for (const e of document.querySelectorAll('.ui-hud button')) {
        const r = e.getBoundingClientRect();
        if (r.width > 2 && (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth)) bad.push('HUD button off-screen (' + Math.round(r.left) + ',' + Math.round(r.top) + ')');
      }
      return bad.slice(0, 3).join('; ');
    });
    add(name, 'nothing shifted or off-screen', shifted === '', shifted);
    if (pz) {
      await t.tap(pz.x, pz.y);
      await sleep(700);
      const tp = await frame.evaluate(() => /** @type {any} */ (window).__GAME__.top());
      await shot('4-pause');
      const menuFits = await frame.evaluate(() => {
        const root = document.querySelector('[data-screen]');
        return document.documentElement.scrollWidth <= innerWidth + 1 && (!root || root.scrollWidth <= innerWidth + 1);
      });
      add(name, 'pause menu opens and fits', tp !== 'hud' && menuFits, `top=${tp}`);
      await frame.evaluate(() => /** @type {any} */ (window).__GAME__.ctx.ui.closeAll && /** @type {any} */ (window).__GAME__.ctx.ui.closeAll());
      await sleep(400);
    } else add(name, 'pause menu opens and fits', false, 'no pause button found');

    // ---- rotate and back
    await page.setViewportSize({ width: H, height: W });
    await sleep(1200);
    const rot = await frame.evaluate(() => {
      const cv = document.querySelector('canvas');
      const bad = [];
      for (const e of document.querySelectorAll('.ctl-touch .ctl-btn')) {
        const q = e.getBoundingClientRect();
        if (q.width < 2 || getComputedStyle(e).display === 'none') continue;
        if (q.left < 0 || q.top < 0 || q.right > innerWidth || q.bottom > innerHeight) bad.push(e.getAttribute('data-action'));
      }
      return { iw: innerWidth, ih: innerHeight, cw: cv.clientWidth, ch: cv.clientHeight, bad };
    });
    await shot('5-rotated');
    add(name, 'rotate: layout follows', rot.iw === H && rot.cw === H && rot.ch === W && rot.bad.length === 0, `${rot.cw}x${rot.ch}${rot.bad.length ? ', off-screen: ' + rot.bad.join(',') : ''}`);
    await page.setViewportSize({ width: W, height: H });
    await sleep(900);

    // ---- background and back: paused and saved, then running again
    const bg = await frame.evaluate(async () => {
      const g = /** @type {any} */ (window).__GAME__;
      const c = g.ctx;
      const tick0 = c.time.tick;
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 600));
      const during = c.time.tick;
      const paused = c.loop.paused ? (typeof c.loop.paused === 'function' ? c.loop.paused() : c.loop.paused) : null;
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 900));
      return { stepsHidden: during - tick0, after: c.time.tick - during, paused: String(paused) };
    });
    add(name, 'background pauses, return resumes', bg.stepsHidden <= 3 && bg.after > 5, `sim steps while hidden ${bg.stepsHidden}, after return ${bg.after}`);

    // ---- soak: move, attack and turn for a while; heap and errors
    const h0 = await snap(frame);
    const soak = quick ? 8 : 40;
    const tEnd = Date.now() + soak * 1000;
    await t.down(1, sx, sy);
    let k = 0;
    let costSum = 0;
    let costN = 0;
    while (Date.now() < tEnd) {
      k++;
      await t.move(1, sx + Math.cos(k * 0.7) * 50, sy + Math.sin(k * 0.7) * 50);
      await t.tap(at.x, at.y, 50);
      if (k % 3 === 0) { await t.down(2, cx, cy); for (let i = 1; i <= 5; i++) { await t.move(2, cx + i * 12 * (k % 2 ? 1 : -1), cy); await sleep(16); } await t.up(2); }
      await sleep(260);
      const q = await snap(frame);
      if (q.cost > 0) { costSum += q.cost; costN++; }
    }
    await t.up(1);
    await sleep(500);
    const h1 = await snap(frame);
    const grow = (h1.heap - h0.heap) / 1048576;
    add(name, `${soak} s of play: no errors`, h1.errors.length === 0 && errs.length === 0, errs.concat(h1.errors).slice(0, 2).join(' | ') || `heap ${(h0.heap / 1048576).toFixed(0)} -> ${(h1.heap / 1048576).toFixed(0)} MB, frame cost ${(costSum / Math.max(1, costN)).toFixed(1)} ms (JS only), pointercancel ${h1.probe.cancel}`);
    add(name, 'heap growth in the soak', grow < 40, `${grow.toFixed(1)} MB`);
    add(name, 'no network beyond fonts', reqs.filter((u) => /^https?:/.test(u)).length === 0, reqs.filter((u) => /^https?:/.test(u)).slice(0, 2).join(' '));
    await shot('6-end');
  } catch (e) {
    add(name, 'run completed', false, String(e && e.message ? e.message : e).slice(0, 200) + (errs.length ? ' | ' + errs[0].slice(0, 160) : ''));
    await shot('error');
  }
  await context.close();
}

/** Boot and frame cost with the CPU slowed 4x (top-level page, normal mode, no audio). */
async function runThrottled(pw, browser, url) {
  const name = 'Pixel 7, CPU /4';
  const context = await browser.newContext({ ...pw.devices['Pixel 7'] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.route('**/*', (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    await page.goto(url + 'index.html?noaudio=1&tutorial=0&nosave=1', { waitUntil: 'load' });
    await page.waitForFunction(() => { const g = /** @type {any} */ (window).__GAME__; return !!g && (g.isReady() || g.errors.length > 0); }, null, { timeout: 300000, polling: 250 });
    const bt = await page.evaluate(() => {
      const g = /** @type {any} */ (window).__GAME__;
      const b = g.bootTimes();
      const by = {};
      for (const s of b.stages) by[s.stage] = Math.round(s.ms);
      return { total: Math.round(b.total), fcp: Math.round(b.firstContentfulPaint || 0), by, tier: g.ctx.render.tier };
    });
    add(name, 'boot time', bt.total < 20000, `title after ${(bt.total / 1000).toFixed(1)} s (first paint ${bt.fcp} ms; world ${bt.by.world || '?'} ms, compile ${bt.by.compile || '?'} ms), tier ${bt.tier}`);
    // start a journey through the API, then measure the real loop for 12 s in a settlement and 12 s in a fight
    await page.evaluate(() => { const g = /** @type {any} */ (window).__GAME__; g.ctx.ui.closeAll(); g.ctx.session.start({ newGame: true }); });
    await sleep(4000);
    const measure = (secs) => page.evaluate(async (s) => {
      const g = /** @type {any} */ (window).__GAME__;
      const c = g.ctx;
      const a = [];
      const t0 = performance.now();
      const tk0 = c.time.tick;
      while (performance.now() - t0 < s * 1000) {
        await new Promise((r) => setTimeout(r, 100));
        if (c.loop.stats.costMs > 0) a.push(c.loop.stats.costMs);
      }
      a.sort((x, y) => x - y);
      const el = (performance.now() - t0) / 1000;
      const st = g.stats();
      return { avg: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p95: a[Math.floor(a.length * 0.95)] || 0, simHz: (c.time.tick - tk0) / el, fps: st.fps, draws: st.drawCalls, tris: st.triangles, scale: st.scale };
    }, secs);
    const m1 = await measure(quick ? 5 : 12);
    add(name, 'frame cost at rest (JS)', m1.avg < 12, `avg ${m1.avg.toFixed(1)} ms, p95 ${m1.p95.toFixed(1)} ms, sim ${m1.simHz.toFixed(0)} Hz, ${m1.draws} draws, scale ${m1.scale}`);
    await page.evaluate(() => {
      const g = /** @type {any} */ (window).__GAME__;
      const p = g.ctx.player;
      for (let i = 0; i < 8; i++) g.spawn('tusk_boar', { x: p.pos.x + Math.cos(i) * 9, z: p.pos.z + Math.sin(i) * 9, level: 1, aggro: true });
      g.god && g.god(true);
      g.hold && g.hold('attack', true);
    });
    const m2 = await measure(quick ? 5 : 12);
    add(name, 'frame cost in a fight (JS)', m2.avg < 14, `avg ${m2.avg.toFixed(1)} ms, p95 ${m2.p95.toFixed(1)} ms, sim ${m2.simHz.toFixed(0)} Hz, ${m2.draws} draws`);
  } catch (e) {
    add(name, 'run completed', false, String(e && e.message ? e.message : e).slice(0, 220));
  }
  await context.close();
}

/** A WebGL2 context with no optional extension, on a 2 GB device: low tier and forced high tier. */
async function runBare(pw, browser, url) {
  for (const q of ['quality=low', 'quality=high']) {
    const name = 'bare WebGL2, ' + q.split('=')[1];
    const context = await browser.newContext({ ...pw.devices['Moto G4'] });
    await context.addInitScript(bareInit);
    const page = await context.newPage();
    const errs = [];
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /GL_INVALID|WebGL: INVALID|GL ERROR|FRAMEBUFFER|incomplete/i.test(t)) errs.push(t.slice(0, 160)); });
    page.on('pageerror', (e) => errs.push(String(e && e.message).slice(0, 160)));
    await page.route('**/*', (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
    try {
      await page.goto(url + 'index.html?noaudio=1&tutorial=0&nosave=1&' + q, { waitUntil: 'load' });
      await page.waitForFunction(() => { const g = /** @type {any} */ (window).__GAME__; return !!g && (g.isReady() || g.errors.length > 0); }, null, { timeout: 300000, polling: 250 });
      await page.evaluate(() => { const g = /** @type {any} */ (window).__GAME__; g.ctx.ui.closeAll(); g.ctx.session.start({ newGame: true }); });
      await sleep(5000);
      const r = await page.evaluate(() => {
        const g = /** @type {any} */ (window).__GAME__;
        const c = g.ctx;
        const gl = c.three.renderer.getContext();
        // programs: active uniforms against the smallest limits a WebGL2 device may report
        let worst = 0;
        let attrs = 0;
        for (const p of c.three.renderer.info.programs || []) {
          const prog = p.program;
          let v = 0;
          const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
          for (let i = 0; i < n; i++) {
            const u = gl.getActiveUniform(prog, i);
            const per = u.type === gl.FLOAT_MAT4 ? 4 : u.type === gl.FLOAT_MAT3 ? 3 : 1;
            v += per * u.size;
          }
          worst = Math.max(worst, v);
          attrs = Math.max(attrs, gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES));
        }
        // is the picture alive: sample the canvas for more than one colour
        const cv = document.querySelector('canvas');
        const t2 = document.createElement('canvas');
        t2.width = 32; t2.height = 32;
        const x = t2.getContext('2d');
        c.three.renderer.render(c.three.scene, c.three.camera || c.render.camera);
        x.drawImage(cv, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data;
        const set = new Set();
        for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
        return { tier: c.render.tier, errors: g.errors.slice(0, 3), glError: gl.getError(), bake: c.world.bakeMode, programs: (c.three.renderer.info.programs || []).length, worst, attrs, colours: set.size, ext: gl.getSupportedExtensions().length };
      });
      await page.screenshot({ path: join(OUT, `bare-${q.split('=')[1]}.png`) }).catch(() => {});
      add(name, 'renders without extensions', r.errors.length === 0 && errs.length === 0 && r.glError === 0 && r.colours > 12, `tier ${r.tier}, ${r.colours} colour buckets, GL error ${r.glError}, world bake '${r.bake}'${errs.length ? ' | ' + errs[0] : ''}${r.errors.length ? ' | ' + r.errors[0] : ''}`);
      add(name, 'shader limits', r.worst <= 224 && r.attrs <= 16, `${r.programs} programs, largest uses ${r.worst} uniform vectors (smallest device limit 224), ${r.attrs} attributes (limit 16)`);
    } catch (e) {
      add(name, 'run completed', false, String(e && e.message ? e.message : e).slice(0, 200) + (errs.length ? ' | ' + errs[0] : ''));
    }
    await context.close();
  }
}

await ensureBuilt({});
const pw = await loadPlaywright();
const srv = await startServer({ port: 0 });
const browser = await pw.chromium.launch({ headless: true, args: GL_ARGS });
const doc = hostDoc();
for (const d of DEVICES) {
  if (only && d !== only) continue;
  await runDevice(pw, browser, d, doc);
}
if (!only) {
  await runThrottled(pw, browser, srv.url);
  await runBare(pw, browser, srv.url);
}
await browser.close();
await srv.close();
const failed = rows.filter((r) => !r.ok);
writeFileSync(join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
console.log(`\nandroid-check: ${rows.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
