/**
 * Versioned saves, settings, slots, autosave policy and the journey code (ARCHITECTURE 3.7).
 * Storage is injected (a dom.safeStorage-like object) so this module runs in Node. Every storage access is inside
 * try/catch; on failure an in-memory Map is used and `memoryOnly` becomes true.
 * Pure module: no three, no DOM.
 * @module core/save
 */
import { SAVE_VERSION, APP_VERSION, defaultState, cloneJson } from './store.js';

export { SAVE_VERSION };

/** Number of journey slots the API accepts (the P0 UI uses slot 1). */
export const SLOT_COUNT = 3;
/** Size budget of one serialised journey, in characters. */
export const SIZE_BUDGET = 32 * 1024;
/** Seconds out of combat between timed autosaves. */
export const AUTOSAVE_INTERVAL = 120;
/** Events that request an autosave. */
export const AUTOSAVE_EVENTS = Object.freeze(['ringstone:activated', 'quest:step', 'rpg:levelUp', 'boss:end']);

/** Storage keys. */
export const STORAGE_KEYS = Object.freeze({
  /** @param {number} n @returns {string} */
  slot: (n) => 'kethra.v1.slot.' + n,
  settings: 'kethra.v1.settings',
  last: 'kethra.v1.last',
});

/** i18n keys returned by importCode as `reasonKey`. */
export const CODE_REASONS = Object.freeze({
  invalid: 'core.save.codeInvalid',
  damaged: 'core.save.codeDamaged',
  newer: 'core.save.codeNewer',
  unsupported: 'core.save.codeUnsupported',
  slotNewer: 'core.save.slotNewer',
});

/** Default settings, shared by all journeys (ARCHITECTURE 3.7). */
export const DEFAULT_SETTINGS = Object.freeze({
  lang: 'he', quality: 'auto', volMaster: 0.8, volMusic: 0.7, volSfx: 0.9, camSens: 1, invertY: false, leftHanded: false,
  pitchFlight: false, vibration: true, shake: 1, reducedMotion: false, photosensitive: false, textScale: 1, damageNumbers: true,
  shortTransform: false,
});

/** Allowed values of the enumerated settings. */
const SETTING_ENUMS = Object.freeze({ lang: ['he', 'en'], quality: ['auto', 'low', 'high'] });

/**
 * Migrations: MIGRATIONS[v] turns a state of version v into version v + 1. Version 1 is the first released
 * schema, so the table is empty; add an entry here whenever SAVE_VERSION is raised.
 * @type {Readonly<Record<number, (state:object) => object>>}
 */
export const MIGRATIONS = Object.freeze({});

/** @param {any} v @returns {boolean} */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Fill keys missing from `target` with copies of `defaults`, recursing into plain objects.
 * @param {object} target @param {object} defaults @returns {object} target
 */
function fillDefaults(target, defaults) {
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    if (target[k] === undefined) target[k] = cloneJson(d);
    else if (isObj(d) && isObj(target[k])) fillDefaults(target[k], d);
  }
  return target;
}

/**
 * Migrate a parsed state up to `version`. Returns a new object; never mutates the input.
 * @param {any} state
 * @param {Readonly<Record<number, (state:object) => object>>} [migrations=MIGRATIONS]
 * @param {number} [version=SAVE_VERSION]
 * @returns {object|null} null when the input is not a state, is newer than `version`, or a migration is missing
 */
export function migrateState(state, migrations = MIGRATIONS, version = SAVE_VERSION) {
  if (!isObj(state) || !Number.isInteger(state.v) || state.v < 0) return null;
  if (state.v > version) return null;
  let s = cloneJson(state);
  while (s.v < version) {
    const fn = migrations[s.v];
    if (typeof fn !== 'function') return null;
    const from = s.v;
    s = fn(s) || s;
    s.v = from + 1;
  }
  return fillDefaults(s, defaultState());
}

/**
 * Shape check of a migrated state: the fields every package reads exist with the right types.
 * @param {any} s
 * @returns {boolean}
 */
export function validateState(s) {
  if (!isObj(s) || !Number.isInteger(s.v)) return false;
  const { meta, player: p, inv, quests: q, world: w, stats } = s;
  if (!isObj(meta) || !isObj(p) || !isObj(inv) || !isObj(q) || !isObj(w) || !isObj(stats)) return false;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!Number.isInteger(p.level) || p.level < 1 || !num(p.xp) || !num(p.hp) || !num(p.ora) || !num(p.surge)) return false;
  if (!num(p.x) || !num(p.y) || !num(p.z) || !num(p.yaw) || !num(p.statPoints) || !num(p.tp)) return false;
  if (!isObj(p.base) || !num(p.base.mgt) || !num(p.base.spr) || !num(p.base.vit) || !num(p.base.swf)) return false;
  if (!Array.isArray(p.forms) || !Array.isArray(p.nodes) || !Array.isArray(p.techs) || !Array.isArray(p.slots) || p.slots.length !== 2) return false;
  if (p.gender !== 'm' && p.gender !== 'f') return false;
  if (!num(inv.shells) || !Number.isInteger(inv.nextUid) || !Array.isArray(inv.items) || !isObj(inv.equip)) return false;
  for (const it of inv.items) if (!isObj(it) || !Number.isInteger(it.uid) || typeof it.itemId !== 'string' || !num(it.count)) return false;
  if (!isObj(q.active) || !Array.isArray(q.done) || !isObj(q.flags)) return false;
  if (!num(w.hour) || !num(w.day) || !isObj(w.races) || !isObj(w.camps)) return false;
  for (const k of ['discovered', 'regionsSeen', 'ringstones', 'shrines', 'chests', 'siphons', 'bosses']) if (!Array.isArray(w[k])) return false;
  return true;
}

// ---------------------------------------------------------------- journey code encoding

/** @param {Uint8Array} bytes @returns {string} */
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text @returns {Uint8Array} throws on characters outside base64url */
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Run bytes through a CompressionStream or DecompressionStream.
 * @param {Uint8Array} bytes @param {{ writable:WritableStream, readable:ReadableStream }} stream @returns {Promise<Uint8Array>}
 */
async function pipeBytes(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** @returns {boolean} true when deflate-raw streams are available */
export function compressionAvailable() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * Encode a JSON string as a journey code: 'K1.' + base64url(deflate-raw(utf8)) when `compress` and the streams
 * exist (falling back to K0 if compression fails), else 'K0.' + base64url(utf8).
 * @param {string} json
 * @param {boolean} [compress=compressionAvailable()]
 * @returns {Promise<string>}
 */
export async function encodeJourneyCode(json, compress = compressionAvailable()) {
  const bytes = new TextEncoder().encode(json);
  if (compress && compressionAvailable()) {
    try {
      return 'K1.' + toBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    } catch (e) {
      // deflate-raw unsupported by this CompressionStream: the uncompressed form below is always valid
    }
  }
  return 'K0.' + toBase64Url(bytes);
}

/**
 * Decode a journey code into its parsed JSON value. Never throws.
 * Whitespace anywhere in the text is ignored (codes pasted across lines).
 * @param {string} text
 * @returns {Promise<{ ok:boolean, value:any, reasonKey:string|null }>}
 */
export async function decodeJourneyCode(text) {
  const fail = (reasonKey) => ({ ok: false, value: null, reasonKey });
  try {
    const t = typeof text === 'string' ? text.replace(/\s+/g, '') : '';
    const kind = t.slice(0, 3);
    if (kind !== 'K0.' && kind !== 'K1.') return fail(CODE_REASONS.invalid);
    let bytes = fromBase64Url(t.slice(3));
    if (kind === 'K1.') {
      if (typeof DecompressionStream !== 'function') return fail(CODE_REASONS.unsupported);
      bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return { ok: true, value, reasonKey: null };
  } catch (e) {
    return fail(CODE_REASONS.damaged);
  }
}

// ---------------------------------------------------------------- the save service

/**
 * @typedef {object} SaveOptions
 * @property {import('./store.js').Store} store
 * @property {{ get(key:string):string|null, set(key:string, value:string):void, remove(key:string):void, memoryOnly?:boolean }} [storage]
 *           dom.safeStorage or localStorage; absent = memory only. A `memoryOnly: true` flag on it is honoured.
 * @property {boolean} [memoryOnly=false]   force memory-only storage (test mode, nosave=1)
 * @property {boolean} [autosave=true]      false: request() is ignored (test mode)
 * @property {{ on(type:string, fn:Function, owner?:string):Function, emit(type:string, payload:object):void }} [bus]
 *           when given, save emits save:written / settings:changed and listens to the autosave triggers
 * @property {{ warn(tag:string, ...args:any[]):void }} [log]
 * @property {() => number} [now=Date.now]  wall clock for meta timestamps (never used by the sim)
 * @property {() => ({ pos:{ x:number, y:number, z:number }, yaw:number }|null)} [getPlayer]   read at call time
 * @property {(ringstoneId:string) => ({ x:number, y:number, z:number }|null)} [ringstonePos]   snaps the position on load
 * @property {(x:number, z:number) => string} [regionAt]    region id for slots()
 * @property {boolean} [compression]        force K1 (true) or K0 (false) journey codes; default: available streams
 */

/**
 * @typedef {object} Save
 * @property {boolean} memoryOnly
 * @property {object} settings
 * @property {string|null} pending        the pending autosave reason, or null
 * @property {() => Array<{ slot:number, exists:boolean, level:number, playSeconds:number, savedAt:number, regionId:string }>} slots
 * @property {(reason?:string) => boolean} write
 * @property {(slot:number) => object|null} load
 * @property {(slot:number) => void} erase
 * @property {(reason:string) => void} request
 * @property {(key:string, value:any) => boolean} setSetting
 * @property {() => Promise<string>} exportCode
 * @property {(text:string) => Promise<{ ok:boolean, reasonKey:string|null }>} importCode
 * @property {(state:object) => object|null} migrate
 * @property {(fn:(state:object) => void) => () => void} onBeforeSave
 * @property {(fn:(state:object) => void) => () => void} onAfterLoad
 * @property {(state?:object) => void} runAfterLoad
 * @property {(dt:number) => void} tick
 * @property {() => number|null} lastSlot
 * @property {() => void} dispose
 */

/**
 * Create the save service (ctx.save).
 *
 * Autosave policy: `request(reason)` marks a save as pending; `tick(dt)`, called once per sim tick in the cleanup
 * phase, adds play time, issues a timed request every 120 s out of combat, and writes a pending save when allowed:
 * a journey is running (between game:loaded and game:ended), not in combat (combat:state), not in a cinematic
 * (cine:start / cine:end), and autosave is enabled (off in test mode). A request made while not allowed waits.
 * Without a bus there are no lifecycle events, so the journey counts as running from creation.
 * @param {SaveOptions} opts
 * @returns {Save}
 */
export function createSave(opts) {
  const store = opts.store;
  const storage = opts.storage || null;
  const log = opts.log || null;
  const bus = opts.bus || null;
  const now = opts.now || Date.now;
  const autosaveEnabled = opts.autosave !== false;
  const mem = new Map();
  let memoryOnly = !!opts.memoryOnly || !storage;
  const beforeHooks = [];
  const afterHooks = [];
  const warned = new Set();
  /** @type {Function[]} bus unsubscribe functions */
  const unsubs = [];

  let active = false;
  let inCombat = false;
  let inCine = false;
  let timer = 0;
  /** @type {string|null} */
  let pending = null;

  const warnOnce = (key, ...args) => {
    if (warned.has(key)) return;
    warned.add(key);
    if (log) log.warn('save', ...args);
  };
  const toMemory = (e) => {
    if (!memoryOnly) warnOnce('storage', 'storage unavailable, keeping progress in memory', e && e.message);
    memoryOnly = true;
  };
  const syncFlag = () => {
    if (storage && storage.memoryOnly === true) memoryOnly = true;
  };

  const read = (key) => {
    if (!memoryOnly) {
      try {
        const v = storage.get(key);
        syncFlag();
        if (!memoryOnly) return v === undefined ? null : v;
      } catch (e) {
        toMemory(e);
      }
    }
    return mem.has(key) ? mem.get(key) : null;
  };
  const put = (key, value) => {
    mem.set(key, value);
    if (memoryOnly) return;
    try {
      storage.set(key, value);
      syncFlag();
    } catch (e) {
      toMemory(e);
    }
  };
  const drop = (key) => {
    mem.delete(key);
    if (memoryOnly) return;
    try {
      storage.remove(key);
    } catch (e) {
      toMemory(e);
    }
  };

  const clampSlot = (slot) => (Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT ? slot : 1);

  /** @param {string|null} raw @returns {boolean} true when the stored journey has a newer schema version */
  const isNewer = (raw) => {
    if (!raw) return false;
    const m = /^\{"v":(\d+)/.exec(raw);
    return !!m && Number(m[1]) > SAVE_VERSION;
  };

  const runHooks = (list, state, tag) => {
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](state);
      } catch (e) {
        if (log) log.warn('save', tag + ' hook failed', e && e.message);
      }
    }
  };

  /** Copy the player position and run the onBeforeSave hooks into the live state. */
  const prepare = () => {
    const s = store.state;
    const ent = opts.getPlayer ? opts.getPlayer() : null;
    if (ent && ent.pos && s.player) {
      s.player.x = ent.pos.x;
      s.player.y = ent.pos.y;
      s.player.z = ent.pos.z;
      s.player.yaw = ent.yaw;
    }
    runHooks(beforeHooks, s, 'onBeforeSave');
  };

  const writeSlot = (slot, json) => {
    const key = STORAGE_KEYS.slot(slot);
    if (isNewer(read(key))) {
      warnOnce('newer' + slot, 'slot ' + slot + ' holds a newer save version; not overwritten');
      return false;
    }
    if (json.length > SIZE_BUDGET) warnOnce('size', 'save is ' + json.length + ' bytes, over the 32 KB budget');
    put(key, json);
    put(STORAGE_KEYS.last, String(slot));
    return true;
  };

  const loadSettings = () => {
    const out = { ...DEFAULT_SETTINGS };
    const raw = read(STORAGE_KEYS.settings);
    if (!raw) return out;
    try {
      const parsed = JSON.parse(raw);
      if (isObj(parsed)) for (const k of Object.keys(DEFAULT_SETTINGS)) if (validSetting(k, parsed[k])) out[k] = parsed[k];
    } catch (e) {
      warnOnce('settings', 'settings unreadable, using defaults');
    }
    return out;
  };

  const save = {
    get memoryOnly() {
      syncFlag();
      return memoryOnly;
    },
    get pending() {
      return pending;
    },
    settings: /** @type {any} */ (null),

    slots() {
      const out = [];
      for (let n = 1; n <= SLOT_COUNT; n++) {
        const s = save.load(n);
        out.push(s
          ? { slot: n, exists: true, level: s.player.level, playSeconds: s.meta.playSeconds, savedAt: s.meta.savedAt,
            regionId: opts.regionAt ? opts.regionAt(s.player.x, s.player.z) : '' }
          : { slot: n, exists: false, level: 0, playSeconds: 0, savedAt: 0, regionId: '' });
      }
      return out;
    },

    write(reason) {
      let ok = false;
      const slot = clampSlot(store.state.meta && store.state.meta.slot);
      try {
        prepare();
        const meta = store.state.meta;
        const t = now();
        if (!meta.createdAt) meta.createdAt = t;
        meta.savedAt = t;
        meta.appVersion = APP_VERSION;
        ok = writeSlot(slot, JSON.stringify(store.state));
      } catch (e) {
        if (log) log.warn('save', 'write failed', reason || '', e && e.message);
      }
      pending = null;
      timer = 0;
      if (bus) bus.emit('save:written', { slot, ok, memoryOnly: save.memoryOnly });
      return ok;
    },

    load(slot) {
      const n = clampSlot(slot);
      const raw = read(STORAGE_KEYS.slot(n));
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        warnOnce('parse' + n, 'slot ' + n + ' is damaged');
        return null;
      }
      const s = migrateState(parsed);
      if (!s || !validateState(s)) return null;
      s.meta.slot = n;
      const pos = opts.ringstonePos && s.player.respawn ? opts.ringstonePos(s.player.respawn) : null;
      if (pos) {
        s.player.x = pos.x;
        s.player.y = pos.y;
        s.player.z = pos.z;
      }
      return s;
    },

    erase(slot) {
      const n = clampSlot(slot);
      drop(STORAGE_KEYS.slot(n));
      if (save.lastSlot() === n) drop(STORAGE_KEYS.last);
    },

    request(reason) {
      if (!autosaveEnabled) return;
      if (pending === null) pending = reason || 'request';
    },

    setSetting(key, value) {
      if (!(key in DEFAULT_SETTINGS) || !validSetting(key, value)) {
        if (log) log.warn('save', 'rejected setting', key);
        return false;
      }
      save.settings[key] = value;
      put(STORAGE_KEYS.settings, JSON.stringify(save.settings));
      if (bus) bus.emit('settings:changed', { key, value });
      return true;
    },

    async exportCode() {
      prepare();
      const compress = typeof opts.compression === 'boolean' ? opts.compression : compressionAvailable();
      return encodeJourneyCode(JSON.stringify(store.state), compress);
    },

    async importCode(text) {
      try {
        const dec = await decodeJourneyCode(text);
        if (!dec.ok) return { ok: false, reasonKey: dec.reasonKey };
        const v = dec.value;
        if (isObj(v) && Number.isInteger(v.v) && v.v > SAVE_VERSION) return { ok: false, reasonKey: CODE_REASONS.newer };
        const s = migrateState(v);
        if (!s || !validateState(s)) return { ok: false, reasonKey: CODE_REASONS.damaged };
        s.meta.slot = 1;
        if (!writeSlot(1, JSON.stringify(s))) return { ok: false, reasonKey: CODE_REASONS.slotNewer };
        return { ok: true, reasonKey: null };
      } catch (e) {
        return { ok: false, reasonKey: CODE_REASONS.damaged };
      }
    },

    migrate(state) {
      return migrateState(state);
    },

    onBeforeSave(fn) {
      beforeHooks.push(fn);
      return () => {
        const i = beforeHooks.indexOf(fn);
        if (i >= 0) beforeHooks.splice(i, 1);
      };
    },

    onAfterLoad(fn) {
      afterHooks.push(fn);
      return () => {
        const i = afterHooks.indexOf(fn);
        if (i >= 0) afterHooks.splice(i, 1);
      };
    },

    /** Run the onAfterLoad hooks (session.start step 5). @param {object} [state=store.state] */
    runAfterLoad(state) {
      runHooks(afterHooks, state || store.state, 'onAfterLoad');
    },

    tick(dt) {
      if (!active) return;
      const meta = store.state.meta;
      if (meta) meta.playSeconds += dt;
      if (!inCombat) {
        timer += dt;
        if (timer >= AUTOSAVE_INTERVAL) {
          timer = 0;
          save.request('timer');
        }
      }
      if (pending !== null && !inCombat && !inCine) save.write(pending);
    },

    lastSlot() {
      const raw = read(STORAGE_KEYS.last);
      const n = raw === null ? NaN : Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT ? n : null;
    },

    dispose() {
      for (const off of unsubs) off();
      unsubs.length = 0;
    },
  };

  save.settings = loadSettings();

  if (bus) {
    const owner = 'core.save';
    const onTrigger = (type) => () => save.request(type);
    for (const type of AUTOSAVE_EVENTS) unsubs.push(bus.on(type, onTrigger(type), owner));
    unsubs.push(bus.on('combat:state', (p) => { inCombat = !!(p && p.inCombat); }, owner));
    unsubs.push(bus.on('cine:start', () => { inCine = true; }, owner));
    unsubs.push(bus.on('cine:end', () => { inCine = false; }, owner));
    unsubs.push(bus.on('game:loaded', () => {
      active = true;
      inCombat = false;
      inCine = false;
      timer = 0;
      pending = null;
    }, owner));
    unsubs.push(bus.on('game:ended', () => {
      active = false;
      pending = null;
    }, owner));
  } else {
    active = true;
  }
  return save;
}

/**
 * @param {string} key @param {any} value @returns {boolean} true when `value` is valid for setting `key`
 */
function validSetting(key, value) {
  const d = DEFAULT_SETTINGS[key];
  if (d === undefined || typeof value !== typeof d) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  const e = SETTING_ENUMS[key];
  return !e || e.indexOf(value) >= 0;
}
