/**
 * WebGL context-loss handling of core/errors: the give-up timer runs only while the page is visible, and the
 * running journey is saved before the fatal screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createErrors } from '../../src/core/errors.js';

function target() {
  const map = new Map();
  return {
    hidden: false,
    addEventListener(type, fn) { map.set(type, fn); },
    removeEventListener(type) { map.delete(type); },
    fire(type) { const fn = map.get(type); if (fn) fn({ preventDefault() {} }); },
  };
}

function setup() {
  const log = { error() {}, warn() {}, info() {}, record() {}, console: null };
  const doc = target();
  const canvas = target();
  const errors = createErrors({ log, dom: null, win: null, doc, restoreMs: 40 });
  const calls = { writes: [], fatal: 0, paused: [] };
  const ctx = {
    session: { running: true },
    player: { id: 1 },
    save: { write(r) { calls.writes.push(r); return true; } },
    time: { pause(r) { calls.paused.push(r); }, resume() {} },
    loop: { stop() { calls.fatal++; } },
    bus: { emit() {} },
    render: { restore() {} },
  };
  errors.attach(ctx);
  errors.watchContext(/** @type {any} */ (canvas));
  return { errors, doc, canvas, calls };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('context loss: no give-up while hidden; a fresh timer once visible; save before fatal', async () => {
  const { errors, doc, canvas, calls } = setup();
  doc.hidden = true;
  canvas.fire('webglcontextlost');
  assert.deepEqual(calls.paused, ['context']);
  await wait(120);
  assert.equal(calls.fatal, 0, 'hidden: the give-up timer does not run');
  doc.hidden = false;
  doc.fire('visibilitychange');
  await wait(15);
  assert.equal(calls.fatal, 0, 'visible: a fresh timer, not an expired one');
  doc.hidden = true;
  doc.fire('visibilitychange');
  await wait(80);
  assert.equal(calls.fatal, 0, 'hidden again: the timer is cleared');
  doc.hidden = false;
  doc.fire('visibilitychange');
  await wait(90);
  assert.equal(calls.fatal, 1, 'visible and still lost: the fatal screen');
  assert.deepEqual(calls.writes, ['fatal'], 'the journey is saved before the fatal screen');
  errors.dispose();
});

test('context loss: a restore while hidden or visible cancels the give-up', async () => {
  const { errors, doc, canvas, calls } = setup();
  canvas.fire('webglcontextlost');
  await wait(10);
  canvas.fire('webglcontextrestored');
  await wait(80);
  assert.equal(calls.fatal, 0);
  doc.hidden = true;
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextrestored');
  doc.hidden = false;
  doc.fire('visibilitychange');
  await wait(80);
  assert.equal(calls.fatal, 0, 'restored: becoming visible arms nothing');
  assert.deepEqual(calls.writes, []);
  errors.dispose();
});
