/**
 * Localisation (ARCHITECTURE 4.14): Hebrew (default, RTL) and English, gendered address, plurals.
 * Template syntax inside a string:
 *   {name}               the value of args.name (numbers formatted by `num`)
 *   {g:masc/fem}         picks the form for the player's form of address (setGender)
 *   {p:n/one/many}       picks `one` when args.n === 1, else `many`
 * Forms may contain parameters, e.g. '{p:n/one bolt/{n} bolts}'. A '/' inside a nested {...} does not split.
 * Pure module: the root element is reached through an injected getter, never at module scope.
 * @module core/i18n
 */

/** @typedef {'he'|'en'} Lang */

export const LANGS = Object.freeze(['he', 'en']);
const DIRS = Object.freeze({ he: 'rtl', en: 'ltr' });

/**
 * Format a number with Western digits and comma thousands separators (1,240). Non-integers keep up to two decimals.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  const int = Math.floor(rounded);
  const frac = Math.round((rounded - int) * 100);
  let s = String(int);
  let out = '';
  while (s.length > 3) {
    out = ',' + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  out = s + out;
  if (frac > 0) out += '.' + String(frac).padStart(2, '0').replace(/0$/, '');
  return (neg && (int > 0 || frac > 0) ? '-' : '') + out;
}

/**
 * Split `body` on '/' at nesting depth 0.
 * @param {string} body @returns {string[]}
 */
function splitTop(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '/' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Expand a template.
 * @param {string} text
 * @param {object|null|undefined} args
 * @param {'m'|'f'} gender
 * @returns {string}
 */
export function formatTemplate(text, args, gender) {
  if (text.indexOf('{') < 0) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    let depth = 0;
    let close = -1;
    for (let j = open; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close < 0) {
      out += text.slice(open);
      break;
    }
    out += expand(text.slice(open + 1, close), args, gender);
    i = close + 1;
  }
  return out;
}

/** @param {string} body @param {object|null|undefined} args @param {'m'|'f'} gender @returns {string} */
function expand(body, args, gender) {
  if (body.startsWith('g:')) {
    const forms = splitTop(body.slice(2));
    const pick = gender === 'f' && forms.length > 1 ? forms[1] : forms[0];
    return formatTemplate(pick, args, gender);
  }
  if (body.startsWith('p:')) {
    const parts = splitTop(body.slice(2));
    const n = args ? args[parts[0]] : undefined;
    const one = parts.length > 1 ? parts[1] : '';
    const many = parts.length > 2 ? parts[2] : one;
    return formatTemplate(n === 1 ? one : many, args, gender);
  }
  if (args && Object.prototype.hasOwnProperty.call(args, body)) {
    const v = args[body];
    return typeof v === 'number' ? formatNumber(v) : String(v);
  }
  return '{' + body + '}';
}

/**
 * @typedef {object} I18n
 * @property {Lang} lang
 * @property {'rtl'|'ltr'} dir
 * @property {'m'|'f'} gender
 * @property {(key:string, args?:object|null) => string} t     missing keys render as '[key]' and are recorded once
 * @property {(lang:Lang) => void} setLang                      sets dir and lang on the root, emits lang:changed
 * @property {(g:'m'|'f') => void} setGender
 * @property {(tables:{ he?:object, en?:object }) => void} addStrings   later tables replace earlier keys
 * @property {(key:string) => boolean} has                      the key exists in the current language
 * @property {(n:number) => string} num
 * @property {() => string[]} missing                           keys requested but missing, in first-seen order
 * @property {(lang:Lang) => string[]} keys                     every key of one language
 */

/**
 * Create the i18n service.
 * @param {object} [opts]
 * @param {Lang} [opts.lang='he']
 * @param {{ emit(type:string, payload:object):void }} [opts.bus]
 * @param {() => ({ setAttribute(name:string, value:string):void }|null)} [opts.getRoot]  #app, read at call time
 * @param {{ warn(tag:string, ...args:any[]):void }} [opts.log]
 * @returns {I18n}
 */
export function createI18n(opts = {}) {
  /** @type {Record<Lang, Record<string, string>>} */
  const tables = { he: Object.create(null), en: Object.create(null) };
  const missingSet = new Set();
  const missingList = [];

  const i18n = {
    lang: /** @type {Lang} */ (LANGS.indexOf(opts.lang) >= 0 ? opts.lang : 'he'),
    dir: /** @type {'rtl'|'ltr'} */ ('rtl'),
    gender: /** @type {'m'|'f'} */ ('m'),

    t(key, args) {
      const text = tables[i18n.lang][key];
      if (text === undefined) {
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missingList.push(key);
          if (opts.log) opts.log.warn('i18n', 'missing key', key, i18n.lang);
        }
        return '[' + key + ']';
      }
      return formatTemplate(text, args, i18n.gender);
    },

    setLang(lang) {
      if (LANGS.indexOf(lang) < 0) {
        if (opts.log) opts.log.warn('i18n', 'unknown language', lang);
        return;
      }
      i18n.lang = lang;
      i18n.dir = DIRS[lang];
      const root = opts.getRoot ? opts.getRoot() : null;
      if (root) {
        root.setAttribute('lang', lang);
        root.setAttribute('dir', i18n.dir);
      }
      if (opts.bus) opts.bus.emit('lang:changed', { lang, dir: i18n.dir });
    },

    setGender(g) {
      i18n.gender = g === 'f' ? 'f' : 'm';
    },

    addStrings(t) {
      for (const lang of LANGS) {
        const src = t && t[lang];
        if (!src) continue;
        for (const k of Object.keys(src)) tables[lang][k] = String(src[k]);
      }
    },

    has(key) {
      return tables[i18n.lang][key] !== undefined;
    },

    num: formatNumber,

    missing() {
      return missingList.slice();
    },

    keys(lang) {
      return tables[lang] ? Object.keys(tables[lang]) : [];
    },
  };
  i18n.dir = DIRS[i18n.lang];
  return i18n;
}
