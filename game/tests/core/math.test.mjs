import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { clamp, lerp, invLerp, smoothstep, damp, angleDelta, wrapAngle, approach, TMP, initTmp } from '../../src/core/math.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('clamp, lerp, invLerp, smoothstep', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(invLerp(10, 20, 12.5), 0.25);
  assert.equal(invLerp(4, 4, 9), 0);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  close(smoothstep(0, 10, 2.5), 0.15625);
});

test('damp is frame-rate independent', () => {
  let a = 0;
  for (let i = 0; i < 60; i++) a = damp(a, 10, 3, 1 / 60);
  const b = damp(0, 10, 3, 1);
  close(a, b, 1e-9);
  close(b, 10 * (1 - Math.exp(-3)));
});

test('wrapAngle and angleDelta take the short way round', () => {
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(wrapAngle(-Math.PI), Math.PI);
  close(wrapAngle(-3 * Math.PI / 2), Math.PI / 2);
  close(wrapAngle(0.5), 0.5);
  close(angleDelta(0.1, -0.1), -0.2);
  close(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);
  close(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), -0.2);
});

test('approach never overshoots', () => {
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(9, 10, 3), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(approach(1, 0, 4), 0);
  assert.equal(approach(5, 5, 1), 5);
});

test('TMP holds three scratch objects once initialised (ents.js does this at load)', async () => {
  await import('../../src/core/ents.js');
  for (const k of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']) assert.ok(TMP[k] instanceof Vector3, k);
  assert.ok(TMP.q1 instanceof Quaternion && TMP.q2 instanceof Quaternion);
  assert.ok(TMP.m1 instanceof Matrix4);
  const v1 = TMP.v1;
  initTmp({ Vector3, Quaternion, Matrix4 });
  assert.equal(TMP.v1, v1, 'idempotent');
  assert.notEqual(TMP.v1, TMP.v2);
});
