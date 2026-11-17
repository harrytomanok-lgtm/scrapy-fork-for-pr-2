import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { genRegistry, registrySource, REGISTRY_ORDER } from '../../tools/gen-registry.mjs';

/** A temporary game folder with package manifests for `dirs`. */
function tree(dirs) {
  const root = mkdtempSync(join(tmpdir(), 'kethra-reg-'));
  mkdirSync(join(root, 'src', 'game'), { recursive: true });
  for (const d of dirs) {
    mkdirSync(join(root, 'src', d), { recursive: true });
    writeFileSync(join(root, 'src', d, 'index.js'), `export const pkg = { id: '${d}', install(ctx) { ctx.installed.push('${d}'); } };\n`);
  }
  return root;
}

test('the install order is fixed (2.3)', () => {
  assert.deepEqual(REGISTRY_ORDER, ['render', 'vfx', 'world', 'env', 'audio', 'actors', 'control', 'combat', 'ai', 'rpg', 'ui']);
});

test('only directories with index.js are imported, in registry order', async () => {
  const root = tree(['ui', 'world', 'render', 'rpg']);
  try {
    mkdirSync(join(root, 'src', 'combat'));
    writeFileSync(join(root, 'src', 'combat', 'other.js'), 'export {};\n');
    const r = genRegistry({ root });
    assert.deepEqual(r.found, ['render', 'world', 'rpg', 'ui'], 'combat without index.js is skipped');
    const mod = await import(pathToFileURL(r.file).href);
    assert.deepEqual(mod.PACKAGE_DIRS, ['render', 'world', 'rpg', 'ui']);
    const ctx = { installed: [] };
    for (const p of mod.PACKAGES) p.install(ctx);
    assert.deepEqual(ctx.installed, ['render', 'world', 'rpg', 'ui']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing feature directory is skipped; no packages gives an empty registry', async () => {
  const root = tree([]);
  try {
    const r = genRegistry({ root });
    assert.deepEqual(r.found, []);
    const mod = await import(pathToFileURL(r.file).href);
    assert.deepEqual(mod.PACKAGES, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removing any one feature directory still produces a valid registry', async () => {
  for (const removed of REGISTRY_ORDER) {
    const root = tree(REGISTRY_ORDER.filter((d) => d !== removed));
    try {
      const r = genRegistry({ root });
      assert.equal(r.found.includes(removed), false);
      assert.equal(r.found.length, REGISTRY_ORDER.length - 1);
      const mod = await import(pathToFileURL(r.file).href + '?' + removed);
      assert.equal(mod.PACKAGES.length, REGISTRY_ORDER.length - 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('the file is rewritten only when its content changes', () => {
  const root = tree(['world']);
  try {
    assert.equal(genRegistry({ root }).changed, true);
    assert.equal(genRegistry({ root }).changed, false);
    assert.equal(readFileSync(join(root, 'src', 'game', 'registry.gen.js'), 'utf8'), registrySource(['world']));
    assert.equal(genRegistry({ root, write: false }).changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
