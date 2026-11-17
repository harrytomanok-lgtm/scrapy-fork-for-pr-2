#!/usr/bin/env node
/**
 * Import rule (ARCHITECTURE 2.2) and the related source rules of 3.9 and 7.2:
 * - a file imports only its own package's directories, src/core/**, and 'three';
 * - only src/main.js and src/game/** import src/standins/** or src/game/** (each of those two folders may import
 *   itself); src/game/registry.gen.js imports the packages' index.js manifests;
 * - pure files (any logic/ or data/ subdirectory, and the core files of PURE_CORE) do not import 'three' and do not
 *   touch window or document at module scope;
 * - Math.random appears only in src/core/rng.js; localStorage only in src/core/dom.js.
 * Usage: node tools/check-imports.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_ROOT } from './gen-registry.mjs';

/** Package id -> its source directories under src/ (2.1). */
export const PACKAGE_DIRS = Object.freeze({
  world: ['world'], env: ['env', 'audio'], gfx: ['render', 'vfx'], actors: ['actors'], control: ['control'],
  combat: ['combat'], ai: ['ai'], rpg: ['rpg'], ui: ['ui'],
});

/** Core files that must stay loadable in Node (2.2). */
export const PURE_CORE = Object.freeze(['balance', 'formulas', 'feel', 'rng', 'math', 'store', 'events', 'defs', 'palette', 'ids', 'actions', 'i18n']);

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Blank out comments, string and template contents (keeping quotes and newlines) so code scans see code only.
 * Import specifiers are read before this.
 * @param {string} src
 * @returns {string}
 */
export function codeOnly(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Import specifiers of a module (static imports, re-exports, dynamic imports with a literal).
 * @param {string} src
 * @returns {string[]}
 */
export function importsOf(src) {
  const out = [];
  const re = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s+)?(['"])([^'"]+)\1|\bimport\(\s*(['"])([^'"]+)\3\s*\)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[2] || m[4]);
  return out;
}

/**
 * Whether `window` or `document` is used at module scope (outside any function or class body).
 * Braces of object literals at module scope count as module scope too.
 * @param {string} code output of codeOnly
 * @returns {boolean}
 */
export function touchesDomAtModuleScope(code) {
  // Track brace depth; a brace opened right after `=>`, `)` (function head) or `class X` starts a body.
  const bodyStack = [];
  let inBody = 0;
  const re = /[{}]|\bwindow\b|\bdocument\b/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[0] === '{') {
      const before = code.slice(Math.max(0, m.index - 80), m.index).trimEnd();
      const isBody = /(=>|\)|\bclass\s+[\w$]+(\s+extends\s+[\w$.]+)?|\belse|\btry|\bfinally|\bdo)$/.test(before)
        && !/\b(if|for|while|switch|catch)\s*\([^()]*\)$/.test(before);
      bodyStack.push(isBody);
      if (isBody) inBody++;
    } else if (m[0] === '}') {
      if (bodyStack.pop()) inBody--;
    } else if (inBody === 0) {
      const prev = code.slice(Math.max(0, m.index - 7), m.index);
      const next = code.slice(m.index + m[0].length, m.index + m[0].length + 3);
      // `typeof window`, a property access `x.window` and an object key `window:` are not uses.
      if (!/(typeof\s*|\.\s*)$/.test(prev) && !/^\s*:/.test(next)) return true;
    }
  }
  return false;
}

/**
 * Package of a file: 'core', 'game' (main.js and src/game), 'standins', a feature package id, or null.
 * @param {string} rel path relative to src/, with '/' separators
 * @returns {string|null}
 */
export function packageOf(rel) {
  if (rel === 'main.js' || rel.startsWith('game/')) return 'game';
  if (rel.startsWith('core/')) return 'core';
  if (rel.startsWith('standins/')) return 'standins';
  const top = rel.split('/')[0];
  for (const [id, dirs] of Object.entries(PACKAGE_DIRS)) if (dirs.includes(top)) return id;
  return null;
}

/** @param {string} rel @returns {boolean} */
export function isPure(rel) {
  if (/(^|\/)(logic|data)\//.test(rel)) return true;
  const m = /^core\/([\w]+)\.js$/.exec(rel);
  return !!m && PURE_CORE.includes(m[1]);
}

/**
 * Check the tree.
 * @param {{ root?:string }} [opts]
 * @returns {string[]} problems (empty = pass)
 */
export function checkImports(opts = {}) {
  const root = opts.root || GAME_ROOT;
  const srcDir = join(root, 'src');
  const problems = [];
  for (const file of jsFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    const src = readFileSync(file, 'utf8');
    const own = packageOf(rel);
    if (!own) problems.push(`src/${rel}: not inside a known package directory`);
    for (const spec of importsOf(src)) {
      if (spec === 'three') {
        if (isPure(rel)) problems.push(`src/${rel}: pure module imports 'three'`);
        continue;
      }
      if (!spec.startsWith('.')) {
        problems.push(`src/${rel}: imports '${spec}' (only 'three' and relative paths are allowed)`);
        continue;
      }
      const target = relative(srcDir, resolve(dirname(file), spec)).split(sep).join('/');
      if (target.startsWith('..')) {
        problems.push(`src/${rel}: imports '${spec}' outside src/`);
        continue;
      }
      if (!existsSync(join(srcDir, target))) problems.push(`src/${rel}: imports '${spec}', which does not exist`);
      const tp = packageOf(target);
      const ok = tp === 'core'
        || tp === own
        || (own === 'game' && tp === 'standins')
        || (rel === 'game/registry.gen.js' && /^[a-z]+\/index\.js$/.test(target) && tp !== null);
      if (!ok) problems.push(`src/${rel}: imports src/${target} (package '${tp}') from package '${own}'`);
    }
    const code = codeOnly(src);
    if (isPure(rel) && touchesDomAtModuleScope(code)) problems.push(`src/${rel}: pure module touches window or document at module scope`);
    if (rel !== 'core/rng.js' && /\bMath\.random\b/.test(code)) problems.push(`src/${rel}: Math.random (use ctx.rng)`);
    if (rel !== 'core/dom.js' && /\blocalStorage\b/.test(code)) problems.push(`src/${rel}: localStorage (use dom.safeStorage)`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkImports();
  for (const p of problems) console.error('check-imports: ' + p);
  console.log(`check-imports: ${problems.length ? problems.length + ' problem(s)' : 'ok'}`);
  process.exit(problems.length ? 1 : 0);
}
