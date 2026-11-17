/**
 * The one JSON store for everything persistent (ARCHITECTURE 3.7). Runtime objects are never stored.
 * Pure module: no three, no DOM.
 * @module core/store
 */

/** Save schema version written by this build. */
export const SAVE_VERSION = 1;

/** Application version recorded in `meta.appVersion`. */
export const APP_VERSION = '0.1.0';

/**
 * A fresh default journey state (save schema version 1, ARCHITECTURE 3.7). Every call returns a new object.
 * @returns {object}
 */
export function defaultState() {
  return {
    v: SAVE_VERSION,
    meta: { slot: 1, createdAt: 0, savedAt: 0, playSeconds: 0, appVersion: APP_VERSION },
    player: {
      preset: 'hero_a', gender: 'm', difficulty: 'warrior',
      level: 1, xp: 0, statPoints: 0, tp: 0, autoStyle: 'balanced',
      base: { mgt: 5, spr: 5, vit: 5, swf: 5 },
      hp: 196, ora: 125, surge: 0, awakened: false, canFly: false,
      x: -1650, y: 0, z: 1860, yaw: 0,
      respawn: 'ringstone_sparkstead',
      forms: [],
      selectedForm: null,
      nodes: [],
      techs: ['strike_string', 'breaker', 'ora_bolt', 'guard', 'flicker_step', 'pursuit'],
      slots: [null, null], ultimate: null,
    },
    inv: {
      shells: 0, nextUid: 1,
      items: [],
      equip: { wraps: null, garb: null, charm1: null, charm2: null },
      quick: 'sunfruit',
    },
    quests: {
      active: {},
      done: [], tracked: null,
      flags: {},
    },
    world: {
      hour: 7, day: 1,
      discovered: [],
      regionsSeen: [], ringstones: [], shrines: [], chests: [], siphons: [],
      races: {},
      bosses: [],
      camps: {},
    },
    stats: { kills: 0, deaths: 0, maxCombo: 0, metresFlown: 0, craters: 0, propsSmashed: 0 },
  };
}

/**
 * Deep clone of a JSON value.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneJson(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * @typedef {object} Store
 * @property {object} state                 the live state object (its identity never changes; reset replaces its contents)
 * @property {(path:string) => any} get     dotted path read, undefined when missing
 * @property {(path:string, value:any) => void} set   dotted path write; creates missing parent objects; marks dirty
 * @property {(state?:object) => void} reset          replace everything with a deep copy of `state` (default: defaultState())
 * @property {() => object} snapshot        deep clone of the state
 * @property {boolean} dirty                true after set or reset until clearDirty
 * @property {() => void} clearDirty
 */

/**
 * Create the store.
 * @param {object} [initial]  initial state (deep-copied); defaults to defaultState()
 * @returns {Store}
 */
export function createStore(initial) {
  /** @type {Map<string, string[]>} split paths, cached so repeated reads allocate nothing */
  const paths = new Map();
  const split = (path) => {
    let parts = paths.get(path);
    if (!parts) {
      parts = path.split('.');
      paths.set(path, parts);
    }
    return parts;
  };

  const store = {
    state: {},
    dirty: false,

    get(path) {
      const parts = split(path);
      let o = store.state;
      for (let i = 0; i < parts.length; i++) {
        if (o === null || typeof o !== 'object') return undefined;
        o = o[parts[i]];
      }
      return o;
    },

    set(path, value) {
      const parts = split(path);
      let o = store.state;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (o[k] === null || typeof o[k] !== 'object') o[k] = {};
        o = o[k];
      }
      o[parts[parts.length - 1]] = value;
      store.dirty = true;
    },

    reset(state) {
      const next = state ? cloneJson(state) : defaultState();
      const s = store.state;
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, next);
      store.dirty = true;
    },

    snapshot() {
      return cloneJson(store.state);
    },

    clearDirty() {
      store.dirty = false;
    },
  };
  store.reset(initial);
  store.dirty = false;
  return store;
}
