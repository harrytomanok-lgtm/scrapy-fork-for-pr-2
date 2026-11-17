/**
 * Foundation scenarios (ARCHITECTURE 8.0): the smoke list. Runs on stand-ins and on any set of final packages.
 * Every scenario ends with `__GAME__.errors` and the console errors empty, and the harness records any network
 * request other than the Google Fonts stylesheet and its font files as an error (checked by the runner).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDS } from '../../src/core/ids.js';
import { GAME_ROOT } from '../gen-registry.mjs';

/** IDS keys that are asset or key catalogs, not defs kinds (3.8). */
const NOT_DEFS = ['prop', 'clip', 'vfx', 'sfx', 'feel', 'modKey'];

/** Every member of `window.__GAME__` (section 6). */
const API_MEMBERS = [
  'version', 'flags', 'ready', 'isReady', 'errors', 'ctx',
  'step', 'render', 'screenshotReady', 'tick', 'simTime', 'pause', 'resume', 'setTimeScale',
  'heightAt', 'regionAt', 'teleport', 'goto', 'setHour', 'crater', 'landmarks', 'pois',
  'player', 'grantXp', 'setLevel', 'allocate', 'heal', 'god', 'setOra', 'setSurge', 'give', 'equip', 'shells',
  'unlockTech', 'setSlot', 'unlockForm', 'setForm', 'unlockAll',
  'spawn', 'startBoss', 'kill', 'killAll', 'actors', 'damage', 'ai', 'ambient',
  'press', 'hold', 'move', 'look', 'clearInput', 'use', 'lock', 'setCamera',
  'startQuest', 'completeStep', 'questState', 'setFlag', 'open', 'closeAll', 'top', 'setLang', 'setDevice', 'setTier',
  'save', 'load', 'state', 'exportCode', 'importCode',
  'stats', 'bench', 'events', 'cmd',
];

/**
 * The common opening: the test journey is running at the Sparkstead Ringstone with the tutorial=0 shortcut.
 * @param {any} game @param {any} assert
 */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  assert.equal(await game((g) => g.top()), 'hud', 'no menu is open in test mode');
  return p;
}

/**
 * In the page: every visible element of the HUD and touch layers lies inside the viewport, and the page has no
 * horizontal overflow. Returns the offenders.
 */
function layoutProblems() {
  const out = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const app = document.getElementById('app');
  if (app.scrollWidth > app.clientWidth + 1) out.push('app overflows horizontally: ' + app.scrollWidth + ' > ' + app.clientWidth);
  if (document.documentElement.scrollWidth > W + 1) out.push('document overflows horizontally');
  for (const el of app.querySelectorAll('*')) {
    if (el.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (el.closest('[style*="display: none"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (!(el.textContent || '').trim() && !String(el.className).match(/btn|bar|ring|pill|medal|knob/i)) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) {
      out.push(`${el.tagName}.${String(el.className).split(' ').join('.')} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
    }
  }
  return out;
}

/**
 * A fixed input script used twice by the determinism scenario: walk, take off, fly, fire bolts, fight.
 * Runs inside the page.
 * @param {any} g
 */
function scriptedRun(g) {
  g.move(0, 1);
  g.step(90);
  g.press('jump');
  g.step(12);
  g.press('jump');
  g.step(30);
  g.move(0.5, 1);
  g.step(60);
  g.move(0, 0);
  for (let i = 0; i < 4; i++) {
    g.press('bolt');
    g.step(15);
  }
  const id = g.spawn('tusk_boar', { dist: 6, aggro: true });
  for (let i = 0; i < 10; i++) {
    g.press('attack');
    g.step(10);
  }
  if (id) g.damage(id, 1);
  g.step(120);
  const s = JSON.stringify(g.state());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return { hash: h, tick: g.tick(), xp: g.player().xp };
}

/** In the page: a store snapshot without the values that legitimately move between save and load. */
function stripState(s) {
  const c = JSON.parse(JSON.stringify(s));
  for (const k of ['x', 'y', 'z', 'yaw', 'hp', 'ora', 'surge']) delete c.player[k];
  c.meta.playSeconds = 0;
  delete c.meta.savedAt;
  return c;
}

export const scenarios = [
  {
    name: 'foundation-boot',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const t0 = await game((g) => g.tick());
      await game((g) => g.step(120));
      assert.equal(await game((g) => g.tick()), t0 + 120, 'step(120) runs exactly 120 ticks');
      const st = await game((g) => ({ state: g.state(), q: g.questState('mq1'), q2: g.questState('mq2'), lvl: g.player().level, p: g.player() }));
      assert.equal(st.lvl, 1);
      assert.ok(st.state.quests.done.includes('mq1'), 'tutorial=0 shortcut: MQ1 done');
      assert.equal(st.q2, 'active', 'tutorial=0 shortcut: MQ2 active');
      assert.equal(st.state.player.awakened, true);
      assert.equal(st.state.player.canFly, true);
      assert.equal(st.p.xp, 0);
      const rs = await game((g) => g.pois('ringstone').find((r) => r.id === 'ringstone_sparkstead'));
      assert.ok(rs && Math.hypot(rs.x - st.p.x, rs.z - st.p.z) < 2, 'the journey starts at the Sparkstead Ringstone');
      const s = await game((g) => g.stats());
      for (const k of ['fps', 'frameMs', 'simMs', 'drawCalls', 'triangles', 'geometries', 'textures', 'programs', 'scale', 'particles', 'actors', 'projectiles', 'voices', 'audioNodes']) {
        assert.equal(typeof s[k], 'number', 'stats().' + k);
      }
      assert.equal(typeof s.tier, 'string');
      assert.ok(s.drawCalls <= 120, 'low-tier draw calls');
      await shot('foundation-boot');
    },
  },
  {
    name: 'foundation-walk-fly-bolts',
    async run({ game, assert, shot }) {
      const p0 = await opening(game, assert);
      await game((g) => {
        g.move(0, 1);
        g.step(120);
        g.move(0, 0);
        g.step(10);
      });
      const p1 = await game((g) => g.player());
      assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, 'walking moves the player');
      assert.equal(p1.mode, 'ground');
      await game((g) => {
        g.press('jump');
        g.step(12);
        g.press('jump');
        g.step(6);
        g.hold('jump', true);
        g.step(60);
        g.hold('jump', false);
      });
      const p2 = await game((g) => g.player());
      assert.equal(p2.mode, 'fly', 'a second jump in the air takes off');
      assert.ok(p2.y > p1.y + 1, 'flight climbs');
      await game((g) => {
        g.move(0, 1);
        g.step(60);
        g.move(0, 0);
      });
      const pf = await game((g) => g.player());
      assert.ok(Math.hypot(pf.x - p2.x, pf.z - p2.z) > 3, 'flight moves forward');
      // The camera follows: it stays behind the player at a sane distance.
      const camd = await game((g) => {
        const c = g.ctx.three.camera.position;
        const p = g.ctx.player.pos;
        return Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      });
      assert.ok(camd > 2 && camd < 20, 'camera follows the flying player (' + camd.toFixed(1) + ' m)');
      await shot('foundation-flight');
      const ora0 = pf.ora;
      const fired = await game((g) => {
        const before = g.events(['projectile:spawned']).length;
        for (let i = 0; i < 3; i++) {
          g.press('bolt');
          g.step(20);
        }
        return g.events(['projectile:spawned']).length - before;
      });
      const p3 = await game((g) => g.player());
      assert.ok(fired >= 1, 'bolts spawn projectiles');
      assert.ok(p3.ora < ora0 + 1, 'bolts cost Ora');
    },
  },
  {
    name: 'foundation-kill-xp-levelup',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const id = await game((g) => g.spawn('tusk_boar', { dist: 4, level: 1 }));
      assert.ok(id > 0, 'tusk_boar spawned');
      const row = await game((g, eid) => g.actors().find((a) => a.id === eid), id);
      assert.equal(row.defId, 'tusk_boar');
      assert.equal(row.kind, 'enemy');
      await game((g, eid) => {
        g.lock(eid);
        for (let i = 0; i < 24; i++) {
          g.press('attack');
          g.step(12);
        }
      }, id);
      let alive = await game((g, eid) => g.actors().some((a) => a.id === eid && a.hp > 0), id);
      const hits = await game((g, eid) => g.events(['combat:hit']).filter((e) => e.payload.targetId === eid).length, id);
      assert.ok(hits > 0, 'player attacks hit the boar');
      if (alive) {
        await game((g, eid) => {
          g.damage(eid, 1);
          g.step(5);
        }, id);
        alive = await game((g, eid) => g.actors().some((a) => a.id === eid && a.hp > 0), id);
      }
      assert.equal(alive, false, 'the boar dies');
      const died = await game((g, eid) => g.events(['actor:died']).filter((e) => e.payload.entId === eid).length, id);
      assert.equal(died, 1, 'actor:died once');
      const xp = await game((g) => g.player().xp);
      assert.ok(xp > 0, 'XP rises from the kill');
      await shot('foundation-kill');
      const r = await game((g) => {
        const lvl = g.player().level;
        const need = g.ctx.rpg.xpToNext() - g.player().xp;
        g.grantXp(need - 1);
        g.step(1);
        const before = g.player().level;
        g.grantXp(1);
        g.step(1);
        return { lvl, before, after: g.player().level, xpAfter: g.player().xp, ups: g.events(['rpg:levelUp']).length, top: g.top() };
      });
      assert.equal(r.before, r.lvl, 'one XP short does not level up');
      assert.equal(r.after, r.lvl + 1, 'the exact XP levels up');
      assert.equal(r.xpAfter, 0, 'the exact XP leaves no remainder');
      assert.ok(r.ups >= 1, 'rpg:levelUp emitted');
      assert.equal(r.top, 'hud', 'a level-up never opens a screen');
      // The body is removed after death.
      const gone = await game((g, eid) => {
        g.step(150);
        return !g.actors().some((a) => a.id === eid);
      }, id);
      assert.equal(gone, true, 'the body is removed');
    },
  },
  {
    name: 'foundation-save-load',
    async run({ game, assert }) {
      await opening(game, assert);
      const r = await game((g, stripSrc) => {
        const strip = (0, eval)('(' + stripSrc + ')');
        g.grantXp(25);
        g.give('sunfruit', 3);
        g.shells(40);
        g.step(30);
        const ok = g.save();
        const a = g.state();
        g.grantXp(10);
        g.shells(5);
        const loaded = g.load(1);
        const b = g.state();
        g.step(1);
        return { ok, loaded, a: strip(a), b: strip(b), memoryOnly: g.ctx.save.memoryOnly, top: g.top(), p: !!g.player() };
      }, stripState.toString());
      assert.equal(r.ok, true, 'save() writes');
      assert.equal(r.memoryOnly, true, 'test mode storage is memory-only');
      assert.equal(r.loaded, true, 'load(1) starts the saved journey');
      assert.ok(r.p, 'the player exists after load');
      assert.equal(r.top, 'hud');
      assert.deepEqual(r.b, r.a, 'saved and loaded state are equal');

      // Journey code round trip: export, import (into slot 1), load, deep equality.
      const j = await game(async (g, stripSrc) => {
        const strip = (0, eval)('(' + stripSrc + ')');
        g.give('ora_draught', 2);
        const before = strip(g.state());
        const code = await g.exportCode();
        g.grantXp(7);
        const imp = await g.importCode(code);
        const loaded = g.load(1);
        const after = strip(g.state());
        const bad = await g.importCode('K1.@@@');
        const cut = await g.importCode(code.slice(0, Math.max(4, code.length >> 1)));
        const junk = await g.importCode('hello');
        g.step(1);
        return { code, imp, loaded, before, after, bad, cut, junk };
      }, stripState.toString());
      assert.match(j.code, /^K[01]\./);
      assert.deepEqual(j.imp, { ok: true, reasonKey: null });
      assert.equal(j.loaded, true);
      assert.deepEqual(j.after, j.before, 'journey code round trip keeps the state');
      for (const k of ['bad', 'cut', 'junk']) {
        assert.equal(j[k].ok, false, 'a damaged code is rejected (' + k + ')');
        assert.equal(typeof j[k].reasonKey, 'string');
      }
    },
  },
  {
    name: 'foundation-lang-pause',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.setLang('he');
        g.render();
        const root = document.getElementById('app');
        return { dir: root.getAttribute('dir'), lang: root.getAttribute('lang'), events: g.events(['lang:changed']).length };
      });
      assert.equal(r.dir, 'rtl');
      assert.equal(r.lang, 'he');
      assert.ok(r.events >= 1, 'lang:changed emitted');
      const p = await game((g) => {
        g.open('pause');
        g.render();
        const top = g.top();
        const paused = g.ctx.time.paused;
        const t = g.tick();
        g.ctx.loop.stepSim(5);
        const frozen = g.tick() === t;
        return { top, paused, frozen };
      });
      assert.equal(p.top, 'pause');
      assert.equal(p.paused, true, 'a menu pauses the sim');
      assert.equal(p.frozen, true, 'no sim ticks run while the menu is open');
      const probs = await game(layoutProblems);
      assert.deepEqual(probs, [], 'the Hebrew pause menu fits at 640x360');
      await shot('foundation-pause-he');
      const q = await game((g) => {
        g.closeAll();
        g.render();
        return { after: g.top(), pausedAfter: g.ctx.time.paused };
      });
      assert.equal(q.after, 'hud');
      assert.equal(q.pausedAfter, false);
      await game((g) => g.step(10));
      await shot('foundation-he');
      const back = await game((g) => {
        g.setLang('en');
        return document.getElementById('app').getAttribute('dir');
      });
      assert.equal(back, 'ltr');
    },
  },
  {
    name: 'foundation-landscape',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => g.step(30));
      assert.deepEqual(await game(layoutProblems), [], 'the HUD fits at 640x360 (en)');
      await shot('foundation-landscape');
      // The island seen from the air over the coast: land, water and sky.
      await game((g) => {
        g.goto('tide_beacon', { alt: 70 });
        // Turn back toward the island centre so land, shore and sea share the frame.
        const p = g.player();
        const yaw = Math.atan2(-p.x, -p.z);
        g.teleport(p.x, p.z, { alt: 70, yaw });
        g.setCamera({ yaw, pitch: -0.3 });
        g.step(30);
      });
      const fly = await game((g) => g.player());
      assert.equal(fly.mode, 'fly', 'goto with alt flies');
      await shot('foundation-coast');
      await game((g) => {
        g.setLang('he');
        g.step(2);
      });
      assert.deepEqual(await game(layoutProblems), [], 'the HUD fits at 640x360 (he)');
    },
  },
  {
    name: 'foundation-portrait',
    width: 400,
    height: 800,
    query: 'lang=he',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => g.step(30));
      assert.equal(await game(() => document.getElementById('app').getAttribute('dir')), 'rtl');
      assert.deepEqual(await game(layoutProblems), [], 'the HUD fits at 400x800 (he)');
      await shot('foundation-portrait');
      await game((g) => {
        g.setLang('en');
        g.step(2);
      });
      assert.deepEqual(await game(layoutProblems), [], 'the HUD fits at 400x800 (en)');
    },
  },
  {
    name: 'foundation-touch',
    width: 400,
    height: 800,
    touch: true,
    // Real device sources are ignored in test mode unless the sim runs in real time (4.8).
    query: 'autoplay=1',
    async run({ page, game, assert, shot }) {
      await opening(game, assert);
      await game((g) => {
        g.setDevice('touch');
        g.render();
      });
      const ui = await game(() => {
        const root = document.querySelector('.sti-root');
        const r = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
        };
        return {
          shown: !!root && getComputedStyle(root).display !== 'none',
          move: r('[data-action="move"]'), attack: r('[data-action="attack"]'), bolt: r('[data-action="bolt"]'),
          jump: r('[data-action="jump"]'), dash: r('[data-action="dash"]'),
          W: innerWidth, H: innerHeight,
        };
      });
      assert.equal(ui.shown, true, 'touch controls are visible on the touch device');
      for (const k of ['move', 'attack', 'bolt', 'jump', 'dash']) {
        assert.ok(ui[k] && ui[k].w > 20, 'touch control ' + k);
        assert.ok(ui[k].x > 0 && ui[k].x < ui.W && ui[k].y > 0 && ui[k].y < ui.H, 'touch control ' + k + ' is on screen');
      }
      assert.deepEqual(await game(layoutProblems), [], 'touch layout fits at 400x800');
      // Drive the floating stick with synthetic pointer events: press in the move zone and drag up (forward).
      const sx = Math.min(ui.move.x, 90);
      const sy = ui.H - 160;
      const moved = await game((g, pt) => {
        const zone = document.querySelector('[data-action="move"]');
        const ev = (type, x, y) => zone.dispatchEvent(new PointerEvent(type, {
          pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
        }));
        g.pause();
        const p0 = g.player();
        ev('pointerdown', pt.x, pt.y);
        ev('pointermove', pt.x, pt.y - 30);
        ev('pointermove', pt.x, pt.y - 60);
        const axis = g.ctx.input.axis('moveY');
        g.ctx.loop.stepSim(1);
        const axisTick = g.ctx.input.axis('moveY');
        g.ctx.loop.stepSim(89);
        const p1 = g.player();
        ev('pointerup', pt.x, pt.y - 60);
        g.ctx.loop.stepSim(20);
        return { d: Math.hypot(p1.x - p0.x, p1.z - p0.z), device: g.ctx.input.device, axis, axisTick };
      }, { x: sx, y: sy });
      assert.ok(moved.axisTick > 0.5, 'the stick pushes forward (moveY ' + moved.axisTick + ')');
      assert.ok(moved.d > 2, 'the touch stick walks the player (' + moved.d.toFixed(2) + ' m)');
      assert.equal(moved.device, 'touch');
      const id = await game((g) => g.spawn('tusk_boar', { dist: 3, passive: true }));
      // Tap the Attack button.
      const tapped = await game((g, eid) => {
        const btn = document.querySelector('[data-action="attack"]');
        const b = btn.getBoundingClientRect();
        const ev = (type) => btn.dispatchEvent(new PointerEvent(type, {
          pointerId: 9, pointerType: 'touch', isPrimary: false, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true,
        }));
        g.lock(eid);
        const before = g.events(['combat:techStart']).length;
        ev('pointerdown');
        const down = btn.classList.contains('sti-down');
        g.ctx.loop.stepSim(3);
        ev('pointerup');
        g.ctx.loop.stepSim(30);
        g.render();
        return { started: g.events(['combat:techStart']).length - before, down };
      }, id);
      assert.equal(tapped.down, true, 'the button shows its pressed state');
      assert.ok(tapped.started >= 1, 'tapping Attack starts a technique');
      await game((g) => {
        g.ctx.loop.stepSim(20);
        g.resume();
      });
      await shot('foundation-touch-portrait');
      await page.setViewportSize({ width: 640, height: 360 });
      await game((g) => {
        g.setLang('he');
        g.render();
      });
      assert.deepEqual(await game(layoutProblems), [], 'touch layout fits at 640x360 (he)');
      await shot('foundation-touch-landscape');
    },
  },
  {
    name: 'foundation-api',
    async run({ game, assert }) {
      await opening(game, assert);
      const missing = await game((g, names) => names.filter((n) => !(n in g)), API_MEMBERS);
      assert.deepEqual(missing, [], 'every member of section 6 exists');
      const r = await game(async (g) => {
        const out = {};
        out.version = typeof g.version === 'string' && g.version.length > 0;
        out.flags = g.flags.test === true;
        out.ready = g.isReady() && typeof g.ready.then === 'function';
        out.errorsArray = Array.isArray(g.errors);
        await g.ready;
        const t = g.tick();
        g.step();
        out.step1 = g.tick() === t + 1;
        g.render();
        await g.screenshotReady();
        out.simTime = g.simTime() > 0;
        g.pause();
        const t2 = g.tick();
        g.step(3);
        out.debugPauseSteps = g.tick() === t2 + 3;
        g.resume();
        g.setTimeScale(0.5);
        const s0 = g.simTime();
        g.step(60);
        out.timeScale = Math.abs(g.simTime() - s0 - 0.5) < 0.02;
        g.setTimeScale(1);

        // world and environment
        const p = g.player();
        out.heightAt = Number.isFinite(g.heightAt(p.x, p.z)) && Math.abs(g.heightAt(p.x, p.z) - p.y) < 2;
        out.regionAt = g.regionAt(p.x, p.z) === 'meadows';
        g.teleport(p.x + 30, p.z + 30, { alt: 40 });
        const pt = g.player();
        out.teleport = Math.abs(pt.x - p.x - 30) < 0.01 && pt.mode === 'fly' && Math.abs(pt.y - g.heightAt(pt.x, pt.z) - 40) < 0.5;
        const lms = g.landmarks();
        out.landmarks = lms.length >= 23 && lms.every((l) => Number.isFinite(l.y));
        g.goto('haven_aster');
        const ha = lms.find((l) => l.id === 'haven_aster');
        const pg = g.player();
        out.goto = Math.hypot(pg.x - ha.x, pg.z - ha.z) < 1;
        g.goto('sparkstead');
        g.setHour(18);
        out.setHour = Math.abs(g.state().world.hour - 18) < 0.01;
        const q = g.player();
        const h0 = g.heightAt(q.x + 20, q.z);
        g.crater(q.x + 20, q.z, 6, 2);
        out.crater = g.heightAt(q.x + 20, q.z) < h0 - 0.5;
        out.pois = g.pois().length > 0 && g.pois('ringstone').length > 0;

        // player
        const keys = ['id', 'x', 'y', 'z', 'yaw', 'hp', 'hpMax', 'ora', 'oraMax', 'surge', 'level', 'xp', 'resonance', 'formId', 'mode', 'state', 'targetId', 'shells'];
        const pp = g.player();
        out.playerKeys = keys.filter((k) => !(k in pp));
        g.setLevel(5);
        out.setLevel = g.player().level === 5;
        const xp0 = g.player().xp;
        g.grantXp(3);
        out.grantXp = g.player().xp === xp0 + 3;
        const sp = g.state().player.statPoints;
        const mgt = g.state().player.base.mgt;
        const okAlloc = g.allocate('mgt', 1);
        out.allocate = sp > 0 ? okAlloc === true && g.state().player.base.mgt === mgt + 1 : okAlloc === false;
        out.allocateRejects = g.allocate('nonsense', 1) === false;
        g.damage(g.player().id, 0.5);
        g.heal();
        out.heal = g.player().hp === g.player().hpMax;
        g.god(true);
        g.damage(g.player().id, 0.9, { kind: 'melee', sourceId: 0 });
        out.god = g.player().hp === g.player().hpMax;
        g.god(false);
        g.setOra(10);
        out.setOra = Math.abs(g.player().ora - 10) < 0.5;
        g.setSurge(50);
        out.setSurge = Math.abs(g.player().surge - 50) < 0.5;
        const uid = g.give('copper_knuckles', 1);
        out.give = !!uid;
        out.equip = !!g.equip('copper_knuckles');
        const sh = g.player().shells;
        g.shells(25);
        out.shells = g.player().shells === sh + 25;
        g.unlockTech('nova_ring');
        out.unlockTech = g.state().player.techs.indexOf('nova_ring') >= 0;
        g.setSlot(0, 'nova_ring');
        out.setSlot = g.state().player.slots[0] === 'nova_ring';
        g.unlockForm('ember');
        g.setForm('ember');
        out.setForm = g.player().formId === 'ember';
        g.setForm(null);
        out.unsetForm = g.player().formId === null;
        g.unlockAll();
        out.unlockAll = g.state().player.forms.length >= 3;
        g.setOra(g.player().oraMax);

        // actors
        const e1 = g.spawn('tusk_boar', { dist: 6, level: 3 });
        const e2 = g.spawn('ember_wisp', { dist: 9, alt: 3, passive: true });
        const rows = g.actors();
        out.spawn = e1 > 0 && e2 > 0 && rows.some((a) => a.id === e1 && a.level === 3);
        g.lock(e1);
        out.lock = g.player().targetId === e1;
        out.use = g.use('ora_bolt', { targetId: e1 }) === true;
        g.step(30);
        const dr = g.damage(e1, 5);
        out.damage = !!dr && typeof dr === 'object';
        g.kill(e1);
        g.step(1);
        out.kill = !g.actors().some((a) => a.id === e1 && a.hp > 0);
        g.killAll();
        g.step(1);
        out.killAll = !g.actors().some((a) => (a.kind === 'enemy' || a.kind === 'boss') && a.hp > 0);
        g.ai(false);
        g.ai(true);
        g.ambient(false);
        g.heal();
        const b = g.startBoss('bramblehorn');
        g.step(2);
        out.startBoss = b > 0 && g.events(['boss:start']).length >= 1;
        g.damage(b, 0.6);
        g.step(2);
        out.bossPhase = g.events(['boss:phase']).length >= 1;
        g.kill(b);
        g.step(2);
        out.bossEnd = g.events(['boss:end']).some((e) => e.payload.defeated === true);
        g.step(120);

        // input
        g.clearInput();
        g.lock(0);
        out.unlock = g.player().targetId !== e1;
        const yaw0 = g.ctx.cam.yaw;
        g.look(30, 0);
        g.step(1);
        out.look = Math.abs(g.ctx.cam.yaw - yaw0) > 0.1;
        g.setCamera({ yaw: 1, pitch: -0.3, dist: 8 });
        out.setCamera = Math.abs(g.ctx.cam.yaw - 1) < 1e-6;
        g.hold('guard', true);
        g.step(4);
        out.hold = g.ctx.input.down('guard');
        g.hold('guard', false);
        g.step(2);
        g.press('jump');
        g.step(1);
        out.press = g.events(['move:jump']).length >= 1;
        g.move(1, 0);
        g.step(1);
        out.move = g.ctx.input.axis('moveX') > 0.5;
        g.clearInput();
        g.step(1);
        out.clearInput = g.ctx.input.axis('moveX') === 0;
        g.step(60);

        // quests, ui, save
        out.questState = g.questState('mq2') === 'active' && g.questState('mq1') === 'done' && ['locked', 'available'].indexOf(g.questState('sq1')) >= 0;
        g.startQuest('sq1');
        out.startQuest = g.questState('sq1') === 'active';
        g.completeStep('sq1');
        g.step(2);
        out.completeStep = g.questState('sq1') !== 'active' || g.state().quests.active.sq1.step > 0;
        g.setFlag('fdn_test', 3);
        out.setFlag = g.state().quests.flags.fdn_test === 3;
        g.open('pause');
        out.open = g.top() === 'pause';
        g.closeAll();
        out.closeAll = g.top() === 'hud';
        g.setDevice('pad');
        out.setDevice = g.ctx.input.device === 'pad';
        g.setDevice('kbm');
        g.setTier('low');
        out.setTier = g.stats().tier === 'low';
        out.save = g.save() === true;
        out.load = g.load(1) === true;
        out.state = typeof g.state().meta === 'object';
        out.exportCode = /^K[01]\./.test(await g.exportCode());
        out.importCode = (await g.importCode('nope')).ok === false;
        out.events = g.events().length > 0 && g.events(['game:loaded']).every((e) => e.type === 'game:loaded');
        out.cmd = typeof g.cmd === 'object';
        return out;
      });
      const failed = Object.keys(r).filter((k) => (Array.isArray(r[k]) ? r[k].length > 0 : r[k] !== true));
      assert.deepEqual(failed, [], 'section 6 members work against the stand-ins: ' + JSON.stringify(r));
    },
  },
  {
    name: 'foundation-defs',
    async run({ game, assert }) {
      await opening(game, assert);
      const kinds = Object.keys(IDS).filter((k) => NOT_DEFS.indexOf(k) < 0);
      const r = await game((g, ids, ks) => {
        const missing = [];
        for (const k of ks) for (const id of ids[k]) if (!g.ctx.defs.has(k, id)) missing.push(k + ':' + id);
        const v = g.ctx.defs.validate();
        return { missing, ok: v.ok, errors: v.errors };
      }, IDS, kinds);
      assert.deepEqual(r.missing, [], 'every id of IDS has a definition');
      assert.deepEqual(r.errors, [], 'defs.validate() passes');
      assert.equal(r.ok, true);
    },
  },
  {
    name: 'foundation-determinism',
    async run({ game, assert, harness }) {
      const a = await game(scriptedRun);
      await harness.reload();
      const b = await game(scriptedRun);
      assert.equal(a.tick, b.tick);
      assert.ok(a.xp > 0, 'the scripted fight gives XP');
      assert.equal(a.hash, b.hash, 'identical inputs give an identical state() hash');
    },
  },
  {
    name: 'foundation-bench',
    async run({ game, assert }) {
      const r = await game((g) => g.bench({ durationScale: 0.03, panel: true }));
      assert.equal(r.mode, 'stepped');
      assert.equal(r.aborted, false);
      assert.deepEqual(r.segments.map((s) => s.name), ['flight', 'fight', 'settlement']);
      for (const s of r.segments) assert.ok(s.frames > 0, s.name + ' recorded frames');
      assert.equal(typeof r.text, 'string');
      assert.ok(r.peaks.drawCalls <= 120, 'draw calls within the low budget');
    },
  },
  {
    // The published artifact runs inside a sandboxed iframe (no allow-same-origin, so storage throws): the inline
    // fragment as srcdoc (how an artifact host serves it) and dist/index.html from the server.
    name: 'foundation-iframe',
    async run({ page, assert }) {
      const inline = readFileSync(join(GAME_ROOT, 'dist', 'artifact-inline.html'), 'utf8');
      const doc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
        + inline + '</body></html>';
      const origin = new URL(page.url()).origin;
      const cases = [
        { name: 'artifact-inline', srcdoc: doc, shot: 'foundation-iframe-title' },
        { name: 'index', src: origin + '/index.html?quality=low&res=0.5&noaudio=1&lang=en', shot: null },
      ];
      for (const c of cases) {
        const host = await page.context().newPage();
        const requests = [];
        const dialogs = [];
        const consoleErrors = [];
        host.on('request', (rq) => requests.push(rq.url()));
        host.on('dialog', (d) => {
          dialogs.push(d.type());
          d.dismiss().catch(() => {});
        });
        host.on('console', (m) => {
          if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|ERR_FAILED/.test(m.text() + JSON.stringify(m.location()))) consoleErrors.push(m.text());
        });
        host.on('pageerror', (e) => consoleErrors.push(String(e && e.message)));
        // Only the game's own files load; the fonts requests are recorded and refused (fallback stacks).
        await host.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
        await host.setViewportSize({ width: 640, height: 360 });
        await host.setContent('<!doctype html><html><head><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head>'
          + '<body><iframe id="f" sandbox="allow-scripts"></iframe></body></html>');
        await host.evaluate((cc) => {
          const f = document.getElementById('f');
          if (cc.srcdoc) f.srcdoc = cc.srcdoc;
          else f.src = cc.src;
        }, c);
        let frame = null;
        for (let i = 0; i < 100 && !frame; i++) {
          frame = host.frames().find((f) => f !== host.mainFrame() && f.url() !== 'about:blank') || null;
          if (!frame) await host.waitForTimeout(100);
        }
        assert.ok(frame, c.name + ': the iframe exists');
        await frame.waitForFunction(() => {
          const g = window.__GAME__;
          return !!g && (g.isReady() || g.errors.length > 0);
        }, null, { timeout: 180000, polling: 250 });
        const r = await frame.evaluate(() => {
          const g = window.__GAME__;
          const app = document.getElementById('app');
          let storageThrows = false;
          try {
            void window.localStorage.length;
          } catch (e) {
            storageThrows = true;
          }
          return {
            ready: g.isReady(), errors: g.errors.slice(), top: g.top(), memoryOnly: g.ctx.save.memoryOnly, storageThrows,
            appH: app.getBoundingClientRect().height, winH: innerHeight, canvasH: (app.querySelector('canvas') || { clientHeight: 0 }).clientHeight,
            test: !!g.flags.test, dir: app.getAttribute('dir'), saved: g.save(),
          };
        });
        if (c.shot) {
          await host.waitForTimeout(500);
          await host.screenshot({ path: join(GAME_ROOT, 'tools', 'out', 'shots', c.shot + '.png') });
        }
        await host.close();
        const tag = c.name + ': ';
        assert.deepEqual(r.errors, [], tag + 'no errors inside the sandboxed iframe');
        assert.deepEqual(consoleErrors, [], tag + 'no console errors');
        assert.equal(r.ready, true);
        assert.equal(r.test, false, tag + 'normal mode');
        assert.equal(r.top, 'title', tag + 'normal mode opens the title screen');
        assert.equal(r.storageThrows, true, tag + 'the sandbox blocks localStorage');
        assert.equal(r.memoryOnly, true, tag + 'storage failure falls back to memory');
        assert.equal(r.dir, c.srcdoc ? 'rtl' : 'ltr', tag + 'language from the flag, Hebrew by default');
        assert.ok(Math.abs(r.appH - r.winH) < 2 && r.appH > 300, tag + 'the page sizes with height:100% (' + r.appH + ' of ' + r.winH + ')');
        assert.ok(r.canvasH > 300, tag + 'the canvas fills the frame');
        assert.deepEqual(dialogs, [], tag + 'no alert, confirm or prompt');
        const bad = requests.filter((u) => !u.startsWith(origin) && !/^(data:|blob:|about:)/.test(u) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
        assert.deepEqual(bad, [], tag + 'no network request except Google Fonts');
        assert.ok(requests.some((u) => u.startsWith('https://fonts.googleapis.com/css2')), tag + 'the fonts stylesheet is requested');
      }
    },
  },
];
