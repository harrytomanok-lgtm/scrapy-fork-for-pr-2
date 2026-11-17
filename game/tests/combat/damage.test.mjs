/**
 * Combat damage pipeline (ARCHITECTURE 8.6 DoD): guard x0.2, perfect guard 0 and stagger, red ignores guard,
 * invulnerability, crit multiplier, difficulty, poise break and refill, event order, Form multipliers once,
 * Second Breath.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './fakeCtx.mjs';
import { BALANCE } from '../../src/core/balance.js';
import * as F from '../../src/core/formulas.js';
import { TAG as ETAG, KIND_MASK as EKM } from '../../src/core/ents.js';
import { TAG, KIND_MASK, frontal, hitAmount, knockVelocity, softScore, sweepCapsuleT } from '../../src/combat/logic/rules.js';

const req = (o) => ({ sourceId: 0, targetId: 0, power: 1, kind: 'melee', poise: 0, knock: { kind: 'none' }, ...o });

test('rules mirror the entity tags and kind masks of core/ents.js', () => {
  assert.deepEqual({ ...TAG }, { ...ETAG });
  assert.deepEqual({ ...KIND_MASK }, { ...EKM });
});

test('a plain hit follows formulas.damage and rpg rating', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2);
  h.ctx.rng.sim.reseed(99);
  const res = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 1 }));
  h.ctx.rng.sim.reseed(99);
  const roll = h.ctx.rng.sim.range(0.95, 1.05);
  assert.equal(res.applied, true);
  assert.equal(res.amount, F.damage(1, 60, 10, 1, 1, 1, roll, 1));
  assert.equal(e.stats.hp, 1000 - res.amount);
});

test('event order: actor:damaged then combat:hit with the same amount; kill emits actor:died after them', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { hp: 5 });
  h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 3 }));
  const types = h.events.map((x) => x.type).filter((t) => t === 'actor:damaged' || t === 'combat:hit' || t === 'actor:died');
  assert.deepEqual(types, ['actor:damaged', 'combat:hit', 'actor:died']);
  assert.equal(h.of('actor:damaged')[0].amount, h.of('combat:hit')[0].amount);
  assert.equal(e.alive, false);
  assert.equal(e.combat.state, 'dead');
});

test('player death: actor:died then player:died, with slow motion', () => {
  const h = makeCtx();
  const p = h.addPlayer({ hp: 10 });
  const e = h.addEnemy(0, 2);
  h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 50, kind: 'true' }));
  const types = h.events.map((x) => x.type).filter((t) => t === 'actor:died' || t === 'player:died');
  assert.deepEqual(types, ['actor:died', 'player:died']);
  assert.ok(h.time.slow.length > 0);
  h.combat.revive(p, 1);
  assert.equal(p.alive, true);
  assert.equal(p.stats.hp, p.stats.hpMax);
  assert.ok(p.combat.invulnT > 0);
});

test('guard blocks frontal hits at x0.2 for 3 Ora; hits from behind land', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  p.yaw = 0; // facing +z
  const e = h.addEnemy(0, 2);
  h.combat.act(p, 'guardOn');
  h.step(30); // past the perfect window
  const ora0 = p.stats.ora;
  h.ctx.rng.sim.reseed(5);
  const r1 = h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 2, dirX: 0, dirZ: -1 }));
  h.ctx.rng.sim.reseed(5);
  const roll = h.ctx.rng.sim.range(0.95, 1.05);
  const full = F.damage(2, 40, 10, 1, 1, 1, roll, 1);
  assert.equal(r1.blocked, true);
  assert.equal(r1.perfect, false);
  assert.equal(r1.amount, Math.max(1, Math.round(full * BALANCE.tech.guard.blockedMult)));
  assert.equal(p.stats.ora, ora0 - BALANCE.tech.guard.oraPerBlock);
  const r2 = h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 2, dirX: 0, dirZ: 1 }));
  assert.equal(r2.blocked, false);
  assert.ok(frontal(0, 0, -1) && !frontal(0, 0, 1));
});

test('perfect guard: no damage, attacker staggered 0.8 s, +8 Surge', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2);
  h.combat.act(p, 'guardOn');
  h.step(3);
  const r = h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 2, dirX: 0, dirZ: -1 }));
  assert.equal(r.perfect, true);
  assert.equal(r.amount, 0);
  assert.equal(p.stats.hp, p.stats.hpMax);
  assert.equal(e.combat.state, 'stagger');
  assert.ok(Math.abs(e.combat.staggerT - BALANCE.tech.guard.perfect.attackerStagger) < 1e-9);
  assert.equal(p.combat.surge, BALANCE.surge.perfect);
  assert.equal(h.of('combat:perfect')[0].kind, 'guard');
});

test('guard breaks at 0 Ora: stagger 1 s', () => {
  const h = makeCtx();
  const p = h.addPlayer({ ora: 2 });
  const e = h.addEnemy(0, 2);
  h.combat.act(p, 'guardOn');
  h.step(30);
  p.stats.ora = 2;
  const r = h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 1, dirX: 0, dirZ: -1 }));
  assert.equal(r.blocked, true);
  assert.equal(p.combat.state, 'stagger');
  assert.equal(p.combat.guarding, false);
});

test('a red telegraphed attack ignores guard and staggers the player', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 1.5);
  h.combat.act(p, 'guardOn');
  h.step(30);
  assert.equal(h.combat.useTechnique(e, 'test_red', { targetId: p.id }), true);
  assert.equal(h.of('combat:telegraph')[0].kind, 'red');
  h.step(40);
  const hit = h.of('combat:hit').find((x) => x.targetId === p.id);
  assert.ok(hit, 'the red attack hits');
  assert.equal(hit.blocked, false);
  assert.ok(h.of('actor:staggered').some((x) => x.entId === p.id));
});

test('invulnerability: TAG.INVULNERABLE and invulnT block damage', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2);
  e.tags |= TAG.INVULNERABLE;
  assert.equal(h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 5 })).applied, false);
  e.tags = 0;
  h.combat.setInvulnerable(e, 1);
  assert.equal(h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 5 })).applied, false);
  h.step(61);
  assert.equal(h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 5 })).applied, true);
});

test('crit multiplier and difficulty', () => {
  const base = { power: 1, rating: 100, defense: 0, dmgMult: 1, defMult: 1, crit: false, roll: 1, difficultyMult: 1, kind: 'melee', blocked: false, perfect: false };
  assert.equal(hitAmount({ ...base, crit: true }), Math.round(100 * BALANCE.derived.crit.mult));
  for (const d of ['story', 'warrior', 'master']) {
    const h = makeCtx({ difficulty: d });
    const p = h.addPlayer({ defense: 0 });
    const e = h.addEnemy(0, 2, { meleeRating: 100 });
    h.ctx.rng.sim.reseed(1);
    const r = h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 1, canCrit: false }));
    h.ctx.rng.sim.reseed(1);
    const roll = h.ctx.rng.sim.range(0.95, 1.05);
    assert.equal(r.amount, Math.round(100 * roll * F.difficultyRow(d).enemyDmg), d);
  }
  const h = makeCtx();
  const p = h.addPlayer({ critChance: 1 });
  const e = h.addEnemy(0, 2);
  const r = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 1 }));
  assert.equal(r.crit, true);
});

test('poise: Break at 0 staggers 2 s, +25% damage while broken, refill 3 s after the last hit', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { poise: 20, poiseMax: 20 });
  h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 0.1, poise: 12 }));
  assert.equal(e.stats.poise, 8);
  h.step(Math.ceil(BALANCE.combat.poise.refillSeconds * 60) + 2);
  assert.equal(e.stats.poise, 20, 'refilled');
  h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 0.1, poise: 25 }));
  const st = h.of('actor:staggered').find((x) => x.entId === e.id);
  assert.ok(st && st.broken && st.seconds === BALANCE.combat.poise.breakStagger);
  assert.equal(e.combat.state, 'stagger');
  h.ctx.rng.sim.reseed(3);
  const a = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 2, canCrit: false })).amount;
  h.ctx.rng.sim.reseed(3);
  const roll = h.ctx.rng.sim.range(0.95, 1.05);
  assert.equal(a, F.damage(2, 60, 10, BALANCE.combat.poise.brokenDamageMult, 1, 1, roll, 1));
  h.step(Math.ceil(BALANCE.combat.poise.breakStagger * 60) + 2);
  assert.equal(e.combat.state, 'idle');
  assert.equal(e.stats.poise, 20, 'poise restored after the Break');
});

test('Form multipliers are applied exactly once (stats.dmgMult already holds them)', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { defense: 0 });
  h.ctx.rng.sim.reseed(11);
  const base = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 2, canCrit: false })).amount;
  assert.equal(h.combat.setForm(p, 'ember', { instant: true, free: true }), true);
  p.stats.dmgMult = BALANCE.forms.ember.mult.dmg; // what rpg does on combat:form
  h.ctx.rng.sim.reseed(11);
  const ember = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 2, canCrit: false })).amount;
  h.ctx.rng.sim.reseed(11);
  const roll = h.ctx.rng.sim.range(0.95, 1.05);
  assert.equal(ember, F.damage(2, 60, 0, 1.25, 1, 1, roll, 1));
  assert.ok(Math.abs(ember / base - 1.25) < 0.02, `ember ${ember} vs base ${base}`);
});

test('Second Breath: a lethal hit leaves 1 HP and 2 s of invulnerability, once per 5 minutes', () => {
  const h = makeCtx();
  const p = h.addPlayer({ hp: 50 });
  h.mods.secondBreath = 1;
  const e = h.addEnemy(0, 2);
  h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 500, kind: 'true' }));
  assert.equal(p.stats.hp, 1);
  assert.equal(p.alive, true);
  assert.ok(p.combat.invulnT >= 2);
  h.step(150);
  h.combat.damage(req({ sourceId: e.id, targetId: p.id, power: 500, kind: 'true' }));
  assert.equal(p.alive, false);
});

test('front guard of an enemy reduces frontal damage unless unblockable', () => {
  const h = makeCtx();
  const p = h.addPlayer();
  const e = h.addEnemy(0, 2, { defense: 0 }, { defId: 'guarder' });
  h.ctx.rng.sim.reseed(2);
  const front = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 4, canCrit: false, dirX: 0, dirZ: 1 })).amount;
  h.ctx.rng.sim.reseed(2);
  const unbl = h.combat.damage(req({ sourceId: p.id, targetId: e.id, power: 4, canCrit: false, dirX: 0, dirZ: 1, unblockable: true })).amount;
  assert.ok(front < unbl * 0.3, `${front} < ${unbl}`);
});

test('knock classes: launch rises with juggle gravity, smash and spike and radial hurtle, bosses and the player never hurtle', () => {
  const out = { vx: 0, vy: 0, vz: 0, hurtle: false, gravityScale: 1, stun: 0 };
  const who = { boss: false, player: false };
  knockVelocity({ kind: 'launch', up: 14 }, 1, 0, 1, 0, who, out);
  const h = (out.vy * out.vy) / (2 * BALANCE.move.gravity * out.gravityScale);
  assert.ok(h >= BALANCE.tech.breaker.launch.minHeight && h <= BALANCE.tech.breaker.launch.maxHeight, `launch height ${h}`);
  knockVelocity({ kind: 'smash', speed: 30 }, 1, 0, 1, 0, who, out);
  assert.equal(out.hurtle, true);
  knockVelocity({ kind: 'spike', speed: 35 }, 1, 0, 1, 0, who, out);
  assert.ok(out.hurtle && out.vy === -35);
  knockVelocity({ kind: 'radial', speed: 18 }, 1, 0, 0, 1, who, out);
  assert.ok(out.hurtle && out.vz === 18);
  knockVelocity({ kind: 'push', speed: 10 }, 1, 0, 1, 0, who, out);
  assert.equal(out.hurtle, false);
  knockVelocity({ kind: 'smash', speed: 30 }, 1, 0, 1, 0, { boss: true, player: false }, out);
  assert.equal(out.hurtle, false);
  knockVelocity({ kind: 'radial', speed: 18 }, 1, 0, 1, 0, { boss: false, player: true }, out);
  assert.equal(out.hurtle, false);
});

test('soft lock prefers the target ahead; sweeps find capsules', () => {
  const ahead = softScore(0, 10, 0, 1, 25, 60);
  const side = softScore(8, 3, 0, 1, 25, 60);
  const behind = softScore(0, -10, 0, 1, 25, 60);
  assert.ok(ahead >= 0 && (side < 0 || side > ahead));
  assert.equal(behind, -1);
  assert.ok(softScore(0, -3, 0, 1, 25, 60) >= 0, 'very close targets count from any angle');
  assert.ok(sweepCapsuleT(0, 1, 0, 0, 1, 10, 0.3, 0, 0, 5, 0.5, 1.8) > 0.3);
  assert.equal(sweepCapsuleT(0, 1, 0, 0, 1, 10, 0.3, 3, 0, 5, 0.5, 1.8), -1);
});
