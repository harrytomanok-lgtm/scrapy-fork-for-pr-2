/**
 * Foundation scenarios (ARCHITECTURE 8.0): the smoke list. Runs on stand-ins and on any set of final packages.
 * Every scenario ends with `__GAME__.errors` empty (checked by the runner).
 */

/** Ticks of one second. */
const SEC = 60;

/**
 * The common opening: the test journey is running at the Sparkstead Ringstone with the tutorial=0 shortcut.
 * @param {any} game
 */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  assert.equal(await game((g) => g.top()), 'hud', 'no menu is open in test mode');
  return p;
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
  const id = g.spawn('tusk_boar', { dist: 6 });
  for (let i = 0; i < 10; i++) {
    g.press('attack');
    g.step(10);
  }
  if (id) g.damage(id, 1);
  g.step(120);
  const s = JSON.stringify(g.state());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return { hash: h, tick: g.tick() };
}

export const scenarios = [
  {
    name: 'foundation-boot',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const t0 = await game((g) => g.tick());
      await game((g) => g.step(120));
      assert.equal(await game((g) => g.tick()), t0 + 120, 'step(120) runs exactly 120 ticks');
      const st = await game((g) => ({ state: g.state(), q: g.questState('mq1'), lvl: g.player().level }));
      assert.equal(st.lvl, 1);
      assert.ok(st.state.quests.done.includes('mq1'), 'tutorial=0 shortcut: MQ1 done');
      assert.equal(st.state.player.awakened, true);
      assert.equal(st.state.player.canFly, true);
      const s = await game((g) => g.stats());
      for (const k of ['fps', 'frameMs', 'simMs', 'drawCalls', 'triangles', 'programs', 'actors', 'projectiles']) {
        assert.equal(typeof s[k], 'number', 'stats().' + k);
      }
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
      await shot('foundation-flight');
      const ora0 = p2.ora;
      const fired = await game((g) => {
        const before = g.events(['projectile:spawned']).length;
        for (let i = 0; i < 3; i++) {
          g.press('bolt');
          g.step(20);
        }
        return g.events(['projectile:spawned']).length - before;
      });
      const p3 = await game((g) => g.player());
      assert.ok(fired > 0 || p3.ora < ora0, 'bolts fire (projectiles spawned or Ora spent)');
    },
  },
  {
    name: 'foundation-kill-xp-levelup',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const id = await game((g) => g.spawn('tusk_boar', { dist: 5, level: 1 }));
      assert.ok(id > 0, 'tusk_boar spawned');
      await game((g, eid) => {
        g.lock(eid);
        for (let i = 0; i < 20; i++) {
          g.press('attack');
          g.step(12);
        }
      }, id);
      let alive = await game((g, eid) => g.actors().some((a) => a.id === eid && a.hp > 0), id);
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
        return { lvl, before, after: g.player().level, ups: g.events(['rpg:levelUp']).length, top: g.top() };
      });
      assert.equal(r.before, r.lvl, 'one XP short does not level up');
      assert.equal(r.after, r.lvl + 1, 'the exact XP levels up');
      assert.ok(r.ups >= 1, 'rpg:levelUp emitted');
      assert.equal(r.top, 'hud', 'a level-up never opens a screen');
    },
  },
  {
    name: 'foundation-save-load',
    async run({ game, assert }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.grantXp(25);
        g.give('sunfruit', 3);
        g.shells(40);
        g.step(30);
        const ok = g.save();
        const a = g.state();
        g.grantXp(10);
        const loaded = g.load(1);
        g.step(1);
        const b = g.state();
        const strip = (s) => {
          const c = JSON.parse(JSON.stringify(s));
          for (const k of ['x', 'y', 'z', 'yaw', 'hp', 'ora', 'surge']) delete c.player[k];
          c.meta.playSeconds = 0;
          return c;
        };
        return { ok, loaded, a: strip(a), b: strip(b), memoryOnly: g.ctx.save.memoryOnly };
      });
      assert.equal(r.ok, true, 'save() writes');
      assert.equal(r.memoryOnly, true, 'test mode storage is memory-only');
      assert.equal(r.loaded, true, 'load(1) starts the saved journey');
      assert.deepEqual(r.b, r.a, 'saved and loaded state are equal');
      const code = await game((g) => g.exportCode());
      assert.match(code, /^K[01]\./);
      const imp = await game((g, c) => g.importCode(c), code);
      assert.deepEqual(imp, { ok: true, reasonKey: null });
      const bad = await game((g) => g.importCode('K1.@@@'));
      assert.equal(bad.ok, false, 'a damaged code is rejected');
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
        g.closeAll();
        g.render();
        return { top, paused, after: g.top(), pausedAfter: g.ctx.time.paused };
      });
      assert.equal(p.top, 'pause');
      assert.equal(p.paused, true, 'a menu pauses the sim');
      assert.equal(p.after, 'hud');
      assert.equal(p.pausedAfter, false);
      await game((g) => g.step(10));
      await shot('foundation-he');
    },
  },
  {
    name: 'foundation-landscape',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => g.step(30));
      await shot('foundation-landscape');
    },
  },
  {
    name: 'foundation-portrait',
    width: 400,
    height: 800,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => g.step(30));
      const over = await game(() => document.getElementById('app').scrollWidth > document.getElementById('app').clientWidth);
      assert.equal(over, false, 'no horizontal overflow in portrait');
      await shot('foundation-portrait');
    },
  },
  {
    name: 'foundation-determinism',
    async run({ game, assert, harness }) {
      const a = await game(scriptedRun);
      await harness.reload();
      const b = await game(scriptedRun);
      assert.equal(a.tick, b.tick);
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
];
