#!/usr/bin/env node
/**
 * Smoke test (ARCHITECTURE 2.5, 8.0): the foundation scenario list of tools/scenarios/foundation.mjs, run in
 * headless Chromium; every scenario also asserts that `__GAME__.errors` stays empty. Exit code 1 on failure.
 * Usage: node tools/smoke.mjs [--only <name>]
 */
import { runScenarios } from './lib/harness.mjs';
import { scenarios } from './scenarios/foundation.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--only');
const only = i >= 0 ? argv[i + 1] : null;
const r = await runScenarios(scenarios, { only, label: 'foundation' });
console.log(`smoke: ${r.passed} passed, ${r.failed} failed`);
process.exit(r.failed ? 1 : 0);
