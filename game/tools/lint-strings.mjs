#!/usr/bin/env node
/**
 * String lint (ARCHITECTURE 2.5, ART_UX 7.1):
 * 1. every key of every string table exists in both `he` and `en`;
 * 2. every literal `t('key')` in src/ exists in a table;
 * 3. no Hebrew literals and no user-facing English literals inside src/ui or src/control outside strings files;
 * 4. Hebrew UI strings do not start with a bare imperative (dialogue keys `<questId>.lNN`, `*.idle.*`, `*.bark.*`
 *    are exempt).
 * String tables are the `{ he:{...}, en:{...} }` exports of src/core/strings.js and of every `strings*.js` file
 * under a package directory.
 * Usage: node tools/lint-strings.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GAME_ROOT } from './gen-registry.mjs';

/**
 * Hebrew imperative verb forms (masculine, feminine and plural) that must not open a UI string. UI verbs are
 * infinitives (לדבר, לפתוח, לאסוף, לקנות, לקום).
 */
export const HEBREW_IMPERATIVES = Object.freeze([
  'לחץ', 'לחצי', 'לחצו', 'הקש', 'הקישי', 'הקישו', 'בחר', 'בחרי', 'בחרו', 'פתח', 'פתחי', 'פתחו', 'סגור', 'סגרי', 'סגרו',
  'אסוף', 'אספי', 'אספו', 'קנה', 'קני', 'קנו', 'מכור', 'מכרי', 'מכרו', 'דבר', 'דברי', 'דברו', 'קום', 'קומי', 'קומו',
  'בוא', 'בואי', 'בואו', 'שמור', 'שמרי', 'שמרו', 'טען', 'טעני', 'טענו', 'העתק', 'העתיקי', 'העתיקו', 'הדבק', 'הדביקי',
  'הדביקו', 'נסה', 'נסי', 'נסו', 'המשך', 'המשיכי', 'המשיכו', 'חזור', 'חזרי', 'חזרו', 'צא', 'צאי', 'צאו', 'היכנס',
  'היכנסי', 'היכנסו', 'השתמש', 'השתמשי', 'השתמשו', 'עוף', 'עופי', 'עופו', 'קפוץ', 'קפצי', 'קפצו', 'תקוף', 'תקפי', 'תקפו',
  'הגן', 'הגיני', 'הגינו', 'הפעל', 'הפעילי', 'הפעילו', 'שחזר', 'שחזרי', 'שחזרו', 'מצא', 'מצאי', 'מצאו', 'עקוב', 'עקבי',
  'עקבו', 'חכה', 'חכי', 'חכו', 'תן', 'תני', 'תנו', 'קח', 'קחי', 'קחו', 'הקשב', 'הקשיבי', 'הקשיבו', 'שים', 'שימי', 'שימו',
  'רוץ', 'רוצי', 'רוצו', 'הטען', 'התחל', 'התחילי', 'התחילו', 'עצור', 'עצרי', 'עצרו', 'לבש', 'לבשי', 'לבשו', 'צייד', 'ציידי',
  'ציידו', 'למד', 'למדי', 'למדו', 'שדרג', 'שדרגי', 'שדרגו', 'הצטרף', 'הצטרפי', 'הצטרפו', 'גע', 'געי', 'געו',
]);

/** Keys exempt from the imperative rule: dialogue lines and barks. */
export function isDialogueKey(key) {
  return /^[a-z]+\d*\.l\d+/.test(key) || /\.idle\./.test(key) || /\.bark\./.test(key);
}

/** @param {string} dir @param {string[]} [out] @returns {string[]} every .js file under dir */
function jsFiles(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** @param {string} file @returns {boolean} */
export function isStringsFile(file) {
  return /^strings.*\.js$/.test(basename(file));
}

/**
 * Remove comments, keeping string and template literals (and line structure).
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
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
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * String literals of a source text, with line numbers.
 * @param {string} src comment-free source
 * @returns {Array<{ text:string, line:number, quote:string }>}
 */
export function literals(src) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(src))) out.push({ text: m[2], line: src.slice(0, m.index).split('\n').length, quote: m[1] });
  return out;
}

/** Plain English sentence or phrase shown to a player: two or more words, starts with a capital letter. */
const ENGLISH_UI = /^[A-Z][a-z']+(?: [A-Za-z'][a-z']*)+[.!?…:]?$/;
const HEBREW = /[֐-׿]/;

/**
 * Lint the tree.
 * @param {{ root?:string }} [opts]
 * @returns {Promise<string[]>} problems (empty = pass)
 */
export async function lintStrings(opts = {}) {
  const root = opts.root || GAME_ROOT;
  const src = join(root, 'src');
  const files = jsFiles(src);
  const problems = [];
  /** @type {Record<'he'|'en', Map<string, string>>} */
  const all = { he: new Map(), en: new Map() };

  for (const file of files.filter(isStringsFile)) {
    let mod;
    try {
      mod = await import(pathToFileURL(file).href);
    } catch (e) {
      problems.push(`${relative(root, file)}: cannot be imported in Node (${e.message})`);
      continue;
    }
    for (const [name, value] of Object.entries(mod)) {
      if (!value || typeof value !== 'object' || !value.he || !value.en || typeof value.he !== 'object') continue;
      const where = `${relative(root, file)} (${name})`;
      for (const k of Object.keys(value.he)) if (!(k in value.en)) problems.push(`${where}: '${k}' has no English text`);
      for (const k of Object.keys(value.en)) if (!(k in value.he)) problems.push(`${where}: '${k}' has no Hebrew text`);
      for (const lang of ['he', 'en']) for (const [k, v] of Object.entries(value[lang])) all[lang].set(k, String(v));
    }
  }

  for (const [key, text] of all.he) {
    if (isDialogueKey(key)) continue;
    const first = text.trim().split(/[\s,.:;!?״"'()\-–—]+/)[0];
    if (HEBREW_IMPERATIVES.includes(first)) problems.push(`he '${key}': starts with the imperative '${first}' (use an infinitive)`);
  }

  for (const file of files) {
    const rel = relative(root, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    // t('a.b') and i18n.t('a.b') / ctx.i18n.t("a.b"): the character before `t(` is not part of an identifier.
    const tre = /(?:^|[^\w$])t\(\s*(['"])([a-z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1\s*[,)]/gm;
    let m;
    while ((m = tre.exec(code))) {
      const key = m[2];
      if (!all.en.has(key) && !all.he.has(key)) problems.push(`${rel}: t('${key}') has no string`);
    }
    const inUi = rel.startsWith(join('src', 'ui')) || rel.startsWith(join('src', 'control'));
    if (!inUi || isStringsFile(file)) continue;
    const lines = code.split('\n');
    for (const lit of literals(code)) {
      const line = lines[lit.line - 1] || '';
      if (/\b(log|console)\.(info|warn|error)\(|new (Type|Range)?Error\(/.test(line)) continue;
      if (HEBREW.test(lit.text)) problems.push(`${rel}:${lit.line}: Hebrew literal outside a strings file`);
      else if (ENGLISH_UI.test(lit.text.trim())) problems.push(`${rel}:${lit.line}: user-facing English literal '${lit.text}' outside a strings file`);
    }
  }
  return [...new Set(problems)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = await lintStrings();
  for (const p of problems) console.error('lint-strings: ' + p);
  console.log(`lint-strings: ${problems.length ? problems.length + ' problem(s)' : 'ok'}`);
  process.exit(problems.length ? 1 : 0);
}
