import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredShadows, setShadows } from '../../src/ui/screens/other.js';

/** A ctx with a storage map, a settings object and a renderer that records setShadows. */
function fakeCtx(stored, settings, raw) {
  const store = new Map(stored ? Object.entries(stored) : []);
  const calls = [];
  const ctx = {
    flags: { raw: raw || {} },
    dom: { safeStorage: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) } },
    save: {
      settings: { shadows: true, ...(settings || {}) },
      setSetting(k, v) {
        if (typeof v !== 'boolean') return false;
        this.settings[k] = v;
        return true;
      },
    },
    render: { setShadows: (on) => calls.push(on), caps: { shadowSize: 1024 } },
  };
  return { ctx, store, calls };
}

test('shadows: the old per-device key moves into the setting once and is removed', () => {
  const { ctx, store, calls } = fakeCtx({ 'kethra.ui.shadows': '0' });
  applyStoredShadows(ctx);
  assert.equal(ctx.save.settings.shadows, false);
  assert.equal(store.has('kethra.ui.shadows'), false, 'old key removed');
  assert.deepEqual(calls, [false], 'off applied');
  const on = fakeCtx({ 'kethra.ui.shadows': '1' }, { shadows: false });
  applyStoredShadows(on.ctx);
  assert.equal(on.ctx.save.settings.shadows, true);
  assert.deepEqual(on.calls, [], 'on leaves the renderer its own choice');
});

test('shadows: without an old key the setting applies; the URL flag wins', () => {
  const a = fakeCtx(null, { shadows: false });
  applyStoredShadows(a.ctx);
  assert.deepEqual(a.calls, [false]);
  const b = fakeCtx(null, { shadows: false }, { shadows: '1' });
  applyStoredShadows(b.ctx);
  assert.deepEqual(b.calls, [], '?shadows=1 is not overridden');
  const c = fakeCtx(null, { shadows: true });
  applyStoredShadows(c.ctx);
  assert.deepEqual(c.calls, []);
});

test('shadows: the Settings switch writes the setting and the renderer', () => {
  const { ctx, calls } = fakeCtx();
  setShadows(ctx, false);
  assert.equal(ctx.save.settings.shadows, false);
  setShadows(ctx, true);
  assert.equal(ctx.save.settings.shadows, true);
  assert.deepEqual(calls, [false, true]);
});
