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
        // Both lines of the Awakening bark are said (queued behind the earlier barks), though the step ended with the first.
        g.step(60 * 12);
        const said = (k) => g.events(['ui:toast']).some((e) => e.payload.key === 'rpg.bark' && e.payload.args && e.payload.args.line === g.ctx.i18n.t(k));
        const awakeLines = [said('mq1.l11'), said('mq1.l12')];
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
        return { log, canFly, awake, res0, res1, lvl, done: Q.state('mq1'), mq2: Q.state('mq2'), techs: g.state().player.techs, awakeLines };
      }, drainSrc.toString());
      assert.equal(r.log[0], 's1');
      assert.equal(r.log[1], 's2', 'reaching the post completes the move beat');
      assert.equal(r.log[2], 's3', 'breaking the post');
      assert.ok(r.canFly, 'tut_fly grants flight');
      assert.equal(r.log[5], 's6', 'four wisps down');
      assert.ok(r.awake, 'the Ora Awakening');
      assert.ok(r.res1 >= r.res0 * 4, 'Resonance rolls up (' + r.res0 + ' -> ' + r.res1 + ')');
      assert.equal(r.log[6], 's7');
      assert.deepEqual(r.awakeLines, [true, true], 'both Awakening lines are said');
      assert.equal(r.log[7], 's8', 'the boars are calmed');
      assert.ok(r.lvl >= 2, 'step 7 XP lands level 2');
      assert.equal(r.done, 'done', 'touching the Ringstone completes MQ1');
      assert.equal(r.mq2, 'active');
      assert.ok(r.techs.includes('gather'));
      await shot('rpg-mq1-end');
    },
  },
  {
    // The returning player's offer: Skip the training lands at the Sparkstead Ringstone with MQ1 done and MQ2 on;
    // a new journey after a saved one past MQ1 opens with the offer instead of the drills.
    name: 'rpg-mq1-skip',
    width: W, height: H,
    query: 'tutorial=1',
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        d(g);
        g.step(5);
        const xp0 = g.ctx.rpg.xp;
        Q.talk('mq1_skip', {});
        const first = Q.dialogueState();
        Q.advance(1);
        g.step(5);
        d(g);
        g.step(5);
        const p = g.ctx.player;
        const rs = g.pois('ringstone').find((x) => x.id === 'ringstone_sparkstead');
        const out = { first, mq1: Q.state('mq1'), mq2: Q.state('mq2'), lvl: g.ctx.rpg.level, xp0, fly: g.state().player.canFly, awake: g.state().player.awakened,
          techs: g.state().player.techs.slice(), dist: Math.round(Math.hypot(p.pos.x - rs.x, p.pos.z - rs.z)), attuned: g.state().world.ringstones.slice(),
          tutEnemies: g.ctx.ents.list('enemy').filter((e) => e.alive && String(e.questTag || '').startsWith('mq1_')).length };
        // A second journey: the saved one is past MQ1, so the opening is the offer.
        g.save();
        g.ctx.session.start({ slot: 1, newGame: true });
        out.offer = Q.dialogueState();
        out.mq1b = Q.state('mq1');
        d(g);
        return out;
      }, drainSrc.toString());
      console.log('    ' + JSON.stringify(r));
      assert.equal(r.first && r.first.dialogueId, 'mq1_skip');
      assert.equal(r.mq1, 'done', 'Skip completes MQ1');
      assert.equal(r.mq2, 'active', 'MQ2 starts');
      assert.ok(r.lvl >= 2, 'MQ1 XP granted (level ' + r.lvl + ')');
      assert.ok(r.fly && r.awake && r.techs.includes('gather'), 'flight, the Awakening and Gather granted');
      assert.ok(r.dist < 20, 'at the Sparkstead Ringstone (' + r.dist + ' m)');
      assert.ok(r.attuned.includes('ringstone_sparkstead'), 'the Ringstone is attuned');
      assert.equal(r.tutEnemies, 0, 'no tutorial enemies left');
      assert.equal(r.offer && r.offer.dialogueId, 'mq1_skip', 'a returning player is offered the skip');
      await shot('rpg-mq1-skip');
    },
  },
  {
    // Ora shards: a fixed set per region, collected by flying through them (the pickup system), a counter for the
    // map, a light column on the nearest, TP at five, and the region's viewpoint revealing its places.
    name: 'rpg-shards',
    width: 412, height: 915,
    query: 'res=1&quality=low',
    async run({ game, assert, shot }) {
      const a = await game((g) => {
        const Q = g.ctx.quests;
        g.god(true);
        const s0 = Q.shards();
        const meadows = s0.list.filter((s) => s.regionId === 'meadows');
        const view = meadows.find((s) => s.view);
        const sky = meadows.find((s) => s.kind === 'sky');
        // Approach the sky shard in flight from 120 m and look at its light column.
        g.teleport(sky.x - 120, sky.z, { alt: sky.y - g.heightAt(sky.x - 120, sky.z), fly: true, yaw: Math.PI / 2 });
        g.step(25);
        // Every shard clear of the world's colliders as the browser has them (structures, places, props).
        const inside = [];
        const out = [];
        for (const s of s0.list) {
          const n = g.ctx.world.queryColliders(s.x, s.z, 4, out);
          for (let i = 0; i < n; i++) {
            const c = out[i];
            if (!c || !(c.flags & 1)) continue;
            const dh = Math.hypot(s.x - c.x, s.z - c.z);
            const r = (c.r || Math.max(c.hx || 0, c.hz || 0)) + 0.4;
            const y0 = c.shape === 'sphere' ? c.y - r : c.y;
            const y1 = c.shape === 'sphere' ? c.y + r : c.y + (c.h || 0) + (c.shape === 'capsule' ? c.r : 0);
            const hit = c.shape === 'sphere' ? Math.hypot(dh, s.y - c.y) < r : dh < r && s.y >= y0 && s.y <= y1;
            if (hit) inside.push(s.id + ' in ' + c.shape);
          }
        }
        return { total: s0.total, regions: s0.regions.map((r) => r.id + ':' + r.total), kinds: [...new Set(s0.list.map((s) => s.kind))], view, sky, tp0: g.state().player.tp, inside };
      });
      await game((g) => g.ctx.cam.setOrbit(Math.PI / 2, 0.1));
      await game((g) => g.step(4));
      await shot('rpg-shards-01-beacon');
      const b = await game((g, a) => {
        const Q = g.ctx.quests;
        const pickups = g.ctx.ents.list('pickup').filter((e) => e.alive && e.data && String(e.data.itemId).startsWith('shard_')).length;
        // Fly past 10 m from it: the flight magnet takes it.
        g.teleport(a.sky.x - 8, a.sky.z + 6, { alt: a.sky.y - g.heightAt(a.sky.x - 8, a.sky.z + 6), fly: true, yaw: Math.PI / 2 });
        for (let i = 0; i < 12 && Q.shards().found === 0; i++) g.step(5);
        const afterPass = Q.shards().found;
        // The viewpoint: the region's highest peak.
        g.teleport(a.view.x, a.view.z, { alt: 2, fly: true });
        g.step(40);
        const st = Q.shards();
        const vb = g.events(['ui:banner']).find((e) => e.payload.key === 'rpg.banner.viewpoint');
        return { pickups, afterPass, found: st.found, revealed: st.revealed.includes('meadows'), disc: vb ? vb.payload.args.n : 0 };
      }, a);
      // Five shards: +1 TP.
      const c = await game((g) => {
        const Q = g.ctx.quests;
        for (const s of Q.shards().list.filter((x) => !x.found).slice(0, 3)) {
          g.teleport(s.x, s.z, { alt: s.y - g.heightAt(s.x, s.z), fly: true });
          g.step(30);
        }
        const banner = g.events(['ui:banner']).some((e) => e.payload.key === 'rpg.banner.shardsTp');
        return { found: Q.shards().found, tp: g.state().player.tp, saved: (g.state().quests.flags['ora.shards'] || []).length, banner };
      });
      console.log('    ' + JSON.stringify({ a: { total: a.total, regions: a.regions, kinds: a.kinds, inside: a.inside }, b, c }));
      assert.ok(a.total >= 40, 'about eight shards in each of six regions (' + a.total + ')');
      assert.deepEqual(a.inside, [], 'no shard inside a collider');
      assert.deepEqual(a.kinds.sort(), ['islet', 'peak', 'roof', 'sky'].filter((k) => a.kinds.includes(k)).sort());
      assert.ok(a.kinds.includes('peak') && a.kinds.includes('sky') && a.kinds.includes('roof'), 'peaks, open air and roofs');
      assert.ok(b.pickups >= 1, 'the nearby shard stands as a pickup');
      assert.equal(b.afterPass, 1, 'flying past collects it');
      assert.ok(b.revealed && b.disc > 3, 'the viewpoint puts the region on the map (' + b.disc + ' places)');
      assert.equal(c.found, 5);
      assert.equal(c.saved, 5, 'the count is kept in the journey');
      assert.ok(c.banner && c.tp > a.tp0, 'five shards: +1 TP (with the level-ups of their XP)');
    },
  },
  {
    // After the ending: Ringstone travel, the menu, a boss rematch at a higher level with a medal, a timed trial and
    // the Spire Circuit.
    name: 'rpg-after-ending',
    width: 412, height: 915,
    query: 'res=1&quality=low',
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        const st = g.ctx.store.state;
        g.god(true);
        g.setLevel(30);
        st.quests.flags.credits = true;
        for (const b of ['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal']) if (st.world.bosses.indexOf(b) < 0) st.world.bosses.push(b);
        for (const id of ['ringstone_tide_beacon', 'ringstone_copperwatch']) {
          st.world.ringstones.push(id);
          st.quests.flags['attuned.' + id] = true;
        }
        const out = {};
        // Travel by the service (the map screen's call) and by the menu.
        out.travel = Q.travel('ringstone_tide_beacon');
        const rs = g.pois('ringstone').find((x) => x.id === 'ringstone_tide_beacon');
        out.travelDist = Math.round(Math.hypot(g.ctx.player.pos.x - rs.x, g.ctx.player.pos.z - rs.z));
        out.badTravel = Q.travel('ringstone_ridgerest');
        Q.talk('ringstone_menu', {});
        out.menu = Q.dialogueState();
        Q.advance(1); // Travel
        out.travelNode = Q.dialogueState() && Q.dialogueState().nodeId;
        Q.advance(2); // the third attuned stone listed: Copperwatch (Sparkstead, Tide Beacon, Copperwatch)
        g.step(5);
        const cw = g.pois('ringstone').find((x) => x.id === 'ringstone_copperwatch');
        out.menuTravelDist = Math.round(Math.hypot(g.ctx.player.pos.x - cw.x, g.ctx.player.pos.z - cw.z));
        d(g);
        // A rematch with Durn.
        Q.runActions([{ op: 'script', script: 'rematch_durn' }]);
        g.step(10);
        const boss = g.ctx.ents.list('boss').find((b) => b.alive && b.defId === 'durn');
        out.bossLevel = boss ? boss.level : 0;
        for (let i = 0; i < 40 && boss && boss.alive && !st.quests.flags['rematch.durn']; i++) {
          g.damage(boss.id, 0.2);
          g.step(20);
        }
        g.step(600);
        out.rematch = st.quests.flags['rematch.durn'];
        // The gauntlet trial.
        Q.runActions([{ op: 'script', script: 'trial_gauntlet' }]);
        g.step(10);
        out.trialFoes = g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === 'trial_trial_gauntlet').length;
        for (let i = 0; i < 6; i++) {
          for (const e of g.ctx.ents.list('enemy').filter((x) => x.alive && x.questTag === 'trial_trial_gauntlet')) g.kill(e.id);
          g.step(20);
        }
        out.trial = st.quests.flags['trial.trial_gauntlet'];
        // Lose the wave trial, take the Retry: back on the Ledge with the first wave.
        Q.runActions([{ op: 'script', script: 'trial_waves' }]);
        g.step(10);
        g.god(false);
        g.kill(g.player().id);
        g.step(5);
        out.canRetry = g.ctx.rpg.canRetry;
        g.ctx.rpg.respawn({ retry: true });
        g.god(true);
        g.step(10);
        out.retryFoes = g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === 'trial_trial_waves').length;
        out.retryDist = Math.round(Math.hypot(g.ctx.player.pos.x + 1650, g.ctx.player.pos.z - 1835));
        for (const e of g.ctx.ents.list('enemy').filter((x) => x.alive && x.questTag === 'trial_trial_waves')) g.ctx.ai.despawn(e.id);
        Q.runActions([]);
        // A wave that cannot spawn is never a cleared wave: the trial ends without a medal.
        const sg = g.ctx.ai.spawnGroup;
        g.ctx.ai.spawnGroup = () => [];
        const rec0 = JSON.stringify(st.quests.flags['trial.trial_waves'] || null);
        Q.runActions([{ op: 'script', script: 'trial_waves' }]);
        g.step(60 * 7);
        g.ctx.ai.spawnGroup = sg;
        out.noSpawn = { rec: JSON.stringify(st.quests.flags['trial.trial_waves'] || null) === rec0,
          failed: g.events(['ui:toast']).some((e) => e.payload.key === 'rpg.toast.trialFailed') };
        // The Spire Circuit; a second start while it runs is refused where the player is.
        Q.runActions([{ op: 'script', script: 'trial_sky' }]);
        g.step(5);
        g.teleport(g.ctx.player.pos.x + 50, g.ctx.player.pos.z, { alt: 20 });
        const px = g.ctx.player.pos.x;
        Q.runActions([{ op: 'script', script: 'trial_sky' }]);
        out.skyRefused = Math.abs(g.ctx.player.pos.x - px) < 1 && g.events(['ui:toast']).some((e) => e.payload.key === 'rpg.toast.busyRace');
        // Travel and a rematch refused during the race: each says why.
        const nRace = () => g.events(['ui:toast']).filter((e) => e.payload.key === 'rpg.toast.busyRace').length;
        const n0 = nRace();
        out.travelInRace = Q.travel('ringstone_copperwatch');
        Q.runActions([{ op: 'script', script: 'rematch_durn' }]);
        out.raceToasts = nRace() - n0;
        out.race = g.ctx.quests.objects().length > 0 && g.ctx.player.move.mode;
        return out;
      }, drainSrc.toString());
      const ms = await game((g) => {
        g.step(30);
        g.ctx.world.flushBuilds();
        const t0 = performance.now();
        g.render();
        const t1 = performance.now();
        g.render();
        return [Math.round(t1 - t0), Math.round(performance.now() - t1), g.cmd.drawBreakdown ? JSON.stringify(g.cmd.drawBreakdown()).slice(0, 300) : ''];
      });
      console.log('    render ms ' + JSON.stringify(ms));
      // A screenshot can time out on a loaded machine: one retry, then go on (the assertions do not need it).
      for (let k = 0; k < 2; k++) {
        try {
          await shot('rpg-after-ending-circuit');
          break;
        } catch (err) {
          console.log('    shot retry: ' + String(err).split('\n')[0]);
        }
      }
      console.log('    ' + JSON.stringify(r));
      assert.ok(r.travel && r.travelDist < 15, 'travel to an attuned Ringstone');
      assert.equal(r.badTravel, false, 'not to a stone never touched');
      assert.equal(r.menu && r.menu.dialogueId, 'ringstone_menu');
      assert.equal(r.travelNode, 'travel');
      assert.ok(r.menuTravelDist < 15, 'the menu travels too');
      assert.ok(r.bossLevel > 4, 'the rematch is above the first fight (level ' + r.bossLevel + ')');
      assert.ok(r.rematch && r.rematch.medals.length >= 1, 'the rematch records a medal');
      assert.ok(r.trialFoes >= 4, 'the gauntlet band spawns');
      assert.ok(r.trial && r.trial.medals.length >= 1 && r.trial.best > 0, 'the trial records a time and a medal');
      assert.ok(r.noSpawn.rec && r.noSpawn.failed, 'a wave that never spawned fails the trial, no medal');
      assert.ok(r.skyRefused, 'a refused Spire Circuit leaves the player where they are');
      assert.equal(r.travelInRace, false, 'no travel during a race');
      assert.equal(r.raceToasts, 2, 'the refused travel and rematch each say why');
      assert.ok(r.canRetry, 'a lost trial offers Retry');
      assert.ok(r.retryFoes >= 1 && r.retryDist < 30, 'Retry puts the player back in the trial (' + r.retryFoes + ' foes, ' + r.retryDist + ' m)');
    },
  },
  {
    // A rematch is one attempt: Rise cancels it for good (Sparkstead, Durn's arena and the hub, stays quiet); Retry
    // restarts it, and a retried win pays its medals once.
    name: 'rpg-rematch-retry',
    width: W, height: H,
    async run({ game, assert }) {
      const r = await game((g) => {
        const Q = g.ctx.quests;
        const st = g.ctx.store.state;
        const out = {};
        g.setLevel(20);
        st.quests.flags.credits = true;
        st.world.bosses.push('durn');
        const bossOf = () => g.ctx.ents.list('boss').filter((b) => b.alive && b.defId === 'durn');
        // 1. Rematch, die, Rise, walk back into Sparkstead.
        Q.runActions([{ op: 'script', script: 'rematch_durn' }]);
        g.step(30);
        out.level = (bossOf()[0] || {}).level || 0;
        g.kill(g.player().id);
        g.step(100);
        g.ctx.rpg.respawn({ retry: false });
        g.step(30);
        const lm = g.ctx.world.landmark('sparkstead');
        for (let i = 0; i < 4; i++) {
          g.teleport(lm.x + i * 8, lm.z + 10, {});
          g.step(40);
        }
        out.afterRise = bossOf().length;
        out.aiBoss = !!g.ctx.ai.boss;
        // 2. Rematch, die, Retry, win.
        const shells0 = st.inv.shells;
        Q.runActions([{ op: 'script', script: 'rematch_durn' }]);
        g.step(30);
        g.kill(g.player().id);
        g.step(100);
        out.canRetry = g.ctx.rpg.canRetry;
        g.ctx.rpg.respawn({ retry: true });
        g.god(true);
        g.step(40);
        const b2 = bossOf()[0];
        out.retried = !!b2;
        out.retryLevel = b2 ? b2.level : 0;
        out.addLevels = [];
        for (let i = 0; i < 60 && b2 && b2.alive && !st.quests.flags['rematch.durn']; i++) {
          g.damage(b2.id, 0.2);
          g.step(20);
          for (const e of g.ctx.ents.list('enemy')) if (e.alive && e.defId === 'choir_acolyte' && out.addLevels.indexOf(e.level) < 0) out.addLevels.push(e.level);
        }
        g.step(300);
        out.record = st.quests.flags['rematch.durn'];
        out.paid = st.inv.shells - shells0;
        out.pendingAfterWin = bossOf().length;
        g.god(false);
        return out;
      });
      console.log('    ' + JSON.stringify(r));
      assert.ok(r.level > 4, 'the rematch runs at a raised level');
      assert.equal(r.afterRise, 0, 'Rise cancels the rematch: no boss in Sparkstead');
      assert.equal(r.aiBoss, false);
      assert.ok(r.canRetry, 'the death screen can Retry the rematch');
      assert.ok(r.retried && r.retryLevel === r.level, 'Retry restarts it at the same level');
      assert.ok(r.record && r.record.medals.length >= 1, 'the retried win records its medal');
      assert.ok(r.addLevels.length > 0 && r.addLevels.every((l) => l === r.level), 'the adds come at the rematch level (' + r.addLevels + ')');
      const once = { bronze: 300, silver: 600, gold: 1200 };
      const want = r.record.medals.reduce((a, m) => a + once[m], 0);
      assert.ok(r.paid >= want && r.paid < want + 400, 'the medals are paid once (' + r.paid + ' for ' + r.record.medals.join(',') + ')');
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
  {
    // A journey loaded in the middle of a step rebuilds what that step's onStart set up (S3), and several pending
    // quest bosses never orphan each other (S1): kill steps with script-spawned enemies (MQ1 s5, MQ4 s3), a destroy
    // step (MQ2 s7), three boss steps at once (MQ3 s4, MQ5 s3, and the finale MQ7 s3).
    name: 'rpg-resume',
    width: W, height: H,
    async run({ game, assert, shot }) {
      const r = await game((g, drain) => {
        const d = (0, eval)('(' + drain + ')');
        const Q = g.ctx.quests;
        const tagged = (tag) => g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === tag && e.combat.state !== 'dead');
        const bosses = () => g.ctx.ents.list('boss').filter((e) => e.alive && e.combat.state !== 'dead').map((e) => e.defId);
        const stepOf = (id) => (Q.active().find((a) => a.questId === id) || { stepId: Q.state(id) }).stepId;
        g.god(true);
        let q = g.ctx.store.state.quests;
        q.done = q.done.filter((x) => x !== 'mq1');
        q.active.mq1 = { step: 4, counts: { s5: 1 } };
        q.active.mq2 = { step: 6, counts: {} };
        q.active.mq4 = { step: 2, counts: { s3: 5 } };
        const saved1 = g.save();
        const loaded1 = g.load(1);
        const dlg1 = Q.dialogueState();
        d(g);
        g.step(3);
        const a = {
          saved: saved1, loaded: loaded1, dialogue: dlg1 && dlg1.dialogueId,
          steps: [stepOf('mq1'), stepOf('mq2'), stepOf('mq4')],
          wisps: tagged('mq1_wisps').length, wave: tagged('mq4_wave').length,
          siphon: (Q.objects().find((o) => o.id === 'siphon_1') || {}).entId || 0,
          markers: Q.markers().map((m) => m.questId),
        };
        d(g);
        for (const e of tagged('mq1_wisps')) g.kill(e.id);
        for (const e of tagged('mq4_wave')) g.kill(e.id);
        d(g);
        g.step(3);
        d(g);
        a.after = [stepOf('mq1'), stepOf('mq4')];

        // Three boss steps pending at once, then a load.
        q = g.ctx.store.state.quests;
        q.active = { mq3: { step: 3, counts: {} }, mq5: { step: 2, counts: {} }, mq7: { step: 2, counts: {} } };
        if (q.done.indexOf('mq2') < 0) q.done.push('mq2');
        if (q.done.indexOf('mq1') < 0) q.done.push('mq1');
        const saved2 = g.save();
        const nBanners = g.events(['ui:banner']).length;
        const loaded2 = g.load(1);
        const dlg2 = Q.dialogueState();
        d(g);
        g.step(3);
        const b = { saved: saved2, loaded: loaded2, dialogue: dlg2 && dlg2.dialogueId, atLoad: bosses(),
          bossBanners: g.events(['ui:banner']).slice(nBanners).filter((x) => x.payload.kind === 'boss').length };
        const visit = (lm) => {
          g.goto(lm);
          g.step(40);
          return bosses().join(',');
        };
        b.visits = [visit('bramble_hollow'), visit('burrow_pit'), visit('bramble_hollow')];
        const bh = g.ctx.ents.list('boss').find((e) => e.alive && e.defId === 'bramblehorn');
        if (bh) g.kill(bh.id);
        d(g);
        g.step(5);
        d(g);
        b.mq3 = stepOf('mq3');
        b.visits.push(visit('burrow_pit'), visit('dim_court'));
        b.mq5 = stepOf('mq5');
        b.mq7 = stepOf('mq7');
        return { a, b };
      }, drainSrc.toString());
      const { a, b } = r;
      assert.ok(a.saved && a.loaded, 'saved and loaded inside MQ1 s5, MQ2 s7 and MQ4 s3');
      assert.deepEqual(a.steps, ['s5', 's7', 's3'], 'the steps resume');
      assert.ok(!a.dialogue, 'a resumed step does not replay its story line (' + a.dialogue + ')');
      assert.equal(a.wisps, 3, 'MQ1 s5: the three wisps the step still needs drift in again');
      assert.equal(a.wave, 3, 'MQ4 s3: the three Choir the step still needs come back');
      assert.ok(a.siphon > 0, 'MQ2 s7: the Siphon to destroy stands');
      for (const id of ['mq1', 'mq2', 'mq4']) assert.ok(a.markers.includes(id), 'a marker for ' + id + ' (' + a.markers.join(',') + ')');
      assert.deepEqual(a.after, ['s6', 's4'], 'the rebuilt enemies finish their steps');
      assert.ok(b.saved && b.loaded, 'saved and loaded with three boss steps open');
      assert.ok(!b.dialogue, 'no story line on load (' + b.dialogue + ')');
      assert.ok(b.atLoad.length <= 1, 'at most one boss spawned at a time (' + b.atLoad.join(',') + ')');
      assert.equal(b.bossBanners, 0, 'a resumed boss skips its intro');
      assert.deepEqual(b.visits.slice(0, 3), ['bramblehorn', 'gorrumaw', 'bramblehorn'], 'each pending boss returns at its arena: ' + b.visits.join(' | '));
      assert.equal(b.mq3, 's5', 'Bramblehorn defeated after the switches');
      assert.equal(b.visits[3], 'gorrumaw', 'Gorrumaw is still pending after Bramblehorn falls');
      assert.equal(b.visits[4], 'vorrhal', 'the finale boss is still pending');
      assert.equal(b.mq5, 's3');
      assert.equal(b.mq7, 's3');
      await shot('rpg-resume-vorrhal');
    },
  },
  {
    // S2 (the MQ4 pillar stands again), S7 (death ends a race), S8 (bag-full items become Shells), and a fallen
    // Siphon's guards are dispelled.
    name: 'rpg-fixes',
    width: W, height: H,
    async run({ game, assert }) {
      const r = await game((g) => {
        const Q = g.ctx.quests;
        const out = {};
        // S8: Sunfruit at the cap; a quest gives three more.
        g.give('sunfruit', 9);
        const cap = g.ctx.rpg.count('sunfruit');
        const shells0 = g.ctx.rpg.shells;
        const t0 = g.events(['ui:toast']).length;
        Q.runActions([{ op: 'giveItem', item: 'sunfruit', count: 3 }]);
        out.s8 = { cap, after: g.ctx.rpg.count('sunfruit'), shells: g.ctx.rpg.shells - shells0,
          toasts: g.events(['ui:toast']).slice(t0).map((x) => x.payload.key) };
        // S2: the saltglass pillar is broken before the Dawn Lance step.
        const q = g.ctx.store.state.quests;
        delete q.active.mq2;
        if (q.done.indexOf('mq2') < 0) q.done.push('mq2');
        Q.start('mq4');
        g.step(2);
        const pil0 = (Q.objects().find((o) => o.id === 'saltglass_pillar') || {}).entId || 0;
        if (pil0) g.kill(pil0);
        g.step(3);
        const mid = (Q.objects().find((o) => o.id === 'saltglass_pillar') || {}).entId || 0;
        g.step(120);
        const pil1 = (Q.objects().find((o) => o.id === 'saltglass_pillar') || {}).entId || 0;
        out.s2 = { pil0, mid, pil1, flag: !!q.flags['obj.saltglass_pillar.destroyed'] };
        // Siphon guards: wake siphon_1, then silence it.
        const sp = Q.objects().find((o) => o.id === 'siphon_1');
        g.ai(true);
        g.god(true);
        g.goto('siphon_1');
        g.step(20);
        const guards = () => g.ctx.ents.list('enemy').filter((e) => e.alive && e.questTag === 'siphon_1_guard').length;
        const woke = guards();
        if (sp && sp.entId) g.kill(sp.entId);
        g.step(3);
        out.guards = { woke, after: guards() };
        // S7: a race, then death.
        g.god(false);
        const course = g.ctx.defs.all('course')[0];
        g.teleport(course.start.x + 2, course.start.z + 2);
        g.step(2);
        const started = Q.raceStart(course.id);
        g.step(10);
        const e0 = g.events(['race:end']).length;
        g.kill(g.ctx.player.id);
        g.step(3);
        const ends = g.events(['race:end']).slice(e0);
        out.s7 = { started, ended: ends.length, finished: ends.length ? ends[0].payload.finished : null, again: Q.raceStart(course.id) };
        Q.raceAbort();
        return out;
      });
      assert.equal(r.s8.cap, r.s8.after, 'the bag stays at the cap');
      assert.ok(r.s8.shells > 0, 'the overflow is sold for Shells (+' + r.s8.shells + ')');
      assert.ok(r.s8.toasts.includes('rpg.toast.bagFull'), 'the toast says what happened: ' + r.s8.toasts.join(','));
      assert.ok(!r.s8.toasts.includes('rpg.toast.item'), 'no toast claims items that were not added');
      assert.ok(r.s2.pil0 > 0, 'the pillar is built with MQ4');
      assert.equal(r.s2.mid, 0, 'it shatters');
      assert.ok(r.s2.pil1 > 0 && r.s2.pil1 !== r.s2.pil0, 'and stands again');
      assert.ok(!r.s2.flag, 'never flagged destroyed');
      assert.ok(r.guards.woke > 0, 'the Siphon woke its guards (' + r.guards.woke + ')');
      assert.equal(r.guards.after, 0, 'its fall dispels them');
      assert.ok(r.s7.started, 'race started');
      assert.equal(r.s7.ended, 1, 'death ends the race');
      assert.equal(r.s7.finished, false);
      assert.ok(r.s7.again, 'the race can be started again');
    },
  },
];
