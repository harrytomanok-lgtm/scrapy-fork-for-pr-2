import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultState, SAVE_VERSION } from '../../src/core/store.js';

test('default state has the schema of ARCHITECTURE 3.7', () => {
  const s = defaultState();
  assert.equal(s.v, SAVE_VERSION);
  assert.deepEqual(Object.keys(s), ['v', 'meta', 'player', 'inv', 'quests', 'world', 'stats']);
  assert.equal(s.player.hp, 196);
  assert.equal(s.player.ora, 125);
  assert.deepEqual(s.player.base, { mgt: 5, spr: 5, vit: 5, swf: 5 });
  assert.deepEqual(s.player.techs, ['strike_string', 'breaker', 'ora_bolt', 'guard', 'flicker_step', 'pursuit']);
  assert.equal(s.player.respawn, 'ringstone_sparkstead');
  assert.deepEqual(s.inv.equip, { wraps: null, garb: null, charm1: null, charm2: null });
  assert.equal(s.inv.quick, 'sunfruit');
  assert.equal(s.world.hour, 7);
  assert.deepEqual(s.stats, { kills: 0, deaths: 0, maxCombo: 0, metresFlown: 0, craters: 0, propsSmashed: 0 });
  assert.notEqual(defaultState().player, defaultState().player, 'every call returns fresh objects');
});

test('get and set by dotted path', () => {
  const store = createStore();
  assert.equal(store.get('player.level'), 1);
  assert.equal(store.get('player.base.mgt'), 5);
  assert.equal(store.get('player.nothing.deeper'), undefined);
  assert.equal(store.dirty, false);
  store.set('player.level', 4);
  assert.equal(store.state.player.level, 4);
  assert.equal(store.dirty, true);
  store.set('quests.flags.tutorialSeen', true);
  assert.equal(store.get('quests.flags.tutorialSeen'), true);
  store.set('new.branch.value', 3);
  assert.equal(store.get('new.branch.value'), 3);
  store.clearDirty();
  assert.equal(store.dirty, false);
});

test('reset replaces everything, keeps the state identity, and copies its input', () => {
  const store = createStore();
  const live = store.state;
  const next = defaultState();
  next.player.level = 9;
  next.extra = { a: 1 };
  store.reset(next);
  assert.equal(store.state, live, 'state object identity is stable');
  assert.equal(store.state.player.level, 9);
  next.player.level = 10;
  assert.equal(store.state.player.level, 9, 'reset deep-copies');
  store.reset();
  assert.equal(store.state.player.level, 1);
  assert.equal(store.state.extra, undefined, 'keys of the previous state are removed');
});

test('snapshot is a deep clone', () => {
  const store = createStore();
  const snap = store.snapshot();
  assert.deepEqual(snap, store.state);
  snap.player.base.mgt = 99;
  assert.equal(store.state.player.base.mgt, 5);
});
