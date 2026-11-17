import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../../src/core/context.js';
import { createInput, createPadSource, ACTIONS, AXES } from '../../src/core/input.js';
import { ALWAYS_ACTIONS, PAD } from '../../src/core/actions.js';
import { SIM_DT } from '../../src/core/constants.js';

function fakeLog() {
  const out = { warnings: [], errors: [] };
  out.info = () => {};
  out.warn = (...a) => out.warnings.push(a.join(' '));
  out.error = (...a) => out.errors.push(a.join(' '));
  return out;
}

/** A context whose sim is driven by stepSim and whose frames by renderNow; records per-tick reads. */
function setup(flags = {}) {
  const ctx = createContext({ flags, log: fakeLog(), loop: { raf: () => 1, caf() {}, now: () => 0 } });
  const ticks = [];
  ctx.systems.add({
    id: 't.read', phase: 'intent',
    step(c) {
      ticks.push({
        pressed: c.input.pressed('attack'), down: c.input.down('attack'), released: c.input.released('attack'),
        held: c.input.heldTime('attack'), moveX: c.input.axis('moveX'), moveY: c.input.axis('moveY'), lookX: c.input.axis('lookX'),
      });
    },
  });
  return { ctx, ticks };
}

test('ACTIONS and AXES are the contract lists; ui*, pause and skip always work', () => {
  assert.equal(ACTIONS.length, 33);
  assert.deepEqual(AXES, ['moveX', 'moveY', 'lookX', 'lookY']);
  assert.deepEqual([...ALWAYS_ACTIONS].sort(), ['pause', 'skip', 'uiBack', 'uiConfirm', 'uiDown', 'uiLeft', 'uiRight', 'uiTabNext', 'uiTabPrev', 'uiUp'].sort());
});

test('an injected press is pressed for exactly one tick, then released', () => {
  const { ctx, ticks } = setup();
  ctx.input.inject.press('attack');
  ctx.loop.stepSim(3);
  assert.deepEqual(ticks.map((t) => t.pressed), [true, false, false]);
  assert.deepEqual(ticks.map((t) => t.down), [true, false, false]);
  assert.deepEqual(ticks.map((t) => t.released), [false, true, false]);
  assert.equal(ctx.input.pressed('attack'), false, 'edges are cleared in cleanup');
});

test('press(action, ticks) holds for that many ticks; hold(on) holds until released; heldTime counts ticks', () => {
  const { ctx, ticks } = setup();
  ctx.input.inject.press('attack', 3);
  ctx.loop.stepSim(4);
  assert.deepEqual(ticks.map((t) => t.down), [true, true, true, false]);
  assert.deepEqual(ticks.map((t) => t.pressed), [true, false, false, false]);
  ticks.length = 0;
  ctx.input.inject.hold('attack', true);
  ctx.loop.stepSim(21);
  assert.equal(ticks.filter((t) => t.pressed).length, 1);
  assert.ok(Math.abs(ticks.at(-1).held - 21 * SIM_DT) < 1e-12);
  ctx.input.inject.hold('attack', false);
  ctx.loop.stepSim(1);
  assert.equal(ticks.at(-1).released, true);
  assert.equal(ticks.at(-1).held, 0);
});

test('a device press shorter than one tick still reads as pressed for one tick', () => {
  const { ctx, ticks } = setup();
  ctx.input.setButton('attack', true, 'touch');
  ctx.input.setButton('attack', false, 'touch');
  ctx.loop.stepSim(2);
  assert.deepEqual(ticks.map((t) => t.pressed), [true, false]);
  assert.deepEqual(ticks.map((t) => t.released), [false, true]);
});

test('a held device button is pressed once; several sources holding the same action merge', () => {
  const { ctx, ticks } = setup();
  ctx.input.setButton('attack', true, 'kbm');
  ctx.loop.stepSim(2);
  ctx.input.setButton('attack', true, 'pad');
  ctx.input.setButton('attack', false, 'kbm');
  ctx.loop.stepSim(2);
  ctx.input.setButton('attack', false, 'pad');
  ctx.loop.stepSim(1);
  assert.deepEqual(ticks.map((t) => t.pressed), [true, false, false, false, false]);
  assert.deepEqual(ticks.map((t) => t.down), [true, true, true, true, false]);
});

test('consume clears pressed for the rest of the tick', () => {
  const { ctx } = setup();
  const seen = [];
  ctx.systems.add({ id: 't.a', phase: 'intent', order: -10, step(c) { if (c.input.pressed('jump')) { seen.push('first'); c.input.consume('jump'); } } });
  ctx.systems.add({ id: 't.b', phase: 'combat', step(c) { if (c.input.pressed('jump')) seen.push('second'); } });
  ctx.input.inject.press('jump');
  ctx.loop.stepSim(1);
  assert.deepEqual(seen, ['first']);
});

test('contexts: gameplay actions and axes read as up in ui and cine; ui*, pause and skip always work', () => {
  const { ctx, ticks } = setup();
  const pressed = [];
  ctx.systems.add({ id: 't.ctx', phase: 'script', step(c) { for (const a of ['uiConfirm', 'pause', 'skip', 'jump']) if (c.input.pressed(a)) pressed.push(a); } });
  ctx.input.inject.hold('attack', true);
  ctx.input.inject.move(1, 0);
  ctx.loop.stepSim(1);
  assert.equal(ticks[0].down, true);
  assert.equal(ticks[0].moveX, 1);
  ctx.input.setContext('ui');
  assert.equal(ctx.input.down('attack'), false, 'reads as up immediately');
  ctx.loop.stepSim(1);
  assert.equal(ticks[1].down, false);
  assert.equal(ticks[1].released, true);
  assert.equal(ticks[1].moveX, 0);
  for (const a of ['uiConfirm', 'pause', 'skip', 'jump']) ctx.input.inject.press(a);
  ctx.loop.stepSim(1);
  assert.deepEqual(pressed, ['uiConfirm', 'pause', 'skip']);
  ctx.loop.stepSim(1);
  ctx.input.setContext('cine');
  ctx.input.inject.press('skip');
  ctx.input.inject.press('attack');
  ctx.loop.stepSim(1);
  assert.deepEqual(pressed, ['uiConfirm', 'pause', 'skip', 'skip']);
  ctx.input.setContext('game');
  ctx.loop.stepSim(1);
  assert.equal(ticks.at(-1).pressed, true, 'a still-held action presses again when gameplay resumes');
  assert.throws(() => ctx.input.setContext('menu'));
});

test('move axes: largest magnitude source wins, the vector is clamped to length 1', () => {
  const { ctx, ticks } = setup();
  ctx.input.setAxis('moveX', 1, 'kbm');
  ctx.input.setAxis('moveY', 1, 'kbm');
  ctx.input.setAxis('moveX', -0.3, 'pad');
  ctx.loop.stepSim(1);
  assert.ok(Math.abs(ticks[0].moveX - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(ticks[0].moveY - Math.SQRT1_2) < 1e-12);
  ctx.input.setAxis('moveX', 0, 'kbm');
  ctx.input.setAxis('moveY', 0, 'kbm');
  ctx.loop.stepSim(1);
  assert.equal(ticks[1].moveX, -0.3);
  assert.equal(ticks[1].moveY, 0);
});

test('look accumulates degrees per tick and resets after each tick', () => {
  const { ctx, ticks } = setup();
  ctx.input.addLook(2, 0);
  ctx.input.inject.look(3, 1);
  ctx.input.setAxis('lookX', 1, 'pad');
  ctx.loop.stepSim(2);
  assert.equal(ticks[0].lookX, 6);
  assert.equal(ticks[1].lookX, 0);
});

test('onPress is delivered once at the next frame pass, even while the sim is paused', () => {
  const { ctx } = setup();
  const got = [];
  const un = ctx.input.onPress((a) => got.push(a));
  ctx.time.pause('menu');
  ctx.input.inject.press('uiDown');
  ctx.input.inject.press('pause');
  assert.deepEqual(got, []);
  ctx.loop.renderNow();
  assert.deepEqual(got, ['pause', 'uiDown']);
  ctx.loop.renderNow();
  assert.equal(got.length, 2);
  ctx.input.setButton('attack', true, 'kbm');
  ctx.input.setButton('attack', true, 'kbm');
  ctx.loop.renderNow();
  ctx.loop.renderNow();
  assert.deepEqual(got, ['pause', 'uiDown', 'attack']);
  un();
  ctx.input.inject.press('uiUp');
  ctx.loop.renderNow();
  assert.equal(got.length, 3);
});

test('registerSource with an existing id disposes the old source and a press is delivered once', () => {
  const { ctx, ticks } = setup();
  const log = [];
  let oldPolls = 0;
  const oldPad = {
    poll(input) { oldPolls++; input.setButton('attack', true, 'pad'); },
    dispose() { log.push('old disposed'); },
  };
  ctx.input.registerSource('pad', oldPad);
  ctx.loop.renderNow();
  assert.equal(oldPolls, 1);
  ctx.loop.stepSim(1);

  let newPolls = 0;
  const newPad = {
    poll(input) { newPolls++; input.setButton('attack', newPolls === 1, 'pad'); },
    dispose() { log.push('new disposed'); },
  };
  ctx.input.registerSource('pad', newPad);
  assert.deepEqual(log, ['old disposed']);
  ctx.loop.stepSim(1);
  assert.equal(ticks[1].down, false, 'buttons held by the disposed source are released');

  const presses = [];
  ctx.input.onPress((a) => presses.push(a));
  ctx.loop.renderNow();
  ctx.loop.stepSim(1);
  ctx.loop.renderNow();
  ctx.loop.stepSim(2);
  assert.equal(oldPolls, 1, 'the old source is never polled again');
  assert.equal(newPolls, 2);
  assert.deepEqual(presses, ['attack']);
  assert.equal(ticks.filter((t) => t.pressed).length, 2, 'one press from the old source, one from the new');
  assert.deepEqual(ticks.map((t) => t.pressed), [true, false, true, false, false]);
});

test('input:device follows the last used device and is emitted on change only', () => {
  const { ctx } = setup();
  const devs = [];
  ctx.bus.on('input:device', (p) => devs.push(p.device));
  ctx.input.setButton('jump', true, 'touch');
  ctx.loop.renderNow();
  ctx.input.setButton('jump', false, 'touch');
  ctx.input.setAxis('moveX', 0.2, 'pad'); // small axis: no device change
  ctx.loop.renderNow();
  ctx.input.setAxis('moveX', 0.9, 'pad');
  ctx.loop.renderNow();
  ctx.input.inject.press('jump'); // injection never changes the device
  ctx.loop.renderNow();
  ctx.input.setDevice('kbm');
  assert.deepEqual(devs, ['touch', 'pad', 'kbm']);
  assert.equal(ctx.input.device, 'kbm');
});

test('test mode without autoplay ignores real devices but not injection or other sources', () => {
  const { ctx, ticks } = setup({ test: true });
  ctx.input.setButton('attack', true, 'kbm');
  ctx.input.setAxis('moveX', 1, 'touch');
  ctx.input.addLook(5, 0, 'pad');
  ctx.loop.stepSim(1);
  assert.equal(ticks[0].down, false);
  assert.equal(ticks[0].moveX, 0);
  assert.equal(ticks[0].lookX, 0);
  ctx.input.setButton('attack', true, 'hud');
  ctx.loop.stepSim(1);
  assert.equal(ticks[1].pressed, true);
});

test('glyphs follow the device; pad glyphs are never shown when the pad is unavailable', () => {
  const input = createInput({ flags: {}, log: fakeLog() });
  assert.deepEqual(input.glyph('jump'), { device: 'kbm', label: 'Space', icon: null });
  assert.equal(input.glyph('move').label, 'WASD');
  input.setDevice('pad');
  assert.equal(input.glyph('jump').label, 'A');
  assert.equal(input.glyph('tech1').label, 'LT+X');
  input.padAvailable = false;
  assert.equal(input.glyph('jump').device, 'kbm');
  input.setDevice('touch');
  assert.deepEqual(input.glyph('look'), { device: 'touch', label: 'look', icon: 'look' });
  for (const a of ACTIONS) assert.equal(typeof createInput({ flags: {} }).glyph(a).label, 'string');
});

test('vibrate honours settings and turns itself off after the first rejection; rumble is a no-op', () => {
  const calls = [];
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate(p) { calls.push(p); return false; } }, configurable: true });
  try {
    const ctx = { flags: {}, save: { settings: { vibration: false } } };
    const input = createInput(ctx);
    input.vibrate(20);
    assert.equal(calls.length, 0);
    ctx.save.settings.vibration = true;
    input.vibrate(20);
    input.vibrate(30);
    assert.deepEqual(calls, [20], 'disabled after the first rejection');
    input.rumble(1, 1, 100);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  }
});

test('basic pad source: standard mapping, LT modifier, dead zone; a throwing Gamepad API turns it off', () => {
  const nav = globalThis.navigator;
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const pad = { connected: true, mapping: 'standard', buttons, axes: [0.1, -0.1, 0, -1] };
  let throwIt = false;
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads() { if (throwIt) throw new Error('blocked'); return [null, pad]; } }, configurable: true,
  });
  try {
    const { ctx, ticks } = setup();
    const seen = [];
    ctx.systems.add({ id: 't.pad', phase: 'script', step(c) { for (const a of ['jump', 'form', 'tech1', 'attack']) if (c.input.down(a)) seen.push(a); } });
    ctx.input.registerSource('pad', createPadSource(ctx.input));
    buttons[PAD.X].pressed = true;
    ctx.input.poll(1 / 60);
    ctx.loop.stepSim(1);
    assert.deepEqual(seen, ['attack']);
    assert.equal(ticks[0].moveX, 0, 'left stick inside the radial dead zone');
    assert.equal(ticks[0].moveY, 0);
    assert.ok(ticks[0].lookX === 0 && ctx.input.axis('lookY') > 0, 'right stick up looks up');
    assert.equal(ctx.input.device, 'pad');
    buttons[PAD.LT].pressed = true;
    buttons[PAD.A].pressed = true;
    seen.length = 0;
    ctx.loop.renderNow();
    ctx.loop.stepSim(1);
    assert.deepEqual(seen, ['form', 'tech1']);
    throwIt = true;
    ctx.loop.renderNow();
    assert.equal(ctx.input.padAvailable, false);
    seen.length = 0;
    ctx.loop.stepSim(1);
    assert.deepEqual(seen, [], 'buttons released when the pad turns off');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  }
});
