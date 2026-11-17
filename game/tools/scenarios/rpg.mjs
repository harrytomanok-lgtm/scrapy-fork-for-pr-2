/**
 * rpg package scenarios (ARCHITECTURE 8.8): progression and gear, the shop, Ringstone / shrine / chest, the whole
 * of MQ2 with debug kills, and a mid-quest save round trip. Every scenario starts from the test-mode journey
 * (tutorial=0 shortcut: MQ2 active at the Sparkstead Ringstone).
 */

/** In the page: advance every open dialogue to its end (first visible choice). */
function drainSrc(g) {
  let n = 0;
  while (g.ctx.quests.dialogueOpen && n++ < 80) g.ctx.quests.advance(0);
  return n;
}

const W = 640;
const H = 360;

export const scenarios = [
  {
    name: 'rpg-level-gear',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g) => {
        const s = g.ctx.store.state;
        s.player.autoStyle = 'manual';
        const F = (L) => Math.round(60 * Math.pow(L, 1.5) + 40 * L);
        g.grantXp(F(1) + F(2) + F(3) + F(4));
        const lv = g.ctx.rpg.level;
        const lvHp = g.ctx.player.stats.hp;
        const lvHpMax = g.ctx.player.stats.hpMax;
        const points = g.ctx.rpg.statPoints;
        const levelUps = g.events(['rpg:levelUp']).length;
        const a1 = g.allocate('mgt', 6);
        const a2 = g.allocate('vit', 6);
        const a3 = g.allocate('vit', 1);
        const st = g.ctx.player.stats;
        const before = { hpMax: st.hpMax, melee: st.meleeRating, def: st.defense, res: g.ctx.rpg.resonance(), resStat: st.resonance };
        const uid = g.give('training_wraps', 1, 1);
        const eq = g.ctx.rpg.equip(uid);
        g.step(5);
        const after = { hpMax: st.hpMax, melee: st.meleeRating, res: g.ctx.rpg.resonance(), resEvents: g.events(['rpg:resonance']).length };
        return { lvHp, lvHpMax, lv, points, levelUps, a1, a2, a3, before, after, eq, equipped: g.ctx.rpg.equipped().wraps === uid, hp: st.hp, top: g.top() };
      });
      assert.equal(r.lv, 5, 'XP to level 5');
      assert.equal(r.levelUps, 4, 'one rpg:levelUp per level');
      assert.equal(r.points, 12, 'manual style banks 3 points per level');
      assert.ok(r.a1 && r.a2 && !r.a3, 'allocation spends exactly the banked points');
      // mgt 11, spr 5, vit 11, swf 5 at level 5, awakened
      assert.equal(r.before.hpMax, 100 + 18 * 11 + 6 * 5);
      assert.equal(r.before.melee, 20 + 4 * 11 + 3 * 5);
      assert.equal(r.before.def, 2 * 11 + 5);
      assert.equal(r.before.res, Math.round(40 * 32 * 1.5));
      assert.equal(r.before.resStat, r.before.res);
      assert.ok(r.eq && r.equipped, 'Training Wraps equipped');
      // Training Wraps L1: +round(2 * 1.08) = +2 mgt
      assert.equal(r.after.melee, 20 + 4 * 13 + 3 * 5);
      assert.equal(r.after.res, Math.round(40 * 34 * 1.5));
      assert.equal(r.after.hpMax, r.before.hpMax);
      assert.ok(r.after.resEvents > 0, 'rpg:resonance fired');
      assert.equal(r.lvHp, r.lvHpMax, 'the level-up restore filled HP');
      assert.equal(r.hp, r.lvHp, 'a recompute keeps the current HP');
      assert.equal(r.top, 'hud', 'a level-up never opens a screen');
      await shot('rpg-level-gear');
    },
  },
  {
    name: 'rpg-shop',
    width: W, height: H,
    async run({ game, assert }) {
      const r = await game((g) => {
        g.shells(200);
        const rows = g.ctx.rpg.shop('dov_stall');
        const sun = rows.find((x) => x.itemId === 'sunfruit');
        const shells0 = g.ctx.rpg.shells;
        const count0 = g.ctx.rpg.count('sunfruit');
        const res = g.ctx.rpg.buy('dov_stall', sun.index, 1);
        g.ctx.rpg.buy('dov_stall', sun.index, 1);
        const shells1 = g.ctx.rpg.shells + sun.price;
        const count1 = g.ctx.rpg.count('sunfruit') - 1;
        const poor = g.ctx.rpg.buy('dov_stall', rows.find((x) => x.itemId === 'meadow_garb').index, 9);
        const p = g.ctx.player;
        g.damage(p.id, Math.round(p.stats.hpMax * 0.6), { sourceId: 0 });
        g.step(2);
        const hp0 = p.stats.hp;
        const used = g.ctx.rpg.useItem('sunfruit');
        g.step(75);
        const hp1 = p.stats.hp;
        const sell = g.ctx.rpg.sell(g.ctx.rpg.items().find((x) => x.itemId === 'sunfruit').uid, 1);
        return { rows, sun, res, shells0, shells1, count0, count1, poor, used, hp0, hp1, hpMax: p.stats.hpMax, count2: g.ctx.rpg.count('sunfruit'), sell,
          usedEv: g.events(['rpg:itemUsed']).length };
      });
      assert.equal(r.rows.length, 5, "Dov's stock");
      assert.equal(r.sun.price, 32, 'Sunfruit: 30 + 2 x level 1');
      assert.ok(r.res.ok, 'bought');
      assert.equal(r.shells1, r.shells0 - r.sun.price, 'Shells drop by the price');
      assert.equal(r.count1, r.count0 + 1, 'count rises');
      assert.equal(r.poor.ok, false);
      assert.equal(r.poor.reasonKey, 'rpg.shop.poor');
      assert.ok(r.used, 'Sunfruit used');
      assert.ok(r.hp1 > r.hp0 + r.hpMax * 0.25, 'HP rises by about 30% (' + r.hp0 + ' -> ' + r.hp1 + ')');
      assert.equal(r.usedEv, 1);
      assert.equal(r.sell.ok, true);
      assert.equal(r.sell.shells, 8, 'sell for 25%');
    },
  },
  {
    name: 'rpg-ringstone-shrine-chest',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const rs = await game((g) => {
        const poi = g.pois('ringstone').find((p) => p.id === 'ringstone_sparkstead');
        g.teleport(poi.x + 4, poi.z + 7, { yaw: 0 });
        g.step(3);
        const focus = g.ctx.quests.focus;
        g.press('interact');
        g.step(2);
        const ev = g.events(['ringstone:activated']).at(-1);
        return { focus, ev: ev ? ev.payload : null, respawn: g.state().player.respawn, list: g.state().world.ringstones };
      });
      assert.equal(rs.focus, 'ringstone_sparkstead', 'the Ringstone takes focus');
      assert.ok(rs.ev && rs.ev.id === 'ringstone_sparkstead', 'ringstone:activated');
      assert.equal(rs.respawn, 'ringstone_sparkstead');
      assert.ok(rs.list.includes('ringstone_sparkstead'));
      await shot('rpg-ringstone');

      const sh = await game((g) => {
        const poi = g.pois('shrine')[0];
        g.teleport(poi.x + 1.5, poi.z + 1.5, { yaw: Math.PI * 1.25 });
        g.step(3);
        const tp0 = g.ctx.rpg.tp;
        const focus = g.ctx.quests.focus;
        g.press('interact');
        g.step(2);
        const ev = g.events(['shrine:claimed']).at(-1);
        g.step(2);
        const again = g.ctx.quests.focus;
        return { id: poi.id, focus, tp0, tp1: g.ctx.rpg.tp, ev: ev ? ev.payload : null, list: g.state().world.shrines, again };
      });
      assert.equal(sh.focus, sh.id, 'the shrine takes focus');
      assert.ok(sh.ev && sh.ev.id === sh.id, 'shrine:claimed');
      assert.equal(sh.tp1, sh.tp0 + 1, '+1 TP');
      assert.ok(sh.list.includes(sh.id));
      assert.notEqual(sh.again, sh.id, 'a claimed shrine cannot be used again');
      await shot('rpg-shrine');

      const ch = await game((g) => {
        const poi = g.pois('chest')[0];
        g.teleport(poi.x + 1.5, poi.z + 1.5, { yaw: Math.PI * 1.25 });
        g.step(3);
        const shells0 = g.ctx.rpg.shells;
        const focus = g.ctx.quests.focus;
        g.press('interact');
        g.step(2);
        const ev = g.events(['chest:opened']).at(-1);
        const obj = g.ctx.quests.objects().find((o) => o.id === poi.id);
        return { id: poi.id, focus, shells0, shells1: g.ctx.rpg.shells, ev: ev ? ev.payload : null, list: g.state().world.chests, state: obj && obj.state };
      });
      assert.equal(ch.focus, ch.id, 'the chest takes focus');
      assert.ok(ch.ev && ch.ev.id === ch.id, 'chest:opened');
      assert.ok(ch.shells1 >= ch.shells0 + 60, 'chest Shells (60-150 for tier 1)');
      assert.ok(ch.list.includes(ch.id));
      assert.equal(ch.state, 'open');
      await shot('rpg-chest');
    },
  },
  {
    name: 'rpg-mq2',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        g.god(true);
        const log = [];
        const at = () => (Q.active().find((a) => a.questId === 'mq2') || { stepId: 'done' }).stepId;
        log.push(at());
        Q.talkTo('dov'); d(g); g.step(1);
        log.push(at());
        const sun = g.ctx.rpg.count('sunfruit');
        Q.talkTo('mira'); d(g); g.step(1);
        log.push(at());
        const wraps = g.ctx.rpg.count('training_wraps');
        d(g);
        // The raid: the group plus enough tagged Choir to make four (stand-in groups are smaller).
        const p = g.ctx.player;
        let tagged = g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === 'mq2_raid').length;
        for (; tagged < 4; tagged++) g.ctx.ai.spawn('choir_acolyte', p.pos.x + 6 + tagged, p.pos.y, p.pos.z + 6, { questTag: 'mq2_raid', aggro: false });
        for (const e of g.ctx.ents.list('enemy').filter((x) => x.alive && x.questTag === 'mq2_raid')) g.kill(e.id);
        d(g);
        g.step(2);
        log.push(at());
        d(g);
        const boss = g.ctx.ents.list('boss').find((e) => e.alive);
        if (boss) g.kill(boss.id);
        d(g);
        g.step(3);
        log.push(at());
        Q.talkTo('kerrin'); d(g); g.step(1);
        log.push(at());
        d(g);
        g.goto('siphon_1');
        g.step(2);
        d(g);
        g.step(30);
        log.push(at());
        d(g);
        g.step(1);
        const sip = Q.objects().find((o) => o.id === 'siphon_1');
        return { log, sun, wraps, sipEnt: sip ? sip.entId : 0 };
      }, drainSrc.toString());
      assert.deepEqual(r.log, ['s1', 's2', 's3', 's4', 's5', 's6', 's7'], 'MQ2 steps in order');
      assert.equal(r.sun, 3, 'Dov gives 3 Sunfruit');
      assert.equal(r.wraps, 1, 'Mira gives the Training Wraps');
      assert.ok(r.sipEnt > 0, 'Siphon I is a damageable entity');
      await game((g) => {
        const l = g.ctx.world.landmark('siphon_1');
        g.killAll();
        while (g.ctx.quests.dialogueOpen) g.ctx.quests.advance(0);
        g.step(2);
        g.teleport(l.x + 26, l.z + 34, { yaw: Math.atan2(-26, -34) });
        g.setCamera({ yaw: Math.atan2(-26, -34), pitch: 0.15 });
        g.step(4);
      });
      await shot('rpg-mq2-siphon');

      const f = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        const sip = Q.objects().find((o) => o.id === 'siphon_1');
        const e = g.ctx.ents.get(sip.entId);
        const hp0 = e.stats.hp;
        const def0 = e.stats.defMult;
        g.kill(sip.entId);
        d(g);
        g.step(3);
        const destroyed = g.events(['siphon:state']).some((x) => x.payload.id === 'siphon_1' && x.payload.state === 'destroyed');
        const at = (Q.active().find((a) => a.questId === 'mq2') || { stepId: 'done' }).stepId;
        Q.talkTo('sela');
        const lines = d(g);
        g.step(2);
        const st = g.state();
        return { hp0, def0, destroyed, at, lines, mq2: Q.state('mq2'), forms: st.player.forms, techs: st.player.techs, slots: st.player.slots,
          active: Object.keys(st.quests.active).sort(), siphons: st.world.siphons, done: g.events(['quest:completed']).map((x) => x.payload.questId) };
      }, drainSrc.toString());
      assert.ok(f.hp0 > 0 && (f.def0 === 1 || f.def0 === 10), 'the Siphon core cycles its defense');
      assert.ok(f.destroyed, 'siphon:state destroyed');
      assert.equal(f.at, 's8');
      assert.ok(f.lines >= 6, 'Sela speaks the MQ2 closing lines');
      assert.equal(f.mq2, 'done');
      assert.ok(f.forms.includes('ember'), 'Ember Form unlocked');
      assert.ok(f.techs.includes('nova_ring'), 'Nova Ring unlocked');
      assert.equal(f.slots[0], 'nova_ring', 'Nova Ring in slot 1');
      assert.deepEqual(f.active, ['mq3', 'mq4', 'mq5', 'mq6'], 'four quests started');
      assert.deepEqual(f.siphons, ['siphon_1']);
      assert.ok(f.done.includes('mq2'));
    },
  },
  {
    name: 'rpg-save-load',
    width: W, height: H,
    async run({ game, assert }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        Q.talkTo('dov'); d(g);
        Q.talkTo('mira'); d(g);
        d(g);
        g.step(2);
        const raid = g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === 'mq2_raid');
        if (raid[0]) g.kill(raid[0].id);
        g.step(2);
        const p = g.ctx.player;
        g.ctx.combat.heal(p, -Math.round(p.stats.hpMax * 0.4));
        g.setOra(37);
        g.setSurge(42);
        g.step(1);
        const before = { quests: JSON.parse(JSON.stringify(g.state().quests)), hp: Math.round(p.stats.hp), ora: Math.round(p.stats.ora), surge: Math.round(p.combat.surge),
          inv: JSON.parse(JSON.stringify(g.state().inv)), active: Q.active() };
        const ok = g.save();
        g.grantXp(50);
        g.give('ora_draught', 1);
        Q.completeStep('mq2');
        const loaded = g.load(1);
        g.step(1);
        const q = g.ctx.player;
        const after = { quests: JSON.parse(JSON.stringify(g.state().quests)), hp: Math.round(q.stats.hp), ora: Math.round(q.stats.ora), surge: Math.round(q.combat.surge),
          inv: JSON.parse(JSON.stringify(g.state().inv)), active: Q.active() };
        return { ok, loaded, before, after };
      }, drainSrc.toString());
      assert.ok(r.ok && r.loaded, 'saved and loaded');
      assert.equal(r.before.active[0].stepId, 's3', 'saved mid-quest (MQ2 step 3)');
      assert.deepEqual(r.after.quests, r.before.quests, 'identical quest state');
      assert.deepEqual(r.after.active, r.before.active, 'identical objectives and counts');
      assert.deepEqual(r.after.inv, r.before.inv, 'identical inventory');
      assert.equal(r.after.hp, r.before.hp, 'hp restored');
      assert.equal(r.after.ora, r.before.ora, 'ora restored');
      assert.equal(r.after.surge, r.before.surge, 'surge restored');
    },
  },
  {
    name: 'rpg-race',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g) => {
        const c = g.ctx.defs.find('course', 'windmill_run');
        const shells0 = g.ctx.rpg.shells;
        g.teleport(c.start.x, c.start.z, { yaw: Math.atan2(c.gates[0].x - c.start.x, c.gates[0].z - c.start.z) });
        g.step(3);
        const focus = g.ctx.quests.focus;
        const ok = g.ctx.quests.raceStart('windmill_run');
        const again = g.ctx.quests.raceStart('windmill_run');
        g.step(2);
        return { focus, ok, again, shells0, n: c.gates.length };
      });
      assert.equal(r.focus, 'race_windmill_run', 'the race start takes focus');
      assert.ok(r.ok && !r.again, 'one race at a time');
      await shot('rpg-race-start');
      const e = await game((g) => {
        const c = g.ctx.defs.find('course', 'windmill_run');
        for (const gt of c.gates) {
          const y = g.ctx.world.heightAt(gt.x, gt.z) + gt.alt;
          g.teleport(gt.x, gt.z, { y: y - 1, fly: true });
          g.step(3);
        }
        g.step(2);
        const end = g.events(['race:end']).at(-1);
        return { gates: g.events(['race:gate']).filter((x) => x.payload.courseId === 'windmill_run').length, end: end ? end.payload : null,
          shells: g.ctx.rpg.shells, charm: g.ctx.rpg.count('ember_charm'), rec: g.state().world.races.windmill_run };
      });
      assert.equal(e.gates, r.n, 'race:gate for each of the 14 gates');
      assert.ok(e.end && e.end.finished && e.end.medal === 'gold', 'race:end with a medal');
      assert.equal(e.shells, r.shells0 + 100 + 250 + 500, 'first-time medal rewards');
      assert.equal(e.charm, 1, 'gold reward');
      assert.deepEqual(e.rec.medals, ['bronze', 'silver', 'gold']);
    },
  },
  {
    name: 'rpg-siphon',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g) => {
        g.god(true);
        g.ai(false);
        const o = g.ctx.quests.objects().find((x) => x.id === 'siphon_2');
        g.teleport(o.x + 30, o.z + 30, { yaw: Math.atan2(-30, -30) });
        const e = g.ctx.ents.get(o.entId);
        const states = [];
        const hit = () => {
          const before = e.stats.hp;
          g.ctx.combat.damage({ sourceId: g.ctx.player.id, targetId: e.id, power: 2, kind: 'melee', unblockable: true, canCrit: false });
          return before - e.stats.hp;
        };
        let closed = -1;
        let open = -1;
        // Sim ticks without a render each: 540 queued software-GL frames would stall the screenshot.
        for (let i = 0; i < 9 * 60 && (closed < 0 || open < 0); i++) {
          g.ctx.loop.stepSim(1);
          const st = g.ctx.quests.objects().find((x) => x.id === 'siphon_2').state;
          if (states[states.length - 1] !== st) states.push(st);
          if (st === 'closed' && closed < 0 && i > 2) closed = hit();
          if (st === 'open' && open < 0) open = hit();
        }
        g.kill(e.id);
        g.step(3);
        const ev = g.events(['siphon:state']).filter((x) => x.payload.id === 'siphon_2').map((x) => x.payload.state);
        return { closed, open, states, ev, silenced: g.state().world.siphons, obj: g.ctx.quests.objects().find((x) => x.id === 'siphon_2') };
      });
      assert.ok(r.states.includes('open') && r.states.includes('closed'), 'the core cycles: ' + r.states.join(','));
      assert.ok(r.open > 0 && r.closed > 0, 'both hits land');
      assert.ok(r.closed < r.open * 0.5, 'closed core takes reduced damage (' + r.closed + ' vs ' + r.open + ')');
      assert.ok(r.ev.includes('open') && r.ev.includes('destroyed'), 'siphon:state open ... destroyed');
      assert.ok(r.silenced.includes('siphon_2'));
      assert.equal(r.obj.state, 'destroyed');
      await shot('rpg-siphon-destroyed');
    },
  },
  {
    name: 'rpg-mq1',
    width: W, height: H,
    query: 'tutorial=1',
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        g.god(true);
        const at = () => (Q.active().find((a) => a.questId === 'mq1') || { stepId: 'done' }).stepId;
        const log = [at()];
        d(g);
        g.teleport(-1645, 1856, { yaw: Math.PI });
        g.step(12);
        log.push(at());
        const post = Q.objects().find((o) => o.id === 'training_post');
        if (post && post.entId) g.kill(post.entId);
        d(g);
        g.step(2);
        log.push(at());
        const canFly = g.state().player.canFly;
        Q.completeStep('mq1');
        d(g);
        log.push(at());
        Q.completeStep('mq1');
        d(g);
        g.step(2);
        log.push(at());
        for (const e of g.ctx.ents.list('enemy').filter((x) => x.alive && x.defId === 'ember_wisp')) g.kill(e.id);
        d(g);
        g.step(2);
        log.push(at());
        // the Awakening: Gather at full Ora
        const p = g.ctx.player;
        g.setOra(p.stats.oraMax);
        const res0 = g.ctx.rpg.resonance();
        g.hold('gather', true);
        g.step(10);
        g.setOra(p.stats.oraMax);
        g.step(60);
        g.hold('gather', false);
        g.step(150);
        d(g);
        g.step(2);
        log.push(at());
        const awake = g.state().player.awakened;
        const res1 = g.ctx.rpg.resonance();
        const xp0 = g.ctx.rpg.level * 100000 + g.ctx.rpg.xp;
        for (const e of g.ctx.ents.list('enemy').filter((x) => x.alive && x.defId === 'tusk_boar')) g.kill(e.id);
        d(g);
        g.step(2);
        log.push(at());
        const lvl = g.ctx.rpg.level;
        const rs = g.pois('ringstone').find((x) => x.id === 'ringstone_sparkstead');
        g.teleport(rs.x + 4, rs.z + 7, { yaw: 0 });
        g.step(3);
        g.press('interact');
        g.step(12);
        d(g);
        g.step(2);
        return { log, canFly, awake, res0, res1, lvl, done: Q.state('mq1'), mq2: Q.state('mq2'), techs: g.state().player.techs };
      }, drainSrc.toString());
      assert.equal(r.log[0], 's1');
      assert.equal(r.log[1], 's2', 'reaching the post completes the move beat');
      assert.equal(r.log[2], 's3', 'breaking the post');
      assert.ok(r.canFly, 'tut_fly grants flight');
      assert.equal(r.log[5], 's6', 'four wisps down');
      assert.ok(r.awake, 'the Ora Awakening');
      assert.ok(r.res1 >= r.res0 * 4, 'Resonance rolls up (' + r.res0 + ' -> ' + r.res1 + ')');
      assert.equal(r.log[6], 's7');
      assert.equal(r.log[7], 's8', 'the boars are calmed');
      assert.ok(r.lvl >= 2, 'step 7 XP lands level 2');
      assert.equal(r.done, 'done', 'touching the Ringstone completes MQ1');
      assert.equal(r.mq2, 'active');
      assert.ok(r.techs.includes('gather'));
      await shot('rpg-mq1-end');
    },
  },
  {
    name: 'rpg-finale',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const TAGS = 64 | 128;
        g.god(true);
        g.ai(false);
        g.state();
        g.ctx.store.state.world.siphons.push('siphon_1', 'siphon_2', 'siphon_3', 'siphon_4');
        g.goto('dim_court');
        const bossId = g.startBoss('vorrhal');
        g.step(2);
        d(g);
        g.ctx.quests.runActions([{ op: 'script', script: 'finale_tethers' }]);
        d(g);
        const boss = g.ctx.ents.get(bossId);
        const tagged = boss ? (boss.tags & TAGS) === TAGS : false;
        const p = g.ctx.player;
        const ora0 = p.stats.ora;
        const oras = [];
        const anchors = g.ctx.defs.all('object').filter((o) => o.id.startsWith('tether_')).slice(0, 4);
        for (const a of anchors) {
          g.teleport(a.x + 1, a.z + 1);
          g.step(3);
          g.press('interact');
          g.step(2);
          g.teleport(6, 6, { alt: 4 });
          g.step(3);
          oras.push(Math.round(p.stats.ora));
        }
        d(g);
        g.step(2);
        const b2 = g.ctx.ents.get(bossId);
        return { bossId, tagged, ora0, oras, oraMax: p.stats.oraMax, form: p.combat.formId, cleared: b2 ? (b2.tags & TAGS) === 0 : true,
          toasts: g.events(['ui:toast']).filter((x) => x.payload.key === 'rpg.toast.tether').length };
      }, drainSrc.toString());
      assert.ok(r.bossId > 0, 'Vorrhal spawned');
      assert.ok(r.tagged, 'the boss is tagged scripted and invulnerable');
      assert.equal(r.ora0, 0, 'the Ora is drained');
      assert.equal(r.toasts, 4, 'one tether per silenced Siphon delivered');
      assert.ok(r.oras.every((o) => o >= r.oraMax - 1), 'each delivery refills Ora');
      assert.equal(r.form, 'zenith', 'Zenith after the last thread');
      assert.ok(r.cleared, 'the boss tags are cleared');
      await shot('rpg-finale-zenith');
    },
  },
];
