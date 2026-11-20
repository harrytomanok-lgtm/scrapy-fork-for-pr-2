/**
 * cast scenarios: the character gallery (pose sheets). Each shot is a contact sheet: one character in several key
 * poses side by side, or the hero from front, three-quarter, side and back. Phone sizes (412x915 portrait and
 * 915x412 landscape) on the low tier at res=1. Display actors use the actors debug commands (actorsLineup,
 * actorsPose, actorsStage); every sheet also checks that no bone matrix is NaN.
 * Run with `node tools/scenarios.mjs cast [--only name]`. Screenshots go to tools/out/shots/cast-*.png.
 */

const PORTRAIT = { width: 412, height: 915, query: 'res=1&quality=low' };
const LANDSCAPE = { width: 915, height: 412, query: 'res=1&quality=low' };

/** Boot state: AI and ambient spawns off, noon, nothing alive around. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  await game((g) => {
    g.ai(false);
    g.ambient(false);
    g.setHour(12);
    g.killAll();
    g.step(2);
  });
}

/**
 * In the page: spawn a row of display actors, each frozen in a clip at a time, turned by `turn` from facing the
 * camera, with an optional expression and Form; frame the row with the stage camera. Returns the entity ids.
 * Kept as a string so every page call can share it.
 */
const SHEET = `(g, o) => {
  const ids = g.cmd.actorsLineup({ ids: o.items.map((it) => it.id), dist: o.dist, gap: o.gap, back: o.back, up: o.up, look: o.look });
  const p = g.ctx.player;
  const face = p.yaw + Math.PI + Math.PI;
  ids.forEach((id, i) => {
    const it = o.items[i];
    const e = g.ctx.ents.get(id);
    if (!e) return;
    e.yaw = face + (it.turn || 0) + (o.turn || 0);
    if (it.form) g.cmd.actorsForm(id, it.form);
    if (it.expr) g.cmd.actorsExpr(id, it.expr);
  });
  for (let k = 0; k < 4; k++) g.step(15);
  ids.forEach((id, i) => {
    const it = o.items[i];
    if (it.clip) g.cmd.actorsPose(id, it.clip, it.t || 0);
  });
  for (let k = 0; k < 6; k++) g.step(15);
  return ids;
}`;

/** @param {any} game @param {any} assert @param {any} o */
async function sheet(game, assert, o) {
  const ids = await game((g, src, opts) => (0, eval)('(' + src + ')')(g, opts), SHEET, o);
  assert.equal(ids.filter((x) => x > 0).length, o.items.length, 'every display actor spawned');
  const nan = await game((g) => g.cmd.actorsNaN());
  assert.equal(nan, 0, 'no NaN bone matrices');
  return ids;
}

const hero = (clip, t, extra) => Object.assign({ id: 'hero_a', clip, t }, extra || {});
const FOES = ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard'];
const BOSSES = ['durn', 'iskra', 'vorrhal', 'bramblehorn', 'gorrumaw'];

export const scenarios = [
  {
    name: 'cast-hero-views',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: [hero('idle', 0.3), hero('idle', 0.3, { turn: -0.7 }), hero('idle', 0.3, { turn: -Math.PI / 2 }), hero('idle', 0.3, { turn: Math.PI })], dist: 5, gap: 0.1, back: 3.3, up: 1.0, look: 0.95 });
      await shot('cast-hero-views');
      await sheet(game, assert, { items: [hero('idle', 0.3, { turn: -0.2 }), hero('idle', 0.3, { expr: 'angry', turn: -0.2 }), hero('idle', 0.3, { expr: 'hurt', turn: -0.2 }), hero('idle', 0.3, { expr: 'shout', turn: -0.2 })], dist: 3, gap: -0.42, back: 1.15, up: 1.6, look: 1.57 });
      await shot('cast-hero-faces');
    },
  },
  {
    name: 'cast-hero-portrait',
    ...PORTRAIT,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: [hero('idle', 0.3, { turn: -0.5 })], dist: 3, back: 2.6, up: 1.2, look: 1.0 });
      await shot('cast-hero-portrait');
      await sheet(game, assert, { items: [hero('idle', 0.3, { turn: 2.6 })], dist: 3, back: 2.6, up: 1.3, look: 1.0 });
      await shot('cast-hero-back');
    },
  },
  {
    // secondary motion over time: run, stop, sprint-jump, land, fly (the player, seen from the side)
    name: 'cast-motion',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const frames = [
        ['run', (g) => { g.cmd.actorsFollow(3.6, 1.5, 0.2); g.move(0, 1); for (let i = 0; i < 6; i++) g.step(10); }],
        ['stop', (g) => { g.move(0, 0); g.step(8); }],
        ['settle', (g) => { g.step(12); }],
        ['jump', (g) => { g.hold('sprint', true); g.move(0, 1); for (let i = 0; i < 4; i++) g.step(10); g.press('jump'); g.step(10); g.step(8); }],
        ['land', (g) => { for (let i = 0; i < 12; i++) { g.step(4); if (g.ctx.player.move.grounded) break; } g.step(3); }],
        ['fly', (g) => { g.hold('sprint', false); g.press('flyToggle'); g.step(15); g.hold('jump', true); g.step(30); g.hold('jump', false); g.move(0, 1); g.hold('sprint', true); for (let i = 0; i < 6; i++) g.step(10); }],
      ];
      for (const [name, fn] of frames) {
        await game((g, src) => (0, eval)('(' + src + ')')(g), fn.toString());
        assert.equal(await game((g) => g.cmd.actorsNaN()), 0, 'no NaN bone matrices');
        await shot('cast-motion-' + name);
      }
    },
  },
  {
    name: 'cast-hero-strikes',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: [hero('attack1', 0.1), hero('attack2', 0.11), hero('attack3', 0.12), hero('attack4', 0.15), hero('attack5', 0.16), hero('heavy', 0.1)], dist: 6, gap: 0.3, back: 4, up: 1.0, look: 0.95, turn: -0.9 });
      await shot('cast-hero-strikes');
      await sheet(game, assert, { items: [hero('heavy_charge', 0.2), hero('beam_charge', 0.2), hero('beam_loop', 0.1), hero('gather', 0.3), hero('guard', 0.3), hero('flicker', 0.1)], dist: 6, gap: 0.3, back: 4, up: 1.0, look: 0.95, turn: -0.9 });
      await shot('cast-hero-techniques');
    },
  },
  {
    name: 'cast-hero-moves',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: [hero('run', 0.0), hero('sprint', 0.14), hero('jump', 0.3), hero('land', 0.06), hero('fly_cruise', 0.5), hero('fly_boost', 0.1)], dist: 6, gap: 0.35, back: 4, up: 1.0, look: 0.95, turn: -1.3 });
      await shot('cast-hero-moves');
      await sheet(game, assert, { items: [hero('stagger', 0.2), hero('hurtle', 0.2), hero('down', 0.5), hero('getup', 0.3), hero('death', 1), hero('transform', 0.6), hero('victory', 0.6)], dist: 6, gap: 0.3, back: 4.4, up: 1.0, look: 0.85, turn: -0.9 });
      await shot('cast-hero-reactions');
    },
  },
  {
    name: 'cast-enemies',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: FOES.map((id) => ({ id, clip: 'idle', t: 0.3 })), dist: 10, gap: 0.3, back: 6.2, up: 1.3, look: 1.0 });
      await shot('cast-enemies-idle');
      const winds = ['windup_ranged', 'windup_bite', 'charge_windup', 'windup_slam', 'windup_ranged', 'windup_slam', 'windup_slam', 'charge_windup', 'windup_charge'];
      const ids = await sheet(game, assert, { items: FOES.map((id, i) => ({ id, clip: winds[i], t: 0.1 })), dist: 10, gap: 0.3, back: 6.2, up: 1.3, look: 1.0, turn: -0.6 });
      await shot('cast-enemies-windup');
      // the real path: a technique start picks the wind-up of its attack, and a three-hit string plays as a flurry
      const path = await game((g, id) => {
        const e = g.ctx.ents.get(id);
        const r = e.visual;
        g.ctx.bus.emit('combat:techStart', { entId: id, techId: 'acolyte_string', targetId: 0 });
        g.cmd.actorsPlay(id, 'charge_windup');
        g.step(6);
        const wind = r.full.clip.id;
        g.cmd.actorsPlay(id, 'slam');
        g.step(2);
        return [wind, r.full.clip.id];
      }, ids[3]);
      assert.deepEqual(path, ['humanoid.windup_slam', 'humanoid.flurry'], 'the acolyte winds up overhead, then strikes a flurry');
      await sheet(game, assert, { items: FOES.map((id) => ({ id, clip: 'stagger', t: 0.15 })), dist: 10, gap: 0.3, back: 6.2, up: 1.3, look: 1.0, turn: -0.6 });
      await shot('cast-enemies-hit');
    },
  },
  {
    name: 'cast-bosses',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await sheet(game, assert, { items: BOSSES.map((id) => ({ id, clip: 'idle', t: 0.3 })), dist: 20, gap: 0.6, back: 16, up: 2.4, look: 2.6 });
      await shot('cast-bosses');
      await sheet(game, assert, { items: BOSSES.map((id) => ({ id, clip: 'roar', t: 0.5 })), dist: 20, gap: 0.6, back: 16, up: 2.4, look: 2.6, turn: -0.4 });
      await shot('cast-bosses-intro');
    },
  },
  {
    name: 'cast-villagers',
    ...LANDSCAPE,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const ids = ['npc_sela', 'npc_kerrin', 'npc_dov', 'npc_mira', 'npc_bren', 'npc_yael', 'npc_noa'];
      await sheet(game, assert, { items: ids.map((id, i) => ({ id, clip: i === 4 ? 'talk' : 'idle', t: i === 1 ? 2.5 : 0.6 + i * 0.3 })), dist: 7, gap: 0.1, back: 4.2, up: 1.0, look: 0.95 });
      await shot('cast-villagers');
      // generic villagers: the same few specs, a different look per person, with idle gestures
      const gen = ['npc_villager_1', 'npc_villager_1', 'npc_villager_2', 'npc_villager_2', 'npc_villager_3', 'npc_villager_4', 'npc_villager_5', 'npc_villager_6'];
      await sheet(game, assert, { items: gen.map((id, i) => ({ id, clip: 'idle', t: 2.5 + i * 0.45 })), dist: 7.5, gap: 0.1, back: 4.4, up: 1.0, look: 0.95 });
      await shot('cast-villagers-crowd');
    },
  },
];
