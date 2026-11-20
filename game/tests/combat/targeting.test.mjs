/**
 * Aim assist: the intent-weighted soft-target rule (rules.intentScore) and the engine's picks for clusters, enemies
 * behind the camera, flyers above the player, the hysteresis, re-lock after a kill, flick and camera-relative cycling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { intentScore } from '../../src/combat/logic/rules.js';
import { makeCtx } from './fakeCtx.mjs';
import { isFlick } from '../../src/control/logic/gesture.js';

const TAG_FLYER = 2;

/** Camera looking along +z (yaw 0) unless given. */
function setup(camYaw = 0) {
  const h = makeCtx();
  h.ctx.cam.yaw = camYaw;
  const p = h.addPlayer();
  return { h, p };
}

/** @param {any} p @param {number} x @param {number} z stick in world units (length = deflection) */
function stick(p, x, z) {
  p.intent.mx = x;
  p.intent.mz = z;
}

test('intentScore: range, vertical band, cones, behind-camera cost', () => {
  // Straight ahead at 10 m: eligible, scored by distance.
  const ahead = intentScore(0, 0, 10, 0, 0, 0, 0, 1, 25, 60, 7.5, 4);
  assert.ok(Math.abs(ahead - 10) < 1e-9);
  assert.equal(intentScore(0, 0, 30, 0, 0, 0, 0, 1, 25, 60, 7.5, 4), -1, 'out of range');
  assert.equal(intentScore(0, 9, 4, 0, 0, 0, 0, 1, 25, 60, 7.5, 4), -1, 'above the melee band');
  assert.equal(intentScore(10, 0, 0, 0, 0, 0, 0, 1, 25, 60, 7.5, 4), -1, 'outside both cones and not close');
  assert.ok(intentScore(10, 0, 0, 1, 0, 1, 0, 1, 25, 60, 7.5, 4) > 0, 'the stick makes a side enemy eligible');
  assert.ok(intentScore(3, 0, 0, 0, 0, 0, 0, 1, 25, 60, 7.5, 4) > 0, 'close enemies are eligible from any side');
  // Behind the camera is costly without a stick toward it, cheap with one.
  const behindIdle = intentScore(0, 0, -5, 0, 0, 0, 0, 1, 25, 60, 7.5, 4);
  const behindPushed = intentScore(0, 0, -5, 0, -1, 1, 0, 1, 25, 60, 7.5, 4);
  assert.ok(behindIdle > 15 && behindPushed < behindIdle, `${behindIdle} vs ${behindPushed}`);
});

test('cluster: the nearest enemy in view wins; the stick picks the one it points at', () => {
  const { h, p } = setup();
  const near = h.addEnemy(0, 8);
  const left = h.addEnemy(4, 10);
  const right = h.addEnemy(-4, 10);
  h.step(1);
  assert.equal(h.combat.softTarget(), near.id, 'no stick: the nearest in front');
  // Push the stick toward the right-hand enemy (camera yaw 0: right is -x).
  stick(p, -0.37, 0.93);
  h.step(1);
  assert.equal(h.combat.softTarget(), right.id, 'the stick chooses inside the cluster');
  stick(p, 0.37, 0.93);
  h.step(1);
  assert.equal(h.combat.softTarget(), left.id);
  void p;
});

test('behind the camera: ignored while something is in view, chosen when the stick pulls toward it', () => {
  const { h, p } = setup();
  const front = h.addEnemy(0, 14);
  const back = h.addEnemy(0.5, -8);
  h.step(1);
  assert.equal(h.combat.softTarget(), front.id, 'the visible enemy, although farther');
  stick(p, 0, -1);
  h.step(1);
  assert.equal(h.combat.softTarget(), back.id, 'stick pulled back toward the camera');
  // An enemy at arm's length behind is still hit when nothing is in view.
  stick(p, 0, 0);
  front.pos.set(0, 0, 300);
  back.pos.set(0, 0, -2);
  h.step(1);
  assert.equal(h.combat.softTarget(), back.id);
});

test('the camera, not the body, says what is in front when the stick is idle', () => {
  const { h, p } = setup(Math.PI / 2); // camera looks along +x, the body faces +z
  const a = h.addEnemy(0, 10);
  const b = h.addEnemy(11, 0);
  p.yaw = 0;
  h.step(1);
  assert.equal(h.combat.softTarget(), b.id);
  void a;
});

test('above the player: a flyer in reach wins over a ground enemy off to the side; out of the melee band it is Ora only', () => {
  const { h } = setup();
  const flyer = h.addEnemy(0, 4, {}, { y: 5, tags: TAG_FLYER });
  const ground = h.addEnemy(3, 9);
  h.step(1);
  assert.equal(h.combat.softTarget(), flyer.id);
  flyer.pos.y = 20;
  h.step(1);
  assert.equal(h.engine.state.softMelee, ground.id, 'too high for melee');
  ground.pos.set(0, 0, 200);
  h.step(1);
  assert.equal(h.engine.state.softMelee, 0);
  assert.equal(h.engine.state.softOra, flyer.id, 'bolts still aim at it');
});

test('hysteresis: the soft target holds against a marginally better one', () => {
  const { h } = setup();
  const a = h.addEnemy(0, 8);
  h.step(1);
  assert.equal(h.combat.softTarget(), a.id);
  const b = h.addEnemy(0.4, 7.6);
  h.step(1);
  assert.equal(h.combat.softTarget(), a.id, 'barely better: stays');
  b.pos.set(0, 0, 3);
  h.step(1);
  assert.equal(h.combat.softTarget(), b.id, 'clearly better: switches');
});

test('the rising lunge carries a grounded hero up to a hovering flyer', () => {
  const { h, p } = setup();
  const f = h.addEnemy(0, 4, {}, { y: 4.5, tags: TAG_FLYER });
  f.move.mode = 'fly';
  f.move.grounded = false;
  h.step(1);
  h.input.press('attack');
  h.step(20);
  assert.ok(p.pos.y > 3, 'the hero rose to the flyer (' + p.pos.y.toFixed(2) + ')');
  assert.ok(h.of('combat:hit').some((e) => e.targetId === f.id), 'and hit it');
});

test('bolts aim at the soft target in 3D', () => {
  const { h } = setup();
  const f = h.addEnemy(0, 20, {}, { y: 12, tags: TAG_FLYER });
  h.step(1);
  h.input.press('bolt');
  h.step(12);
  const shot = h.ctx.ents.list('projectile')[0];
  assert.ok(shot, 'a bolt flies');
  assert.ok(shot.vel.y > 0 && shot.vel.z > 0, 'upward toward the flyer');
  void f;
});

test('the hard target dies: the next sensible hostile is locked; none left releases', () => {
  const { h } = setup();
  const a = h.addEnemy(0, 6);
  const b = h.addEnemy(3, 12);
  const far = h.addEnemy(0, 120);
  h.step(1);
  h.combat.setTarget(a.id);
  h.combat.kill(a, h.ctx.player.id);
  assert.equal(h.combat.target(), b.id, 'next in view');
  h.combat.kill(b, h.ctx.player.id);
  assert.equal(h.combat.target(), 0, 'the far one is beyond the re-lock radius');
  void far;
});

test('cycling is left and right as the camera sees it', () => {
  const { h, p } = setup(Math.PI); // camera looks along -z; screen right is +x
  const a = h.addEnemy(0, -10);
  const r = h.addEnemy(6, -10);
  const l = h.addEnemy(-6, -10);
  p.yaw = 0; // the body faces away from the camera view
  h.step(1);
  h.combat.setTarget(a.id);
  h.combat.cycleTarget(1);
  assert.equal(h.combat.target(), r.id, 'a flick to the right picks the enemy on the right of the screen');
  h.combat.setTarget(a.id);
  h.combat.cycleTarget(-1);
  assert.equal(h.combat.target(), l.id);
});

test('flick: fast, wide and horizontal', () => {
  assert.equal(isFlick(60, 10, 150), true);
  assert.equal(isFlick(-60, 10, 150), true);
  assert.equal(isFlick(60, 50, 150), false, 'diagonal');
  assert.equal(isFlick(20, 0, 150), false, 'short');
  assert.equal(isFlick(80, 0, 600), false, 'slow drag');
});
