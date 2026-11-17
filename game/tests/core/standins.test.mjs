import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefs } from '../../src/core/defs.js';
import { IDS } from '../../src/core/ids.js';
import { standinDefs } from '../../src/standins/content.js';

/** IDS keys that are catalogs of assets or keys, not defs kinds (3.8): they have no definitions. */
const NOT_DEFS = ['prop', 'clip', 'vfx', 'sfx', 'feel', 'modKey'];

test('the stand-in content defines every id of IDS in its defs kind (8.0)', () => {
  const all = standinDefs();
  const kinds = Object.keys(IDS).filter((k) => NOT_DEFS.indexOf(k) < 0);
  assert.equal(kinds.length, 18, 'eighteen defs kinds are catalogued in IDS');
  for (const kind of kinds) {
    assert.ok(Array.isArray(all[kind]), 'stand-in kind ' + kind);
    const have = new Set(all[kind].map((d) => d.id));
    for (const id of IDS[kind]) assert.ok(have.has(id), `stand-in definition for ${kind}:${id}`);
  }
});

test('with zero feature packages defs.validate() passes on the stand-in content (3.1 step 5)', () => {
  const defs = createDefs({ strict: true });
  const all = standinDefs();
  for (const kind of Object.keys(all)) defs.register(kind, all[kind]);
  const r = defs.validate();
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});
