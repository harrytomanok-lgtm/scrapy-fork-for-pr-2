/**
 * Definition registry (ARCHITECTURE 3.8). Content is plain frozen data registered by the owning package;
 * other packages read it by id only. `validate` checks every cross-reference marked "ref" in section 5.
 * Pure module: no three, no DOM.
 * @module core/defs
 */
import { IDS } from './ids.js';

/** @param {object} o @returns {object} */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/** Dialogue speakers that are not definitions. */
const SPEAKERS = Object.freeze(['tavi', 'system', 'villager']);

/** Action ops of ARCHITECTURE 5.6. */
const ACTION_OPS = Object.freeze(['giveItem', 'giveXp', 'giveShells', 'giveTp', 'unlockTech', 'unlockForm', 'setFlag', 'startQuest',
  'spawnGroup', 'startBoss', 'setHour', 'toast', 'banner', 'teleport', 'heal', 'setRespawn', 'moveNpc', 'openScreen', 'script', 'awaken']);

/**
 * @typedef {object} Defs
 * @property {(kind:string, list:object[]) => void} register   re-registering an id replaces it
 * @property {(kind:string, id:string) => object} get          throws when missing in strict mode (dev, test); else logs once and returns null
 * @property {(kind:string, id:string) => object|null} find
 * @property {(kind:string) => object[]} all                    registration order; do not mutate
 * @property {(kind:string, id:string) => boolean} has
 * @property {() => string[]} kinds
 * @property {(opts?:{ throwOnError?:boolean }) => { ok:boolean, errors:string[] }} validate
 */

/**
 * Create the registry.
 * @param {{ strict?:boolean, log?:{ warn(tag:string, ...args:any[]):void } }} [opts]  strict (default true): get and validate throw
 * @returns {Defs}
 */
export function createDefs(opts = {}) {
  const strict = opts.strict !== false;
  const log = opts.log || null;
  /** @type {Map<string, Map<string, object>>} */
  const byKind = new Map();
  /** @type {Map<string, object[]>} */
  const lists = new Map();
  const warned = new Set();
  const EMPTY = Object.freeze([]);

  const find = (kind, id) => {
    const m = byKind.get(kind);
    const d = m ? m.get(id) : undefined;
    return d === undefined ? null : d;
  };

  const defs = {
    register(kind, list) {
      if (typeof kind !== 'string' || !Array.isArray(list)) throw new Error('defs.register(' + kind + '): list must be an array');
      let m = byKind.get(kind);
      if (!m) {
        m = new Map();
        byKind.set(kind, m);
      }
      for (const def of list) {
        if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id) {
          throw new Error('defs.register(' + kind + '): every definition needs a string id');
        }
        m.set(def.id, deepFreeze(def));
      }
      lists.set(kind, Object.freeze(Array.from(m.values())));
    },

    get(kind, id) {
      const d = find(kind, id);
      if (d) return d;
      if (strict) throw new Error('defs.get: missing ' + kind + ':' + id);
      const key = kind + ':' + id;
      if (!warned.has(key)) {
        warned.add(key);
        if (log) log.warn('defs', 'missing definition', key);
      }
      return null;
    },

    find,

    all(kind) {
      return lists.get(kind) || EMPTY;
    },

    has(kind, id) {
      return find(kind, id) !== null;
    },

    kinds() {
      return Array.from(byKind.keys());
    },

    validate(vopts = {}) {
      const errors = validateAll(defs);
      const throwOnError = vopts.throwOnError !== undefined ? vopts.throwOnError : strict;
      if (errors.length && throwOnError) throw new Error('defs.validate: ' + errors.length + ' problem(s)\n' + errors.join('\n'));
      if (errors.length && log) log.warn('defs', errors.length + ' validation problem(s)', errors[0]);
      return { ok: errors.length === 0, errors };
    },
  };
  return defs;
}

/**
 * Check every cross-reference of section 5.
 * @param {Defs} defs
 * @returns {string[]} one message per dangling or invalid reference
 */
function validateAll(defs) {
  const errors = [];
  /** @type {string} */
  let where = '';
  const at = (kind, id) => { where = kind + ':' + id; };
  const fail = (field, msg) => errors.push(where + ' ' + field + ': ' + msg);
  const ref = (field, kind, id) => {
    if (typeof id !== 'string' || !defs.has(kind, id)) fail(field, 'unknown ' + kind + ' "' + id + '"');
  };
  const optRef = (field, kind, id) => {
    if (id !== undefined && id !== null) ref(field, kind, id);
  };
  const refs = (field, kind, list) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) return fail(field, 'must be an array');
    for (let i = 0; i < list.length; i++) ref(field + '[' + i + ']', kind, list[i]);
  };
  const cat = (field, catKind, id) => {
    if (id === undefined || id === null) return;
    if (typeof id !== 'string' || IDS[catKind].indexOf(id) < 0) fail(field, 'unknown ' + catKind + ' id "' + id + '"');
  };
  const modKeys = (field, mods) => {
    if (!mods) return;
    for (const k of Object.keys(mods)) if (IDS.modKey.indexOf(k) < 0) fail(field, 'unknown modifier key "' + k + '"');
  };
  const actions = (field, list) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) return fail(field, 'must be an array');
    list.forEach((a, i) => {
      const f = field + '[' + i + ']';
      if (!a || ACTION_OPS.indexOf(a.op) < 0) return fail(f, 'unknown action op "' + (a && a.op) + '"');
      if (a.op === 'giveItem') ref(f + '.item', 'item', a.item);
      else if (a.op === 'unlockTech') ref(f + '.tech', 'technique', a.tech);
      else if (a.op === 'unlockForm') ref(f + '.form', 'form', a.form);
      else if (a.op === 'startQuest') ref(f + '.quest', 'quest', a.quest);
      else if (a.op === 'spawnGroup') ref(f + '.group', 'group', a.group);
      else if (a.op === 'startBoss') ref(f + '.boss', 'boss', a.boss);
      else if (a.op === 'teleport') optRef(f + '.landmark', 'landmark', a.landmark);
      else if (a.op === 'moveNpc') {
        ref(f + '.npc', 'npc', a.npc);
        ref(f + '.settlement', 'settlement', a.settlement);
      }
    });
  };
  const hits = (field, list) => {
    if (!Array.isArray(list)) return;
    list.forEach((h, i) => cat(field + '[' + i + '].feel', 'feel', h && h.feel));
  };
  const anim = (field, a, isPlayer) => {
    if (!a || !isPlayer) return;
    for (const k of ['windup', 'active', 'recover']) cat(field + '.' + k, 'clip', a[k]);
  };

  for (const t of defs.all('technique')) {
    at('technique', t.id);
    const isPlayer = t.user === 'player';
    anim('anim', t.anim, isPlayer);
    hits('hits', t.hits);
    if (Array.isArray(t.projectiles)) {
      t.projectiles.forEach((p, i) => {
        cat('projectiles[' + i + '].feel', 'feel', p && p.feel);
        cat('projectiles[' + i + '].fxId', 'vfx', p && p.fxId);
      });
    }
    if (t.beam) cat('beam.feel', 'feel', t.beam.feel);
    if (Array.isArray(t.chain)) {
      t.chain.forEach((c, i) => {
        anim('chain[' + i + '].anim', c && c.anim, isPlayer);
        hits('chain[' + i + '].hits', c && c.hits);
      });
    }
    if (t.fx) for (const k of ['windup', 'active', 'hit']) cat('fx.' + k, 'vfx', t.fx[k]);
    if (t.sfx) for (const k of ['windup', 'active', 'loop', 'end', 'hit']) cat('sfx.' + k, 'sfx', t.sfx[k]);
    if (t.unlock) optRef('unlock.quest', 'quest', t.unlock.quest);
  }

  for (const n of defs.all('techNode')) {
    at('techNode', n.id);
    optRef('techId', 'technique', n.techId);
    if (n.requires) {
      optRef('requires.tech', 'technique', n.requires.tech);
      optRef('requires.node', 'techNode', n.requires.node);
    }
    modKeys('passive', n.passive);
  }

  const hero = defs.find('actorSpec', 'hero_a');
  for (const f of defs.all('form')) {
    at('form', f.id);
    if (f.unlock) optRef('unlock.quest', 'quest', f.unlock.quest);
    if (hero && hero.forms && !(f.formKey in hero.forms)) fail('formKey', 'not in the forms block of actorSpec hero_a: "' + f.formKey + '"');
  }

  for (const e of defs.all('enemy')) {
    at('enemy', e.id);
    ref('specId', 'actorSpec', e.specId);
    refs('techs', 'technique', e.techs);
    ref('lootTable', 'lootTable', e.lootTable);
    refs('regions', 'region', e.regions);
    optRef('variantOf', 'enemy', e.variantOf);
  }

  for (const b of defs.all('boss')) {
    at('boss', b.id);
    ref('enemyId', 'enemy', b.enemyId);
    const e = defs.find('enemy', b.enemyId);
    if (e && (e.tier !== 'boss' || e.brain !== 'boss')) fail('enemyId', 'enemy "' + b.enemyId + '" must have tier and brain "boss"');
    ref('arena.landmarkId', 'landmark', b.arena && b.arena.landmarkId);
    (b.phases || []).forEach((p, i) => {
      (p.techs || []).forEach((t, j) => ref('phases[' + i + '].techs[' + j + ']', 'technique', t && t.id));
      actions('phases[' + i + '].onEnter', p.onEnter);
    });
  }

  for (const g of defs.all('group')) {
    at('group', g.id);
    (g.members || []).forEach((m, i) => ref('members[' + i + '].enemy', 'enemy', m && m.enemy));
  }

  for (const s of defs.all('spawnTable')) {
    at('spawnTable', s.id);
    ref('id', 'region', s.id);
    (s.entries || []).forEach((e, i) => ref('entries[' + i + '].enemy', 'enemy', e && e.enemy));
    (s.camps || []).forEach((c, i) => ref('camps[' + i + '].group', 'group', c && c.group));
  }

  for (const it of defs.all('item')) {
    at('item', it.id);
    modKeys('mods', it.mods);
  }

  for (const s of defs.all('shop')) {
    at('shop', s.id);
    refs('stock', 'item', s.stock);
  }

  for (const q of defs.all('quest')) {
    at('quest', q.id);
    optRef('giver', 'npc', q.giver);
    if (q.prereq) refs('prereq.quests', 'quest', q.prereq.quests);
    (q.steps || []).forEach((s, i) => {
      const f = 'steps[' + i + ']';
      optRef(f + '.npc', 'npc', s.npc);
      optRef(f + '.dialogue', 'dialogue', s.dialogue);
      optRef(f + '.landmark', 'landmark', s.landmark);
      optRef(f + '.enemy', 'enemy', s.enemy);
      optRef(f + '.region', 'region', s.region);
      optRef(f + '.boss', 'boss', s.boss);
      optRef(f + '.item', 'item', s.item);
      refs(f + '.objects', 'object', s.objects);
      optRef(f + '.object', 'object', s.object);
      optRef(f + '.tech', 'technique', s.tech);
      optRef(f + '.course', 'course', s.course);
      if (s.marker) {
        optRef(f + '.marker.npc', 'npc', s.marker.npc);
        optRef(f + '.marker.landmark', 'landmark', s.marker.landmark);
        optRef(f + '.marker.object', 'object', s.marker.object);
      }
      actions(f + '.onStart', s.onStart);
      actions(f + '.onComplete', s.onComplete);
    });
    actions('rewards', q.rewards);
  }

  for (const n of defs.all('npc')) {
    at('npc', n.id);
    ref('specId', 'actorSpec', n.specId);
    optRef('shop', 'shop', n.shop);
    optRef('idleDialogue', 'dialogue', n.idleDialogue);
    if (n.home && n.home.settlement !== undefined) ref('home.settlement', 'settlement', n.home.settlement);
  }

  for (const d of defs.all('dialogue')) {
    at('dialogue', d.id);
    const nodes = d.nodes || {};
    if (!(d.start in nodes)) fail('start', 'unknown node "' + d.start + '"');
    for (const nid of Object.keys(nodes)) {
      const n = nodes[nid];
      const f = 'nodes.' + nid;
      const sp = n.speaker;
      if (SPEAKERS.indexOf(sp) < 0 && !defs.has('npc', sp) && !defs.has('boss', sp) && !defs.has('enemy', sp)) {
        fail(f + '.speaker', 'unknown speaker "' + sp + '"');
      }
      if (typeof n.next === 'string' && !(n.next in nodes)) fail(f + '.next', 'unknown node "' + n.next + '"');
      actions(f + '.actions', n.actions);
      (n.choices || []).forEach((c, i) => {
        if (typeof c.next === 'string' && !(c.next in nodes)) fail(f + '.choices[' + i + '].next', 'unknown node "' + c.next + '"');
        actions(f + '.choices[' + i + '].actions', c.actions);
        if (c.if) optRef(f + '.choices[' + i + '].if.quest', 'quest', c.if.quest);
      });
    }
  }

  for (const o of defs.all('object')) {
    at('object', o.id);
    cat('prop', 'prop', o.prop);
    if (o.prop === undefined) fail('prop', 'missing');
    optRef('quest', 'quest', o.quest);
  }

  for (const c of defs.all('course')) {
    at('course', c.id);
    optRef('goldReward', 'item', c.goldReward);
  }

  for (const r of defs.all('region')) {
    at('region', r.id);
    ref('chestTable', 'lootTable', r.chestTable);
    cat('musicKey', 'music', r.musicKey);
  }

  for (const a of defs.all('actorSpec')) {
    at('actorSpec', a.id);
    if (a.clips) for (const k of Object.keys(a.clips)) ref('clips.' + k, 'clip', a.clips[k]);
  }

  for (const s of defs.all('settlement')) {
    at('settlement', s.id);
    ref('id', 'landmark', s.id);
  }

  return errors;
}
