/**
 * Combat package scenarios (ARCHITECTURE 8.6): the string and the launch, bolts and the charged beam, Nova and
 * the ultimate, guard and Flicker, Forms. Each drives the real game through __GAME__ and takes screenshots.
 * Run with `node tools/scenarios.mjs combat`.
 */

/** Common opening: everything unlocked, the AI quiet, full Ora. */
async function opening(game, assert) {
  const p = await game((g) => {
    g.unlockAll();
    g.setLevel(12);
    g.ambient(false);
    g.setSlot('ultimate', 'ringfall');
    g.heal();
    g.ctx.combat.setInvulnerable(g.ctx.player, 0);
    g.step(2);
    return g.player();
  });
  assert.ok(p && p.hp > 0, 'the player exists');
  return p;
}

export const scenarios = [
  {
    name: 'combat-string-launch',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      // 1. The Strike String kills a boar.
      const boar = await game((g) => g.spawn('tusk_boar', { dist: 6, level: 1, passive: true }));
      assert.ok(boar > 0, 'boar spawned');
      const kill = await game((g, id) => {
        g.step(2);
        let presses = 0;
        let shotTaken = false;
        for (; presses < 40 && g.actors().some((a) => a.id === id && a.hp > 0); presses++) {
          g.press('attack');
          g.step(13);
          if (presses === 3 && !shotTaken) shotTaken = true;
        }
        const hits = g.events(['combat:hit']).filter((e) => e.payload.targetId === id && e.payload.techId === 'strike_string').length;
        const died = g.events(['actor:died']).some((e) => e.payload.entId === id);
        return { presses, hits, died };
      }, boar);
      assert.ok(kill.hits >= 2, 'the string hits the boar (' + kill.hits + ')');
      assert.equal(kill.died, true, 'the string kills the boar in ' + kill.presses + ' presses');
      await game((g) => g.step(20));
      await shot('combat-string-kill');

      // 2. Breaker launches an acolyte above 6 m.
      const aco = await game((g) => {
        g.ai(false);
        // A tough acolyte (level 30) survives the launch, the Pursuit and the Meteor Heel.
        return g.spawn('choir_acolyte', { dist: 3, level: 30, passive: true });
      });
      assert.ok(aco > 0);
      const launch = await game((g, id) => {
        // Let the string expire so Breaker launches (three string hits right before it would smash instead).
        g.step(60);
        const row0 = g.actors().find((a) => a.id === id);
        const ground = g.heightAt(row0.x, row0.z);
        g.hold('attack', true);
        g.step(Math.ceil(0.35 * 60) + 4);
        g.hold('attack', false);
        let maxRise = 0;
        let apexTick = 0;
        for (let i = 0; i < 90; i++) {
          g.step(1);
          const r = g.actors().find((a) => a.id === id);
          if (r && r.y - ground > maxRise) { maxRise = r.y - ground; apexTick = i; }
        }
        const knocked = g.events(['actor:knocked']).some((e) => e.payload.entId === id);
        return { maxRise, apexTick, knocked, breaker: g.events(['combat:techStart']).some((e) => e.payload.techId === 'breaker') };
      }, aco);
      assert.ok(launch.breaker, 'holding attack starts Breaker');
      assert.ok(launch.knocked, 'the acolyte is knocked');
      assert.ok(launch.maxRise > 6, 'Breaker launches the acolyte above 6 m (' + launch.maxRise.toFixed(1) + ' m)');

      // 3. Pursuit: relaunch and dash inside the window.
      const pursuit = await game((g, id) => {
        // The launched acolyte hangs with juggle gravity for about 3 s: wait for it to land.
        g.step(260);
        g.heal();
        const a0 = g.actors().find((r) => r.id === id);
        g.teleport(a0.x, a0.z - 2.2, { yaw: 0 });
        g.lock(id);
        g.step(2);
        const used = g.use('breaker', { targetId: id });
        g.step(16);
        const e = g.ctx.ents.get(id);
        const dbg = { used, mode: e && e.move.mode, grounded: e && e.move.grounded, ps: g.player().state, pt: g.ctx.player.combat.techId };
        g.press('dash');
        g.step(10);
        const p = g.player();
        const a = g.actors().find((r) => r.id === id);
        return { dbg, started: g.events(['combat:techStart']).some((e) => e.payload.techId === 'pursuit'), dy: a ? Math.abs(a.y - p.y) : 99 };
      }, aco);
      assert.ok(pursuit.started, 'Dash after a launch is Pursuit ' + JSON.stringify(pursuit.dbg));
      await shot('combat-pursuit');

      // 4. Meteor Heel from the air: actor:slam and world:crater.
      const heel = await game((g, id) => {
        g.step(150);
        g.heal();
        const p = g.player();
        const a = g.actors().find((r) => r.id === id);
        if (!a) return { err: 'acolyte gone' };
        const c0 = g.events(['world:crater']).length;
        const s0 = g.events(['actor:slam']).length;
        g.teleport(a.x + 1.5, a.z - 1.5, { alt: 5 });
        g.lock(id);
        g.step(2);
        g.hold('attack', true);
        g.step(Math.ceil(0.35 * 60) + 3);
        g.hold('attack', false);
        g.step(60);
        void p;
        return {
          heel: g.events(['combat:techStart']).some((e) => e.payload.techId === 'meteor_heel'),
          slam: g.events(['actor:slam']).length - s0,
          craters: g.events(['world:crater']).slice(c0).map((e) => e.payload.radius),
        };
      }, aco);
      assert.ok(!heel.err, heel.err);
      assert.ok(heel.heel, 'Breaker in the air is Meteor Heel');
      assert.ok(heel.slam >= 1, 'Meteor Heel slams the acolyte (actor:slam)');
      assert.ok(heel.craters.length >= 1, 'Meteor Heel leaves a crater: ' + JSON.stringify(heel.craters));
      await game((g) => g.step(6));
      await shot('combat-meteor-heel');
    },
  },
  {
    name: 'combat-bolt-beam',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const target = await game((g) => {
        g.ai(false);
        return g.spawn('rust_golem', { dist: 16, level: 30, passive: true });
      });
      assert.ok(target > 0);
      const bolts = await game((g, id) => {
        g.lock(id);
        g.step(2);
        const ora0 = g.player().ora;
        const s0 = g.events(['projectile:spawned']).length;
        g.hold('bolt', true);
        g.step(48);
        g.hold('bolt', false);
        g.step(40);
        return {
          fired: g.events(['projectile:spawned']).length - s0,
          hits: g.events(['combat:hit']).filter((e) => e.payload.targetId === id && e.payload.techId === 'ora_bolt').length,
          ora: ora0 - g.player().ora,
        };
      }, target);
      assert.ok(bolts.fired >= 3, 'holding bolt auto-fires (' + bolts.fired + ')');
      assert.ok(bolts.hits >= 3, 'bolts hit (' + bolts.hits + ')');
      assert.ok(bolts.ora > 10, 'bolts cost Ora (' + bolts.ora.toFixed(1) + ')');
      // Dawn Lance uncharged, then fully charged.
      const beam = await game(async (g, id) => {
        g.setSlot(0, 'dawn_lance');
        const total = (from) => g.events(['combat:hit']).slice(from).filter((e) => e.payload.targetId === id && e.payload.techId === 'dawn_lance')
          .reduce((a, e) => a + e.payload.amount, 0);
        g.setOra(g.player().oraMax);
        let n0 = g.events(['combat:hit']).length;
        g.press('tech1');
        g.step(150);
        const a = total(n0);
        g.step(Math.ceil(8 * 60));
        g.setOra(g.player().oraMax);
        g.heal();
        g.setOra(g.player().oraMax);
        n0 = g.events(['combat:hit']).length;
        g.hold('tech1', true);
        g.step(126);
        g.hold('tech1', false);
        g.step(40);
        return { a, n0 };
      }, target);
      await shot('combat-dawn-lance');
      const b = await game((g, o) => {
        g.step(110);
        return g.events(['combat:hit']).slice(o.n0).filter((e) => e.payload.targetId === o.id && e.payload.techId === 'dawn_lance')
          .reduce((a, e) => a + e.payload.amount, 0);
      }, { n0: beam.n0, id: target });
      assert.ok(beam.a > 0, 'the uncharged beam deals damage');
      const ratio = b / beam.a;
      assert.ok(ratio > 2.2 && ratio < 2.8, 'a full charge deals about 2.5x (' + ratio.toFixed(2) + ')');
    },
  },
  {
    name: 'combat-nova-ultimate',
    async run({ game, assert, shot }) {
      const p = await opening(game, assert);
      const ids = await game((g, pp) => {
        g.ai(false);
        const out = [];
        for (const [dx, dz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) out.push(g.spawn('tusk_boar', { x: pp.x + dx, z: pp.z + dz, level: 14, passive: true }));
        g.step(2);
        return out;
      }, p);
      assert.equal(ids.filter((x) => x > 0).length, 4, 'four boars');
      const nova = await game((g, list) => {
        const p0 = g.player();
        const d0 = list.map((id) => { const a = g.actors().find((r) => r.id === id); return Math.hypot(a.x - p0.x, a.z - p0.z); });
        const ok = g.use('nova_ring', {});
        g.step(20);
        const knocked = list.filter((id) => g.events(['actor:knocked']).some((e) => e.payload.entId === id)).length;
        g.step(30);
        const p1 = g.player();
        const d1 = list.map((id) => { const a = g.actors().find((r) => r.id === id); return a ? Math.hypot(a.x - p1.x, a.z - p1.z) : 99; });
        return { ok, knocked, d0, d1 };
      }, ids);
      assert.ok(nova.ok, 'Nova Ring cast');
      assert.equal(nova.knocked, 4, 'Nova knocks all four');
      assert.ok(nova.d1.every((d, i) => d > nova.d0[i] + 2), 'all four are thrown outward: ' + nova.d1.map((d) => d.toFixed(1)).join(','));
      await shot('combat-nova');
      const ult = await game((g) => {
        g.step(90);
        g.heal();
        g.setSurge(100);
        g.step(1);
        const c0 = g.events(['world:crater']).length;
        g.press('ultimate');
        g.step(64);
        return { c0, started: g.events(['combat:techStart']).some((e) => e.payload.techId === 'ringfall') };
      });
      assert.ok(ult.started, 'Ringfall starts at full Surge');
      await shot('combat-ringfall-impact');
      const after = await game((g, c0) => {
        g.step(60);
        const cr = g.events(['world:crater']).slice(c0).map((e) => e.payload);
        return { craters: cr, surge: g.player().surge };
      }, ult.c0);
      const big = after.craters.find((c) => c.radius >= 20);
      assert.ok(big, 'Ringfall leaves a 20 m crater: ' + JSON.stringify(after.craters.map((c) => c.radius)));
      assert.equal(big.deformed, true, 'the crater deforms the terrain');
      assert.ok(after.surge < 20, 'Ringfall spends the Surge');
      await game((g) => { g.setCamera({ pitch: -0.6, dist: 16 }); g.step(2); });
      await shot('combat-ringfall-crater');
    },
  },
  {
    name: 'combat-guard-flicker',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const id = await game((g) => {
        g.ai(false);
        return g.spawn('choir_acolyte', { dist: 2.5, level: 12, passive: true });
      });
      assert.ok(id > 0);
      // Scripted enemy attack helper (in page): start the attack, step until `lead` seconds before its active phase.
      const attack = `(g, id, lead) => {
        const e = g.ctx.ents.get(id);
        const p = g.ctx.player;
        e.yaw = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        p.yaw = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        g.ctx.combat.useTechnique(e, 'acolyte_string', { targetId: p.id, force: true });
        const def = g.ctx.defs.find('technique', 'acolyte_string');
        const windup = def.timeline.windup;
        for (let i = 0; i < 200 && e.combat.state === 'windup' && e.combat.techT < windup - lead; i++) g.step(1);
      }`;
      const guard = await game(new Function('return async (g, a) => { const attack = ' + attack + `;
        g.heal();
        const hp0 = g.player().hp;
        attack(g, a.id, 0.6);
        g.hold('guard', true);
        g.step(80);
        const blocked = g.events(['combat:hit']).filter((e) => e.payload.targetId === g.player().id);
        const res = { blocked: blocked.length ? blocked[blocked.length - 1].payload.blocked : null, lost: hp0 - g.player().hp };
        g.hold('guard', false);
        g.step(60);
        // Perfect guard: raise it just before the impact.
        g.heal();
        attack(g, a.id, 0.05);
        g.press('guard');
        g.hold('guard', true);
        g.step(40);
        g.hold('guard', false);
        res.perfect = g.events(['combat:perfect']).some((e) => e.payload.kind === 'guard');
        res.staggered = g.events(['actor:staggered']).some((e) => e.payload.entId === a.id);
        return res;
      }`)(), { id });
      assert.equal(guard.blocked, true, 'guard blocks the attack');
      assert.ok(guard.perfect, 'a late guard is perfect');
      assert.ok(guard.staggered, 'a perfect guard staggers the attacker');
      await shot('combat-guard');
      const flick = await game(new Function('return async (g, a) => { const attack = ' + attack + `;
        g.step(80);
        g.heal();
        const hp0 = g.player().hp;
        const f0 = g.events(['combat:flicker']).length;
        attack(g, a.id, 0.05);
        g.press('dash');
        g.step(40);
        return {
          flickers: g.events(['combat:flicker']).length - f0,
          perfect: g.events(['combat:perfect']).some((e) => e.payload.kind === 'flicker'),
          lost: hp0 - g.player().hp,
        };
      }`)(), { id });
      assert.equal(flick.flickers, 1, 'one dash press, one Flicker');
      assert.equal(flick.lost, 0, 'Flicker avoids the attack');
      assert.ok(flick.perfect, 'a last-instant Flicker is perfect (slow motion)');
      await shot('combat-flicker');
    },
  },
  {
    name: 'combat-forms',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.setOra(g.player().oraMax);
        const res0 = g.player().resonance;
        g.ctx.rpg.selectForm('ember');
        g.press('form');
        g.step(30);
        return { res0, state: g.player().state, form: g.player().formId };
      });
      assert.equal(r.form, 'ember', 'Form pressed: Ember');
      assert.equal(r.state, 'transform', 'the transform sequence runs');
      await shot('combat-transform');
      const f = await game((g) => {
        g.step(120);
        const p1 = g.player();
        const o1 = p1.ora;
        g.step(120);
        const p2 = g.player();
        return { res1: p1.resonance, drain: (o1 - p2.ora) / 2, state: p2.state };
      });
      assert.ok(Math.abs(f.res1 / r.res0 - 1.5) < 0.08, 'Ember Resonance x1.5 (' + (f.res1 / r.res0).toFixed(2) + ')');
      assert.ok(Math.abs(f.drain - 3) < 0.4, 'Ember drains 3 Ora/s (' + f.drain.toFixed(2) + ')');
      await shot('combat-ember');
      const burn = await game((g) => {
        g.setOra(3);
        g.step(150);
        const p = g.player();
        const lockout = g.ctx.combat.setForm(g.ctx.player, 'ember', {});
        return { form: p.formId, burnout: g.events(['combat:burnout']).length, lockout };
      });
      assert.equal(burn.form, null, 'the Form ends at 0 Ora');
      assert.equal(burn.burnout, 1, 'Burnout');
      assert.equal(burn.lockout, false, 'no transform during Burnout');
      const z = await game((g) => {
        g.step(60 * 13);
        g.setOra(g.player().oraMax);
        const t = g.ctx.combat.setForm(g.ctx.player, 'tempest', {});
        g.step(120);
        const tp = g.player().formId;
        g.ctx.combat.setForm(g.ctx.player, null, {});
        g.step(5);
        const zs = g.ctx.combat.setForm(g.ctx.player, 'zenith', { scripted: true });
        g.step(100);
        const o = g.player().ora;
        g.step(120);
        return { t, tp, zs, zform: g.player().formId, zdrain: o - g.player().ora };
      });
      assert.ok(z.t && z.tp === 'tempest', 'Tempest');
      assert.ok(z.zs && z.zform === 'zenith', 'scripted Zenith');
      assert.ok(z.zdrain <= 0.01, 'scripted Zenith has no drain');
      await shot('combat-zenith');
    },
  },
];
