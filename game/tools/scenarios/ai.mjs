/**
 * ai package scenarios (ARCHITECTURE 8.7): the roster line-up, melee and ranged fights (telegraph before every
 * attack, damage to the player, the token limit on god mode), ground versus flyer, ambient spawning through the
 * Meadows, a camp clear and its one-day refill, the five bosses (intro, every phase, defeat) and the boss reset.
 * Run with `node tools/scenarios.mjs ai`.
 */

/** An open meadow away from Sparkstead. */
const FIELD = { x: -1150, z: 1250 };

/** In the page: record the events the assertions need. */
function record(g) {
  const L = [];
  window.__aiLog = L;
  if (window.__aiOff) window.__aiOff();
  const KEEP = ['combat:telegraph', 'combat:techStart', 'actor:damaged', 'boss:start', 'boss:phase', 'boss:end', 'camp:cleared', 'ui:banner', 'cine:start', 'actor:died'];
  window.__aiOff = g.ctx.bus.onAny((t, p) => {
    if (KEEP.indexOf(t) < 0) return;
    L.push({ tick: g.tick(), t, entId: p.entId, techId: p.techId, targetId: p.targetId, sourceId: p.sourceId, amount: p.amount, phase: p.phase,
      defeated: p.defeated, bossId: p.bossId, key: p.key, kind: p.kind, campId: p.campId });
  });
}

/** Common opening: level, flight, AI on, ambient off, standing in the open field. */
async function opening(game, assert, o = {}) {
  const p = await game((g, a) => {
    g.unlockAll();
    g.setLevel(a.level || 10);
    g.ambient(false);
    g.ai(true);
    g.setHour(10);
    g.teleport(a.x, a.z, { yaw: a.yaw || 0 });
    g.heal();
    g.step(30);
    return g.player();
  }, { x: o.x || FIELD.x, z: o.z || FIELD.z, level: o.level, yaw: o.yaw });
  assert.ok(p && p.hp > 0, 'the player exists');
  await game(record);
  return p;
}

/**
 * In the page: a fight of `ids` around the idle player. Returns telegraph/attack pairing, damage and the peak of
 * simultaneous attackers sampled every tick (the second half on god mode).
 */
function fight(g, a) {
  const p = g.ctx.player;
  const ids = [];
  a.ids.forEach((id, i) => {
    const ang = (i / a.ids.length) * Math.PI * 2;
    const e = g.ctx.ai.spawn(id, p.pos.x + Math.sin(ang) * a.dist, g.heightAt(p.pos.x + Math.sin(ang) * a.dist, p.pos.z + Math.cos(ang) * a.dist) + (a.alt || 0),
      p.pos.z + Math.cos(ang) * a.dist, { level: a.level, aggro: true });
    if (e) ids.push(e.id);
  });
  const L = window.__aiLog;
  const lim = g.ctx.ai.tokens().limits;
  // A per-tick sampler (step in chunks: every step() also renders a frame).
  const S = { peak: 0, peakTokens: 0, hpLost: 0, last: p.stats.hp, god: false };
  g.ctx.systems.add({
    id: 'test.aiSample', phase: 'cleanup', owner: 'test',
    step(c) {
      let n = 0;
      for (const e of c.ents.list('enemy')) {
        if (!e.alive || !e.combat) continue;
        const st = e.combat.state;
        if (st === 'windup' || st === 'active' || st === 'recover') n++;
      }
      if (p.stats.hp < S.last) S.hpLost += S.last - p.stats.hp;
      if (!S.god && p.stats.hp < p.stats.hpMax * 0.5) c.combat.heal(p, p.stats.hpMax);
      S.last = p.stats.hp;
      if (S.god) {
        S.peak = Math.max(S.peak, n);
        const tk = c.ai.tokens();
        S.peakTokens = Math.max(S.peakTokens, tk.melee + tk.ranged);
      }
    },
  });
  // Phase 1: no god mode (the sampler heals the player below half HP). Phase 2: god mode for the token limit.
  for (let t = 0; t < a.ticks1; t += 60) g.step(60);
  g.god(true);
  S.god = true;
  for (let t = 0; t < a.ticks2; t += 60) g.step(60);
  g.god(false);
  g.ctx.systems.remove('test.aiSample');
  const hpLost = S.hpLost;
  const peak = S.peak;
  const peakTokens = S.peakTokens;
  const mine = new Set(ids);
  const starts = L.filter((e) => e.t === 'combat:techStart' && mine.has(e.entId));
  let unTele = 0;
  for (const s of starts) {
    const ok = L.some((e) => e.t === 'combat:telegraph' && e.entId === s.entId && e.tick <= s.tick && e.tick >= s.tick - 1);
    if (!ok) unTele++;
  }
  const dmg = L.filter((e) => e.t === 'actor:damaged' && e.targetId === p.id && mine.has(e.sourceId)).length;
  return { spawned: ids.length, starts: starts.length, unTele, dmg, hpLost, peak, peakTokens, limit: lim.melee + lim.ranged,
    techs: Array.from(new Set(starts.map((s) => s.techId))) };
}

const LIST = [
  {
    name: 'ai-roster',
    width: 640,
    height: 360,
    query: 'hour=10',
    async run({ game, assert, shot }) {
      await opening(game, assert, { yaw: Math.PI });
      const ROSTER = ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard'];
      const r = await game((g, ids) => {
        const p = g.ctx.player;
        const yaw = p.yaw;
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const out = [];
        ids.forEach((id, i) => {
          const off = (i - (ids.length - 1) / 2) * 2.7;
          const x = p.pos.x + fx * 10 + fz * off;
          const z = p.pos.z + fz * 10 - fx * off;
          const fly = id === 'ember_wisp' || id === 'frost_harrier' || id === 'choir_vanguard' || id === 'choir_caster';
          out.push(g.spawn(id, { x, z, passive: true, alt: fly ? 2.5 : 0 }));
        });
        g.setCamera({ yaw: yaw, pitch: -0.2, dist: 6 });
        g.step(60);
        const states = out.map((id) => g.ctx.ai.debugState(id));
        return { out, states, pos: out.map((id) => { const e = g.ctx.ents.get(id); return e ? [e.pos.x, e.pos.z] : null; }) };
      }, ROSTER);
      assert.equal(r.out.filter((id) => id > 0).length, 9, 'all nine spawn');
      for (const s of r.states) {
        assert.ok(s, 'debugState exists');
        assert.equal(s.targetId, 0, 'passive: no target');
        assert.equal(s.hasToken, false);
      }
      await shot('ai-roster');
    },
  },
  {
    name: 'ai-fight-melee',
    async run({ game, assert, shot }) {
      await opening(game, assert, { level: 8 });
      const r = await game(fight, { ids: ['choir_acolyte', 'choir_acolyte', 'choir_acolyte', 'tusk_boar', 'tusk_boar', 'choir_acolyte'], dist: 16, level: 6, ticks1: 600, ticks2: 1200 });
      await shot('ai-fight-melee');
      assert.equal(r.spawned, 6);
      assert.ok(r.starts >= 4, 'the enemies attack (' + r.starts + ' starts: ' + r.techs.join(', ') + ')');
      assert.equal(r.unTele, 0, 'a telegraph precedes every attack');
      assert.ok(r.dmg >= 1 && r.hpLost > 0, 'the player takes damage (' + r.dmg + ' hits, ' + r.hpLost + ' hp)');
      assert.ok(r.peakTokens <= r.limit, 'tokens within the limit (' + r.peakTokens + ' <= ' + r.limit + ')');
      assert.ok(r.peak <= r.limit, 'at most ' + r.limit + ' attack at once (peak ' + r.peak + ')');
    },
  },
  {
    name: 'ai-fight-ranged',
    async run({ game, assert, shot }) {
      await opening(game, assert, { level: 8 });
      const r = await game(fight, { ids: ['choir_caster', 'choir_caster', 'ember_wisp', 'ember_wisp', 'ember_wisp', 'choir_caster'], dist: 20, alt: 4, level: 6, ticks1: 600, ticks2: 1200 });
      await shot('ai-fight-ranged');
      assert.ok(r.starts >= 4, 'the enemies attack (' + r.starts + ': ' + r.techs.join(', ') + ')');
      assert.equal(r.unTele, 0, 'a telegraph precedes every attack');
      assert.ok(r.dmg >= 1, 'the player takes damage (' + r.dmg + ')');
      assert.ok(r.peak <= r.limit, 'at most ' + r.limit + ' attack at once (peak ' + r.peak + ')');
      const band = await game((g) => {
        const p = g.ctx.player;
        const d = [];
        for (const e of g.ctx.ents.list('enemy')) {
          if (!e.alive || e.defId !== 'choir_caster') continue;
          d.push(Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z));
        }
        return d;
      });
      for (const d of band) assert.ok(d > 8 && d < 45, 'casters keep their distance (' + d.toFixed(1) + ' m)');
    },
  },
  {
    name: 'ai-ground-vs-flyer',
    async run({ game, assert, shot }) {
      await opening(game, assert, { level: 8 });
      const r = await game((g) => {
        const p = g.ctx.player;
        const ids = [];
        for (let i = 0; i < 3; i++) {
          const x = p.pos.x + 8 + i * 3;
          const z = p.pos.z + 6;
          ids.push(g.spawn(i === 2 ? 'tusk_boar' : 'choir_acolyte', { x, z, level: 6, aggro: true }));
        }
        g.step(30);
        g.god(true);
        g.teleport(p.pos.x, p.pos.z, { alt: 15 });
        const L = window.__aiLog;
        const start = g.tick();
        let rocks = 0;
        // Hold the hover: no input, flight mode keeps the altitude.
        for (let t = 0; t < 9; t++) g.step(60);
        rocks = L.filter((e) => e.t === 'combat:techStart' && e.techId === 'enemy_rock' && e.tick >= start).length;
        const states = ids.map((id) => g.ctx.ai.debugState(id));
        const hp = ids.map((id) => { const e = g.ctx.ents.get(id); return e ? e.stats.hp / e.stats.hpMax : 0; });
        const alt = p.pos.y - g.heightAt(p.pos.x, p.pos.z);
        g.god(false);
        return { rocks, states, hp, alt };
      });
      await shot('ai-ground-vs-flyer');
      assert.ok(r.alt > 10, 'the player hovers (' + r.alt.toFixed(1) + ' m)');
      assert.ok(r.rocks >= 1, 'ground enemies throw at the flyer (' + r.rocks + ')');
      for (const s of r.states) assert.ok(s && s.targetId === 0 && (s.state === 'return' || s.state === 'idle'), 'disengaged: ' + JSON.stringify(s));
    },
  },
  {
    name: 'ai-ambient',
    async run({ game, assert, shot }) {
      await opening(game, assert, { x: -1000, z: 1150, level: 4 });
      const r = await game((g) => {
        g.god(true);
        g.ambient(true);
        const p = g.ctx.player;
        const cap = g.ctx.render && g.ctx.render.tier === 'high' ? 24 : 12;
        let min = 99;
        let max = 0;
        let x = -1000;
        const z = 1150;
        const regions = new Set();
        for (let i = 0; i < 40; i++) {
          x -= 15;
          g.teleport(x, z + i * 5, { alt: 30 });
          g.step(30);
          regions.add(g.regionAt(p.pos.x, p.pos.z));
          const pop = g.ctx.ai.population();
          if (i >= 4) {
            min = Math.min(min, pop.alive);
            max = Math.max(max, pop.alive);
          }
        }
        // Into Sparkstead: nothing ambient inside.
        const s = g.ctx.env.settlement('sparkstead');
        g.teleport(s.x, s.z, {});
        g.step(240);
        let inside = 0;
        for (const e of g.ctx.ents.list('enemy')) {
          if (!e.alive) continue;
          if (Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < s.radius) inside++;
        }
        g.god(false);
        return { min, max, cap, inside, regions: Array.from(regions) };
      });
      await shot('ai-ambient');
      assert.ok(r.regions.includes('meadows'), 'flew through the Meadows: ' + r.regions.join(','));
      assert.ok(r.min >= 1, 'population at least 1 (min ' + r.min + ')');
      assert.ok(r.max <= r.cap, 'population within the cap (max ' + r.max + ' <= ' + r.cap + ')');
      assert.equal(r.inside, 0, 'no enemies inside Sparkstead');
    },
  },
  {
    name: 'ai-camp',
    async run({ game, assert }) {
      await opening(game, assert, { level: 6 });
      const r = await game((g) => {
        g.god(true);
        const camps = g.cmd.aiCamps();
        const p = g.ctx.player;
        let best = null;
        for (const c of camps) {
          const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
          if (c.regionId === 'meadows' && (!best || d < best.d)) best = { c, d };
        }
        if (!best) return { error: 'no meadows camp' };
        const camp = best.c;
        g.teleport(camp.x + 30, camp.z, {});
        g.ambient(true);
        g.step(40);
        const pop1 = g.cmd.aiCamps().find((c) => c.id === camp.id);
        // Kill everything around the camp.
        const ids = g.actors().filter((a) => a.kind === 'enemy' && Math.hypot(a.x - camp.x, a.z - camp.z) < 30).map((a) => a.id);
        for (const id of ids) g.kill(id);
        g.step(5);
        const cleared = window.__aiLog.filter((e) => e.t === 'camp:cleared' && e.campId === camp.id).length;
        const day = g.ctx.env.day;
        const stored = g.state().world.camps[camp.id];
        // Away and back the same day: no refill.
        g.teleport(camp.x + 400, camp.z, {});
        g.step(70);
        g.teleport(camp.x + 30, camp.z, {});
        g.step(70);
        const sameDay = g.cmd.aiCamps().find((c) => c.id === camp.id);
        // A day later: the camp refills.
        g.ctx.store.state.world.day = day + 1;
        g.step(70);
        const nextDay = g.cmd.aiCamps().find((c) => c.id === camp.id);
        g.god(false);
        return { camp: camp.id, pop1, killed: ids.length, cleared, stored, day, sameDay, nextDay };
      });
      assert.ok(!r.error, r.error);
      assert.ok(r.pop1.populated && r.pop1.alive >= 1, 'the camp populates (' + JSON.stringify(r.pop1) + ')');
      assert.ok(r.killed >= r.pop1.alive, 'killed the camp');
      assert.equal(r.cleared, 1, 'camp:cleared once');
      assert.equal(r.stored, r.day, 'store.world.camps records the day');
      assert.equal(r.sameDay.populated, false, 'no refill on the same day');
      assert.equal(r.nextDay.populated, true, 'refills a day later');
    },
  },
  {
    // A camp's leader is an elite: tougher than its kin, ringed in the rare colour, with its extra move, paying more.
    name: 'ai-camp-elite',
    width: 412, height: 915, query: 'hour=10&res=1&quality=low',
    async run({ game, assert, shot }) {
      await opening(game, assert, { level: 6 });
      const r = await game((g) => {
        g.god(true);
        const p = g.ctx.player;
        let best = null;
        for (const c of g.cmd.aiCamps()) {
          const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
          if (c.regionId === 'meadows' && (!best || d < best.d)) best = { c, d };
        }
        const camp = best.c;
        g.teleport(camp.x + 16, camp.z + 4, { yaw: Math.atan2(-16, -4) });
        g.ambient(true);
        g.step(40);
        g.ambient(false);
        const near = g.ctx.ents.list('enemy').filter((e) => e.alive && Math.hypot(e.pos.x - camp.x, e.pos.z - camp.z) < 30);
        const elites = near.filter((e) => (e.tags & 8) !== 0);
        const el = elites[0];
        const kin = el ? near.find((e) => e !== el && e.defId === el.defId) : null;
        const techs = el && el.brain ? el.brain.techs.map((t) => t.id) : [];
        return { camp: camp.id, n: near.length, elites: elites.length, def: el && el.defId, hp: el && el.stats.hpMax, kinHp: kin && kin.stats.hpMax, techs, id: el && el.id };
      });
      await game((g, id) => { g.lock(id); g.step(10); }, r.id);
      await shot('ai-camp-elite');
      const k = await game((g, id) => {
        const xp0 = g.ctx.rpg.level * 1e6 + g.ctx.rpg.xp;
        g.kill(id);
        g.step(5);
        return { gained: g.ctx.rpg.level * 1e6 + g.ctx.rpg.xp - xp0 };
      }, r.id);
      console.log('    ' + JSON.stringify({ r, k }));
      assert.equal(r.elites, 1, 'one elite per camp');
      if (r.kinHp) assert.ok(r.hp > r.kinHp * 2, 'the elite is tougher than its kin');
      assert.ok(r.techs.includes('elite_quake') || r.techs.includes('elite_fan'), 'the elite has its extra move');
      assert.ok(k.gained > 0, 'the elite pays XP');
    },
  },
  ...['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal'].map((bossId) => ({
    name: 'ai-boss-' + bossId,
    width: 640,
    height: 360,
    query: 'hour=11',
    async run({ game, assert, shot }) {
      await opening(game, assert, { level: 20 });
      const start = await game((g, id) => {
        g.god(true);
        const bd = g.ctx.defs.find('boss', id);
        const lm = g.ctx.world.landmark(bd.arena.landmarkId);
        g.teleport(lm.x + 22, lm.z + 22, {});
        g.step(5);
        const b = g.startBoss(id);
        // Face the fight from 16 m on dry ground.
        const e = g.ctx.ents.get(b);
        g.teleport(e.pos.x + 12, e.pos.z + 11, { yaw: Math.atan2(-12, -11) });
        g.setCamera({ yaw: Math.atan2(-12, -11), pitch: -0.15 });
        for (let i = 0; i < 8; i++) g.step(60);
        const L = window.__aiLog;
        return {
          b, phases: bd.phases.map((p) => p.hpBelow),
          started: L.some((e) => e.t === 'boss:start' && e.bossId === id),
          card: L.some((e) => e.t === 'ui:banner' && e.key === 'boss.' + id + '.title'),
          cine: L.some((e) => e.t === 'cine:start'),
          attacks: L.filter((e) => e.t === 'combat:techStart' && e.entId === b).length,
        };
      }, bossId);
      assert.ok(start.b > 0, 'the boss spawns');
      assert.ok(start.started, 'boss:start');
      assert.ok(start.card, 'the name card event');
      assert.ok(start.cine, 'the intro shot');
      await shot('ai-boss-' + bossId + '-p1');
      for (let i = 1; i < start.phases.length; i++) {
        const r = await game((g, a) => {
          const e = g.ctx.ents.get(a.b);
          if (a.fog && !window.__fog) {
            window.__fog = [];
            const env = g.ctx.env;
            const sf = env.setFog.bind(env);
            const cf = env.clearFog.bind(env);
            env.setFog = (o) => { window.__fog.push('set:' + (o && o.snow)); return sf(o); };
            env.clearFog = (s) => { window.__fog.push('clear'); return cf(s); };
          }
          const want = (a.below - 0.03) * e.stats.hpMax;
          g.damage(a.b, Math.max(2, e.stats.hp - want));
          // Vorrhal's last phase starts the finale script, which speaks: close the dialogue before stepping.
          for (let k = 0; k < 12; k++) {
            if (g.top() !== 'hud') g.closeAll();
            g.step(20);
          }
          return { n: window.__aiLog.filter((x) => x.t === 'boss:phase' && x.phase === a.i).length, fog: (window.__fog || []).join(',') };
        }, { b: start.b, below: start.phases[i], i, fog: bossId === 'iskra' });
        assert.equal(r.n, 1, 'boss:phase ' + i + ' fires once');
        if (bossId === 'iskra' && i === 1) assert.equal(r.fog, 'set:1', "Iskra's phase 2 blizzard sets the fog");
        await shot('ai-boss-' + bossId + '-p' + (i + 1));
      }
      const end = await game((g, a) => {
        const e = g.ctx.ents.get(a.b);
        if (a.flee) g.damage(a.b, Math.max(2, e.stats.hp - 0.03 * e.stats.hpMax));
        else g.kill(a.b);
        for (let k = 0; k < 10; k++) {
          if (g.top() !== 'hud') g.closeAll();
          g.step(20);
        }
        const L = window.__aiLog;
        const attacks = L.filter((x) => x.t === 'combat:techStart' && x.entId === a.b);
        const tele = attacks.every((s) => L.some((x) => x.t === 'combat:telegraph' && x.entId === a.b && x.tick <= s.tick && x.tick >= s.tick - 1));
        g.god(false);
        return { ends: L.filter((x) => x.t === 'boss:end').map((x) => x.defeated), boss: !!g.ctx.ai.boss, attacks: attacks.length, tele,
          fog: (window.__fog || []).join(',') };
      }, { b: start.b, flee: bossId === 'durn', fog: bossId === 'iskra' });
      if (bossId === 'iskra') assert.equal(end.fog, 'set:1,clear', 'the boss fog clears on boss:end');
      assert.deepEqual(end.ends, [true], 'boss:end { defeated: true } once');
      assert.equal(end.boss, false, 'the boss is gone');
      assert.ok(end.attacks >= 1, 'the boss attacked (' + end.attacks + ')');
      assert.ok(end.tele, 'every boss attack is telegraphed');
    },
  })),
  {
    name: 'ai-boss-reset',
    async run({ game, assert }) {
      await opening(game, assert, { level: 14 });
      const r = await game((g) => {
        g.god(true);
        const bd = g.ctx.defs.find('boss', 'bramblehorn');
        const lm = g.ctx.world.landmark('bramble_hollow');
        g.teleport(lm.x + 20, lm.z, {});
        g.step(5);
        g.startBoss('bramblehorn');
        g.step(60);
        const L = window.__aiLog;
        // Leave the arena.
        g.teleport(lm.x + bd.arena.radius + 120, lm.z, {});
        g.step(30);
        const gone = !g.ctx.ai.boss;
        const endFalse = L.some((e) => e.t === 'boss:end' && e.defeated === false);
        // Re-enter: restarts without the intro.
        const cards0 = L.filter((e) => e.t === 'ui:banner' && e.key === 'boss.bramblehorn.title').length;
        g.teleport(lm.x + 20, lm.z, {});
        g.step(30);
        const back = !!g.ctx.ai.boss;
        const cards1 = L.filter((e) => e.t === 'ui:banner' && e.key === 'boss.bramblehorn.title').length;
        // Retry after a reset.
        g.ctx.ai.resetBoss();
        g.step(2);
        const resetGone = !g.ctx.ai.boss;
        g.teleport(lm.x + 600, lm.z, {});
        g.ctx.rpg.respawn({ retry: true });
        g.step(30);
        const retried = !!g.ctx.ai.boss;
        const starts = L.filter((e) => e.t === 'boss:start').length;
        g.kill(g.ctx.ai.boss ? g.ctx.ai.boss.id : 0);
        g.step(5);
        g.god(false);
        return { gone, endFalse, back, cards0, cards1, resetGone, retried, starts };
      });
      assert.ok(r.gone, 'leaving the arena despawns the boss');
      assert.ok(r.endFalse, 'boss:end { defeated: false } on reset');
      assert.ok(r.back, 're-entering restarts the fight');
      assert.equal(r.cards1, r.cards0, 'no intro on the restart');
      assert.ok(r.resetGone, 'resetBoss despawns');
      assert.ok(r.retried, 'retry restarts the boss');
      assert.ok(r.starts >= 3, 'three boss:start events');
    },
  },
];

export const scenarios = LIST.map((s) => Object.assign({ width: 640, height: 360, query: 'hour=10' }, s));
