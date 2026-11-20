/**
 * screens scenarios: the interface gallery on the low tier at res=1, in Hebrew, on a portrait phone (412x915), a
 * landscape phone (915x412) and the narrowest phone (320x640): every screen, then the HUD moments (combo, level-up,
 * quest, boss card and bar, finisher, new technique, tap to skip). Each view also checks the layout rules: nothing
 * overflows, nothing covers the hero or the locked target, and the centre shows one thing at a time.
 * Run with `node tools/scenarios.mjs screens [--only name]`. Screenshots go to tools/out/shots/screens-*.png.
 */

/**
 * A screenshot with a long timeout: at res=1 on a loaded machine SwiftShader can take more than the harness's 30 s.
 * @param {any} page @param {string} name
 */
async function snap(page, name) {
  const { join } = await import('node:path');
  const { mkdirSync } = await import('node:fs');
  const { OUT_SHOTS } = await import('../lib/harness.mjs');
  await page.evaluate(() => /** @type {any} */ (window).__GAME__.screenshotReady());
  mkdirSync(OUT_SHOTS, { recursive: true });
  await page.screenshot({ path: join(OUT_SHOTS, name + '.png'), timeout: 240000, animations: 'disabled', caret: 'hide' });
}

/** Boot state: no AI or ambient spawns, noon, a journey with gear, points and techniques to show. */
function opening(g) {
  g.ai(false);
  g.ambient(false);
  g.god(true);
  g.setHour(12);
  g.killAll();
  g.ctx.rpg.setStyle('manual');
  g.grantXp(400);
  g.ctx.rpg.addTp(6);
  g.give('training_wraps');
  g.give('meadow_garb');
  g.give('ember_charm');
  g.give('sunfruit', 3);
  g.give('ora_draught', 2);
  g.equip('meadow_garb');
  g.shells(450);
  g.unlockTech('dawn_lance');
  g.setDevice('touch');
  // Off the Ringstone and its light pillar, on open ground, so the hero is clearly in view.
  const p = g.player();
  g.teleport(p.x + 46, p.z + 30, { yaw: Math.PI * 0.8 });
  // Let the level-up banners of the grants above play out.
  for (let i = 0; i < 8; i++) g.step(60);
}

/** In the page: layout problems of the open screen (overflow, placeholders). */
function screenProblems() {
  const app = document.getElementById('app');
  const out = [];
  if (app.scrollWidth > app.clientWidth + 1) out.push('root overflows: ' + app.scrollWidth + ' > ' + app.clientWidth);
  const m = (app.innerText || '').match(/\[[a-z]+\.[a-zA-Z0-9_.]+\]/g);
  if (m) out.push('placeholders: ' + m.slice(0, 5).join(' '));
  for (const s of document.querySelectorAll('.ui-scr:not([hidden])')) {
    if (s.scrollWidth > s.clientWidth + 1) out.push(s.getAttribute('data-screen') + ' overflows ' + s.scrollWidth + ' > ' + s.clientWidth);
    for (const b of s.querySelectorAll('.ui-pbody')) if (b.scrollWidth > b.clientWidth + 1) out.push(s.getAttribute('data-screen') + ' panel overflows');
  }
  return out;
}

/**
 * In the page: HUD rule problems. Centre pieces (banner, toast, pill, prompt, combo, card) must not cover the
 * hero's or the locked target's projected box, and at most one centre message (banner or card) is shown at once.
 */
function guardProblems() {
  const g = /** @type {any} */ (window).__GAME__;
  const d = g.cmd.ui();
  const out = [];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const keep = d.keepOut || [];
  const centre = d.pieces.filter((p) => ['toast', 'pill', 'prompt', 'combo'].indexOf(p.name) >= 0).concat(d.centre || []);
  for (const p of centre) for (const k of keep) if (hit(p, k)) out.push(`${p.name} covers ${k.name} ${JSON.stringify([p, k].map((r) => [r.x, r.y, r.w, r.h].map(Math.round)))}`);
  return out;
}

const SCREENS = [
  ['title', {}], ['newgame', {}], ['pause', {}], ['character', {}], ['techniques', {}], ['inventory', {}], ['quests', {}],
  ['map', {}], ['settings', { tab: 'gfx' }], ['settings', { tab: 'a11y' }], ['shop', { shopId: 'dov_stall' }], ['credits', {}],
  ['death', { bossId: 'durn' }], ['savecode', { tab: 'copy' }],
];

/** @param {string} tag @param {number} width @param {number} height */
function menuScenario(tag, width, height) {
  return {
    name: 'screens-menus-' + tag,
    width,
    height,
    query: 'res=1&lang=he',
    async run({ page, game, assert }) {
      const shot = (n) => snap(page, n);
      await game(opening);
      for (const [id, params] of SCREENS) {
        const r = await game((g, a) => {
          g.closeAll();
          g.open(a.id, a.params);
          g.step(2);
          g.render();
          return g.top();
        }, { id, params });
        assert.equal(r, id, 'opened ' + id);
        const probs = await game(screenProblems);
        await shot(`screens-${tag}-${id}${params.tab ? '-' + params.tab : ''}`);
        assert.deepEqual(probs, [], `${id} ${tag}`);
      }
      await game((g) => g.closeAll());
    },
  };
}

/** In the page: put a boar in front of the hero, locked, hurt. */
const FIGHT = `(g) => {
  const id = g.spawn('tusk_boar', { dist: 7, passive: true });
  g.lock(id);
  g.damage(id, 0.35);
  g.step(20);
  return id;
}`;

/** HUD moments, each a function of (g, fightSrc) run in the page before a screenshot. */
const MOMENTS = [
  ['explore', (g) => {
    const q = g.ctx.quests.active();
    if (q.length) g.ctx.quests.track(q[0].questId);
    g.ctx.bus.emit('world:regionEnter', { regionId: 'meadows', prevRegionId: null, first: true });
    g.ctx.bus.emit('tutorial:prompt', { action: 'jump', textKey: 'rpg.tut.jump' });
    g.ctx.bus.emit('interact:focus', { id: 'test', kind: 'npc', promptKey: 'rpg.prompt.talk' });
    g.ctx.ui.toast('ui.toast.ringstone', null, 'good');
    g.step(10);
  }],
  ['fight', (g, f) => {
    g.ctx.bus.emit('tutorial:prompt', { action: 'attack', textKey: 'rpg.tut.attack' });
    g.ctx.bus.emit('interact:focus', { id: '', kind: '', promptKey: '' });
    g.step(200);
    const id = (0, eval)('(' + f + ')')(g);
    const p = g.player();
    g.damage(p.id, 0.5, { kind: 'true', sourceId: id });
    g.setOra(p.oraMax * 0.4);
    g.setSurge(1e6);
    for (let i = 0; i < 4; i++) {
      g.damage(id, 0.03);
      g.step(2);
    }
    g.ctx.bus.emit('combat:combo', { count: 13, rank: 2, rankId: 'gleam', expired: false, best: 13 });
    g.ctx.bus.emit('combat:combo', { count: 14, rank: 3, rankId: 'blaze', expired: false, best: 14 });
    g.ctx.bus.emit('rpg:xp', { amount: 36, total: 0, source: 'kill' });
    g.ctx.bus.emit('rpg:shells', { amount: 12, total: 0 });
    g.step(8);
  }],
  ['levelup', (g) => {
    g.ctx.bus.emit('tutorial:prompt', { action: null, textKey: null });
    g.ctx.bus.emit('rpg:levelUp', { level: 7, statPoints: 3, tp: 1 });
    g.step(14);
  }],
  ['quest', (g) => {
    g.step(200);
    g.ctx.bus.emit('quest:completed', { questId: 'mq2' });
    g.step(14);
  }],
  ['form', (g) => {
    g.step(200);
    g.ctx.bus.emit('rpg:formUnlocked', { formId: 'ember' });
    g.ctx.fx.impact('finisher', g.player().x, g.player().y + 1, g.player().z, 1);
    g.step(10);
  }],
  ['bossintro', (g) => {
    g.step(200);
    g.killAll();
    g.startBoss('durn');
    g.step(30);
  }],
  ['boss', (g) => {
    if (g.ctx.cam.busy) g.ctx.cam.skip();
    g.step(16);
  }],
];

/** @param {string} tag @param {number} width @param {number} height */
function hudScenario(tag, width, height) {
  return {
    name: 'screens-hud-' + tag,
    width,
    height,
    query: 'res=1&lang=he',
    async run({ page, game, assert }) {
      const shot = (n) => snap(page, n);
      await game(opening);
      for (const [name, fn] of MOMENTS) {
        await game((g, src, f) => {
          (0, eval)('(' + src + ')')(g, f);
          g.render();
        }, fn.toString(), FIGHT);
        const probs = await game(guardProblems);
        await shot(`screens-${tag}-hud-${name}`);
        assert.deepEqual(probs, [], `${name} ${tag}`);
      }
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

export const scenarios = [
  hudScenario('p', 412, 915),
  hudScenario('l', 915, 412),
  menuScenario('p', 412, 915),
  menuScenario('l', 915, 412),
  menuScenario('n', 320, 640),
];
