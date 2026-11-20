/**
 * Combat technique engine (ARCHITECTURE 8.6 DoD): timelines and chains, charge scaling, rank mods for every P0
 * rank, cooldown reduction cap, Surge gains and decay, Form drain to Burnout and lockouts, regen rules, the
 * entity-inside-collider bolt rule, one dash press = one Flicker, technique data validation.
 */
import { STYLE } from '../../src/combat/logic/style.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './fakeCtx.mjs';
import { BALANCE } from '../../src/core/balance.js';
import * as F from '../../src/core/formulas.js';
import { IDS } from '../../src/core/ids.js';
import { playerTechniques, PLAYER_TECH_IDS } from '../../src/combat/data/techniques.js';
import { formDefs, techNodeDefs } from '../../src/combat/data/forms.js';
import { resolveRank } from '../../src/combat/logic/rank.js';
import { COMBAT_STRINGS } from '../../src/combat/strings.js';

const T = BALANCE.tech;
const byId = Object.fromEntries(playerTechniques().map((t) => [t.id, t]));
const sum = (list) => list.reduce((a, b) => a + b, 0);

test('technique data: ids, clip / vfx / sfx / feel ids in IDS, positive timelines, numbers from BALANCE', () => {
  assert.deepEqual(Object.keys(byId).sort(), [...PLAYER_TECH_IDS].sort());
  for (const id of PLAYER_TECH_IDS) assert.ok(IDS.technique.includes(id), id);
  for (const t of Object.values(byId)) {
    const steps = t.chain || [t];
    for (const s of steps) {
      for (const k of ['windup', 'active', 'recover']) {
        assert.ok(s.timeline[k] >= 0, `${t.id} ${k}`);
        assert.ok(IDS.clip.includes(s.anim[k]), `${t.id} clip ${s.anim[k]}`);
      }
      for (const h of s.hits || t.hits) assert.ok(IDS.feel.includes(h.feel), `${t.id} feel ${h.feel}`);
    }
    assert.ok(t.timeline.windup + t.timeline.active + t.timeline.recover >= 0);
    for (const p of t.projectiles) {
      assert.ok(IDS.vfx.includes(p.fxId) && IDS.feel.includes(p.feel), t.id);
      assert.ok(p.speed > 0 && p.life > 0);
    }
    for (const k of Object.keys(t.fx)) if (k !== 'color') assert.ok(IDS.vfx.includes(t.fx[k]), `${t.id} fx ${t.fx[k]}`);
    for (const k of Object.keys(t.sfx)) assert.ok(IDS.sfx.includes(t.sfx[k]), `${t.id} sfx ${t.sfx[k]}`);
    if (t.beam) assert.ok(IDS.feel.includes(t.beam.feel));
    assert.equal(t.ranks.length, Math.max(1, (T[t.id].ranks || [1]).length), `${t.id} ranks`);
  }
  // Numbers equal BALANCE.tech.
  assert.deepEqual(byId.strike_string.chain.slice(0, 5).map((s) => s.hits[0].power), T.strike_string.hits.map((h) => h.power));
  assert.deepEqual(byId.strike_string.chain.slice(0, 5).map((s) => s.hits[0].poise), T.strike_string.hits.map((h) => h.poise));
  for (const s of byId.strike_string.chain) assert.ok(Math.abs(s.timeline.windup + s.timeline.active + s.timeline.recover - T.strike_string.hitSeconds) < 1e-9);
  assert.equal(byId.breaker.hits[0].power, T.breaker.power);
  assert.equal(byId.breaker.cooldown, T.breaker.cooldown);
  assert.equal(byId.meteor_heel.cost.ora, T.meteor_heel.ora);
  assert.equal(byId.meteor_heel.crater.radius, T.meteor_heel.crater.radius);
  assert.equal(byId.ora_bolt.projectiles[0].power, T.ora_bolt.power);
  assert.equal(byId.ora_bolt.cost.ora, T.ora_bolt.ora);
  assert.equal(byId.flare_barrage.projectiles[0].every, 1 / T.flare_barrage.boltsPerSec);
  assert.equal(byId.dawn_lance.beam.power, T.dawn_lance.beam.power);
  assert.equal(byId.dawn_lance.timeline.active, T.dawn_lance.beam.seconds);
  assert.equal(byId.nova_ring.hits[0].radius, T.nova_ring.radius);
  assert.equal(byId.ringfall.hits[0].power, T.ringfall.powerCentre);
  assert.equal(byId.ringfall.hits[0].edgePower, T.ringfall.powerEdge);
  assert.equal(byId.ringfall.cost.surge, T.ringfall.surge);
  assert.equal(byId.flicker_step.motion.dist, T.flicker_step.dist);
  assert.equal(byId.flicker_step.cost.ora, T.flicker_step.ora);
});

test('forms, nodes and strings', () => {
  const forms = formDefs();
  assert.deepEqual(forms.map((f) => f.id), IDS.form);
  for (const f of forms) {
    assert.equal(f.cost, BALANCE.forms[f.id].cost);
    assert.equal(f.drain, BALANCE.forms[f.id].drain);
  }
  const nodes = techNodeDefs();
  const ids = new Set(nodes.map((n) => n.id));
  assert.equal(ids.size, nodes.length);
  for (const n of nodes) {
    if (n.requires && n.requires.node) assert.ok(ids.has(n.requires.node), n.id);
    if (n.passive) for (const k of Object.keys(n.passive)) assert.ok(IDS.modKey.includes(k), k);
  }
  assert.ok(ids.has('strike_string_r2') && ids.has('dawn_lance_r3') && ids.has('flare_barrage_r1') && ids.has('iron_fists_3') && ids.has('second_breath_1'));
  for (const k of Object.keys(COMBAT_STRINGS.en)) assert.ok(typeof COMBAT_STRINGS.he[k] === 'string' && COMBAT_STRINGS.he[k].length > 0, k);
});

test('rank mods for every P0 rank', () => {
  const r = (id, rank) => resolveRank(byId[id], rank);
  assert.equal(r('strike_string', 1).chainSteps, 5);
  assert.equal(r('strike_string', 2).chainSteps, 6);
  assert.ok(Math.abs(r('strike_string', 3).chain[0].hits[0].power - T.strike_string.hits[0].power * 1.2) < 1e-9);
  assert.equal(r('strike_string', 3).chainSteps, 6);
  assert.equal(r('breaker', 2).hits[0].unblockable, 1);
  assert.equal(r('breaker', 2).hits[0].poise, T.breaker.poise * 1.5);
  assert.ok(Math.abs(r('meteor_heel', 2).hits[0].power - T.meteor_heel.power * 1.25) < 1e-9);
  assert.equal(r('meteor_heel', 2).crater.radius, 9);
  assert.equal(r('ora_bolt', 2).projectiles[0].count, 2);
  assert.ok(Math.abs(r('ora_bolt', 2).projectiles[0].power - T.ora_bolt.power * 0.6) < 1e-9);
  assert.equal(r('ora_bolt', 3).projectiles[0].pierce, 1);
  assert.equal(r('ora_bolt', 3).projectiles[0].count, 2, 'ranks are cumulative');
  assert.equal(r('flare_barrage', 1).projectiles[1].count, 0);
  assert.equal(r('flare_barrage', 2).projectiles[1].count, 1);
  assert.equal(r('dawn_lance', 2).beam.radius, 1.8);
  assert.ok(Math.abs(r('dawn_lance', 3).beam.power - T.dawn_lance.beam.power * 1.3) < 1e-9);
  assert.equal(r('nova_ring', 2).hits[0].radius, 14);
  assert.equal(r('nova_ring', 3).hits[0].burn.seconds, 3);
  assert.ok(Math.abs(r('ringfall', 2).hits[0].power - T.ringfall.powerCentre * 1.3) < 1e-9);
  assert.equal(r('flicker_step', 2).cost.ora, 4);
  assert.equal(byId.dawn_lance.beam.radius, T.dawn_lance.beam.radius, 'the base def is untouched');
});

test('Strike String: tap presses chain five hits with a lunge; rank 2 adds the sixth', () => {
  for (const [rank, hits] of [[1, 5], [2, 6]]) {
    const h = makeCtx({ ranks: { strike_string: rank } });
    const p = h.addPlayer();
    const e = h.addEnemy(0, 8, { hp: 99999, hpMax: 99999, poise: 0, poiseMax: 0 });
    h.step(1);
    for (let i = 0; i < hits; i++) {
      h.input.press('attack');
      h.input.release('attack');
      h.step(i === 0 ? 24 : 15);
    }
    h.step(30);
    const n = h.of('combat:hit').filter((x) => x.targetId === e.id).length;
    assert.equal(n, hits, `rank ${rank}`);
    assert.equal(h.of('combat:techStart').filter((x) => x.techId === 'strike_string').length, 1, 'one string');
    assert.ok(Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 3, 'the first hit lunged to the target');
  }
});

test('Breaker after three string hits smashes; alone it launches; Pursuit follows a launch', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { hp: 99999, hpMax: 99999, poise: 0, poiseMax: 0 });
  assert.equal(h.combat.useTechnique(p, 'breaker', {}), true);
  h.step(30);
  const k1 = h.move.knocks.find((k) => k.id === e.id);
  assert.ok(k1 && k1.vy >= 14 && k1.gravityScale < 1, 'launch');
  // Pursuit inside the window.
  e.pos.y = 8;
  e.move.mode = 'air';
  e.move.grounded = false;
  const ora0 = p.stats.ora;
  h.input.press('dash');
  h.step(2);
  assert.ok(h.of('combat:techStart').some((x) => x.techId === 'pursuit'), 'pursuit started');
  assert.ok(Math.abs(p.pos.y - e.pos.y) < 1.5, 'beside the flying target');
  assert.ok(p.stats.ora < ora0);
  // Smash after three string hits.
  const h2 = makeCtx();
  const p2 = h2.addPlayer();
  const e2 = h2.addEnemy(0, 2, { hp: 99999, hpMax: 99999, poise: 0, poiseMax: 0 });
  for (let i = 0; i < 3; i++) {
    h2.input.press('attack');
    h2.input.release('attack');
    h2.step(14);
  }
  h2.step(4);
  assert.equal(h2.combat.useTechnique(p2, 'breaker', {}), true);
  h2.step(30);
  const smash = h2.move.knocks.find((k) => k.id === e2.id && k.hurtle);
  assert.ok(smash, 'smash hurtles');
  assert.ok(Math.hypot(smash.vx, smash.vz) >= 29);
});

test('hold attack 0.35 s: Breaker charges while held; in the air it is Meteor Heel with a crater', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { hp: 99999, hpMax: 99999 });
  h.input.press('attack');
  h.step(Math.ceil(BALANCE.tech.breaker.holdSeconds * 60) + 2);
  assert.equal(p.combat.techId, 'breaker');
  h.step(70);
  assert.ok(p.combat.charge > 0.9, 'charging while held');
  h.input.release('attack');
  h.step(30);
  const hit = h.of('combat:hit').filter((x) => x.techId === 'breaker');
  assert.equal(hit.length, 1);
  void e;
  const h2 = makeCtx();
  const p2 = h2.addPlayer();
  h2.addEnemy(0, 3, { hp: 99999, hpMax: 99999 }, { y: 0 });
  p2.pos.y = 6;
  p2.move.mode = 'fly';
  p2.move.grounded = false;
  h2.input.press('attack');
  h2.step(Math.ceil(BALANCE.tech.breaker.holdSeconds * 60) + 2);
  assert.equal(p2.combat.techId, 'meteor_heel');
  h2.input.release('attack');
  h2.step(40);
  assert.ok(h2.world.craters.some((c) => c.radius === T.meteor_heel.crater.radius), 'meteor heel crater');
  assert.ok(h2.move.knocks.some((k) => k.vy < -30 && k.hurtle), 'spike');
});

test('charge scaling: a fully charged Dawn Lance deals about 2.5x the uncharged total', () => {
  const total = (holdTicks) => {
    const h = makeCtx();
    const p = h.addPlayer({ ora: 999, oraMax: 999 });
    const e = h.addEnemy(0, 20, { hp: 1e7, hpMax: 1e7, defense: 0, poise: 0, poiseMax: 0 });
    h.rpg.slot0 = 'dawn_lance';
    h.input.press('tech1');
    h.step(holdTicks);
    h.input.release('tech1');
    h.step(150);
    return sum(h.of('combat:hit').filter((x) => x.targetId === e.id && x.techId === 'dawn_lance').map((x) => x.amount));
  };
  const a = total(1);
  const b = total(130);
  const ticks = Math.round(T.dawn_lance.beam.seconds / T.dawn_lance.beam.tick);
  assert.ok(a > 0);
  assert.ok(Math.abs(b / a - T.dawn_lance.charge.maxMult) < 0.12, `ratio ${b / a} (${ticks} ticks)`);
  assert.equal(F.chargeMult(2, 0.5, 2, 2.5), 2.5);
});

test('Ora Bolt: costs Ora, hits, falls off with range; held bolt auto-fires at the cooldown', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 15, { hp: 99999, hpMax: 99999 });
  const ora0 = p.stats.ora;
  h.input.press('bolt');
  h.step(60);
  h.input.release('bolt');
  h.step(60);
  const shots = h.of('projectile:spawned').length;
  assert.ok(shots >= 4 && shots <= 6, `auto-fire ${shots} in 1 s`);
  assert.ok(h.of('combat:hit').filter((x) => x.targetId === e.id).length >= 4);
  assert.ok(p.stats.ora < ora0 - 4 * T.ora_bolt.ora + 10);
  assert.equal(F.boltFalloff(90), 0.5);
});

test('an entity standing inside a SOLID collider is hit by a bolt; a plain wall stops it', () => {
  const h = makeCtx({ colliders: [{ id: 7, shape: 'sphere', x: 0, y: 1, z: 12, r: 2.5, h: 0 }] });
  const p = h.addPlayer();
  const e = h.addEnemy(0, 12, { hp: 99999, hpMax: 99999 }, { kind: 'object', team: 0 });
  assert.equal(h.combat.useTechnique(p, 'ora_bolt', { targetId: e.id }), true);
  h.step(40);
  assert.ok(h.of('combat:hit').some((x) => x.targetId === e.id), 'the siphon inside its collider is hit');
  const h2 = makeCtx({ colliders: [{ id: 8, shape: 'sphere', x: 0, y: 1, z: 6, r: 1.5, h: 0 }] });
  const p2 = h2.addPlayer();
  const e2 = h2.addEnemy(0, 12, { hp: 99999, hpMax: 99999 });
  h2.combat.useTechnique(p2, 'ora_bolt', { targetId: e2.id });
  h2.step(40);
  assert.equal(h2.of('combat:hit').filter((x) => x.targetId === e2.id).length, 0, 'the wall in front stops the bolt');
  assert.ok(h2.world.props.length > 0, 'world hit on a collider damages props');
});

test('one dash press fires one Flicker; perfect Flicker on an attack inside the window', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  h.input.press('dash');
  h.step(1);
  h.input.hold('dash');
  h.step(60);
  h.input.release('dash');
  h.step(30);
  assert.equal(h.of('combat:flicker').length, 1);
  const f = h.of('combat:flicker')[0];
  assert.ok(Math.abs(Math.hypot(f.toX - f.fromX, f.toZ - f.fromZ) - T.flicker_step.dist) < 1e-6, 'flicker distance');
  const e = h.addEnemy(0, 1.5);
  h.step(40);
  h.input.press('dash');
  h.step(3);
  h.combat.damage({ sourceId: e.id, targetId: p.id, power: 1, kind: 'melee' });
  const perfect = h.of('combat:perfect');
  assert.equal(perfect.length, 1);
  assert.equal(perfect[0].kind, 'flicker');
  assert.equal(p.stats.hp, p.stats.hpMax);
  // +8 for the perfect defence, plus the style reward for reaching the first rank (logic/style.js).
  assert.equal(p.combat.surge, BALANCE.surge.perfect + STYLE.surgePerRank);
});

test('cooldowns use Swiftness reduction with its cap', () => {
  const h = makeCtx();
  const p = h.addPlayer({ cdr: 0.9 });
  h.combat.useTechnique(p, 'nova_ring', {});
  assert.ok(Math.abs(h.combat.cooldown(p, 'nova_ring') - T.nova_ring.cooldown * (1 - BALANCE.derived.cdr.cap)) < 1e-9);
  assert.equal(h.combat.canUse(p, 'nova_ring'), false);
  h.step(Math.ceil(T.nova_ring.cooldown * 60));
  assert.equal(h.combat.cooldown(p, 'nova_ring'), 0);
});

test('Nova Ring knocks every enemy radially outward', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const es = [[0, 5], [5, 0], [0, -5], [-5, 0]].map(([x, z]) => h.addEnemy(x, z, { hp: 99999, hpMax: 99999 }));
  h.combat.useTechnique(p, 'nova_ring', {});
  h.step(40);
  for (const e of es) {
    const k = h.move.knocks.find((x) => x.id === e.id);
    assert.ok(k, 'knocked');
    assert.ok(k.vx * e.pos.x + k.vz * e.pos.z > 0, 'outward');
  }
});

test('Ringfall at full Surge: costs the Surge, falloff damage, a 20 m crater', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const near = h.addEnemy(0, 2, { hp: 1e6, hpMax: 1e6, defense: 0 });
  const far = h.addEnemy(0, 20, { hp: 1e6, hpMax: 1e6, defense: 0 });
  assert.equal(h.combat.act(p, 'ultimate'), false, 'needs Surge');
  h.combat.addSurge(p, 100);
  assert.equal(h.combat.act(p, 'ultimate'), true);
  assert.equal(p.combat.surge, 0);
  h.step(150);
  const hits = h.of('combat:hit').filter((x) => x.techId === 'ringfall');
  const a = hits.find((x) => x.targetId === near.id).amount;
  const b = hits.find((x) => x.targetId === far.id).amount;
  assert.ok(a > b * 1.5, `falloff ${a} vs ${b}`);
  assert.ok(h.world.craters.some((c) => c.radius === T.ringfall.crater.radius));
  assert.ok(p.combat.state === 'idle' || p.combat.state === 'recover');
});

test('Surge: +1.5 per melee hit, +0.5 per Ora hit, decays 2/s after 12 s out of combat', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { hp: 1e6, hpMax: 1e6 });
  h.combat.damage({ sourceId: p.id, targetId: e.id, power: 0.2, kind: 'melee' });
  assert.equal(p.combat.surge, BALANCE.surge.meleeHit);
  h.combat.damage({ sourceId: p.id, targetId: e.id, power: 0.2, kind: 'ora' });
  assert.equal(p.combat.surge, BALANCE.surge.meleeHit + BALANCE.surge.oraHit);
  h.combat.addSurge(p, 50);
  const s0 = p.combat.surge;
  h.step(60 * 12);
  assert.ok(Math.abs(p.combat.surge - s0) < 1e-6, 'no decay in the first 12 s');
  // In combat for 6 s after the hit, then 12 s out of combat, then 2 per second.
  h.step(60 * 10);
  assert.ok(Math.abs(p.combat.surge - (s0 - 2 * 4)) < 0.3, `decayed to ${p.combat.surge}`);
});

test('Forms: cost, drain, Burnout at 0 Ora, lockout, regen suspended', () => {
  const h = makeCtx();
  const p = h.addPlayer({ ora: 100, oraMax: 150 });
  assert.equal(h.combat.act(p, 'form'), true);
  assert.equal(p.combat.formId, 'ember');
  assert.equal(p.combat.state, 'transform');
  assert.equal(p.stats.ora, 100 - BALANCE.forms.ember.cost);
  h.step(Math.ceil(BALANCE.formRules.transformSeconds * 60) + 2);
  assert.equal(p.combat.state, 'idle');
  const o1 = p.stats.ora;
  h.step(60);
  assert.ok(Math.abs(o1 - p.stats.ora - BALANCE.forms.ember.drain) < 0.1, 'drains 3/s, no regen');
  for (let i = 0; i < 60 * 40 && h.of('combat:burnout').length === 0; i++) h.step(1);
  assert.equal(p.combat.formId, null);
  assert.equal(h.of('combat:burnout').length, 1);
  assert.ok(p.combat.burnoutT > 0);
  p.stats.ora = 100;
  assert.equal(h.combat.setForm(p, 'ember', {}), false, 'locked out');
  const o2 = p.stats.ora;
  h.step(60);
  assert.ok(p.stats.ora <= o2 + 1e-9, 'no regen in the first 5 s of Burnout');
  h.step(60 * 12);
  assert.equal(h.combat.setForm(p, 'ember', {}), true, 'free again after 12 s');
  assert.equal(h.of('combat:form').at(-1).first, false);
  // Scripted Zenith has no drain.
  const h2 = makeCtx();
  const p2 = h2.addPlayer();
  assert.equal(h2.combat.setForm(p2, 'zenith', {}), false, 'zenith is scripted');
  assert.equal(h2.combat.setForm(p2, 'zenith', { scripted: true }), true);
  h2.step(120);
  const o3 = p2.stats.ora;
  h2.step(60);
  assert.ok(p2.stats.ora >= o3 - 1e-9);
});

test('regen is 0 while boosting and in a Form; boost costs Ora and is disallowed at 0', () => {
  const h = makeCtx();
  const p = h.addPlayer({ ora: 50 });
  h.step(60);
  assert.ok(p.stats.ora > 50, 'regen while idle');
  p.move.boost = 1;
  const o = p.stats.ora;
  h.step(60);
  assert.ok(Math.abs(o - p.stats.ora - BALANCE.tech.boost.oraPerSec) < 0.1);
  p.stats.ora = 1;
  h.step(20);
  assert.equal(p.move.boostAllowed, false);
  p.move.boost = 0;
  p.stats.ora = 20;
  h.step(1);
  assert.equal(p.move.boostAllowed, true);
});

test('Gather: gains Ora, a hit interrupts with a lockout', () => {
  const h = makeCtx();
  const p = h.addPlayer({ ora: 10 });
  const e = h.addEnemy(0, 2);
  h.input.press('gather');
  h.step(60);
  assert.equal(p.combat.gathering, true);
  assert.ok(p.stats.ora > 10 + F.gatherRate(5, F.createMods()) * 0.9);
  h.combat.damage({ sourceId: e.id, targetId: p.id, power: 0.5, kind: 'melee' });
  assert.equal(p.combat.gathering, false);
  h.step(10);
  assert.equal(p.combat.gathering, false, 'locked out');
  h.step(30);
  assert.equal(p.combat.gathering, true, 'resumes while held');
});

test('targeting: soft lock, hard lock, cycling, break at distance', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const a = h.addEnemy(0, 10);
  const b = h.addEnemy(6, 8);
  const c = h.addEnemy(-6, 8);
  h.step(1);
  assert.equal(h.combat.softTarget(), a.id);
  h.input.press('lock');
  h.step(1);
  assert.equal(h.combat.target(), a.id);
  h.combat.cycleTarget(1);
  const t1 = h.combat.target();
  h.combat.cycleTarget(1);
  const t2 = h.combat.target();
  assert.ok(new Set([a.id, t1, t2]).size === 3 && [b.id, c.id].includes(t1));
  a.pos.set(0, 0, 400);
  h.combat.setTarget(a.id);
  h.step(1);
  assert.equal(h.combat.target(), 0, 'breaks beyond 150 m');
  assert.ok(h.of('combat:lock').length >= 3);
});
