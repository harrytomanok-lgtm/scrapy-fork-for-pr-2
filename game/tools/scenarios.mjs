#!/usr/bin/env node
/**
 * Scenario runner (ARCHITECTURE 2.5): loads tools/scenarios/*.mjs (each exports
 * `scenarios: [{ name, width?, height?, query?, run({ page, game, shot, assert }) }]`), runs them one browser at a
 * time, prints pass or fail, and exits with code 1 on any failure.
 * Usage: node tools/scenarios.mjs [packageId] [--only name]
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runScenarios } from './lib/harness.mjs';
import { GAME_ROOT } from './gen-registry.mjs';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--only');
const only = oi >= 0 ? argv[oi + 1] : null;
const pkgId = argv.find((a, idx) => !a.startsWith('--') && (oi < 0 || idx !== oi + 1)) || null;
const dir = join(GAME_ROOT, 'tools', 'scenarios');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort() : [];
const chosen = pkgId ? files.filter((f) => f === pkgId + '.mjs') : files;
if (pkgId && chosen.length === 0) {
  console.error(`no scenario file tools/scenarios/${pkgId}.mjs`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
for (const f of chosen) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const list = Array.isArray(mod.scenarios) ? mod.scenarios : [];
  if (only && !list.some((s) => s.name === only)) continue;
  const r = await runScenarios(list, { only, label: f.replace(/\.mjs$/, '') });
  passed += r.passed;
  failed += r.failed;
}
if (only && passed + failed === 0) {
  console.error(`no scenario named '${only}'`);
  process.exit(1);
}
console.log(`scenarios: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
