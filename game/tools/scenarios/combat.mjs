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
  {
    name: 'combat-lock',
    async run({ game, assert }) {
      const p = await opening(game, assert);
      const r = await game((g, pp) => {
        g.ai(false);
        const a = g.spawn('tusk_boar', { x: pp.x + Math.sin(pp.yaw) * 10, z: pp.z + Math.cos(pp.yaw) * 10, level: 5, passive: true });
        const b = g.spawn('tusk_boar', { x: pp.x + Math.sin(pp.yaw + 0.6) * 12, z: pp.z + Math.cos(pp.yaw + 0.6) * 12, level: 5, passive: true });
        const c = g.spawn('tusk_boar', { x: pp.x + Math.sin(pp.yaw - 0.6) * 12, z: pp.z + Math.cos(pp.yaw - 0.6) * 12, level: 5, passive: true });
        g.step(2);
        const soft = g.ctx.combat.softTarget();
        g.press('lock');
        g.step(1);
        const locked = g.player().targetId;
        g.press('lockNext');
        g.step(3);
        const n1 = g.player().targetId;
        g.press('lockNext');
        g.step(3);
        const n2 = g.player().targetId;
        g.teleport(pp.x + 400, pp.z + 400, {});
        g.step(2);
        const broken = g.player().targetId;
        return { ids: [a, b, c], soft, locked, n1, n2, broken };
      }, p);
      assert.equal(r.soft, r.ids[0], 'the soft lock is the enemy straight ahead');
      assert.equal(r.locked, r.ids[0], 'Lock locks the soft target');
      assert.ok(r.ids.includes(r.n1) && r.n1 !== r.locked, 'lockNext switches');
      assert.ok(r.ids.includes(r.n2) && r.n2 !== r.n1 && r.n2 !== r.locked, 'lockNext cycles through all three ' + JSON.stringify(r));
      assert.equal(r.broken, 0, 'the lock breaks beyond 150 m');
    },
  },
  {
    name: 'combat-death',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.ai(false);
        const e = g.spawn('choir_acolyte', { dist: 3, level: 5, passive: true });
        g.step(2);
        g.damage(g.player().id, 99999, { kind: 'true', sourceId: e });
        g.step(30);
        const died = g.events(['player:died']).length;
        const order = g.events(['actor:died', 'player:died']).slice(-2).map((x) => x.type);
        const state = g.ctx.player.combat.state;
        g.ctx.rpg.respawn({});
        g.step(10);
        const p = g.player();
        return { died, order, state, hp: p.hp, hpMax: p.hpMax, after: p.state };
      });
      assert.equal(r.died, 1, 'player:died');
      assert.deepEqual(r.order, ['actor:died', 'player:died'], 'actor:died then player:died');
      assert.equal(r.state, 'dead');
      assert.equal(r.hp, r.hpMax, 'rpg.respawn restores full HP');
      assert.notEqual(r.after, 'dead', 'alive again');
      await shot('combat-respawn');
    },
  },
  {
    // The whole combat loop with every package real (control, actors, vfx, env): 8 screenshots at the key moments.
    name: 'combat-real-loop',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      // Instrumentation (in page): feel calls, hit-stop, actor clips and the actors' missing-clip warnings.
      await game((g) => {
        const c = g.ctx;
        const probe = { shake: 0, kick: 0, hitStop: 0, clips: {}, warn: [] };
        window.__probe = probe;
        const cam = c.cam;
        const sh = cam.shake.bind(cam);
        cam.shake = (t) => { probe.shake++; return sh(t); };
        const fk = cam.fovKick.bind(cam);
        cam.fovKick = (d, s, h) => { if (d > 0) probe.kick++; return fk(d, s, h); };
        const hs = c.time.hitStop.bind(c.time);
        c.time.hitStop = (s) => { probe.hitStop++; return hs(s); };
        const pl = c.actors.play.bind(c.actors);
        c.actors.play = (ent, clip, o) => { const k = ent.kind + ':' + clip; probe.clips[k] = (probe.clips[k] || 0) + 1; return pl(ent, clip, o); };
        const w = c.log.warn.bind(c.log);
        c.log.warn = (tag, ...a) => { if (tag === 'actors' || tag === 'combat' || tag === 'vfx') probe.warn.push(tag + ' ' + a.join(' ')); return w(tag, ...a); };
        g.setHour(15);
        g.god(true);
        g.ai(false);
        // Open, gentle ground outside the settlement: no collider within 30 m, low slope.
        const p = g.player();
        const tmp = [];
        let best = null;
        for (let d = 70; d <= 250 && !best; d += 30) {
          for (let a = 0; a < 12 && !best; a++) {
            const x = p.x + Math.sin(a * 0.5236) * d;
            const z = p.z + Math.cos(a * 0.5236) * d;
            if (g.ctx.world.heightAt(x, z) < 2 || g.ctx.world.slopeAt(x, z) > 0.06) continue;
            g.teleport(x, z, {});
            if (g.ctx.world.queryColliders(x, z, 30, tmp) === 0) best = { x, z };
          }
        }
        if (best) g.teleport(best.x, best.z, { yaw: Math.PI });
        else g.teleport(p.x - 6, p.z - 26, { yaw: Math.PI });
        g.setCamera({ yaw: Math.PI, pitch: -0.2 });
        g.step(2);
      });

      // 1. Strike String on a boar until it dies.
      const boar = await game((g) => g.spawn('tusk_boar', { dist: 4, level: 3, passive: true }));
      const s1 = await game((g, id) => {
        g.lock(id);
        g.step(2);
        for (let i = 0; i < 3; i++) { g.press('attack'); g.step(13); }
        const st = g.player().state;
        return { st, comboIndex: g.ctx.player.combat.comboIndex };
      }, boar);
      await shot('combat-real-1-string');
      const kill = await game((g, id) => {
        let presses = 3;
        for (; presses < 40 && g.actors().some((a) => a.id === id && a.hp > 0); presses++) { g.press('attack'); g.step(13); }
        g.step(30);
        return { presses, died: g.events(['actor:died']).some((e) => e.payload.entId === id),
          hits: g.events(['combat:hit']).filter((e) => e.payload.targetId === id && e.payload.techId === 'strike_string').length };
      }, boar);
      assert.ok(s1.comboIndex >= 1, 'the string advances (' + JSON.stringify(s1) + ')');
      assert.ok(kill.died, 'the Strike String kills the boar (' + kill.presses + ' presses, ' + kill.hits + ' hits)');

      // 2. Breaker launch, Pursuit, an air string with the player hanging beside the target, Meteor Heel.
      const aco = await game((g) => g.spawn('choir_acolyte', { dist: 3, level: 30, passive: true }));
      const air = await game((g, id) => {
        g.step(60);
        g.lock(id);
        const a0 = g.actors().find((a) => a.id === id);
        const ground = g.heightAt(a0.x, a0.z);
        g.hold('attack', true);
        g.step(Math.ceil(0.35 * 60) + 4);
        g.hold('attack', false);
        g.step(18);
        const launched = g.actors().find((a) => a.id === id).y - ground;
        g.press('dash');
        g.step(10);
        const pursuit = g.events(['combat:techStart']).some((e) => e.payload.techId === 'pursuit');
        const rows = [];
        const p = g.ctx.player;
        for (let i = 0; i < 4; i++) {
          g.press('attack');
          for (let k = 0; k < 13; k++) {
            g.step(1);
          }
          const t = g.ctx.ents.get(id);
          rows.push({ py: +(p.pos.y - ground).toFixed(1), ty: +(t.pos.y - ground).toFixed(1), mode: p.move.mode, gs: p.move.gravityScale });
        }
        const pAlt = p.pos.y - ground;
        const t = g.ctx.ents.get(id);
        return { launched, pursuit, rows, pAlt, dy: Math.abs(p.pos.y - t.pos.y), airHits: g.events(['combat:hit']).filter((e) => e.payload.targetId === id).length };
      }, aco);
      await shot('combat-real-2-air-string');
      assert.ok(air.launched > 1, 'Breaker launches the acolyte (' + air.launched.toFixed(1) + ' m)');
      assert.ok(air.pursuit, 'Dash after the launch is Pursuit');
      assert.ok(air.pAlt > 2.5, 'the player hangs in the air during the air string: ' + JSON.stringify(air.rows));
      assert.ok(air.dy < 3, 'the player stays level with the target (' + air.dy.toFixed(1) + ' m)');
      const heel = await game((g, id) => {
        const c0 = g.events(['world:crater']).length;
        const s0 = g.events(['actor:slam']).length;
        const p = g.ctx.player;
        if (!(p.move.mode === 'air' && !p.move.grounded)) {
          const a = g.ctx.ents.get(id);
          g.teleport(a.pos.x + 1.5, a.pos.z - 1.5, { alt: 5 });
          g.step(2);
        }
        g.hold('attack', true);
        g.step(Math.ceil(0.35 * 60) + 3);
        g.hold('attack', false);
        let slamAt = -1;
        for (let i = 0; i < 60; i++) { g.step(1); if (slamAt < 0 && g.events(['actor:slam']).length > s0) slamAt = i; }
        return {
          heel: g.events(['combat:techStart']).some((e) => e.payload.techId === 'meteor_heel'),
          slam: g.events(['actor:slam']).length - s0,
          craters: g.events(['world:crater']).slice(c0).map((e) => +e.payload.radius.toFixed(1)),
        };
      }, aco);
      await shot('combat-real-3-meteor-heel');
      assert.ok(heel.heel, 'Breaker in the air is Meteor Heel');
      assert.ok(heel.slam >= 1, 'Meteor Heel slams');
      assert.ok(heel.craters.length >= 1, 'a crater: ' + JSON.stringify(heel.craters));

      // 3. Bolts, then a fully charged Dawn Lance, on a golem.
      const golem = await game((g) => {
        g.killAll();
        g.step(30);
        // Fresh flat ground beside the Meteor Heel crater.
        const p = g.player();
        g.teleport(p.x + 24, p.z - 6, { yaw: Math.PI });
        g.setCamera({ yaw: Math.PI, pitch: -0.15 });
        g.step(10);
        g.heal();
        g.setOra(g.player().oraMax);
        const id = g.spawn('rust_golem', { dist: 14, level: 30, passive: true });
        g.lock(id);
        g.step(2);
        return id;
      });
      const bolts = await game((g, id) => {
        const s0 = g.events(['projectile:spawned']).length;
        g.hold('bolt', true);
        g.step(30);
        return { fired: g.events(['projectile:spawned']).length - s0, id };
      }, golem);
      await shot('combat-real-4-bolts');
      const lance = await game((g, id) => {
        g.hold('bolt', false);
        g.step(40);
        const hitsB = g.events(['combat:hit']).filter((e) => e.payload.targetId === id && e.payload.techId === 'ora_bolt').length;
        g.setSlot(0, 'dawn_lance');
        g.setOra(g.player().oraMax);
        const n0 = g.events(['combat:hit']).length;
        g.hold('tech1', true);
        g.step(126);
        g.hold('tech1', false);
        g.step(24);
        return { hitsB, n0, charge: g.events(['combat:charge']).slice(-1).map((e) => e.payload.level)[0] };
      }, golem);
      await shot('combat-real-5-dawn-lance');
      const lance2 = await game((g, o) => {
        g.step(90);
        return g.events(['combat:hit']).slice(o.n0).filter((e) => e.payload.targetId === o.id && e.payload.techId === 'dawn_lance').length;
      }, { n0: lance.n0, id: golem });
      assert.ok(bolts.fired >= 2, 'holding bolt fires (' + bolts.fired + ')');
      assert.ok(lance.hitsB >= 2, 'bolts hit the golem (' + lance.hitsB + ')');
      assert.ok(lance2 >= 2, 'the charged Dawn Lance hits (' + lance2 + ' ticks)');

      // 4. Nova Ring among four boars.
      const nova = await game((g) => {
        g.killAll();
        g.step(30);
        g.lock(0);
        g.setOra(g.player().oraMax);
        const pp = g.player();
        const ids = [];
        for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) ids.push(g.spawn('tusk_boar', { x: pp.x + dx, z: pp.z + dz, level: 14, passive: true }));
        g.step(2);
        g.setCamera({ pitch: -0.45, dist: 9 });
        const ok = g.use('nova_ring', {});
        g.step(22);
        return { ok, knocked: ids.filter((id) => g.events(['actor:knocked']).some((e) => e.payload.entId === id)).length };
      });
      await shot('combat-real-6-nova');
      assert.ok(nova.ok, 'Nova Ring cast');
      assert.equal(nova.knocked, 4, 'Nova knocks the four boars');

      // 5. The Ember transformation.
      const ember = await game((g) => {
        g.killAll();
        g.step(60);
        g.setOra(g.player().oraMax);
        g.ctx.rpg.selectForm('ember');
        g.press('form');
        g.step(32);
        return { form: g.player().formId, state: g.player().state };
      });
      await shot('combat-real-7-ember');
      assert.equal(ember.form, 'ember', 'Ember Form');

      // 6. Ringfall at full Surge.
      const ult = await game((g) => {
        g.step(120);
        g.ctx.combat.setForm(g.ctx.player, null, {});
        g.step(10);
        const pp = g.player();
        for (const [dx, dz] of [[7, 3], [-6, 5], [2, -8]]) g.spawn('tusk_boar', { x: pp.x + dx, z: pp.z + dz, level: 14, passive: true });
        g.heal();
        g.setSurge(100);
        g.step(2);
        const c0 = g.events(['world:crater']).length;
        g.press('ultimate');
        g.step(64);
        return { c0, started: g.events(['combat:techStart']).some((e) => e.payload.techId === 'ringfall') };
      });
      await shot('combat-real-8-ringfall');
      const after = await game((g, c0) => {
        g.step(60);
        const pr = window.__probe;
        const ids = g.ctx.defs ? null : null;
        void ids;
        return {
          craters: g.events(['world:crater']).slice(c0).map((e) => e.payload.radius),
          probe: { shake: pr.shake, kick: pr.kick, hitStop: pr.hitStop, warn: pr.warn.slice(0, 12), clips: pr.clips },
          impacts: g.events(['fx:impact']).length,
          errors: g.errors.slice(),
        };
      }, ult.c0);
      console.log('    feel: ' + JSON.stringify({ shake: after.probe.shake, kick: after.probe.kick, hitStop: after.probe.hitStop, impacts: after.impacts }));
      console.log('    clips: ' + Object.keys(after.probe.clips).sort().join(' '));
      if (after.probe.warn.length) console.log('    warnings: ' + after.probe.warn.join(' | '));
      assert.ok(ult.started, 'Ringfall starts at full Surge');
      assert.ok(after.craters.some((r) => r >= 20), 'Ringfall leaves a 20 m crater');
      assert.ok(after.probe.hitStop >= 5, 'hit-stop fires (' + after.probe.hitStop + ')');
      assert.ok(after.probe.shake >= 5, 'camera shake fires (' + after.probe.shake + ')');
      assert.ok(after.probe.kick >= 2, 'FOV kicks fire (' + after.probe.kick + ')');
      const missing = after.probe.warn.filter((w) => w.indexOf('missing') >= 0);
      assert.equal(missing.length, 0, 'every played clip exists: ' + missing.join(' | '));
    },
  },
  {
    // Smash an enemy into a destructible rock: three string hits then Breaker throws it; the rock breaks; bonus damage.
    name: 'combat-smash-rock',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.setHour(14);
        g.god(true);
        g.ai(false);
        const c = g.ctx;
        // Find a free-standing destructible rock (sphere collider, not a pillar) near the start, widening the search.
        const out = [];
        const p0 = g.player();
        let rock = null;
        for (let rad = 120; rad <= 900 && !rock; rad += 260) {
          for (let a = 0; a < 8 && !rock; a++) {
            const cx = p0.x + Math.sin(a * 0.785) * (rad - 120);
            const cz = p0.z + Math.cos(a * 0.785) * (rad - 120);
            g.teleport(cx, cz, {});
            g.step(2);
            const n = c.world.queryColliders(cx, cz, 120, out);
            for (let i = 0; i < n; i++) {
              const k = out[i];
              if (k.shape !== 'sphere' || !(k.flags & 4) || (k.flags & 2) || k.r < 0.6 || k.r > 3) continue;
              if (Math.abs(c.world.slopeAt(k.x, k.z)) > 0.15) continue;
              rock = { x: k.x, y: k.y, z: k.z, r: k.r, id: k.id };
              break;
            }
          }
        }
        if (!rock) return { err: 'no rock found' };
        // The player 8 m from the rock, the enemy 2.5 m in front of the player, all in a line.
        const dirX = 0.6;
        const dirZ = 0.8;
        const ex = rock.x - dirX * (rock.r + 3.2);
        const ez = rock.z - dirZ * (rock.r + 3.2);
        const px = ex - dirX * 2.4;
        const pz = ez - dirZ * 2.4;
        g.teleport(px, pz, { yaw: Math.atan2(dirX, dirZ) });
        g.step(4);
        const id = g.spawn('choir_acolyte', { x: ex, z: ez, level: 30, passive: true });
        g.step(2);
        g.lock(id);
        g.setCamera({ yaw: Math.atan2(dirX, dirZ) + 0.9, pitch: -0.25, dist: 8 });
        g.step(2);
        return { rock, id };
      });
      assert.ok(!r.err, r.err);
      const smash = await game((g, o) => {
        const id = o.id;
        const p0 = g.events(['world:propDestroyed']).length;
        const s0 = g.events(['actor:slam']).length;
        const h0 = g.events(['combat:hit']).length;
        for (let i = 0; i < 3; i++) { g.press('attack'); g.step(13); }
        g.hold('attack', true);
        g.step(Math.ceil(0.35 * 60) + 4);
        g.hold('attack', false);
        let slamTick = -1;
        for (let i = 0; i < 40; i++) {
          g.step(1);
          if (slamTick < 0 && g.events(['actor:slam']).length > s0) slamTick = i;
        }
        const knock = g.events(['actor:knocked']).filter((e) => e.payload.entId === id && e.payload.hurtle)[0];
        const slams = g.events(['actor:slam']).slice(s0).filter((e) => e.payload.entId === id).map((e) => e.payload);
        const hits = g.events(['combat:hit']).slice(h0).filter((e) => e.payload.targetId === id).map((e) => ({ tech: e.payload.techId, amount: Math.round(e.payload.amount), cls: e.payload.class }));
        const props = g.events(['world:propDestroyed']).slice(p0).map((e) => e.payload);
        const t = g.ctx.ents.get(id);
        const left = g.ctx.world.queryColliders(o.rock.x, o.rock.z, 1, []);
        return { knock: knock && knock.payload, slamTick, slams: slams.map((s) => ({ surface: s.surface, speed: Math.round(s.speed), damage: Math.round(s.damage) })),
          hits, props: props.map((p) => ({ kind: p.kind, d: Math.hypot(p.x - o.rock.x, p.z - o.rock.z) })), dist: t ? Math.hypot(t.pos.x - o.rock.x, t.pos.z - o.rock.z) : -1, left };
      }, r);
      await game((g) => g.step(4));
      await shot('combat-smash-rock');
      console.log('    smash: ' + JSON.stringify(smash));
      assert.ok(smash.knock && smash.knock.hurtle, 'Breaker after three string hits hurls the enemy');
      const wall = smash.slams.find((s) => s.surface === 'prop');
      assert.ok(wall, 'the enemy slams into the rock');
      assert.ok(smash.props.some((p) => p.d < 3), 'the rock breaks');
      const bonus = smash.hits.find((h) => h.cls === 'wallSlam' || h.tech === null);
      assert.ok(bonus && bonus.amount > 0, 'the slam deals bonus damage: ' + JSON.stringify(smash.hits));
    },
  },
  {
    // GDD 8.3: within 80 m of a standing Siphon passive Ora regen is halved (rpg reports the zone, combat applies it).
    name: 'combat-siphon-regen',
    async run({ game, assert }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.god(true);
        g.ai(false);
        const s = g.ctx.world.pois('siphon')[0];
        const regen = () => {
          g.killAll();
          g.step(20);
          g.setOra(10);
          const o0 = g.player().ora;
          g.step(120);
          return { gain: (g.player().ora - o0) / 2, zone: g.ctx.rpg.inSiphonZone, inCombat: g.ctx.combat.inCombat };
        };
        g.teleport(s.x + 500, s.z + 500, {});
        g.step(4);
        const far = regen();
        g.teleport(s.x + 40, s.z + 30, {});
        g.step(4);
        const near = regen();
        return { far, near };
      });
      console.log('    regen: ' + JSON.stringify(r));
      assert.equal(r.far.zone, false, 'no zone far away');
      assert.equal(r.near.zone, true, 'the zone within 80 m');
      assert.equal(r.near.inCombat, r.far.inCombat, 'same combat state in both measures');
      const ratio = r.near.gain / r.far.gain;
      assert.ok(Math.abs(ratio - 0.5) < 0.05, 'regen is halved in the Siphon zone (' + ratio.toFixed(2) + ')');
    },
  },
];
