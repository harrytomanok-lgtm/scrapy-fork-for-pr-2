/**
 * Combo counter, style rank and the group finisher.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLE, createStyle, styleHit, styleHurt, styleStep, styleBonus, rankOf } from '../../src/combat/logic/style.js';
import { makeCtx } from './fakeCtx.mjs';

test('style: variety and air time rank up faster than one repeated hit', () => {
  const mono = createStyle();
  for (let i = 0; i < 12; i++) styleHit(mono, 'strike_string', false, false);
  const mixed = createStyle();
  const seq = ['strike_string', 'breaker', 'pursuit', 'strike_string', 'meteor_heel', 'ora_bolt'];
  for (let i = 0; i < 12; i++) styleHit(mixed, seq[i % seq.length], i > 2, i > 1);
  assert.ok(mixed.rank > mono.rank, `mixed ${mixed.rank} vs mono ${mono.rank}`);
  assert.equal(mono.count, 12);
});

test('style: the combo expires after the gap; the rank drains while idle; a hit drops one rank', () => {
  const s = createStyle();
  for (let i = 0; i < 8; i++) styleHit(s, i % 2 ? 'a' : 'b', true, true);
  const r0 = s.rank;
  assert.ok(r0 >= 2);
  assert.ok(styleHurt(s));
  assert.equal(s.rank, r0 - 1);
  let expired = false;
  for (let t = 0; t < STYLE.gap + 0.1; t += 1 / 60) if (styleStep(s, 1 / 60) & 1) expired = true;
  assert.ok(expired, 'the combo expired');
  for (let t = 0; t < 30; t += 1 / 60) styleStep(s, 1 / 60);
  assert.equal(s.rank, 0);
  assert.equal(rankOf(STYLE.ranks[4]), 5);
});

test('style: each rank pays its Surge once per climb', () => {
  const s = createStyle();
  let surge = 0;
  for (let i = 0; i < 4; i++) surge += styleBonus(s, STYLE.slam);
  assert.equal(s.rank, 2);
  assert.equal(surge, STYLE.surgePerRank * (1 + 2));
  styleHurt(s);
  surge = styleBonus(s, STYLE.slam) + styleBonus(s, STYLE.slam);
  assert.equal(s.rank, 2);
  assert.equal(surge, STYLE.surgePerRank * 2, 'climbing back pays the rank again');
});

test('engine: combat:combo carries count, rank and expiry; being hit lowers the rank', () => {
  const h = makeCtx();
  h.ctx.cam.yaw = 0;
  const p = h.addPlayer();
  const e = h.addEnemy(0, 1.5);
  h.step(1);
  for (let i = 0; i < 6; i++) {
    const a = i % 3 === 2 ? 'bolt' : 'attack';
    h.input.press(a);
    h.step(2);
    h.input.release(a);
    h.step(18);
  }
  const combos = h.of('combat:combo');
  assert.ok(combos.length >= 4, 'combo events');
  const last = combos[combos.length - 1];
  assert.ok(last.count >= 4 && 'rank' in last && 'expired' in last);
  h.step(200);
  assert.ok(h.of('combat:combo').some((c) => c.expired), 'an expiry event');
  // Being hit at a rank drops it.
  for (let i = 0; i < 4; i++) styleBonus(h.engine.style, STYLE.slam);
  const r0 = h.engine.style.rank;
  h.combat.damage({ sourceId: e.id, targetId: p.id, power: 1, kind: 'true' });
  assert.equal(h.engine.style.rank, r0 - 1);
});

test('finisher: the last enemy of a group dies with slow motion and a camera push', () => {
  const h = makeCtx();
  h.ctx.cam.yaw = 0;
  const pushes = [];
  h.ctx.cam.push = (a, s) => pushes.push([a, s]);
  const p = h.addPlayer();
  const a = h.addEnemy(0, 2, { hp: 1, hpMax: 1 });
  const b = h.addEnemy(1.5, 3, { hp: 1, hpMax: 1 });
  a.combat.inCombatT = 5; b.combat.inCombatT = 5;
  h.step(2);
  h.combat.damage({ sourceId: p.id, targetId: a.id, power: 5, kind: 'true' });
  assert.equal(pushes.length, 0, 'one enemy is still up');
  h.combat.damage({ sourceId: p.id, targetId: b.id, power: 5, kind: 'true' });
  assert.equal(pushes.length, 1, 'the last one is the finisher');
  assert.ok(h.time.slow.some(([sc]) => sc <= 0.35), 'slow motion');
  // A lone enemy is not a group.
  const c = h.addEnemy(0, 2, { hp: 1, hpMax: 1 });
  c.combat.inCombatT = 5;
  h.step(400);
  c.combat.inCombatT = 5;
  h.step(1);
  h.combat.damage({ sourceId: p.id, targetId: c.id, power: 5, kind: 'true' });
  assert.equal(pushes.length, 1);
});

test('weight: no stun-lock; the hero can always act within a second under a barrage of red hits and knocks', () => {
  const h = makeCtx();
  h.ctx.cam.yaw = 0;
  const p = h.addPlayer({ hp: 1e6, hpMax: 1e6 });
  const foes = [h.addEnemy(0, 1.6), h.addEnemy(1.4, -0.8), h.addEnemy(-1.4, -0.8)];
  const vib = [];
  h.ctx.input.vibrate = (pat) => vib.push(pat);
  let run = 0;
  let longest = 0;
  for (let t = 0; t < 600; t++) {
    // Every 0.25 s one of them throws an unguardable hit; every 0.4 s someone shoves.
    if (t % 15 === 0) h.combat.useTechnique(foes[(t / 15) % 3], 'test_red', { force: true, targetId: p.id });
    if (t % 24 === 0) h.combat.damage({ sourceId: foes[0].id, targetId: p.id, power: 0.1, knock: { kind: 'push', speed: 10 } });
    h.step(1);
    const stuck = p.combat.state === 'stagger';
    run = stuck ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  assert.ok(longest > 0, 'the red hits do stagger');
  assert.ok(longest / 60 <= 1.0 + 1e-6, 'longest loss of control ' + (longest / 60).toFixed(2) + ' s');
  // Knocks inside the grace only push.
  const kn = h.move.knocks.filter((k) => k.id === p.id);
  assert.ok(kn.some((k) => k.stun === 0), 'grace knocks carry no stun');
  assert.ok(vib.length > 0 && vib.every((v) => Array.isArray(v) || typeof v === 'number'), 'haptics played');
});
