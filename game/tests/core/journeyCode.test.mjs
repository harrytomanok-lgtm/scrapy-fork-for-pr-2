import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultState } from '../../src/core/store.js';
import { createSave, encodeJourneyCode, decodeJourneyCode, SAVE_VERSION, CODE_REASONS } from '../../src/core/save.js';

function mapStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); }, remove: (k) => { m.delete(k); } };
}

function journey() {
  const s = defaultState();
  s.meta.createdAt = 1700000000000;
  s.meta.playSeconds = 4321.5;
  s.player.level = 14;
  s.player.xp = 1234;
  s.player.gender = 'f';
  s.player.forms = ['ember'];
  s.player.techs.push('nova_ring', 'gather');
  s.player.slots = ['nova_ring', null];
  s.inv.shells = 987;
  s.inv.items = [{ uid: 1, itemId: 'sunfruit', level: 1, count: 4 }, { uid: 2, itemId: 'meadow_garb', level: 3, count: 1 }];
  s.inv.nextUid = 3;
  s.inv.equip.garb = 2;
  s.quests.active = { mq3: { step: 1, counts: { s2: 4 } } };
  s.quests.done = ['mq1', 'mq2'];
  s.quests.flags = { 'hint.break': true, tavernVisits: 3 };
  s.world.discovered = ['sparkstead', 'haven_aster'];
  s.world.siphons = ['siphon_1'];
  s.world.races = { windmill_run: { best: 49.75, medal: 'silver' } };
  s.world.camps = { camp_meadows_2: 3 };
  s.world.bosses = ['durn'];
  s.stats.kills = 140;
  s.stats.metresFlown = 98765.4;
  return s;
}

/** Export from one store, import into a fresh store and storage, load and compare. */
async function roundTrip(compression) {
  const source = createStore(journey());
  const code = await createSave({ store: source, storage: mapStorage(), compression }).exportCode();
  const fresh = createStore();
  const target = createSave({ store: fresh, storage: mapStorage(), compression });
  const res = await target.importCode(code);
  assert.deepEqual(res, { ok: true, reasonKey: null });
  fresh.reset(target.load(1));
  assert.deepEqual(fresh.state, source.state);
  return code;
}

test('K1 journey code round trip (deflate-raw)', async () => {
  const code = await roundTrip(true);
  assert.ok(code.startsWith('K1.'));
  assert.match(code.slice(3), /^[A-Za-z0-9_-]+$/);
});

test('K0 journey code round trip (no compression)', async () => {
  const code = await roundTrip(false);
  assert.ok(code.startsWith('K0.'));
  const k1 = await encodeJourneyCode(JSON.stringify(journey()), true);
  assert.ok(k1.length < code.length, 'K1 is smaller than K0');
});

test('codes are accepted with surrounding and embedded whitespace', async () => {
  const code = await createSave({ store: createStore(journey()), storage: mapStorage() }).exportCode();
  const wrapped = '  \n' + code.slice(0, 20) + '\n' + code.slice(20) + '\t ';
  const res = await createSave({ store: createStore(), storage: mapStorage() }).importCode(wrapped);
  assert.equal(res.ok, true);
});

test('damaged codes are rejected without throwing', async () => {
  const save = createSave({ store: createStore(), storage: mapStorage() });
  const good = await createSave({ store: createStore(journey()), storage: mapStorage() }).exportCode();
  const cases = [
    ['', CODE_REASONS.invalid],
    ['hello world', CODE_REASONS.invalid],
    ['K2.abc', CODE_REASONS.invalid],
    ['K1.***', CODE_REASONS.damaged],
    [good.slice(0, Math.floor(good.length / 2)), CODE_REASONS.damaged],
    ['K1.' + good.slice(3, 40) + 'AAAA' + good.slice(44), CODE_REASONS.damaged],
    ['K0.' + Buffer.from('{"v":1,"player":').toString('base64url'), CODE_REASONS.damaged],
    ['K0.' + Buffer.from('{"v":1,"meta":{}}').toString('base64url'), CODE_REASONS.damaged],
    ['K0.' + Buffer.from('[1,2,3]').toString('base64url'), CODE_REASONS.damaged],
  ];
  for (const [text, reasonKey] of cases) {
    const res = await save.importCode(text);
    assert.deepEqual(res, { ok: false, reasonKey }, 'code: ' + text.slice(0, 30));
  }
  assert.deepEqual(await save.importCode(null), { ok: false, reasonKey: CODE_REASONS.invalid });
  assert.equal(save.load(1), null, 'nothing was written');
});

test('a code from a newer version is rejected', async () => {
  const newer = { ...journey(), v: SAVE_VERSION + 1 };
  for (const compress of [false, true]) {
    const code = await encodeJourneyCode(JSON.stringify(newer), compress);
    const save = createSave({ store: createStore(), storage: mapStorage() });
    assert.deepEqual(await save.importCode(code), { ok: false, reasonKey: CODE_REASONS.newer });
    assert.equal(save.load(1), null);
  }
});

test('decodeJourneyCode returns the parsed value', async () => {
  const value = { v: 1, text: 'קתרה ✦ Kethra' };
  for (const compress of [false, true]) {
    const dec = await decodeJourneyCode(await encodeJourneyCode(JSON.stringify(value), compress));
    assert.deepEqual(dec, { ok: true, value, reasonKey: null });
  }
});

test('import writes slot 1 even when the exported journey used another slot', async () => {
  const s = journey();
  s.meta.slot = 2;
  const code = await createSave({ store: createStore(s), storage: mapStorage() }).exportCode();
  const save = createSave({ store: createStore(), storage: mapStorage() });
  assert.equal((await save.importCode(code)).ok, true);
  assert.equal(save.load(1).meta.slot, 1);
  assert.equal(save.load(1).player.level, 14);
  assert.equal(save.lastSlot(), 1);
});
