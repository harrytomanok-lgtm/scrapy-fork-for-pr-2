import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../../src/core/context.js';
import { createFx, createFlashBudget, FLASH_BUDGET } from '../../src/core/fx.js';
import { FEEL } from '../../src/core/feel.js';

function setup(settings = {}) {
  const warns = [];
  const log = { errors: [], info() {}, warn(...a) { warns.push(a.join(' ')); }, error(...a) { this.errors.push(a.join(' ')); } };
  const ctx = /** @type {any} */ (createContext({ flags: { test: true }, log }));
  const calls = { shake: [], fov: [], vibrate: [], rumble: [], flash: [] };
  ctx.cam = {
    shake: (t) => calls.shake.push(t),
    fovKick: (deg, s, hold) => calls.fov.push([deg, s, !!hold]),
  };
  ctx.input.vibrate = (p) => calls.vibrate.push(p);
  ctx.input.rumble = (a, b, c) => calls.rumble.push([a, b, c]);
  ctx.render = { flash: (c, a, s) => calls.flash.push([c, a, s]) };
  ctx.save = { settings: { shake: 1, reducedMotion: false, photosensitive: false, vibration: true, ...settings } };
  ctx.combat = { inCombat: false };
  const fx = createFx(ctx);
  ctx.fx = fx;
  const impacts = [];
  ctx.bus.on('fx:impact', (p) => impacts.push({ ...p }));
  return { ctx, fx, calls, impacts, warns };
}

test('flash budget: at most 3 per second, alpha clamped to 0.4', () => {
  const b = createFlashBudget();
  const shown = [];
  for (let i = 0; i < 10; i++) shown.push(b.request(0.9, i * 0.1, false));
  assert.deepEqual(shown.filter((a) => a > 0), [0.4, 0.4, 0.4]);
  assert.equal(shown.slice(3).every((a) => a === 0), true, 'later requests in the same second are dropped');
  assert.equal(b.request(0.2, 1.05, false), 0.2, 'a new second frees one start');
});

test('flash budget: photosensitivity mode allows 2 per second at alpha 0.25', () => {
  const b = createFlashBudget();
  const shown = [];
  for (let i = 0; i < 10; i++) shown.push(b.request(1, i * 0.1, true));
  assert.deepEqual(shown.filter((a) => a > 0), [0.25, 0.25]);
  assert.equal(FLASH_BUDGET.photosensitive.count, 2);
  assert.equal(FLASH_BUDGET.normal.alpha, 0.4);
});

test('flash budget: the window slides', () => {
  const b = createFlashBudget();
  assert.ok(b.request(0.3, 0.0, false) > 0);
  assert.ok(b.request(0.3, 0.5, false) > 0);
  assert.ok(b.request(0.3, 0.9, false) > 0);
  assert.equal(b.request(0.3, 0.95, false), 0);
  assert.ok(b.request(0.3, 1.01, false) > 0, 'the first start left the window');
  assert.equal(b.request(0.3, 1.02, false), 0);
  assert.equal(b.request(0, 5, false), 0, 'zero alpha is not a flash');
});

test('fx.flash goes through the budget to render.flash', () => {
  const { ctx, fx, calls } = setup();
  const results = [];
  for (let i = 0; i < 10; i++) results.push(fx.flash(0xffffff, 0.8, 0.1));
  assert.deepEqual(results.filter(Boolean).length, 3);
  assert.deepEqual(calls.flash.map((c) => c[1]), [0.4, 0.4, 0.4]);
  ctx.loop.stepSim(61);
  assert.equal(fx.flash(0xffffff, 0.1, 0.1), true, 'one second of sim time later');
});

test('fx.flash honours the photosensitivity setting', () => {
  const { fx, calls } = setup({ photosensitive: true });
  for (let i = 0; i < 5; i++) fx.flash(0xffffff, 1, 0.1);
  assert.deepEqual(calls.flash.map((c) => c[1]), [0.25, 0.25]);
});

test('impact applies one FEEL row and emits fx:impact', () => {
  const { ctx, fx, calls, impacts } = setup();
  fx.impact('heavyHit', 1, 2, 3, 1);
  assert.deepEqual(calls.shake, [FEEL.heavyHit.shake]);
  assert.deepEqual(calls.fov, [[FEEL.heavyHit.fov, FEEL.heavyHit.fovSeconds, false]]);
  assert.deepEqual(calls.vibrate, [FEEL.heavyHit.vibrate]);
  assert.deepEqual(calls.rumble, [FEEL.heavyHit.rumble]);
  assert.deepEqual(impacts, [{ classId: 'heavyHit', x: 1, y: 2, z: 3, scale: 1 }]);
  assert.equal(ctx.time.frozen, true, 'hit-stop is pending');
  ctx.loop.stepSim(Math.round(90 / 16.667));
  assert.equal(ctx.time.frozen, false, 'hit-stop lasted round(90 / 16.667) ticks');
});

test('shake follows the shake setting; Reduced Motion caps shake at 25% and FOV at 30%', () => {
  const half = setup({ shake: 0.5 });
  half.fx.impact('burst', 0, 0, 0, 2);
  assert.ok(Math.abs(half.calls.shake[0] - FEEL.burst.shake * 2 * 0.5) < 1e-9);
  const rm = setup({ shake: 1, reducedMotion: true });
  rm.fx.impact('burst', 0, 0, 0, 1);
  assert.ok(Math.abs(rm.calls.shake[0] - FEEL.burst.shake * 0.25) < 1e-9);
  assert.ok(Math.abs(rm.calls.fov[0][0] - FEEL.burst.fov * 0.3) < 1e-9);
  const off = setup({ shake: 0 });
  off.fx.impact('burst', 0, 0, 0, 1);
  assert.equal(off.calls.shake.length, 0);
});

test('slow motion of levelUp is skipped in combat', () => {
  const { ctx, fx } = setup();
  ctx.combat.inCombat = true;
  fx.impact('levelUp');
  ctx.loop.stepSim(1);
  assert.equal(ctx.time.scale, 1);
  ctx.combat.inCombat = false;
  fx.impact('levelUp');
  ctx.loop.stepSim(1);
  assert.equal(ctx.time.scale, FEEL.levelUp.slowScale);
});

test('combat:hit on the player picks hurtLight or hurtHeavy by 15% of hpMax', () => {
  const { ctx, impacts } = setup();
  ctx.player = { id: 7, alive: true, stats: { hpMax: 200 }, pos: { x: 0, y: 0, z: 0 } };
  const hit = { attackerId: 3, targetId: 7, techId: null, class: 'lightHit', amount: 29, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, blocked: false, perfect: false, crit: false };
  ctx.bus.emit('combat:hit', hit);
  ctx.bus.emit('combat:hit', { ...hit, amount: 30 });
  ctx.bus.emit('combat:hit', { ...hit, attackerId: 7, targetId: 3, class: 'finisher' });
  ctx.bus.emit('combat:hit', { ...hit, attackerId: 4, targetId: 3 });
  assert.deepEqual(impacts.map((i) => i.classId), ['hurtLight', 'hurtHeavy', 'finisher']);
});

test('automatic classes: boost hold and release, landing, crater, unknown class', () => {
  const { ctx, fx, calls, impacts, warns } = setup();
  ctx.player = { id: 1, alive: true, stats: { hpMax: 100 }, pos: { x: 0, y: 0, z: 0 } };
  ctx.ents.get = () => ctx.player;
  ctx.bus.emit('move:boost', { entId: 1, stage: 1 });
  assert.deepEqual(calls.fov.at(-1), [FEEL.boostStart.fov, FEEL.boostStart.fovSeconds, true]);
  ctx.bus.emit('move:boost', { entId: 1, stage: 0 });
  assert.deepEqual(calls.fov.at(-1)[0], 0, 'boost end releases the held kick');
  ctx.bus.emit('actor:landed', { entId: 1, speed: 25, x: 0, y: 0, z: 0 });
  ctx.bus.emit('actor:landed', { entId: 1, speed: 10, x: 0, y: 0, z: 0 });
  ctx.bus.emit('world:crater', { x: 0, y: 0, z: 0, radius: 12, depth: 3, deformed: true, sourceId: 1 });
  ctx.bus.emit('world:crater', { x: 0, y: 0, z: 0, radius: 4, depth: 1, deformed: false, sourceId: 1 });
  assert.deepEqual(impacts.map((i) => i.classId), ['boostStart', 'landHeavy', 'craterBig']);
  fx.impact('nope');
  fx.impact('nope');
  assert.equal(warns.filter((w) => w.includes('nope')).length, 1);
});

test('sonic boom settles from its peak to the held value', () => {
  const { ctx, calls } = setup();
  ctx.player = { id: 1, alive: true, stats: { hpMax: 100 }, pos: { x: 0, y: 0, z: 0 } };
  ctx.ents.get = () => ctx.player;
  ctx.bus.emit('move:boost', { entId: 1, stage: 2 });
  assert.deepEqual(calls.fov.at(-1), [14, FEEL.sonicBoom.fovSeconds, true]);
  ctx.loop.stepSim(Math.ceil(FEEL.sonicBoom.fovSeconds * 60) + 1);
  ctx.loop.renderNow();
  assert.deepEqual(calls.fov.at(-1)[0], 10);
  assert.equal(calls.fov.at(-1)[2], true);
});
