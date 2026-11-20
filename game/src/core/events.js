/**
 * Event bus and the complete event catalog (ARCHITECTURE 3.6). Pure module.
 *
 * Rules: every type must be in {@link EVENTS}; emitting an unknown type throws in dev and test
 * (in production it is logged once and dropped). Payloads of `actor:damaged`, `combat:hit`,
 * `projectile:*` and `fx:impact` are pooled: listeners must not retain payload objects.
 * Positions in payloads are plain numbers `x, y, z`. Entity ids are numbers; 0 means none.
 * @module core/events
 */

import { FAULT_MAX_THROWS, FAULT_WINDOW_TICKS } from './constants.js';

/* ---------------------------------------------------------------- payloads -- */
/* Lifecycle and settings */
/** @typedef {{ phase:string, progress:number }} GameBootEvent  `game:boot` (foundation, world -> ui) */
/** @typedef {{}} GameReadyEvent  `game:ready` (foundation -> all) */
/** @typedef {{ paused:boolean, reason:string }} GamePausedEvent  `game:paused` (time -> env, ui); `paused` is the state after the change */
/** @typedef {{ slot:number }} GameNewGameEvent  `game:newGame` (session -> rpg) */
/** @typedef {{ slot:number, newGame:boolean }} GameLoadedEvent  `game:loaded` (session -> all) */
/** @typedef {{}} GameEndedEvent  `game:ended` (session -> all) */
/** @typedef {{ key:string, value:any }} SettingsChangedEvent  `settings:changed` (ui, foundation -> all) */
/** @typedef {{ lang:'he'|'en', dir:'rtl'|'ltr' }} LangChangedEvent  `lang:changed` (i18n -> ui, control) */
/** @typedef {{ tier:'low'|'high' }} QualityChangedEvent  `quality:changed` (gfx -> world, env, gfx, actors) */
/** @typedef {{ device:'kbm'|'touch'|'pad' }} InputDeviceEvent  `input:device` (input -> ui, control) */
/** @typedef {{ message:string, fatal:boolean }} ErrorEvent  `error` (foundation -> ui) */

/* World and environment */
/** @typedef {{ seed:number, ms:number }} WorldBakedEvent  `world:baked` (world -> env, rpg, ai) */
/** @typedef {{ x:number, y:number, z:number, radius:number, depth:number, deformed:boolean, sourceId:number }} WorldCraterEvent  `world:crater` */
/** @typedef {{ key:number, kind:string, x:number, y:number, z:number, sourceId:number }} WorldPropDestroyedEvent  `world:propDestroyed` */
/** @typedef {{ regionId:string, prevRegionId:string|null, first:boolean }} WorldRegionEnterEvent  `world:regionEnter` (player only) */
/** @typedef {{ poiId:string, type:string, x:number, z:number }} WorldPoiDiscoveredEvent  `world:poiDiscovered` (rpg) */
/** @typedef {{ factor:number }} WorldEdgeEvent  `world:edge` (control; 0..1 on a change of 0.1 or more) */
/** @typedef {{ hour:number, phase:'dawn'|'day'|'golden'|'dusk'|'night' }} EnvHourEvent  `env:hour` (env) */
/** @typedef {{ campId:string, regionId:string, day:number }} CampClearedEvent  `camp:cleared` (ai) */

/* Actors and movement */
/** @typedef {{ entId:number, kind:string, defId:string }} ActorSpawnedEvent  `actor:spawned` (ai, rpg, session) */
/** @typedef {{ entId:number, kind:string, defId:string }} ActorRemovedEvent  `actor:removed` (whoever destroys an actor) */
/** @typedef {{ targetId:number, sourceId:number, amount:number, crit:boolean, blocked:boolean, perfect:boolean, techId:string|null,
 *              kind:'melee'|'ora'|'true', x:number, y:number, z:number, hpAfter:number }} ActorDamagedEvent  `actor:damaged` (combat; pooled) */
/** @typedef {{ entId:number, amount:number }} ActorHealedEvent  `actor:healed` (combat) */
/** @typedef {{ entId:number, sourceId:number, kind:string, defId:string, level:number, questTag:string|null, x:number, y:number, z:number }} ActorDiedEvent  `actor:died` (combat) */
/** @typedef {{ entId:number, seconds:number, broken:boolean }} ActorStaggeredEvent  `actor:staggered` (combat) */
/** @typedef {{ entId:number, sourceId:number, speed:number, hurtle:boolean }} ActorKnockedEvent  `actor:knocked` (control) */
/** @typedef {{ entId:number, sourceId:number, x:number, y:number, z:number, speed:number, surface:'terrain'|'prop', damage:number }} ActorSlamEvent  `actor:slam` (control) */
/** @typedef {{ entId:number, speed:number, x:number, y:number, z:number }} ActorLandedEvent  `actor:landed` (control) */
/** @typedef {{ entId:number, surface:'grass'|'stone'|'snow'|'sand'|'water' }} ActorStepEvent  `actor:step` (actors; frame phase, cosmetic) */
/** @typedef {{ entId:number, mode:string, prev:string }} MoveModeEvent  `move:mode` (control) */
/** @typedef {{ entId:number }} MoveJumpEvent  `move:jump` (control) */
/** @typedef {{ entId:number, stage:0|1|2 }} MoveBoostEvent  `move:boost` (control) */

/* Combat */
/** @typedef {{ entId:number, techId:string, targetId:number }} CombatTechStartEvent  `combat:techStart` */
/** @typedef {{ entId:number, techId:string, phase:'windup'|'active'|'recover' }} CombatTechPhaseEvent  `combat:techPhase` */
/** @typedef {{ entId:number, techId:string, cancelled:boolean }} CombatTechEndEvent  `combat:techEnd` */
/** @typedef {{ attackerId:number, targetId:number, techId:string, class:string, amount:number, x:number, y:number, z:number,
 *              dirX:number, dirZ:number, blocked:boolean, perfect:boolean, crit:boolean }} CombatHitEvent  `combat:hit` (pooled; `class` is a feel class id) */
/** @typedef {{ entId:number, kind:'white'|'red'|'violet', seconds:number, shape:'self'|'ring'|'line'|'cone'|'circle', radius:number,
 *              x:number, y:number, z:number, dirX:number, dirZ:number }} CombatTelegraphEvent  `combat:telegraph` */
/** @typedef {{ entId:number, techId:string, level:number }} CombatChargeEvent  `combat:charge` (0..1, 10 Hz) */
/** @typedef {{ entId:number, on:boolean }} CombatGatherEvent  `combat:gather` */
/** @typedef {{ entId:number, on:boolean }} CombatGuardEvent  `combat:guard` */
/** @typedef {{ entId:number, kind:'guard'|'flicker', attackerId:number }} CombatPerfectEvent  `combat:perfect` */
/** @typedef {{ entId:number, fromX:number, fromY:number, fromZ:number, toX:number, toY:number, toZ:number }} CombatFlickerEvent  `combat:flicker` */
/** @typedef {{ entId:number, formId:string|null, prevFormId:string|null, first:boolean }} CombatFormEvent  `combat:form` */
/** @typedef {{ entId:number }} CombatBurnoutEvent  `combat:burnout` */
/** @typedef {{ entId:number, targetId:number }} CombatLockEvent  `combat:lock` (targetId 0 = released) */
/** @typedef {{ value:number, full:boolean }} CombatSurgeEvent  `combat:surge` (player only, on a change of 1 or more) */
/** @typedef {{ inCombat:boolean, threat:number }} CombatStateEvent  `combat:state` (on change; threat 0..1) */
/** @typedef {{ count:number }} CombatComboEvent  `combat:combo` */
/** @typedef {{ entId:number, fxId:string, ownerId:number, color:number }} ProjectileSpawnedEvent  `projectile:spawned` (pooled) */
/** @typedef {{ entId:number, fxId:string, hit:boolean, x:number, y:number, z:number }} ProjectileRemovedEvent  `projectile:removed` (pooled) */
/** @typedef {{ bossId:string, entId:number }} BossStartEvent  `boss:start` (ai) */
/** @typedef {{ bossId:string, entId:number, phase:number }} BossPhaseEvent  `boss:phase` (ai) */
/** @typedef {{ bossId:string, defeated:boolean }} BossEndEvent  `boss:end` (ai) */

/* Player, RPG, quests */
/** @typedef {{ entId:number }} PlayerSpawnedEvent  `player:spawned` (session) */
/** @typedef {{ x:number, y:number, z:number, bossId:string|null }} PlayerDiedEvent  `player:died` (combat) */
/** @typedef {{ ringstoneId:string|null, retry:boolean }} PlayerRespawnedEvent  `player:respawned` (rpg) */
/** @typedef {{ amount:number, total:number, source:string }} RpgXpEvent  `rpg:xp` */
/** @typedef {{ level:number, statPoints:number, tp:number }} RpgLevelUpEvent  `rpg:levelUp` */
/** @typedef {{}} RpgStatsEvent  `rpg:stats` (derived stats recomputed) */
/** @typedef {{ value:number, prev:number, milestone:number|null }} RpgResonanceEvent  `rpg:resonance` */
/** @typedef {{ amount:number, total:number }} RpgShellsEvent  `rpg:shells` */
/** @typedef {{ itemId:string, uid:number, delta:number, count:number }} RpgItemEvent  `rpg:item` */
/** @typedef {{ slot:string, uid:number|null, itemId:string|null }} RpgEquipEvent  `rpg:equip` */
/** @typedef {{ itemId:string }} RpgItemUsedEvent  `rpg:itemUsed` */
/** @typedef {{ nodeId:string, techId:string|null, rank:number }} RpgTechLearnedEvent  `rpg:techLearned` */
/** @typedef {{ formId:string }} RpgFormUnlockedEvent  `rpg:formUnlocked` */
/** @typedef {{}} RpgLoadoutEvent  `rpg:loadout` */
/** @typedef {{ entId:number, kind:'shells'|'item'|'xp', itemId:string|null, rarity:string|null }} PickupSpawnedEvent  `pickup:spawned` */
/** @typedef {{ kind:string, itemId:string|null, amount:number }} PickupCollectedEvent  `pickup:collected` */
/** @typedef {{ questId:string }} QuestStartedEvent  `quest:started` */
/** @typedef {{ questId:string, stepId:string, index:number }} QuestStepEvent  `quest:step` (a new step became active) */
/** @typedef {{ questId:string, stepId:string, count:number, need:number }} QuestProgressEvent  `quest:progress` */
/** @typedef {{ questId:string }} QuestCompletedEvent  `quest:completed` */
/** @typedef {{ questId:string|null }} QuestTrackedEvent  `quest:tracked` */
/** @typedef {{ dialogueId:string, npcId:string|null }} DialogueStartEvent  `dialogue:start` */
/** @typedef {{ dialogueId:string, nodeId:string, speakerId:string, textKey:string, choices:Array<{ textKey:string }> }} DialogueLineEvent  `dialogue:line` */
/** @typedef {{ dialogueId:string, npcId:string|null }} DialogueEndEvent  `dialogue:end` */
/** @typedef {{ id:string|null, kind:string|null, promptKey:string|null }} InteractFocusEvent  `interact:focus` (on change) */
/** @typedef {{ id:string, kind:string }} InteractUsedEvent  `interact:used` */
/** @typedef {{ id:string, first:boolean }} RingstoneActivatedEvent  `ringstone:activated` */
/** @typedef {{ id:string }} ShrineClaimedEvent  `shrine:claimed` */
/** @typedef {{ id:string }} ChestOpenedEvent  `chest:opened` */
/** @typedef {{ id:string, state:'closed'|'open'|'destroyed', regionId:string }} SiphonStateEvent  `siphon:state` */
/** @typedef {{ courseId:string }} RaceStartEvent  `race:start` */
/** @typedef {{ courseId:string, index:number, total:number }} RaceGateEvent  `race:gate` */
/** @typedef {{ courseId:string, seconds:number, medal:'none'|'bronze'|'silver'|'gold', finished:boolean }} RaceEndEvent  `race:end` */
/** @typedef {{ action:string|null, textKey:string|null }} TutorialPromptEvent  `tutorial:prompt` (action: an ACTION id, 'move' or 'look'; null clears) */

/* UI, feel, save, cinematics */
/** @typedef {{ id:string, open:boolean }} UiScreenEvent  `ui:screen` (ui) */
/** @typedef {{ key:string, args:object|null, kind:'info'|'good'|'warn' }} UiToastEvent  `ui:toast` (all) */
/** @typedef {{ kind:'level'|'quest'|'region'|'resonance'|'break'|'perfect'|'form'|'boss', key:string, args:object|null }} UiBannerEvent  `ui:banner` (all) */
/** @typedef {{ classId:string, x:number, y:number, z:number, scale:number }} FxImpactEvent  `fx:impact` (fx; pooled) */
/** @typedef {{ slot:number, ok:boolean, memoryOnly:boolean }} SaveWrittenEvent  `save:written` (save) */
/** @typedef {{ id:string, skippable:boolean }} CineStartEvent  `cine:start` (control) */
/** @typedef {{ id:string, skipped:boolean }} CineEndEvent  `cine:end` (control) */

/**
 * The complete catalog: event type -> payload field names (3.6). Frozen.
 * Adding an event is a foundation change; feature packages work with this catalog.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const EVENTS = deepFreeze({
  'game:boot': ['phase', 'progress'],
  'game:ready': [],
  'game:paused': ['paused', 'reason'],
  'game:newGame': ['slot'],
  'game:loaded': ['slot', 'newGame'],
  'game:ended': [],
  'settings:changed': ['key', 'value'],
  'lang:changed': ['lang', 'dir'],
  'quality:changed': ['tier'],
  'input:device': ['device'],
  'error': ['message', 'fatal'],

  'world:baked': ['seed', 'ms'],
  'world:crater': ['x', 'y', 'z', 'radius', 'depth', 'deformed', 'sourceId'],
  'world:propDestroyed': ['key', 'kind', 'x', 'y', 'z', 'sourceId'],
  'world:regionEnter': ['regionId', 'prevRegionId', 'first'],
  'world:poiDiscovered': ['poiId', 'type', 'x', 'z'],
  'world:edge': ['factor'],
  'env:hour': ['hour', 'phase'],
  'camp:cleared': ['campId', 'regionId', 'day'],

  'actor:spawned': ['entId', 'kind', 'defId'],
  'actor:removed': ['entId', 'kind', 'defId'],
  'actor:damaged': ['targetId', 'sourceId', 'amount', 'crit', 'blocked', 'perfect', 'techId', 'kind', 'x', 'y', 'z', 'hpAfter'],
  'actor:healed': ['entId', 'amount'],
  'actor:died': ['entId', 'sourceId', 'kind', 'defId', 'level', 'questTag', 'x', 'y', 'z'],
  'actor:staggered': ['entId', 'seconds', 'broken'],
  'actor:knocked': ['entId', 'sourceId', 'speed', 'hurtle'],
  'actor:slam': ['entId', 'sourceId', 'x', 'y', 'z', 'speed', 'surface', 'damage'],
  'actor:landed': ['entId', 'speed', 'x', 'y', 'z'],
  'actor:step': ['entId', 'surface'],
  'move:mode': ['entId', 'mode', 'prev'],
  'move:jump': ['entId'],
  'move:boost': ['entId', 'stage'],

  'combat:techStart': ['entId', 'techId', 'targetId'],
  'combat:techPhase': ['entId', 'techId', 'phase'],
  'combat:techEnd': ['entId', 'techId', 'cancelled'],
  'combat:hit': ['attackerId', 'targetId', 'techId', 'class', 'amount', 'x', 'y', 'z', 'dirX', 'dirZ', 'blocked', 'perfect', 'crit'],
  'combat:telegraph': ['entId', 'kind', 'seconds', 'shape', 'radius', 'x', 'y', 'z', 'dirX', 'dirZ'],
  'combat:charge': ['entId', 'techId', 'level'],
  'combat:gather': ['entId', 'on'],
  'combat:guard': ['entId', 'on'],
  'combat:perfect': ['entId', 'kind', 'attackerId'],
  'combat:flicker': ['entId', 'fromX', 'fromY', 'fromZ', 'toX', 'toY', 'toZ'],
  'combat:form': ['entId', 'formId', 'prevFormId', 'first'],
  'combat:burnout': ['entId'],
  'combat:lock': ['entId', 'targetId'],
  'combat:surge': ['value', 'full'],
  'combat:state': ['inCombat', 'threat'],
  'combat:combo': ['count', 'rank', 'rankId', 'expired', 'best'],
  'projectile:spawned': ['entId', 'fxId', 'ownerId', 'color'],
  'projectile:removed': ['entId', 'fxId', 'hit', 'x', 'y', 'z'],
  'boss:start': ['bossId', 'entId'],
  'boss:phase': ['bossId', 'entId', 'phase'],
  'boss:end': ['bossId', 'defeated'],

  'player:spawned': ['entId'],
  'player:died': ['x', 'y', 'z', 'bossId'],
  'player:respawned': ['ringstoneId', 'retry'],
  'rpg:xp': ['amount', 'total', 'source'],
  'rpg:levelUp': ['level', 'statPoints', 'tp'],
  'rpg:stats': [],
  'rpg:resonance': ['value', 'prev', 'milestone'],
  'rpg:shells': ['amount', 'total'],
  'rpg:item': ['itemId', 'uid', 'delta', 'count'],
  'rpg:equip': ['slot', 'uid', 'itemId'],
  'rpg:itemUsed': ['itemId'],
  'rpg:techLearned': ['nodeId', 'techId', 'rank'],
  'rpg:formUnlocked': ['formId'],
  'rpg:loadout': [],
  'pickup:spawned': ['entId', 'kind', 'itemId', 'rarity'],
  'pickup:collected': ['kind', 'itemId', 'amount'],
  'quest:started': ['questId'],
  'quest:step': ['questId', 'stepId', 'index'],
  'quest:progress': ['questId', 'stepId', 'count', 'need'],
  'quest:completed': ['questId'],
  'quest:tracked': ['questId'],
  'dialogue:start': ['dialogueId', 'npcId'],
  'dialogue:line': ['dialogueId', 'nodeId', 'speakerId', 'textKey', 'choices'],
  'dialogue:end': ['dialogueId', 'npcId'],
  'interact:focus': ['id', 'kind', 'promptKey'],
  'interact:used': ['id', 'kind'],
  'ringstone:activated': ['id', 'first'],
  'shrine:claimed': ['id'],
  'chest:opened': ['id'],
  'siphon:state': ['id', 'state', 'regionId'],
  'race:start': ['courseId'],
  'race:gate': ['courseId', 'index', 'total'],
  'race:end': ['courseId', 'seconds', 'medal', 'finished'],
  'tutorial:prompt': ['action', 'textKey'],

  'ui:screen': ['id', 'open'],
  'ui:toast': ['key', 'args', 'kind'],
  'ui:banner': ['kind', 'key', 'args'],
  'fx:impact': ['classId', 'x', 'y', 'z', 'scale'],
  'save:written': ['slot', 'ok', 'memoryOnly'],
  'cine:start': ['id', 'skippable'],
  'cine:end': ['id', 'skipped'],
});

/** A flush delivers at most this many posted events (guards against a listener that re-posts forever). */
const MAX_POSTS_PER_FLUSH = 10000;

/** Event types whose payload objects are pooled by the emitter (listeners must not retain them). */
export const POOLED_EVENTS = Object.freeze(['actor:damaged', 'combat:hit', 'projectile:spawned', 'projectile:removed', 'fx:impact']);

/**
 * @template T @param {T} obj @returns {T}
 */
function deepFreeze(obj) {
  for (const k of Object.keys(obj)) Object.freeze(/** @type {any} */ (obj)[k]);
  return Object.freeze(obj);
}

/**
 * True when `type` is in the catalog.
 * @param {string} type @returns {boolean}
 */
export function isEventType(type) {
  return Object.prototype.hasOwnProperty.call(EVENTS, type);
}

/**
 * @typedef {object} Bus
 * @property {(type:string, fn:(payload:any)=>void, owner?:string) => (() => void)} on
 *   Subscribe; returns an unsubscribe function. `owner` defaults to the context's current install owner (`ctx.owner`).
 * @property {(type:string, fn:Function) => void} off   Remove a listener (every registration of `fn` for `type`).
 * @property {(owner:string) => void} offOwner          Remove every listener registered under `owner`.
 * @property {(type:string, payload?:object) => void} emit   Deliver synchronously, in subscription order.
 * @property {(type:string, payload?:object) => void} post   Queue for delivery in the cleanup phase of the current tick.
 * @property {() => void} flush          Deliver the post queue (called by `core.cleanup`); posts made while flushing are delivered in the same flush.
 * @property {(fn:(type:string, payload:any)=>void) => (() => void)} onAny
 *   Observe every delivered event (the debug event recorder). Same no-retain rule.
 * @property {(type:string) => number} listenerCount
 */

/**
 * @typedef {object} BusOptions
 * @property {boolean} [strict]   Dev and test: unknown types throw, missing payload fields are logged once per type.
 * @property {object}  [ctx]      Context read at call time for `ctx.log`, `ctx.time.tick` and the default owner `ctx.owner`.
 */

/**
 * @typedef {{ fn:Function, owner:string|undefined, dead:boolean, faults:number[], disabled:boolean }} Listener
 */

/**
 * Create the event bus.
 * @param {BusOptions} [opts]
 * @returns {Bus}
 */
export function createBus(opts = {}) {
  const strict = !!opts.strict;
  const ctx = /** @type {any} */ (opts.ctx || null);
  /** @type {Record<string, Listener[]>} */
  const table = Object.create(null);
  for (const type of Object.keys(EVENTS)) table[type] = [];
  /** @type {Listener[]} */
  let anyListeners = [];
  /** @type {string[]} */
  const qType = [];
  /** @type {any[]} */
  const qPayload = [];
  let flushing = false;
  /** @type {Set<string>} */
  const warned = new Set();
  const EMPTY = Object.freeze({});

  function log(level, ...args) {
    const l = ctx && ctx.log;
    if (l && typeof l[level] === 'function') l[level]('bus', ...args);
  }

  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    log('warn', ...args);
  }

  /** @param {string} type */
  function check(type) {
    if (table[type]) return true;
    if (strict) throw new Error(`bus: unknown event type '${type}'`);
    warnOnce('unknown:' + type, `unknown event type '${type}' dropped`);
    return false;
  }

  /** @param {string} type @param {any} payload */
  function checkFields(type, payload) {
    const fields = EVENTS[type];
    for (let i = 0; i < fields.length; i++) {
      if (!(fields[i] in payload)) {
        warnOnce('field:' + type, `event '${type}' payload is missing '${fields[i]}'`);
        return;
      }
    }
  }

  /**
   * Record a listener fault; disable after FAULT_MAX_THROWS throws within FAULT_WINDOW_TICKS.
   * @param {Listener} l @param {string} type @param {unknown} err
   */
  function fault(l, type, err) {
    const tick = ctx && ctx.time ? ctx.time.tick : 0;
    l.faults.shift();
    l.faults.push(tick);
    log('error', `listener of '${type}' threw:`, err);
    if (tick - l.faults[0] < FAULT_WINDOW_TICKS) {
      l.disabled = true;
      log('warn', `listener of '${type}' (owner ${l.owner || 'none'}) disabled after ${FAULT_MAX_THROWS} throws`);
    }
  }

  /** @param {string} type @param {any} payload */
  function deliver(type, payload) {
    const list = table[type];
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.dead || l.disabled) continue;
      try {
        l.fn(payload);
      } catch (err) {
        fault(l, type, err);
      }
    }
    const any = anyListeners;
    for (let i = 0; i < any.length; i++) {
      const l = any[i];
      if (l.dead || l.disabled) continue;
      try {
        l.fn(type, payload);
      } catch (err) {
        fault(l, type, err);
      }
    }
  }

  /** @param {Function} fn @param {string|undefined} owner @returns {Listener} */
  function makeListener(fn, owner) {
    const faults = [];
    for (let i = 0; i < FAULT_MAX_THROWS; i++) faults.push(-Infinity);
    return { fn, owner, dead: false, faults, disabled: false };
  }

  /** @param {string} type @param {(l:Listener)=>boolean} pred */
  function removeWhere(type, pred) {
    const list = table[type];
    let hit = false;
    for (let i = 0; i < list.length; i++) if (pred(list[i])) { hit = true; break; }
    if (!hit) return;
    const next = [];
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (pred(l)) l.dead = true;
      else next.push(l);
    }
    table[type] = next;
  }

  /** @type {Bus} */
  const bus = {
    on(type, fn, owner) {
      if (!check(type)) return () => {};
      if (typeof fn !== 'function') throw new TypeError(`bus.on('${type}'): listener must be a function`);
      const l = makeListener(fn, owner !== undefined ? owner : (ctx && ctx.owner) || undefined);
      table[type] = table[type].concat([l]);
      return () => removeWhere(type, (x) => x === l);
    },
    off(type, fn) {
      if (!table[type]) return;
      removeWhere(type, (x) => x.fn === fn);
    },
    offOwner(owner) {
      for (const type in table) removeWhere(type, (x) => x.owner === owner);
      if (anyListeners.some((x) => x.owner === owner)) {
        for (const l of anyListeners) if (l.owner === owner) l.dead = true;
        anyListeners = anyListeners.filter((x) => !x.dead);
      }
    },
    emit(type, payload) {
      if (!check(type)) return;
      const p = payload === undefined ? EMPTY : payload;
      if (strict) checkFields(type, p);
      deliver(type, p);
    },
    post(type, payload) {
      if (!check(type)) return;
      const p = payload === undefined ? EMPTY : payload;
      if (strict) checkFields(type, p);
      qType.push(type);
      qPayload.push(p);
    },
    flush() {
      if (flushing) return;
      flushing = true;
      try {
        for (let i = 0; i < qType.length; i++) {
          if (i >= MAX_POSTS_PER_FLUSH) {
            log('error', `post queue exceeded ${MAX_POSTS_PER_FLUSH} events in one flush; the rest were dropped`);
            break;
          }
          deliver(qType[i], qPayload[i]);
          qPayload[i] = null;
        }
      } finally {
        qType.length = 0;
        qPayload.length = 0;
        flushing = false;
      }
    },
    onAny(fn) {
      const l = makeListener(fn, (ctx && ctx.owner) || undefined);
      anyListeners = anyListeners.concat([l]);
      return () => {
        l.dead = true;
        anyListeners = anyListeners.filter((x) => x !== l);
      };
    },
    listenerCount(type) {
      const list = table[type];
      if (!list) return 0;
      let n = 0;
      for (let i = 0; i < list.length; i++) if (!list[i].disabled) n++;
      return n;
    },
  };
  return bus;
}
