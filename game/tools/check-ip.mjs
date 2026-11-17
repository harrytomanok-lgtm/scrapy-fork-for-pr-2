#!/usr/bin/env node
/**
 * Originality check (ARCHITECTURE 2.5, GDD 1.6).
 * List 1 (FRANCHISE_TERMS): names and terms of existing franchises; fails when one appears anywhere in src/
 * (case-insensitive, whole words, also inside identifiers split at camelCase and underscores).
 * List 2 (RETIRED_TERMS): terms retired from earlier drafts of this design; matched as whole words inside string
 * tables (strings*.js) and content names (`name`, `title`, `label` fields and i18n `.name` / `.title` values) only,
 * never against code identifiers.
 * Usage: node tools/check-ip.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_ROOT } from './gen-registry.mjs';

/** Existing-franchise names and terms. Common English words that are also franchise terms are left out. */
export const FRANCHISE_TERMS = Object.freeze([
  // anime martial-arts franchises
  'dragon ball', 'dragonball', 'saiyan', 'super saiyan', 'kamehameha', 'kamehame', 'goku', 'kakarot', 'vegeta', 'gohan',
  'goten', 'frieza', 'freeza', 'krillin', 'kuririn', 'bulma', 'chi-chi', 'yamcha', 'tien shinhan', 'majin buu', 'kid buu',
  'beerus', 'whis', 'namek', 'namekian', 'kaioken', 'kaio-ken', 'genki dama', 'spirit bomb', 'senzu', 'shenron', 'shenlong',
  'capsule corp', 'kame house', 'master roshi', 'muten roshi', 'final flash', 'galick gun', 'masenko', 'destructo disc',
  'kienzan', 'solar flare', 'instant transmission', 'ultra instinct', 'zenkai', 'oozaru', 'great ape', 'scouter',
  'hyperbolic time chamber', 'king kai', 'kami sama', 'android 18', 'cell games',
  'naruto', 'rasengan', 'chidori', 'sharingan', 'rinnegan', 'hokage', 'jutsu', 'chakra', 'akatsuki', 'konoha',
  'bankai', 'zanpakuto', 'shinigami', 'hollowfication', 'one piece', 'haki', 'gomu gomu', 'jojo', 'stand user',
  'one punch', 'saitama', 'hunter x hunter', 'nen user', 'my hero academia',
  // games
  'hyrule', 'triforce', 'zelda', 'ganondorf', 'korok', 'sheikah', 'teyvat', 'mondstadt', 'liyue', 'paimon', 'genshin',
  'pokemon', 'pokémon', 'pikachu', 'pokeball', 'chocobo', 'moogle', 'materia', 'final fantasy', 'kingdom hearts',
  'keyblade', 'estus', 'dark souls', 'elden', 'erdtree', 'mario', 'luigi', 'bowser',
  'sonic the hedgehog', 'chaos emerald', 'kirby', 'metroid', 'master chief', 'fortnite', 'minecraft', 'warcraft', 'azeroth', 'overwatch', 'diablo', 'starcraft',
  // film and comics
  'jedi', 'sith', 'lightsaber', 'kryptonite', 'avengers', 'vibranium', 'mjolnir', 'hogwarts', 'horcrux',
  'middle-earth', 'mordor', 'hobbit', 'gandalf',
]);

/** Terms retired from earlier drafts of this design (GDD 1.6): bonfire vocabulary and borrowed power words. */
export const RETIRED_TERMS = Object.freeze([
  'kindle', 'rekindle', 'bonfire', 'kindled', 'rekindled', 'ki', 'ki blast', 'power level', 'power up', 'powering up', 'super form',
  'golden form', 'ascended', 'ascension form', 'energy ball', 'energy wave', 'spirit ball', 'aura burst', 'battle power',
  'hermit', 'sensei', 'dojo', 'dragon orb', 'wish orb', 'flying cloud', 'tail', 'scanner',
]);

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function sourceFiles(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(m?js|json|css|html|glsl)$/.test(name)) out.push(p);
  }
  return out;
}

/** @param {string} term @returns {RegExp} whole-word, case-insensitive, flexible separators */
export function termRegex(term) {
  const body = term.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Split identifiers at camelCase boundaries so `superSaiyanForm` reads as `super Saiyan Form`.
 * @param {string} text
 * @returns {string}
 */
function splitCamel(text) {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

/**
 * Content-name and string-table text of a file for the retired list.
 * @param {string} file @param {string} src
 * @returns {string[]}
 */
function contentTexts(file, src) {
  const out = [];
  const lit = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  if (/^strings.*\.js$/.test(basename(file))) {
    let m;
    while ((m = lit.exec(src))) out.push(m[2]);
    return out;
  }
  const field = /\b(?:name|title|label)\s*:\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = field.exec(src))) out.push(m[2]);
  return out;
}

/**
 * Check the tree.
 * @param {{ root?:string }} [opts]
 * @returns {string[]} problems (empty = pass)
 */
export function checkIp(opts = {}) {
  const root = opts.root || GAME_ROOT;
  const problems = [];
  const franchise = FRANCHISE_TERMS.map((t) => [t, termRegex(t)]);
  const retired = RETIRED_TERMS.map((t) => [t, termRegex(t)]);
  for (const file of sourceFiles(join(root, 'src'))) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const text = line + ' ' + splitCamel(line);
      for (const [t, re] of franchise) if (re.test(text)) problems.push(`${rel}:${i + 1}: franchise term '${t}'`);
    });
    for (const text of contentTexts(file, src)) {
      for (const [t, re] of retired) if (re.test(text)) problems.push(`${rel}: retired term '${t}' in "${text.slice(0, 60)}"`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkIp();
  for (const p of problems) console.error('check-ip: ' + p);
  console.log(`check-ip: ${problems.length ? problems.length + ' problem(s)' : 'ok'}`);
  process.exit(problems.length ? 1 : 0);
}
