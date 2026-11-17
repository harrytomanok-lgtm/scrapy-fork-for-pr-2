/**
 * Entity registry `ctx.ents` (ARCHITECTURE 3.5).
 *
 * Entities are plain objects of one stable shape. Ids are unique and never reused within a session;
 * entity objects themselves are pooled, so hold ids, never Entity references, across ticks.
 * Lists are kept in id order (ids only grow, so appending preserves it).
 * @module core/ents
 */

import { Vector3, Quaternion, Matrix4 } from 'three';
import { ENT_CAPS, ENT_KINDS } from './constants.js';
import { initTmp } from './math.js';

initTmp({ Vector3, Quaternion, Matrix4 });

/** Entity tag bits (3.5). */
export const TAG = Object.freeze({ GROUNDED_ONLY: 1, FLYER: 2, BOSS: 4, ELITE: 8, QUEST: 16, NO_LOCK: 32, INVULNERABLE: 64, SCRIPTED: 128, DESTRUCTIBLE: 256 });

/** Kind bits for spatial queries (3.5). */
export const KIND_MASK = Object.freeze({
  player: 1, enemy: 2, boss: 4, npc: 8, projectile: 16, pickup: 32, object: 64,
  ACTORS: 1 | 2 | 4 | 8, HOSTILE_TARGETS: 2 | 4 | 64, ALL: 127,
});

/**
 * @typedef {'player'|'enemy'|'boss'|'npc'|'projectile'|'pickup'|'object'} EntityKind
 */

/**
 * @typedef {object} Entity     Stable shape: every field exists from creation (null when unused).
 * @property {number} id        Unique, never reused within a session.
 * @property {EntityKind} kind
 * @property {string} defId     Definition id (enemy id, npc id, object kind...). '' when unset.
 * @property {boolean} alive    False from the tick it is destroyed or killed.
 * @property {0|1|2} team       0 neutral, 1 player side, 2 hostile.
 * @property {Vector3} pos      Feet position (for flyers: body bottom).
 * @property {Vector3} prev     Position at the previous tick.
 * @property {Vector3} vel
 * @property {number} yaw
 * @property {number} radius    Capsule radius.
 * @property {number} height    Capsule height.
 * @property {number} level
 * @property {object|null} intent  Intent (3.5), written by control (player) or ai, read by move.
 * @property {object|null} move    MoveState, owned by the move service.
 * @property {object|null} stats   ActorStats, see 3.5 for writers.
 * @property {object|null} combat  CombatState, owned by combat.
 * @property {object|null} brain   Private to ai.
 * @property {object|null} visual  Private to actors.
 * @property {object|null} data    Private to the creator.
 * @property {string|null} questTag
 * @property {number} tags      Bit mask of TAG.
 * @property {string|null} nameKey  i18n key of the display name.
 */

/** Default capsule radius and height for a new entity. */
const DEFAULT_RADIUS = 0.5;
const DEFAULT_HEIGHT = 1.8;

/** Fields an `init` object may set, other than the vectors. */
const SCALAR_FIELDS = new Set(['defId', 'alive', 'team', 'yaw', 'radius', 'height', 'level', 'intent', 'move', 'stats', 'combat',
  'brain', 'visual', 'data', 'questTag', 'tags', 'nameKey']);
const VECTOR_FIELDS = new Set(['pos', 'prev', 'vel']);

/** @returns {Entity} */
function makeEntity() {
  return {
    id: 0, kind: 'object', defId: '', alive: false, team: 0,
    pos: new Vector3(), prev: new Vector3(), vel: new Vector3(),
    yaw: 0, radius: DEFAULT_RADIUS, height: DEFAULT_HEIGHT, level: 1,
    intent: null, move: null, stats: null, combat: null, brain: null, visual: null, data: null,
    questTag: null, tags: 0, nameKey: null,
  };
}

/** @param {Entity} e */
function resetEntity(e) {
  e.id = 0; e.defId = ''; e.alive = false; e.team = 0;
  e.pos.set(0, 0, 0); e.prev.set(0, 0, 0); e.vel.set(0, 0, 0);
  e.yaw = 0; e.radius = DEFAULT_RADIUS; e.height = DEFAULT_HEIGHT; e.level = 1;
  e.intent = null; e.move = null; e.stats = null; e.combat = null; e.brain = null; e.visual = null; e.data = null;
  e.questTag = null; e.tags = 0; e.nameKey = null;
}

/** Cap group of each kind. */
const CAP_GROUP = Object.freeze({ player: 'actors', enemy: 'actors', boss: 'actors', npc: 'actors', projectile: 'projectile', pickup: 'pickup', object: 'object' });

/**
 * Remove `e` from `list` keeping order, without allocating.
 * @param {Entity[]} list @param {Entity} e
 */
function removeOrdered(list, e) {
  const i = list.indexOf(e);
  if (i < 0) return;
  for (let j = i; j < list.length - 1; j++) list[j] = list[j + 1];
  list.length--;
}

/**
 * @typedef {object} Ents
 * @property {(kind:EntityKind, init?:object) => Entity|null} create
 *   New entity; `init` holds partial fields (vectors may be `{x,y,z}`). `prev` starts equal to `pos`
 *   unless given. Returns null beyond the cap (logged once per cap group). Emits nothing.
 * @property {(id:number) => boolean} destroy  Sets `alive = false` now; removal happens in the cleanup phase. False for unknown ids.
 * @property {(id:number) => Entity|null} get  Includes entities destroyed this tick until cleanup.
 * @property {(kind:EntityKind) => Entity[]} list  Live array in id order (do not mutate or retain across ticks). Includes entities
 *   destroyed or killed this tick (check `alive`).
 * @property {() => Entity[]} all              Every entity in id order, same rules as `list`.
 * @property {(kind:EntityKind) => number} count  Entities of the kind that exist (created and not yet removed by cleanup).
 * @property {(ent:Entity, alpha:number, out:Vector3) => Vector3} renderPos  lerp(prev, pos, alpha) into `out`.
 * @property {() => void} copyPrev             `core.prev` internal: copy pos into prev for every entity.
 * @property {() => void} flush                `core.cleanup` internal: remove destroyed entities. Also callable outside the loop (session end).
 */

/**
 * Create the entity registry.
 * @param {object} [ctx] Context read at call time for `ctx.log`.
 * @returns {Ents}
 */
export function createEnts(ctx) {
  const c = /** @type {any} */ (ctx || {});
  /** @type {Map<number, Entity>} */
  const byId = new Map();
  /** @type {Record<string, Entity[]>} */
  const lists = Object.create(null);
  for (const k of ENT_KINDS) lists[k] = [];
  /** @type {Entity[]} */
  const allList = [];
  /** @type {Entity[]} */
  const pending = [];
  /** @type {Entity[]} */
  const free = [];
  /** @type {Record<string, number>} */
  const groupCount = { actors: 0, projectile: 0, pickup: 0, object: 0 };
  /** @type {Set<string>} */
  const warned = new Set();
  const EMPTY = Object.freeze([]);
  let nextId = 1;

  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    if (c.log && typeof c.log.warn === 'function') c.log.warn('ents', ...args);
  }

  /** @param {Entity} e @param {object} init */
  function applyInit(e, init) {
    const src = /** @type {any} */ (init);
    for (const key in src) {
      const v = src[key];
      if (VECTOR_FIELDS.has(key)) {
        if (v) /** @type {any} */ (e)[key].set(v.x || 0, v.y || 0, v.z || 0);
      } else if (SCALAR_FIELDS.has(key)) {
        /** @type {any} */ (e)[key] = v;
      } else {
        warnOnce('init:' + key, `ents.create: unknown init field '${key}' ignored (entity shape is fixed)`);
      }
    }
  }

  /** @type {Ents} */
  const ents = {
    create(kind, init) {
      const group = CAP_GROUP[kind];
      if (!group) throw new Error(`ents.create: unknown kind '${kind}'`);
      if (groupCount[group] >= ENT_CAPS[group]) {
        warnOnce('cap:' + group, `entity cap reached for ${group} (${ENT_CAPS[group]}); create returned null`);
        return null;
      }
      const e = free.length > 0 ? /** @type {Entity} */ (free.pop()) : makeEntity();
      e.id = nextId++;
      e.kind = kind;
      e.alive = true;
      if (init) applyInit(e, init);
      if (!init || !(/** @type {any} */ (init).prev)) e.prev.copy(e.pos);
      byId.set(e.id, e);
      lists[kind].push(e);
      allList.push(e);
      groupCount[group]++;
      return e;
    },

    destroy(id) {
      const e = byId.get(id);
      if (!e) return false;
      e.alive = false;
      if (pending.indexOf(e) < 0) pending.push(e);
      return true;
    },

    get(id) {
      return byId.get(id) || null;
    },

    list(kind) {
      return lists[kind] || /** @type {Entity[]} */ (/** @type {unknown} */ (EMPTY));
    },

    all() {
      return allList;
    },

    count(kind) {
      const l = lists[kind];
      return l ? l.length : 0;
    },

    renderPos(ent, alpha, out) {
      const a = ent.prev;
      const b = ent.pos;
      return out.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
    },

    copyPrev() {
      for (let i = 0; i < allList.length; i++) allList[i].prev.copy(allList[i].pos);
    },

    flush() {
      for (let i = 0; i < pending.length; i++) {
        const e = pending[i];
        byId.delete(e.id);
        removeOrdered(lists[e.kind], e);
        removeOrdered(allList, e);
        groupCount[CAP_GROUP[e.kind]]--;
        resetEntity(e);
        free.push(e);
      }
      pending.length = 0;
    },
  };
  return ents;
}
