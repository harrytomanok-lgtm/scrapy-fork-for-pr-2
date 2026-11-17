import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultState } from '../../src/core/store.js';
import {
  createSave, migrateState, validateState, SAVE_VERSION, STORAGE_KEYS, DEFAULT_SETTINGS, AUTOSAVE_INTERVAL,
} from '../../src/core/save.js';

/** localStorage-like map storage. */
function mapStorage() {
  const m = new Map();
  return {
    map: m,
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); },
    remove: (k) => { m.delete(k); },
  };
}

/** Storage whose every call throws, like localStorage in a sandboxed page. */
function throwingStorage() {
  const boom = () => { throw new Error('SecurityError'); };
  return { get: boom, set: boom, remove: boom };
}

/** Minimal bus with the events.js surface save uses. */
function fakeBus() {
  const listeners = new Map();
  const emitted = [];
  return {
    emitted,
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return () => { listeners.set(type, listeners.get(type).filter((f) => f !== fn)); };
    },
    emit(type, payload) {
      emitted.push({ type, payload });
      for (const fn of listeners.get(type) || []) fn(payload);
    },
  };
}

function midGameState() {
  const s = defaultState();
  s.player.level = 7;
  s.player.xp = 321;
  s.player.base = { mgt: 11, spr: 9, vit: 8, swf: 7 };
  s.player.forms = ['ember'];
  s.player.nodes = ['iron_fists_1'];
  s.inv.items = [{ uid: 1, itemId: 'sunfruit', level: 1, count: 3 }, { uid: 2, itemId: 'training_wraps', level: 1, count: 1 }];
  s.inv.nextUid = 3;
  s.inv.equip.wraps = 2;
  s.quests.active = { mq2: { step: 3, counts: { s3: 2 } } };
  s.quests.done = ['mq1'];
  s.quests.flags = { tutorialSeen: true, npcMood: 2 };
  s.world.races = { windmill_run: { best: 51.2, medal: 'silver' } };
  s.world.camps = { camp_meadows_1: 2 };
  return s;
}

test('write and load round trip', () => {
  const storage = mapStorage();
  const store = createStore(midGameState());
  let t = 1000;
  const save = createSave({ store, storage, now: () => t });
  assert.equal(save.memoryOnly, false);
  assert.equal(save.write('test'), true);
  assert.ok(storage.map.has(STORAGE_KEYS.slot(1)));
  assert.equal(storage.map.get(STORAGE_KEYS.last), '1');
  assert.equal(store.state.meta.createdAt, 1000);
  assert.equal(store.state.meta.savedAt, 1000);
  t = 2000;
  save.write();
  assert.equal(store.state.meta.createdAt, 1000, 'createdAt is written once');
  assert.equal(store.state.meta.savedAt, 2000);
  const loaded = save.load(1);
  assert.deepEqual(loaded, store.snapshot());
  assert.equal(save.lastSlot(), 1);
  const slots = save.slots();
  assert.equal(slots.length, 3);
  assert.deepEqual(slots[0], { slot: 1, exists: true, level: 7, playSeconds: 0, savedAt: 2000, regionId: '' });
  assert.equal(slots[1].exists, false);
  save.erase(1);
  assert.equal(save.load(1), null);
  assert.equal(save.lastSlot(), null);
});

test('save:written is emitted, the player position is copied, and load snaps to the Ringstone', () => {
  const bus = fakeBus();
  const store = createStore();
  const player = { pos: { x: 10, y: 20, z: 30 }, yaw: 1.5 };
  const save = createSave({
    store, storage: mapStorage(), bus, getPlayer: () => player,
    ringstonePos: (id) => (id === 'ringstone_sparkstead' ? { x: -1430, y: 41, z: 1580 } : null),
  });
  save.write('manual');
  const ev = bus.emitted.find((e) => e.type === 'save:written');
  assert.deepEqual(ev.payload, { slot: 1, ok: true, memoryOnly: false });
  assert.deepEqual([store.state.player.x, store.state.player.y, store.state.player.z, store.state.player.yaw], [10, 20, 30, 1.5]);
  const loaded = save.load(1);
  assert.deepEqual([loaded.player.x, loaded.player.y, loaded.player.z], [-1430, 41, 1580]);
});

test('memory fallback when storage throws', () => {
  const store = createStore(midGameState());
  const save = createSave({ store, storage: throwingStorage() });
  assert.equal(save.write('test'), true);
  assert.equal(save.memoryOnly, true);
  assert.deepEqual(save.load(1), store.snapshot());
  assert.equal(save.setSetting('lang', 'en'), true);
  assert.equal(save.settings.lang, 'en');
  assert.equal(save.slots()[0].exists, true);
});

test('memory-only when forced (test mode) never touches storage', () => {
  const storage = mapStorage();
  const save = createSave({ store: createStore(), storage, memoryOnly: true });
  save.write();
  assert.equal(storage.map.size, 0);
  assert.notEqual(save.load(1), null);
  assert.equal(save.memoryOnly, true);
});

test('a safeStorage that reports memoryOnly is honoured', () => {
  const storage = mapStorage();
  storage.memoryOnly = true;
  const save = createSave({ store: createStore(), storage });
  assert.equal(save.memoryOnly, true);
});

test('settings: defaults, persistence, validation, settings:changed', () => {
  const storage = mapStorage();
  const bus = fakeBus();
  const save = createSave({ store: createStore(), storage, bus });
  assert.deepEqual(save.settings, { ...DEFAULT_SETTINGS });
  assert.equal(save.setSetting('shake', 0.5), true);
  assert.equal(save.setSetting('quality', 'ultra'), false, 'enum checked');
  assert.equal(save.setSetting('volMusic', 'loud'), false, 'type checked');
  assert.equal(save.setSetting('nope', 1), false, 'unknown key');
  assert.deepEqual(bus.emitted.filter((e) => e.type === 'settings:changed').map((e) => e.payload), [{ key: 'shake', value: 0.5 }]);
  storage.set(STORAGE_KEYS.settings, JSON.stringify({ ...JSON.parse(storage.get(STORAGE_KEYS.settings)), lang: 'xx' }));
  const again = createSave({ store: createStore(), storage });
  assert.equal(again.settings.shake, 0.5);
  assert.equal(again.settings.lang, 'he', 'invalid stored values fall back to defaults');
});

test('onBeforeSave and onAfterLoad hooks', () => {
  const store = createStore();
  const save = createSave({ store, storage: mapStorage() });
  const off = save.onBeforeSave((state) => { state.player.hp = 77; state.player.surge = 40; });
  save.write();
  assert.equal(save.load(1).player.hp, 77);
  assert.equal(save.load(1).player.surge, 40);
  off();
  store.state.player.hp = 5;
  save.write();
  assert.equal(save.load(1).player.hp, 5, 'unsubscribed hook no longer runs');
  const seen = [];
  save.onAfterLoad((state) => seen.push(state.player.hp));
  save.onAfterLoad(() => { throw new Error('a failing hook does not stop the others'); });
  save.onAfterLoad((state) => seen.push(state.player.level));
  store.reset(save.load(1));
  save.runAfterLoad();
  assert.deepEqual(seen, [5, 1]);
});

test('migration from an older version', () => {
  const v1 = defaultState();
  v1.player.level = 3;
  const migrations = {
    1: (s) => { s.player.title = 'apprentice'; s.world.weather = s.world.hour > 12 ? 'dusk' : 'clear'; return s; },
    2: (s) => { s.player.titles = [s.player.title]; delete s.player.title; return s; },
  };
  const m = migrateState(v1, migrations, 3);
  assert.equal(m.v, 3);
  assert.deepEqual(m.player.titles, ['apprentice']);
  assert.equal(m.world.weather, 'clear');
  assert.equal(m.player.level, 3);
  assert.equal(v1.v, 1, 'the input is not mutated');
  assert.equal(migrateState(v1, {}, 2), null, 'a missing migration step fails');
});

test('migrate fills fields missing from an older shape and rejects newer versions', () => {
  const old = defaultState();
  delete old.stats;
  delete old.player.canFly;
  delete old.world.camps;
  const m = migrateState(old);
  assert.deepEqual(m.stats, defaultState().stats);
  assert.equal(m.player.canFly, false);
  assert.deepEqual(m.world.camps, {});
  assert.ok(validateState(m));
  assert.equal(migrateState({ ...defaultState(), v: SAVE_VERSION + 1 }), null);
  assert.equal(migrateState('nope'), null);
  assert.equal(migrateState({ v: 'x' }), null);
});

test('a newer save is never loaded nor overwritten', () => {
  const storage = mapStorage();
  const newer = JSON.stringify({ ...defaultState(), v: SAVE_VERSION + 1 });
  storage.set(STORAGE_KEYS.slot(1), newer);
  const bus = fakeBus();
  const save = createSave({ store: createStore(), storage, bus });
  assert.equal(save.load(1), null);
  assert.equal(save.write(), false);
  assert.equal(storage.get(STORAGE_KEYS.slot(1)), newer);
  assert.equal(bus.emitted.at(-1).payload.ok, false);
});

test('validateState rejects damaged shapes', () => {
  assert.ok(validateState(defaultState()));
  const bad = defaultState();
  bad.player.level = 'ten';
  assert.equal(validateState(bad), false);
  const bad2 = defaultState();
  bad2.inv.items = [{ uid: 'x' }];
  assert.equal(validateState(bad2), false);
  assert.equal(validateState(null), false);
});

test('autosave policy: triggers, combat, cinematics, timer, lifecycle', () => {
  const bus = fakeBus();
  const store = createStore();
  const save = createSave({ store, storage: mapStorage(), bus });
  const writes = () => bus.emitted.filter((e) => e.type === 'save:written').length;
  bus.emit('rpg:levelUp', { level: 2, statPoints: 3, tp: 1 });
  save.tick(1 / 60);
  assert.equal(writes(), 0, 'no autosave before a journey is loaded');
  bus.emit('game:loaded', { slot: 1, newGame: true });
  bus.emit('quest:step', { questId: 'mq2', stepId: 's2', index: 1 });
  assert.equal(save.pending, 'quest:step');
  save.tick(1 / 60);
  assert.equal(writes(), 1, 'written at the end of the tick');
  assert.equal(save.pending, null);
  bus.emit('combat:state', { inCombat: true, threat: 0.5 });
  bus.emit('boss:end', { bossId: 'durn', defeated: true });
  save.tick(1 / 60);
  assert.equal(writes(), 1, 'never during combat');
  bus.emit('combat:state', { inCombat: false, threat: 0 });
  bus.emit('cine:start', { id: 'x', skippable: true });
  save.tick(1 / 60);
  assert.equal(writes(), 1, 'never during a cinematic');
  bus.emit('cine:end', { id: 'x', skipped: false });
  save.tick(1 / 60);
  assert.equal(writes(), 2, 'the waiting request is written once allowed');
  for (let i = 0; i < AUTOSAVE_INTERVAL * 60 - 2; i++) save.tick(1 / 60);
  assert.equal(writes(), 2);
  save.tick(1 / 60);
  save.tick(1 / 60);
  assert.equal(writes(), 3, 'timed autosave after 120 s out of combat');
  assert.ok(store.state.meta.playSeconds > AUTOSAVE_INTERVAL);
  bus.emit('game:ended', {});
  bus.emit('ringstone:activated', { id: 'ringstone_sparkstead', first: true });
  save.tick(1 / 60);
  assert.equal(writes(), 3, 'nothing after the journey ended');
  save.dispose();
});

test('autosave disabled (test mode) ignores requests', () => {
  const bus = fakeBus();
  const save = createSave({ store: createStore(), storage: mapStorage(), bus, autosave: false, memoryOnly: true });
  bus.emit('game:loaded', { slot: 1, newGame: true });
  bus.emit('ringstone:activated', { id: 'r', first: true });
  for (let i = 0; i < AUTOSAVE_INTERVAL * 60 + 5; i++) save.tick(1 / 60);
  assert.equal(bus.emitted.filter((e) => e.type === 'save:written').length, 0);
  assert.equal(save.write('manual'), true, 'explicit writes still work');
});
