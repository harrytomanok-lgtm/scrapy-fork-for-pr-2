/**
 * Balance scenarios: three points of the balance table checked for real in the browser (low tier). A
 * level-appropriate player with a simple scripted rotation (lock, Strike String, a held Breaker every sixth press,
 * bolts at range, the slot technique on cooldown) fights (a) a Meadows wisp group at level 2, (b) a Thornwood camp
 * group at its region level, (c) Captain Durn at the level the story reaches him. Measured time to kill and HP lost
 * must be inside the bands of tools/balance-sim.mjs (`checks()`, bot profile) within 35 percent.
 * Run with `node tools/scenarios.mjs balance`.
 */
import { checks } from '../balance-sim.mjs';

/** Tolerance against the simulated value (GDD balance task: within 35 percent). */
const TOL = 0.35;

/** In the page: set up the player for a check point. */
function setup(g, a) {
  g.unlockAll();
  g.ambient(false);
  g.ai(true);
  g.setHour(11);
  g.ctx.rpg.setDifficulty(a.difficulty);
  g.setLevel(a.level);
  for (const [id, il] of a.gear) {
    g.give(id, 1, il);
    g.equip(id);
  }
  if (a.slot) g.setSlot(0, a.slot);
  g.teleport(a.x, a.z, { yaw: 0 });
  g.step(20);
  g.heal();
  g.god(false);
  g.ctx.combat.setInvulnerable(g.ctx.player, 0);
  g.setCamera({ yaw: 0, pitch: -0.2 });
  // The bot: lock the nearest enemy, string, Breaker every sixth press, bolts beyond lunge range, tech1 on cooldown.
  const p = g.ctx.player;
  const S = { t0: g.simTime(), lost: 0, last: p.stats.hp, heals: 0, presses: 0, techT: -99, done: false, end: 0, chunks: 0, firstHit: -1 };
  window.__bal = S;
  S.dealt = 0;
  S.hits = 0;
  S.techs = {};
  if (window.__balOff) window.__balOff();
  window.__balOff = g.ctx.bus.onAny((t, ev) => {
    if (t === 'actor:damaged' && ev.sourceId === p.id) { S.dealt += ev.amount || 0; S.hits++; }
    if (t === 'combat:techStart' && ev.entId === p.id) {
      S.techs[ev.techId] = (S.techs[ev.techId] || 0) + 1;
      if (ev.techId === a.slot) S.techT = g.simTime();
    }
  });
  S.tick = (seconds) => {
    const until = g.simTime() + seconds;
    while (g.simTime() < until && !S.done) {
      const enemies = g.ctx.ents.list('enemy').concat(g.ctx.ents.list('boss')).filter((e) => e.alive && e.stats && e.stats.hp > 0 && e.team === 2 && (!S.only || S.only.indexOf(e.id) >= 0));
      if (S.boss) {
        const boss = g.ctx.ents.get(S.boss);
        if (!boss || !boss.alive || (boss.stats && boss.stats.hp <= 0)) {
          S.done = true;
          S.end = g.simTime();
          break;
        }
      } else if (enemies.length === 0) {
        S.done = true;
        S.end = g.simTime();
        break;
      }
      let target = g.ctx.ents.get(g.ctx.combat.target());
      if (!target || !target.alive || target.stats.hp <= 0) {
        target = null;
        let best = 1e9;
        for (const e of enemies) {
          const d = (e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2;
          if (d < best) { best = d; target = e; }
        }
        g.lock(target ? target.id : 0);
      }
      if (target) {
        const dx = target.pos.x - p.pos.x;
        const dz = target.pos.z - p.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const now = g.simTime();
        if (a.slot && now - S.techT > a.slotCooldown && p.stats.ora >= a.slotOra && dist < a.slotRange) {
          // Retried every slice until the technique starts (a press during the string is buffered briefly).
          g.press('tech1', a.slotHold || 1);
        } else if (dist > 10.5 && !a.attackOnly) {
          g.press('bolt');
        } else {
          S.presses++;
          if (S.presses % 6 === 0) g.press('attack', 24); else g.press('attack');
        }
      }
      g.ctx.loop.stepSim(S.presses % 6 === 0 ? 26 : 15);
      if (++S.chunks % 25 === 0) g.render();
      if (p.stats.hp < S.last) S.lost += S.last - p.stats.hp;
      // A healing item (Sunfruit, 30%) whenever HP falls below 30%.
      if (p.stats.hp > 0 && p.stats.hp < p.stats.hpMax * 0.3) {
        g.ctx.combat.heal(p, p.stats.hpMax * 0.3);
        S.heals++;
      }
      if (p.stats.hp <= 0 || !p.alive) {
        S.done = true;
        S.dead = true;
        S.end = g.simTime();
      }
      S.last = p.stats.hp;
    }
    const boss = S.boss ? g.ctx.ents.get(S.boss) : null;
    return { probe: S.probe, bossHp: boss && boss.stats ? Math.round(boss.stats.hp) + '/' + boss.stats.hpMax : '', dealt: Math.round(S.dealt), hits: S.hits, techs: S.techs,
      done: S.done, dead: !!S.dead, t: (S.done ? S.end : g.simTime()) - S.t0, lost: S.lost, heals: S.heals, hp: p.stats.hp, hpMax: p.stats.hpMax };
  };
  return { hpMax: p.stats.hpMax, level: g.ctx.rpg.level, slots: JSON.stringify(g.state().player.slots), hasNova: g.ctx.rpg.hasTech('nova_ring') };
}

/** Run the fight in 8-second slices (each slice is one page evaluation). */
async function fightLoop(game, maxSeconds) {
  let r = null;
  for (let t = 0; t < maxSeconds; t += 8) {
    r = await game(() => window.__bal.tick(8));
    if (r.done) break;
  }
  return r;
}

/** Compare a measurement with the simulated band. */
function within(assert, label, measured, expected) {
  const lo = expected * (1 - TOL);
  const hi = expected * (1 + TOL);
  console.log(`  ${label}: measured ${measured.toFixed(1)}, simulated ${expected.toFixed(1)} (band ${lo.toFixed(1)}-${hi.toFixed(1)})`);
  assert.ok(measured >= lo && measured <= hi, `${label}: ${measured.toFixed(1)} outside ${lo.toFixed(1)}-${hi.toFixed(1)}`);
}

/** A group check point. */
function groupScenario(key) {
  return {
    name: 'balance-' + key,
    width: 640, height: 360,
    async run({ game, assert, shot }) {
      const c = checks()[key];
      const info = await game(setup, c.setup);
      assert.equal(info.level, c.setup.level, 'player level');
      console.log('  setup', JSON.stringify(info));
      const ids = await game((g, a) => {
        const p = g.ctx.player;
        const out = [];
        a.members.forEach((id, i) => {
          const ang = (i / a.members.length) * Math.PI * 2 + 0.4;
          const x = p.pos.x + Math.sin(ang) * a.dist;
          const z = p.pos.z + Math.cos(ang) * a.dist;
          out.push(g.spawn(id, { x, z, level: a.enemyLevel, aggro: true }));
        });
        window.__bal.only = out;
        return out;
      }, c.fight);
      assert.ok(ids.every((id) => id > 0), 'the group spawns');
      await game((g) => { window.__bal.t0 = g.simTime(); g.step(1); });
      const r = await fightLoop(game, c.maxSeconds);
      await shot('balance-' + key);
      console.log(`  ${key}: ${JSON.stringify(r)}`);
      assert.ok(r.done && !r.dead, 'the bot wins the fight');
      within(assert, key + ' time to kill (s)', r.t, c.expect.ttk);
      within(assert, key + ' HP lost (% of max)', 100 * r.lost / r.hpMax, c.expect.lostPct);
    },
  };
}

export const scenarios = [
  groupScenario('meadows'),
  {
    // Ember Wisps (task 4): a level-3 player pressing only Attack reaches and kills level-6 wisps.
    name: 'balance-wisps-attack-only',
    width: 640, height: 360,
    async run({ game, assert, shot }) {
      const c = checks().wisps;
      await game(setup, c.setup);
      const ids = await game((g, a) => {
        const p = g.ctx.player;
        const out = a.members.map((id, i) => g.spawn(id, { x: p.pos.x + Math.sin(i * 2.1) * a.dist, z: p.pos.z + Math.cos(i * 2.1) * a.dist, level: a.enemyLevel, aggro: true }));
        window.__bal.only = out;
        window.__bal.t0 = g.simTime();
        return out;
      }, c.fight);
      assert.ok(ids.every((id) => id > 0), 'the wisps spawn');
      const r = await fightLoop(game, c.maxSeconds);
      await shot('balance-wisps-attack-only');
      console.log(`  wisps: ${JSON.stringify(r)}`);
      assert.ok(r.done && !r.dead, 'Attack alone clears the wisps');
      assert.ok(r.techs.strike_string > 0 && r.hits > 0, 'the string reaches the wisps');
      within(assert, 'wisps time to kill (s)', r.t, c.expect.ttk);
      assert.ok(100 * r.lost / r.hpMax < 50, 'the first enemy of the game is not the most dangerous: ' + (100 * r.lost / r.hpMax).toFixed(0) + '% HP lost');
    },
  },
  groupScenario('camp'),
  {
    name: 'balance-durn',
    width: 640, height: 360,
    async run({ game, assert, shot }) {
      const c = checks().durn;
      await game(setup, c.setup);
      const b = await game((g, a) => {
        const bd = g.ctx.defs.find('boss', a.boss);
        const lm = g.ctx.world.landmark(bd.arena.landmarkId);
        g.teleport(lm.x + 20, lm.z + 20, {});
        g.step(5);
        const id = g.startBoss(a.boss);
        const e = g.ctx.ents.get(id);
        g.teleport(e.pos.x + 7, e.pos.z + 7, { yaw: Math.atan2(-7, -7) });
        // Skip the intro shot (it runs on frame time): the clock starts when the boss can fight.
        g.step(30);
        g.ctx.cam.skip();
        for (let i = 0; i < 4; i++) g.step(30);
        g.heal();
        window.__bal.boss = id;
        window.__bal.probe = ({ ctxt: g.ctx.input.context, top: g.top(), st: g.ctx.player.combat.state, mode: g.ctx.player.move && g.ctx.player.move.mode, alive: g.ctx.player.alive, paused: g.ctx.time.isPaused('cine') });
        window.__bal.t0 = g.simTime();
        window.__bal.last = g.ctx.player.stats.hp;
        return id;
      }, { boss: 'durn' });
      assert.ok(b > 0, 'Durn spawns');
      const r = await fightLoop(game, c.maxSeconds);
      await shot('balance-durn');
      console.log(`  durn: ${JSON.stringify(r)}`);
      assert.ok(r.done && !r.dead, 'the bot beats Durn');
      within(assert, 'Durn fight length (s)', r.t, c.expect.ttk);
      within(assert, 'Durn HP lost (% of max)', 100 * r.lost / r.hpMax, c.expect.lostPct);
    },
  },
];
