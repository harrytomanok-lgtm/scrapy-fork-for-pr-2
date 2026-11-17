import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { genRegistry, registrySource, REGISTRY_ORDER, STANDIN_ORDER, standinsFor, GAME_ROOT } from '../../tools/gen-registry.mjs';

/** Every stand-in module name gen-registry can import. */
const STANDIN_NAMES = ['content', 'residual', ...STANDIN_ORDER.map(([n]) => n)];

/** A temporary game folder with package manifests for `dirs` and a stub for every stand-in module. */
function tree(dirs) {
  const root = mkdtempSync(join(tmpdir(), 'kethra-reg-'));
  mkdirSync(join(root, 'src', 'game'), { recursive: true });
  mkdirSync(join(root, 'src', 'standins'), { recursive: true });
  for (const n of STANDIN_NAMES) {
    writeFileSync(join(root, 'src', 'standins', n + '.js'), `export function install(ctx) { ctx.installed.push('standin:${n}'); }\n`);
  }
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

test('stand-ins are generated only for slots no package provides', () => {
  assert.deepEqual(standinsFor(REGISTRY_ORDER.slice()), ['residual'], 'every package: only the residual definitions');
  assert.deepEqual(standinsFor([]), ['content', ...STANDIN_ORDER.map(([n]) => n)], 'no package: every stand-in');
  assert.deepEqual(standinsFor(REGISTRY_ORDER.filter((d) => d !== 'control')), ['content', 'move', 'cam']);
  assert.deepEqual(standinsFor(REGISTRY_ORDER.filter((d) => d !== 'rpg')), ['content', 'rpg', 'quests']);
  for (const dir of REGISTRY_ORDER) {
    const list = standinsFor(REGISTRY_ORDER.filter((d) => d !== dir));
    assert.equal(list[0], 'content', `without ${dir} the full stand-in content is installed`);
    assert.ok(list.length >= 2, `without ${dir} its stand-in(s) are installed`);
  }
  const mapped = new Set(STANDIN_ORDER.map(([, d]) => d));
  for (const dir of REGISTRY_ORDER) assert.ok(mapped.has(dir), `${dir} replaces at least one stand-in`);
});

test('a missing package directory falls back to its stand-in modules in the generated registry', async () => {
  const root = tree(REGISTRY_ORDER.filter((d) => d !== 'control' && d !== 'ui'));
  try {
    const r = genRegistry({ root });
    assert.deepEqual(r.standins, ['content', 'move', 'cam', 'ui']);
    const mod = await import(pathToFileURL(r.file).href);
    assert.deepEqual(mod.STANDINS.map(([n]) => n), ['content', 'move', 'cam', 'ui']);
    const ctx = { installed: [] };
    for (const [, m] of mod.STANDINS) m.install(ctx);
    for (const p of mod.PACKAGES) p.install(ctx);
    assert.deepEqual(ctx.installed.slice(0, 4), ['standin:content', 'standin:move', 'standin:cam', 'standin:ui']);
    assert.equal(ctx.installed.length, 4 + REGISTRY_ORDER.length - 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every package present: no replaced stand-in is imported', async () => {
  const root = tree(REGISTRY_ORDER);
  try {
    const r = genRegistry({ root });
    assert.deepEqual(r.standins, ['residual']);
    assert.equal(/standins\/(?!residual)/.test(r.source), false, r.source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every stand-in module the registry can name exists and exports install', async () => {
  for (const n of STANDIN_NAMES) {
    const file = join(GAME_ROOT, 'src', 'standins', n + '.js');
    const src = readFileSync(file, 'utf8');
    assert.match(src, /export function install\(ctx\)/, n);
  }
});
