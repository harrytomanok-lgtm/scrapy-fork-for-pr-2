/**
 * The `ctx.quests` service (ARCHITECTURE 4.12): the quest engine of ./logic around the store, quest scripts and
 * their api, the declarative actions of 5.6, the dialogue runner, interactables with focus, NPC entities, markers,
 * and the world activities of ./activities.js. System `quests.run` (script phase): interact and quick-item input,
 * script timers and ticks, polled steps, NPC streaming, focus.
 * @module rpg/questService
 */

import { createQuestEngine, needOf } from './logic/questEngine.js';
import { createDialogueRunner } from './logic/dialogue.js';
import { createActivities } from './activities.js';

const NPC_RANGE = 300;
const NPC_DESPAWN = 330;
const FOCUS_RADIUS = 3;
const FOCUS_RADIUS_FLY = 6;

/**
 * @param {any} ctx
 * @param {{ isPlayerSide:(sourceId:number)=>boolean }} rpgInternals
 */
export function createQuests(ctx, rpgInternals) {
  /** @type {Map<string, Function>} */
  const scripts = new Map();
  /** @type {any[]} */
  const interactables = [];
  /** @type {string|null} */
  let focusId = null;
  /** Step runtimes by quest id, and free-running script runtimes (op 'script'). */
  const runtime = new Map();
  /** @type {any[]} */
  const runtimeList = [];
  /** @type {Array<{ at:number, resolve:Function }>} */
  const waits = [];
  /** NPC entity ids by npc id. @type {Map<string, number>} */
  const npcEnts = new Map();
  /** @type {Function|null} */
  let talkResolve = null;
  /** @type {null|{ questId:string, index:number }} */
  let talkFor = null;
  let techSerial = 0;
  let lastTechId = '';
  let tickN = 0;
  let loaded = false;
  const spot = { x: 0, y: 0, z: 0, yaw: 0 };
  const tgt = { x: 0, z: 0 };
  const pFocus = { id: null, kind: null, promptKey: null };
  /** Pooled marker rows. @type {any[]} */
  const markerPool = [];
  const markerOut = [];

  const S = () => ctx.store.state;
  const Q = () => ctx.store.state.quests;
  const player = () => {
    const p = ctx.player;
    return p && p.alive ? p : null;
  };

  // ------------------------------------------------------------------ engine host

  const engine = createQuestEngine({
    q: Q,
    quest: (id) => ctx.defs.find('quest', id),
    quests: () => ctx.defs.all('quest'),
    level: () => ctx.rpg.level,
    siphons: () => S().world.siphons.length,
    flag: (k) => Q().flags[k],
    count: (id) => ctx.rpg.count(id),
    removeItem: (id, n) => ctx.rpg.removeItem(id, n),
    emit: (type, p) => ctx.bus.emit(type, p),
    run: (acts) => quests.runActions(acts),
    enter: enterRuntime,
    leave: teardown,
    objective: (qid) => {
      const rt = runtime.get(qid);
      if (rt && rt.objectiveKey) return { key: rt.objectiveKey, args: rt.objectiveArgs };
      for (let i = 0; i < runtimeList.length; i++) {
        const f = runtimeList[i];
        if (f.free && f.objectiveQuest === qid && f.objectiveKey) return { key: f.objectiveKey, args: f.objectiveArgs };
      }
      return null;
    },
  });

  /** Build the runtime of a quest's current step (scripts and quest objects). */
  function enterRuntime(qid, step, index, resumed) {
    teardown(qid);
    const rt = makeRuntime(qid, index);
    runtime.set(qid, rt);
    runtimeList.push(rt);
    if (step.type === 'script' && step.script) runScript(step.script, rt, resumed);
    activities.questChanged();
  }

  /** @param {string} qid @param {number} index */
  function makeRuntime(qid, index) {
    return { qid, stepIndex: index, cleanups: [], ticks: [], objectiveKey: null, objectiveArgs: null, objectiveQuest: null, prompt: false, finished: false, free: false };
  }

  /** @param {string} scriptId @param {any} rt @param {boolean} resumed */
  function runScript(scriptId, rt, resumed) {
    const fn = scripts.get(scriptId);
    if (!fn) {
      ctx.log.warn('quests', 'unknown script', scriptId);
      return;
    }
    try {
      fn(ctx, makeApi(rt, resumed));
    } catch (err) {
      ctx.log.warn('quests', 'script threw', scriptId, err);
    }
  }

  /** Tear down a runtime (step or free script). */
  function teardown(key) {
    const rt = runtime.get(key);
    if (!rt) return;
    runtime.delete(key);
    finish(rt);
  }

  function finish(rt) {
    if (rt.finished) return;
    rt.finished = true;
    const li = runtimeList.indexOf(rt);
    if (li >= 0) runtimeList.splice(li, 1);
    for (const fn of rt.cleanups) {
      try { fn(); } catch (err) { ctx.log.warn('quests', 'cleanup threw', err); }
    }
    rt.cleanups.length = 0;
    rt.ticks.length = 0;
    if (rt.prompt) ctx.bus.emit('tutorial:prompt', { action: null, textKey: null });
  }

  /** The script api of 4.12 (plus questId, resumed, say and spawnEnemy). */
  function makeApi(rt, resumed) {
    const api = {
      questId: rt.qid,
      resumed: !!resumed,
      done() {
        if (rt.finished) return;
        if (rt.free) {
          runtime.delete(rt.qid);
          finish(rt);
          return;
        }
        const cur = Q().active[rt.qid];
        if (cur && cur.step === rt.stepIndex && runtime.get(rt.qid) === rt) quests.completeStep(rt.qid);
      },
      /** @param {string|null} key @param {any} [args] @param {string} [questId] free scripts: the quest whose objective this replaces */
      setObjective(key, args, questId) {
        rt.objectiveKey = key || null;
        rt.objectiveArgs = args || null;
        if (questId) rt.objectiveQuest = questId;
      },
      onTick(fn) {
        if (!rt.finished) rt.ticks.push(fn);
      },
      onEvent(type, fn) {
        if (!rt.finished) rt.cleanups.push(ctx.bus.on(type, fn, 'rpg'));
      },
      prompt(action, textKey) {
        rt.prompt = true;
        ctx.bus.emit('tutorial:prompt', { action, textKey: textKey || null });
      },
      clearPrompt() {
        if (!rt.prompt) return;
        rt.prompt = false;
        ctx.bus.emit('tutorial:prompt', { action: null, textKey: null });
      },
      wait(seconds) {
        return new Promise((resolve) => waits.push({ at: ctx.time.now + Math.max(0, seconds || 0), resolve }));
      },
      spawnProp(kind, x, y, z, opts) {
        const h = ctx.env.spawnProp(kind, x, y, z, opts);
        rt.cleanups.push(() => h.dispose());
        return h;
      },
      cleanup(fn) {
        rt.cleanups.push(fn);
      },
      /** Open a dialogue (no NPC); resolves when it ends. @param {string} id */
      say(id) {
        return quests.talk(id, {});
      },
    };
    return api;
  }

  // ------------------------------------------------------------------ dialogue

  const runner = createDialogueRunner({
    dialogue: (id) => ctx.defs.find('dialogue', id),
    cond: (c) => {
      if (c.flag && !Q().flags[c.flag]) return false;
      if (c.quest && c.state && engine.state(c.quest) !== c.state) return false;
      if (c.notFlag && Q().flags[c.notFlag]) return false;
      return true;
    },
    run: (acts) => quests.runActions(acts),
    emit: (type, p) => ctx.bus.emit(type, p),
    ended: () => {
      if (ctx.cam) ctx.cam.endDialogue();
      const r = talkResolve;
      const tf = talkFor;
      talkResolve = null;
      talkFor = null;
      if (tf) engine.finishTalk(tf.questId, tf.index);
      if (r) r();
    },
  });

  /** Talk to an NPC: the step it serves, else a quest it offers, else its idle dialogue. @param {string} npcId */
  function talkTo(npcId) {
    const ts = engine.talkStep(npcId);
    if (ts) {
      const d = ts.step.dialogue && ctx.defs.find('dialogue', ts.step.dialogue) ? ts.step.dialogue : null;
      if (d) {
        quests.talk(d, { npcId });
        talkFor = { questId: ts.questId, index: ts.index };
      } else engine.finishTalk(ts.questId, ts.index);
      return;
    }
    for (const qd of ctx.defs.all('quest')) {
      if (qd.giver !== npcId || qd.autoStart || engine.state(qd.id) !== 'available') continue;
      const offer = qd.id + '_offer';
      if (ctx.defs.find('dialogue', offer)) quests.talk(offer, { npcId });
      else quests.start(qd.id);
      return;
    }
    const nd = ctx.defs.find('npc', npcId);
    if (nd && nd.idleDialogue) quests.talk(nd.idleDialogue, { npcId });
  }

  // ------------------------------------------------------------------ NPCs

  /** Where an NPC lives now: a moveNpc override (flag `npc.<id>.home`), else its def home. */
  function npcHome(npcId, out) {
    const nd = ctx.defs.find('npc', npcId);
    if (!nd) return false;
    const ov = Q().flags['npc.' + npcId + '.home'];
    if (typeof ov === 'string' && ov.indexOf(':') > 0) {
      const i = ov.indexOf(':');
      if (ctx.env && ctx.env.spot(ov.slice(0, i), ov.slice(i + 1), out)) return true;
    }
    const h = nd.home || {};
    if (h.settlement) return !!ctx.env && ctx.env.spot(h.settlement, h.spot, out);
    if (typeof h.x === 'number') {
      out.x = h.x; out.z = h.z; out.yaw = h.yaw || 0;
      out.y = ctx.world ? ctx.world.heightAt(h.x, h.z) : 0;
      return true;
    }
    return false;
  }

  function updateNpcs() {
    const p = player();
    if (!p) return;
    for (const nd of ctx.defs.all('npc')) {
      if (!npcHome(nd.id, spot)) continue;
      const dx = p.pos.x - spot.x;
      const dz = p.pos.z - spot.z;
      const d2 = dx * dx + dz * dz;
      const id = npcEnts.get(nd.id);
      if (!id && d2 <= NPC_RANGE * NPC_RANGE) spawnNpc(nd, spot);
      else if (id && d2 > NPC_DESPAWN * NPC_DESPAWN) removeNpc(nd.id);
    }
  }

  function spawnNpc(nd, at) {
    const e = ctx.ents.create('npc');
    if (!e) return;
    const y = ctx.world ? ctx.world.heightAt(at.x, at.z) : at.y;
    e.team = 0;
    e.defId = nd.id;
    e.nameKey = 'npc.' + nd.id + '.name';
    e.yaw = at.yaw;
    e.radius = 0.4;
    e.height = 1.8;
    e.pos.set(at.x, y, at.z);
    e.prev.copy(e.pos);
    ctx.actors.create(e, nd.specId, {});
    npcEnts.set(nd.id, e.id);
    ctx.bus.emit('actor:spawned', { entId: e.id, kind: 'npc', defId: nd.id });
    quests.addInteractable({ id: 'npc_' + nd.id, kind: 'npc', x: at.x, y, z: at.z, radius: FOCUS_RADIUS, promptKey: 'rpg.prompt.talk',
      npcId: nd.id, entId: e.id, onUse: () => talkTo(nd.id) });
  }

  /** @param {string} npcId */
  function removeNpc(npcId) {
    const id = npcEnts.get(npcId);
    if (!id) return;
    npcEnts.delete(npcId);
    quests.removeInteractable('npc_' + npcId);
    const e = ctx.ents.get(id);
    if (e) {
      if (ctx.actors && ctx.actors.destroy) ctx.actors.destroy(e);
      ctx.ents.destroy(id);
      ctx.bus.emit('actor:removed', { entId: id, kind: 'npc', defId: npcId });
    }
  }

  /** Move a living NPC entity to its (new) home. */
  function relocateNpc(npcId) {
    const id = npcEnts.get(npcId);
    if (!id) return;
    removeNpc(npcId);
    updateNpcs();
  }

  // ------------------------------------------------------------------ markers and targets

  /** Resolve a step's goto target. */
  function stepTarget(step, out) {
    const w = ctx.world;
    if (step.landmark && w) {
      const l = w.landmark(step.landmark);
      if (!l) return false;
      out.x = l.x; out.z = l.z;
      return true;
    }
    if (typeof step.x === 'number' && typeof step.z === 'number') {
      out.x = step.x; out.z = step.z;
      return true;
    }
    return false;
  }

  /** Resolve a marker spec ({x,z} | {npc} | {landmark} | {object}) into out. */
  function markerAt(m, out) {
    if (!m) return false;
    if (typeof m.x === 'number') { out.x = m.x; out.z = m.z; return true; }
    if (m.landmark && ctx.world) {
      const l = ctx.world.landmark(m.landmark);
      if (l) { out.x = l.x; out.z = l.z; return true; }
      return false;
    }
    if (m.npc) {
      const id = npcEnts.get(m.npc);
      const e = id ? ctx.ents.get(id) : null;
      if (e) { out.x = e.pos.x; out.z = e.pos.z; return true; }
      return npcHome(m.npc, spot) && ((out.x = spot.x), (out.z = spot.z), true);
    }
    if (m.object) return activities.objectPos(m.object, out);
    return false;
  }

  /** The implicit marker of a step without one. */
  function stepMarker(step, out) {
    if (step.marker) return markerAt(step.marker, out);
    if (step.npc) return markerAt({ npc: step.npc }, out);
    if (step.landmark) return markerAt({ landmark: step.landmark }, out);
    if (step.object) return markerAt({ object: step.object }, out);
    if (step.objects) {
      for (const o of step.objects) if (!Q().flags['obj.' + o + '.used'] && activities.objectPos(o, out)) return true;
      return false;
    }
    if (step.course) {
      const c = ctx.defs.find('course', step.course);
      if (c) { out.x = c.start.x; out.z = c.start.z; return true; }
    }
    if (step.boss) {
      const b = ctx.defs.find('boss', step.boss);
      return !!b && markerAt({ landmark: b.arena.landmarkId }, out);
    }
    if (typeof step.x === 'number') return markerAt(step, out);
    return false;
  }

  function pushMarker(questId, x, z, kind) {
    let m = markerPool[markerOut.length];
    if (!m) {
      m = { questId: '', x: 0, y: 0, z: 0, kind: 'main' };
      markerPool.push(m);
    }
    m.questId = questId; m.x = x; m.z = z; m.y = ctx.world ? ctx.world.heightAt(x, z) : 0; m.kind = kind;
    markerOut.push(m);
  }

  // ------------------------------------------------------------------ the service

  const quests = {
    /** @param {string} questId */
    start(questId) {
      return engine.start(questId);
    },
    /** @param {string} questId */
    state(questId) {
      return engine.state(questId);
    },
    active() {
      return engine.active();
    },
    get tracked() {
      return Q().tracked;
    },
    /** @param {string|null} questId */
    track(questId) {
      engine.track(questId);
    },

    /** Markers of the active quests' current steps, plus 'giver' markers of quests waiting to be offered. Pooled rows. */
    markers() {
      markerOut.length = 0;
      for (const qid of engine.ids) {
        const step = engine.current(qid);
        const def = ctx.defs.find('quest', qid);
        if (!step || !def || step.type === 'script' || step.type === 'reach') continue;
        if (stepMarker(step, tgt)) pushMarker(qid, tgt.x, tgt.z, def.kind === 'main' ? 'main' : 'side');
      }
      for (const d of ctx.defs.all('quest')) {
        if (!d.giver || d.autoStart || engine.state(d.id) !== 'available') continue;
        if (markerAt({ npc: d.giver }, tgt)) pushMarker(d.id, tgt.x, tgt.z, 'giver');
      }
      return markerOut;
    },

    /** @param {string} questId */
    completeStep(questId) {
      engine.completeStep(questId);
    },

    /** @param {string} scriptId @param {Function} fn */
    registerScript(scriptId, fn) {
      if (typeof fn === 'function') scripts.set(scriptId, fn);
    },

    /** @param {any[]} actions */
    runActions(actions) {
      if (!Array.isArray(actions)) return;
      for (const a of actions) {
        try {
          runAction(a);
        } catch (err) {
          ctx.log.warn('quests', 'action failed', a && a.op, err);
        }
      }
    },

    siphonsSilenced() {
      return S().world.siphons.length;
    },

    /** @param {string} dialogueId @param {{ npcId?:string }} [opts] */
    talk(dialogueId, opts) {
      if (!ctx.defs.find('dialogue', dialogueId)) return Promise.resolve();
      if (runner.open) runner.end();
      return new Promise((resolve) => {
        const npcId = opts && opts.npcId ? opts.npcId : null;
        talkResolve = resolve;
        talkFor = null;
        const p = player();
        const nid = npcId ? npcEnts.get(npcId) : 0;
        if (ctx.cam && nid && p) ctx.cam.dialogue(nid, p.id);
        if (!runner.start(dialogueId, npcId)) {
          talkResolve = null;
          resolve();
        }
      });
    },
    /** @param {number} [choiceIndex] */
    advance(choiceIndex) {
      runner.advance(choiceIndex);
    },
    get dialogueOpen() {
      return runner.open;
    },
    /** The open dialogue's id and node (debug, tests). */
    dialogueState() {
      return runner.open ? { dialogueId: runner.def.id, nodeId: runner.nodeId, npcId: runner.npcId } : null;
    },

    /** @param {any} def Interactable */
    addInteractable(def) {
      if (!def || !def.id) return;
      quests.removeInteractable(def.id);
      interactables.push(Object.assign({ radius: FOCUS_RADIUS, enabled: true }, def));
    },
    /** @param {string} id */
    removeInteractable(id) {
      for (let i = interactables.length - 1; i >= 0; i--) if (interactables[i].id === id) interactables.splice(i, 1);
      if (focusId === id) setFocus(null);
    },
    /** @param {string} id @param {boolean} enabled */
    setInteractable(id, enabled) {
      for (const d of interactables) if (d.id === id) d.enabled = !!enabled;
    },
    get focus() {
      return focusId;
    },
    use() {
      if (!focusId || runner.open) return false;
      let d = null;
      for (const x of interactables) if (x.id === focusId) d = x;
      if (!d || !d.enabled) return false;
      const id = d.id;
      const kind = d.kind;
      d.onUse(ctx);
      ctx.bus.emit('interact:used', { id, kind });
      return true;
    },

    /** @param {string} courseId */
    raceStart(courseId) {
      return activities.raceStart(courseId);
    },
    raceAbort() {
      activities.raceAbort();
    },
    objects() {
      return activities.objects();
    },

    /** The entity id of a spawned NPC, or 0 (debug, tests, scripts). @param {string} npcId */
    npcEntity(npcId) {
      return npcEnts.get(npcId) || 0;
    },
    /** Talk to an NPC as if the player used it (debug, tests). @param {string} npcId */
    talkTo(npcId) {
      talkTo(npcId);
    },

    dispose() {
      clearWorld();
      activities.dispose();
    },
  };

  /** One declarative action (5.6). */
  function runAction(a) {
    const p = player();
    switch (a.op) {
      case 'giveItem': {
        const uid = ctx.rpg.addItem(a.item, a.count || 1, typeof a.level === 'number' ? { level: a.level } : undefined);
        if (uid) ctx.bus.emit('ui:toast', { key: 'rpg.toast.item', args: { item: 'item.' + a.item + '.name', count: a.count || 1 }, kind: 'good' });
        break;
      }
      case 'giveXp': ctx.rpg.grantXp(a.amount, 'quest'); break;
      case 'giveShells': ctx.rpg.addShells(a.amount, 'quest'); break;
      case 'giveTp': ctx.rpg.addTp(a.amount); break;
      case 'unlockTech':
        ctx.rpg.unlockTech(a.tech);
        if (a.slot !== undefined) ctx.rpg.setSlot(a.slot, a.tech);
        break;
      case 'unlockForm': ctx.rpg.unlockForm(a.form); break;
      case 'setFlag': ctx.rpg.setFlag(a.key, a.value); break;
      case 'startQuest': quests.start(a.quest); break;
      case 'spawnGroup': ctx.ai.spawnGroup(a.group, a.x, a.z, { questTag: a.questTag, aggro: !!a.aggro }); break;
      case 'startBoss': ctx.ai.startBoss(a.boss, {}); break;
      case 'setHour': ctx.env.setHour(a.hour); break;
      case 'toast': ctx.bus.emit('ui:toast', { key: a.key, args: a.args || null, kind: a.kind || 'info' }); break;
      case 'banner': ctx.bus.emit('ui:banner', { kind: a.kind, key: a.key, args: a.args || null }); break;
      case 'teleport': {
        if (!p) break;
        let x = a.x;
        let z = a.z;
        const l = a.landmark && ctx.world ? ctx.world.landmark(a.landmark) : null;
        if (l) { x = l.x + (a.x || 0); z = l.z + (a.z || 0); }
        if (typeof x === 'number' && typeof z === 'number') {
          ctx.move.teleport(p, x, ctx.world.heightAt(x, z), z, p.yaw);
          ctx.move.setMode(p, 'ground');
        }
        break;
      }
      case 'heal':
        if (p && p.stats) {
          ctx.combat.heal(p, p.stats.hpMax);
          ctx.combat.addOra(p, p.stats.oraMax);
        }
        break;
      case 'setRespawn': S().player.respawn = a.ringstone; break;
      case 'moveNpc':
        Q().flags['npc.' + a.npc + '.home'] = a.settlement + ':' + a.spot;
        relocateNpc(a.npc);
        break;
      case 'openScreen': if (ctx.ui && !ctx.flags.test) ctx.ui.open(a.screen, a.params || {}); break;
      case 'script': {
        const rt = makeRuntime('script:' + a.script, -1);
        rt.free = true;
        teardown(rt.qid);
        runtime.set(rt.qid, rt);
        runtimeList.push(rt);
        runScript(a.script, rt, false);
        break;
      }
      case 'awaken': ctx.rpg.awaken(); break;
      default: ctx.log.warn('quests', 'unknown action', a.op);
    }
  }

  // ------------------------------------------------------------------ focus

  /** @param {any} best */
  function setFocus(best) {
    const id = best ? best.id : null;
    if (id === focusId) return;
    focusId = id;
    pFocus.id = id; pFocus.kind = best ? best.kind : null; pFocus.promptKey = best ? best.promptKey : null;
    ctx.bus.emit('interact:focus', pFocus);
  }

  function updateFocus(p) {
    let best = null;
    let bestD = Infinity;
    if (p && !runner.open && (!p.combat || p.combat.state !== 'dead')) {
      const fly = p.move && p.move.mode === 'fly';
      for (let i = 0; i < interactables.length; i++) {
        const d = interactables[i];
        if (!d.enabled) continue;
        if (d.entId) {
          const e = ctx.ents.get(d.entId);
          if (e) { d.x = e.pos.x; d.y = e.pos.y; d.z = e.pos.z; }
        }
        const r = Math.max(d.radius || FOCUS_RADIUS, fly ? FOCUS_RADIUS_FLY : 0);
        const dx = p.pos.x - d.x;
        const dy = p.pos.y - d.y;
        const dz = p.pos.z - d.z;
        const dd = dx * dx + dy * dy * 0.25 + dz * dz;
        if (dd <= r * r && dd < bestD) { bestD = dd; best = d; }
      }
    }
    setFocus(best);
  }

  function clearWorld() {
    for (const k of Array.from(runtime.keys())) teardown(k);
    for (const w of waits) w.resolve();
    waits.length = 0;
    if (runner.open) runner.end();
    for (const id of Array.from(npcEnts.keys())) removeNpc(id);
    interactables.length = 0;
    setFocus(null);
    loaded = false;
  }

  const activities = createActivities(ctx, {
    quests,
    engine,
    isPlayerSide: rpgInternals.isPlayerSide,
  });

  // ------------------------------------------------------------------ system and listeners

  const runSystem = {
    id: 'quests.run',
    phase: 'script',
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const p = player();
      if (!p || !loaded) return;
      const inp = c.input;
      if (inp.pressed('interact')) quests.use();
      if (inp.pressed('item')) c.rpg.useItem(c.rpg.quickItem);
      if (inp.pressed('itemNext')) c.rpg.cycleQuickItem();
      for (let i = waits.length - 1; i >= 0; i--) {
        if (waits[i].at <= c.time.now) {
          const w = waits[i];
          waits.splice(i, 1);
          w.resolve();
        }
      }
      for (let r = 0; r < runtimeList.length; r++) {
        const rt = runtimeList[r];
        for (let i = 0; i < rt.ticks.length && !rt.finished; i++) rt.ticks[i](dt);
      }
      tickN++;
      if (tickN % 10 === 0) engine.poll(p.pos.x, p.pos.z, c.move ? c.move.altitude(p) : 0, stepTarget, tgt);
      if (tickN % 60 === 1) updateNpcs();
      activities.step(c, dt, p);
      updateFocus(p);
    },
  };

  const on = {
    loaded() {
      clearWorld();
      loaded = true;
      activities.build();
      engine.resume();
      updateNpcs();
      engine.autoStart();
      if (!Q().tracked) engine.track(engine.ids.length ? engine.ids[0] : null);
    },
    ended() {
      clearWorld();
      activities.clear();
    },
    /** @param {any} p actor:died */
    died(p) {
      const side = rpgInternals.isPlayerSide(p.sourceId);
      engine.onDied(p, side, ctx.world ? ctx.world.regionAt(p.x, p.z) : null);
      activities.died(p, side);
    },
    /** @param {any} p boss:end */
    bossEnd(p) {
      if (p.defeated) engine.onBossDefeated(p.bossId);
    },
    /** @param {any} p combat:techStart */
    techStart(p) {
      const pl = ctx.player;
      if (!pl || p.entId !== pl.id) return;
      techSerial++;
      lastTechId = p.techId;
      engine.onTech(p.techId, null, techSerial);
    },
    /** @param {any} p combat:hit */
    hit(p) {
      const pl = ctx.player;
      if (!pl || p.attackerId !== pl.id) return;
      const t = ctx.ents.get(p.targetId);
      if (!t || !t.questTag) return;
      engine.onTech(p.techId || lastTechId, t.questTag, techSerial);
    },
    /** @param {any} p interact:used */
    used(p) {
      engine.onUsed(p.id);
    },
    /** @param {any} p race:end */
    raceEnd(p) {
      if (p.finished) engine.onRace(p.courseId, p.medal);
    },
    /** A step may already hold after an item or level change. */
    poll() {
      const p = player();
      if (p && loaded) engine.poll(p.pos.x, p.pos.z, ctx.move ? ctx.move.altitude(p) : 0, stepTarget, tgt);
    },
  };

  return { quests, runSystem, on, activities, engine, needOf };
}
