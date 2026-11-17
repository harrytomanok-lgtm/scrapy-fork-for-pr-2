/**
 * Stand-in `ctx.quests` (ARCHITECTURE 4.12, 8.0): quests from defs `quest` with `talk`, `goto`, `kill` steps
 * (plus `defeat`, `destroy`, `useTechnique`, `interact`, `reach` and `script`), the declarative actions of 5.6,
 * quest scripts with the documented api, linear dialogue (choices supported), interactables with focus, the
 * Ringstone of Sparkstead (activation, respawn point, refill) and one NPC (Sela) who exists while the player
 * is within 300 m of her home. The `quests.run` system (script phase) maps `interact` -> `quests.use()`,
 * `item` -> `rpg.useItem(rpg.quickItem)` and `itemNext` -> `rpg.cycleQuickItem()`. Races are not run by the
 * stand-in (`raceStart` returns false). Replaced by the rpg package.
 * @module standins/quests
 */

import { BALANCE } from '../core/balance.js';

const OWNER = 'standin:quests';
const NPC_RANGE = 300;
const RINGSTONE = 'ringstone_sparkstead';
const STANDIN_NPC = 'sela';
/** Offset of the stand-in Ringstone prop from its POI (ahead and to the side of the start, so it reads as a landmark). */
const PROP_DX = 4;
const PROP_DZ = 10;

/** Step matchers for progress events (created once). */
const matchDied = (s, e) => (s.type === 'kill' && (e.kind === 'enemy' || e.kind === 'boss') && ((s.enemy && s.enemy === e.defId) || (s.tag && s.tag === e.questTag)))
  || (s.type === 'destroy' && e.kind === 'object' && (s.object === e.defId || (s.objects && s.objects.indexOf(e.defId) >= 0)));
const matchBoss = (s, e) => s.type === 'defeat' && s.boss === e.bossId;
const matchTech = (s, e) => s.type === 'useTechnique' && s.tech === e.techId;
const matchUsed = (s, e) => s.type === 'interact' && (s.object === e.id || (s.objects && s.objects.indexOf(e.id) >= 0));

/**
 * Create the stand-in quests service.
 * @param {any} ctx
 */
function createQuests(ctx) {
  /** @type {Map<string, Function>} */
  const scripts = new Map();
  /** @type {any[]} */
  const interactables = [];
  /** @type {string|null} */
  let focusId = null;
  /** Active quest ids in quest order (rebuilt on change). @type {string[]} */
  const activeIds = [];
  /** Per-quest step runtime. @type {Map<string, any>} */
  const runtime = new Map();
  /** The same runtimes as a list, for the tick loop. @type {any[]} */
  const runtimeList = [];
  /** @type {Array<{ at:number, resolve:Function }>} */
  const waits = [];
  const dlg = { open: false, def: /** @type {any} */ (null), nodeId: '', npcId: /** @type {string|null} */ (null), resolve: /** @type {Function|null} */ (null) };
  /** @type {any} */
  let npcEnt = null;
  /** @type {any} */
  let ringProp = null;
  const spot = { x: 0, y: 0, z: 0, yaw: 0 };
  const pFocus = { id: null, kind: null, promptKey: null };

  const S = () => ctx.store.state;
  const Q = () => ctx.store.state.quests;

  function rebuildActive() {
    activeIds.length = 0;
    const a = Q().active;
    for (const id of Object.keys(a)) activeIds.push(id);
    activeIds.sort((x, y) => {
      const dx = ctx.defs.find('quest', x);
      const dy = ctx.defs.find('quest', y);
      return (dx ? dx.order : 0) - (dy ? dy.order : 0);
    });
  }

  /** @param {string} qid @returns {any} the current step def or null */
  function curStep(qid) {
    const a = Q().active[qid];
    const def = ctx.defs.find('quest', qid);
    return a && def ? def.steps[a.step] || null : null;
  }

  /** Tear down the runtime of a quest's current step. */
  function teardown(qid) {
    const rt = runtime.get(qid);
    if (!rt) return;
    runtime.delete(qid);
    const li = runtimeList.indexOf(rt);
    if (li >= 0) runtimeList.splice(li, 1);
    for (const fn of rt.cleanups) {
      try { fn(); } catch (err) { ctx.log.warn('quests', 'cleanup threw', err); }
    }
    if (rt.prompt) ctx.bus.emit('tutorial:prompt', { action: null, textKey: null });
  }

  /** Build the runtime of the current step (scripts). */
  function setup(qid) {
    teardown(qid);
    const step = curStep(qid);
    if (!step) return;
    const a = Q().active[qid];
    const rt = { qid, stepIndex: a.step, cleanups: [], ticks: [], objectiveKey: null, objectiveArgs: null, prompt: false };
    runtime.set(qid, rt);
    runtimeList.push(rt);
    if (step.type === 'script' && step.script) {
      const fn = scripts.get(step.script);
      if (fn) {
        try {
          fn(ctx, makeApi(rt, () => {
            const cur = Q().active[qid];
            if (cur && cur.step === rt.stepIndex && runtime.get(qid) === rt) quests.completeStep(qid);
          }));
        } catch (err) {
          ctx.log.warn('quests', 'script threw', step.script, err);
        }
      }
    }
  }

  /** The script api of 4.12. */
  function makeApi(rt, done) {
    return {
      done,
      setObjective(key, args) {
        rt.objectiveKey = key;
        rt.objectiveArgs = args || null;
      },
      onTick(fn) {
        rt.ticks.push(fn);
      },
      onEvent(type, fn) {
        rt.cleanups.push(ctx.bus.on(type, fn, OWNER));
      },
      prompt(action, textKey) {
        rt.prompt = true;
        ctx.bus.emit('tutorial:prompt', { action, textKey: textKey || null });
      },
      clearPrompt() {
        rt.prompt = false;
        ctx.bus.emit('tutorial:prompt', { action: null, textKey: null });
      },
      wait(seconds) {
        return new Promise((resolve) => waits.push({ at: ctx.time.now + Math.max(0, seconds), resolve }));
      },
      spawnProp(kind, x, y, z, opts) {
        const h = ctx.env.spawnProp(kind, x, y, z, opts);
        rt.cleanups.push(() => h.dispose());
        return h;
      },
      cleanup(fn) {
        rt.cleanups.push(fn);
      },
    };
  }

  /** Enter step `idx` of an active quest. */
  function enterStep(qid, idx) {
    const def = ctx.defs.find('quest', qid);
    const a = Q().active[qid];
    if (!def || !a) return;
    if (idx >= def.steps.length) {
      completeQuest(qid);
      return;
    }
    const step = def.steps[idx];
    a.step = idx;
    if (typeof a.counts[step.id] !== 'number') a.counts[step.id] = 0;
    ctx.bus.emit('quest:step', { questId: qid, stepId: step.id, index: idx });
    if (step.onStart) quests.runActions(step.onStart);
    if (Q().active[qid] === a && a.step === idx) setup(qid);
  }

  function completeQuest(qid) {
    const q = Q();
    const def = ctx.defs.find('quest', qid);
    teardown(qid);
    delete q.active[qid];
    if (q.done.indexOf(qid) < 0) q.done.push(qid);
    rebuildActive();
    ctx.bus.emit('quest:completed', { questId: qid });
    if (def && def.rewards) quests.runActions(def.rewards);
    if (q.tracked === qid || q.tracked === null) quests.track(activeIds.length ? activeIds[0] : null);
    autoStart();
  }

  /** Start every autoStart quest whose prerequisites are met. */
  function autoStart() {
    for (const d of ctx.defs.all('quest')) if (d.autoStart && quests.state(d.id) === 'available') quests.start(d.id);
  }

  /** Count progress on the current step of every active quest that matches. */
  function progress(match, payload) {
    for (let i = 0; i < activeIds.length; i++) {
      const qid = activeIds[i];
      const step = curStep(qid);
      if (!step || !match(step, payload)) continue;
      const a = Q().active[qid];
      const need = step.count || 1;
      a.counts[step.id] = (a.counts[step.id] || 0) + 1;
      ctx.bus.emit('quest:progress', { questId: qid, stepId: step.id, count: a.counts[step.id], need });
      if (a.counts[step.id] >= need) quests.completeStep(qid);
    }
  }

  /** @param {any} step @returns {{x:number, y:number, z:number}|null} */
  function stepTarget(step, out) {
    const w = ctx.world;
    if (step.landmark && w) {
      const l = w.landmark(step.landmark);
      if (!l) return null;
      out.x = l.x; out.z = l.z; out.y = typeof l.y === 'number' ? l.y : w.heightAt(l.x, l.z);
      return out;
    }
    if (typeof step.x === 'number' && typeof step.z === 'number') {
      out.x = step.x; out.z = step.z; out.y = w ? w.heightAt(step.x, step.z) : 0;
      return out;
    }
    return null;
  }

  /** goto and reach checks. */
  function checkPlaces() {
    const p = ctx.player;
    if (!p || !p.alive) return;
    for (let i = activeIds.length - 1; i >= 0; i--) {
      const qid = activeIds[i];
      const step = curStep(qid);
      if (!step) continue;
      if (step.type === 'goto' && stepTarget(step, spot)) {
        const r = step.radius || 30;
        const dx = p.pos.x - spot.x;
        const dz = p.pos.z - spot.z;
        const alt = ctx.move ? ctx.move.altitude(p) : 0;
        if (dx * dx + dz * dz <= r * r && (!step.minAlt || alt >= step.minAlt)) quests.completeStep(qid);
      } else if (step.type === 'reach' && typeof step.level === 'number' && ctx.rpg.level >= step.level) {
        quests.completeStep(qid);
      }
    }
  }

  /** Talk to an NPC: the current talk step's dialogue, else the idle dialogue. */
  function talkTo(npcId) {
    for (let i = 0; i < activeIds.length; i++) {
      const qid = activeIds[i];
      const step = curStep(qid);
      if (step && step.type === 'talk' && step.npc === npcId) {
        const idx = Q().active[qid].step;
        const finish = () => {
          const a = Q().active[qid];
          if (a && a.step === idx) quests.completeStep(qid);
        };
        if (step.dialogue && ctx.defs.find('dialogue', step.dialogue)) quests.talk(step.dialogue, { npcId }).then(finish);
        else finish();
        return;
      }
    }
    const nd = ctx.defs.find('npc', npcId);
    if (nd && nd.idleDialogue) quests.talk(nd.idleDialogue, { npcId });
  }

  /** Show one dialogue node. */
  function showNode(nodeId) {
    const def = dlg.def;
    const n = def.nodes[nodeId];
    if (!n) {
      endDialogue();
      return;
    }
    dlg.nodeId = nodeId;
    if (n.actions) quests.runActions(n.actions);
    const choices = [];
    if (n.choices) for (const c of n.choices) if (choiceOk(c)) choices.push({ textKey: c.text });
    ctx.bus.emit('dialogue:line', { dialogueId: def.id, nodeId, speakerId: n.speaker, textKey: n.text, choices });
  }

  /** @param {any} c a dialogue choice */
  function choiceOk(c) {
    if (!c.if) return true;
    if (c.if.flag && !ctx.rpg.flag(c.if.flag)) return false;
    if (c.if.quest && c.if.state && quests.state(c.if.quest) !== c.if.state) return false;
    return true;
  }

  function endDialogue() {
    if (!dlg.open) return;
    const def = dlg.def;
    const npcId = dlg.npcId;
    const resolve = dlg.resolve;
    dlg.open = false;
    dlg.def = null;
    dlg.resolve = null;
    if (ctx.cam) ctx.cam.endDialogue();
    ctx.bus.emit('dialogue:end', { dialogueId: def.id, npcId });
    if (resolve) resolve();
  }

  /** Spawn or remove Sela by distance. */
  function updateNpc() {
    const p = ctx.player;
    const nd = ctx.defs.find('npc', STANDIN_NPC);
    if (!p || !nd || !ctx.env || !nd.home || !nd.home.settlement) return;
    if (!ctx.env.spot(nd.home.settlement, nd.home.spot, spot)) return;
    const dx = p.pos.x - spot.x;
    const dz = p.pos.z - spot.z;
    const near = dx * dx + dz * dz <= NPC_RANGE * NPC_RANGE;
    if (near && !npcEnt) {
      const e = ctx.ents.create('npc');
      if (!e) return;
      const y = ctx.world ? ctx.world.heightAt(spot.x, spot.z) : spot.y;
      e.team = 0;
      e.defId = STANDIN_NPC;
      e.nameKey = 'npc.' + STANDIN_NPC + '.name';
      e.yaw = spot.yaw;
      e.pos.set(spot.x, y, spot.z);
      e.prev.copy(e.pos);
      ctx.actors.create(e, nd.specId, {});
      npcEnt = e;
      ctx.bus.emit('actor:spawned', { entId: e.id, kind: 'npc', defId: STANDIN_NPC });
      quests.addInteractable({ id: 'npc_' + STANDIN_NPC, kind: 'npc', x: spot.x, y, z: spot.z, radius: 3, promptKey: 'standin.prompt.talk',
        onUse: () => talkTo(STANDIN_NPC) });
    } else if (!near && npcEnt) {
      removeNpc();
    }
  }

  function removeNpc() {
    if (!npcEnt) return;
    const e = npcEnt;
    npcEnt = null;
    quests.removeInteractable('npc_' + STANDIN_NPC);
    if (ctx.ents.get(e.id) === e) {
      ctx.ents.destroy(e.id);
      ctx.bus.emit('actor:removed', { entId: e.id, kind: 'npc', defId: STANDIN_NPC });
    }
  }

  /** The Sparkstead Ringstone: prop and interactable. */
  function buildRingstone() {
    const poi = ctx.world ? ctx.world.pois('ringstone').find((r) => r.id === RINGSTONE) : null;
    if (!poi) return;
    const done = S().world.ringstones.indexOf(RINGSTONE) >= 0;
    // The prop stands a few metres ahead of the POI: the journey (and every respawn) starts exactly on the POI,
    // facing +z, so the stone is in view instead of filling the screen.
    const px = poi.x + PROP_DX;
    const pz = poi.z + PROP_DZ;
    if (ctx.env) ringProp = ctx.env.spawnProp('ringstone', px, ctx.world.heightAt(px, pz), pz, { state: done ? 'active' : 'idle' });
    if (ringProp && done) ringProp.setGlow(0.6);
    quests.addInteractable({
      id: RINGSTONE, kind: 'ringstone', x: px, y: ctx.world.heightAt(px, pz), z: pz, radius: 4, promptKey: 'standin.prompt.ringstone',
      onUse: () => {
        const w = S().world;
        const first = w.ringstones.indexOf(RINGSTONE) < 0;
        if (first) w.ringstones.push(RINGSTONE);
        S().player.respawn = RINGSTONE;
        const p = ctx.player;
        if (p && p.stats) {
          ctx.combat.heal(p, p.stats.hpMax);
          ctx.combat.addOra(p, p.stats.oraMax);
        }
        if (ringProp) {
          ringProp.setState('active');
          ringProp.setGlow(0.6);
        }
        ctx.bus.emit('ringstone:activated', { id: RINGSTONE, first });
      },
    });
  }

  function clearWorld() {
    for (const qid of Array.from(runtime.keys())) teardown(qid);
    for (const w of waits) w.resolve();
    waits.length = 0;
    if (dlg.open) endDialogue();
    removeNpc();
    if (ringProp) {
      ringProp.dispose();
      ringProp = null;
    }
    interactables.length = 0;
    if (focusId !== null) {
      focusId = null;
      pFocus.id = null; pFocus.kind = null; pFocus.promptKey = null;
      ctx.bus.emit('interact:focus', pFocus);
    }
    activeIds.length = 0;
  }

  const quests = {
    /** @param {string} questId */
    start(questId) {
      const def = ctx.defs.find('quest', questId);
      const q = Q();
      if (!def || q.active[questId] || q.done.indexOf(questId) >= 0) return false;
      q.active[questId] = { step: 0, counts: {} };
      rebuildActive();
      ctx.bus.emit('quest:started', { questId });
      if (!q.tracked) quests.track(questId);
      enterStep(questId, 0);
      return true;
    },

    /** @param {string} questId */
    state(questId) {
      const q = Q();
      if (q.done.indexOf(questId) >= 0) return 'done';
      if (q.active[questId]) return 'active';
      const def = ctx.defs.find('quest', questId);
      if (!def) return 'locked';
      const pr = def.prereq || {};
      if (pr.quests && pr.quests.some((id) => q.done.indexOf(id) < 0)) return 'locked';
      if (typeof pr.level === 'number' && ctx.rpg.level < pr.level) return 'locked';
      if (typeof pr.siphons === 'number' && quests.siphonsSilenced() < pr.siphons) return 'locked';
      return 'available';
    },

    active() {
      const q = Q();
      return activeIds.map((qid) => {
        const a = q.active[qid];
        const step = curStep(qid);
        const rt = runtime.get(qid);
        const need = step ? step.count || 1 : 1;
        const count = step ? a.counts[step.id] || 0 : 0;
        return {
          questId: qid, stepIndex: a.step, stepId: step ? step.id : '',
          objectiveKey: rt && rt.objectiveKey ? rt.objectiveKey : 'quest.' + qid + '.' + (step ? step.id : 's1'),
          objectiveArgs: rt && rt.objectiveArgs ? rt.objectiveArgs : { count, need }, count, need,
        };
      });
    },

    get tracked() {
      return Q().tracked;
    },
    /** @param {string|null} questId */
    track(questId) {
      const q = Q();
      const id = questId && q.active[questId] ? questId : null;
      if (q.tracked === id) return;
      q.tracked = id;
      ctx.bus.emit('quest:tracked', { questId: id });
    },

    markers() {
      const out = [];
      const w = ctx.world;
      for (const qid of activeIds) {
        const step = curStep(qid);
        const def = ctx.defs.find('quest', qid);
        if (!step || !def || !step.marker) continue;
        const m = step.marker;
        let x = NaN;
        let z = NaN;
        if (typeof m.x === 'number') { x = m.x; z = m.z; } else if (m.landmark && w && w.landmark(m.landmark)) {
          const l = w.landmark(m.landmark);
          x = l.x; z = l.z;
        } else if (m.npc) {
          if (npcEnt && npcEnt.defId === m.npc) { x = npcEnt.pos.x; z = npcEnt.pos.z; } else {
            const nd = ctx.defs.find('npc', m.npc);
            if (nd && nd.home && nd.home.settlement && ctx.env && ctx.env.spot(nd.home.settlement, nd.home.spot, spot)) { x = spot.x; z = spot.z; }
          }
        } else if (m.object) {
          const od = ctx.defs.find('object', m.object);
          if (od) { x = od.x; z = od.z; }
        }
        if (x === x) out.push({ questId: qid, x, y: w ? w.heightAt(x, z) : 0, z, kind: def.kind === 'main' ? 'main' : 'side' });
      }
      return out;
    },

    /** @param {string} questId */
    completeStep(questId) {
      const a = Q().active[questId];
      const def = ctx.defs.find('quest', questId);
      if (!a || !def) return;
      const step = def.steps[a.step];
      teardown(questId);
      if (step && step.onComplete) quests.runActions(step.onComplete);
      if (Q().active[questId] !== a) return;
      enterStep(questId, a.step + 1);
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
      const def = ctx.defs.find('dialogue', dialogueId);
      if (!def) return Promise.resolve();
      if (dlg.open) endDialogue();
      return new Promise((resolve) => {
        dlg.open = true;
        dlg.def = def;
        dlg.npcId = opts && opts.npcId ? opts.npcId : null;
        dlg.resolve = resolve;
        ctx.bus.emit('dialogue:start', { dialogueId, npcId: dlg.npcId });
        const p = ctx.player;
        if (ctx.cam && npcEnt && dlg.npcId === npcEnt.defId && p) ctx.cam.dialogue(npcEnt.id, p.id);
        showNode(def.start);
      });
    },

    /** @param {number} [choiceIndex] */
    advance(choiceIndex) {
      if (!dlg.open) return;
      const n = dlg.def.nodes[dlg.nodeId];
      if (!n) {
        endDialogue();
        return;
      }
      let next = n.next === undefined ? null : n.next;
      if (n.choices && n.choices.length) {
        const ok = n.choices.filter(choiceOk);
        const c = ok[Math.max(0, Math.min(ok.length - 1, choiceIndex || 0))];
        if (c) {
          if (c.actions) quests.runActions(c.actions);
          next = c.next;
        }
      }
      if (!dlg.open) return;
      if (next) showNode(next);
      else endDialogue();
    },

    get dialogueOpen() {
      return dlg.open;
    },

    /** @param {any} def Interactable */
    addInteractable(def) {
      if (!def || !def.id) return;
      quests.removeInteractable(def.id);
      interactables.push(Object.assign({ radius: 3, enabled: true }, def));
    },
    /** @param {string} id */
    removeInteractable(id) {
      const i = interactables.findIndex((d) => d.id === id);
      if (i >= 0) interactables.splice(i, 1);
    },
    /** @param {string} id @param {boolean} enabled */
    setInteractable(id, enabled) {
      const d = interactables.find((x) => x.id === id);
      if (d) d.enabled = !!enabled;
    },
    get focus() {
      return focusId;
    },
    use() {
      if (!focusId || dlg.open) return false;
      const d = interactables.find((x) => x.id === focusId);
      if (!d || !d.enabled) return false;
      d.onUse(ctx);
      ctx.bus.emit('interact:used', { id: d.id, kind: d.kind });
      return true;
    },

    /** @param {string} courseId */
    raceStart(courseId) {
      ctx.log.warn('quests', 'races are not run by the stand-in', courseId);
      return false;
    },
    raceAbort() {},

    objects() {
      const poi = ctx.world ? ctx.world.pois('ringstone').find((r) => r.id === RINGSTONE) : null;
      if (!poi) return [];
      return [{ id: RINGSTONE, kind: 'ringstone', x: poi.x, y: poi.y, z: poi.z, state: S().world.ringstones.indexOf(RINGSTONE) >= 0 ? 'active' : 'idle' }];
    },

    dispose() {
      clearWorld();
    },
  };

  /** One declarative action (5.6). */
  function runAction(a) {
    const p = ctx.player;
    switch (a.op) {
      case 'giveItem': ctx.rpg.addItem(a.item, a.count || 1, typeof a.level === 'number' ? { level: a.level } : {}); break;
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
      case 'toast': ctx.bus.emit('ui:toast', { key: a.key, args: null, kind: a.kind || 'info' }); break;
      case 'banner': ctx.bus.emit('ui:banner', { kind: a.kind, key: a.key, args: null }); break;
      case 'teleport': {
        if (!p) break;
        let x = a.x;
        let z = a.z;
        if (a.landmark && ctx.world && ctx.world.landmark(a.landmark)) {
          const l = ctx.world.landmark(a.landmark);
          x = l.x; z = l.z;
        }
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
        if (a.npc === STANDIN_NPC && npcEnt && ctx.env && ctx.env.spot(a.settlement, a.spot, spot)) {
          npcEnt.pos.set(spot.x, ctx.world.heightAt(spot.x, spot.z), spot.z);
          npcEnt.prev.copy(npcEnt.pos);
        }
        break;
      case 'openScreen': if (ctx.ui) ctx.ui.open(a.screen, a.params || {}); break;
      case 'script': {
        const fn = scripts.get(a.script);
        if (fn) fn(ctx, makeApi({ cleanups: [], ticks: [], objectiveKey: null, objectiveArgs: null, prompt: false }, () => {}));
        break;
      }
      case 'awaken': ctx.rpg.awaken(); break;
      default: ctx.log.warn('quests', 'unknown action', a.op);
    }
  }

  let tickN = 0;
  const runSystem = {
    id: 'standin.quests.run',
    phase: 'script',
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const p = c.player;
      if (!p) return;
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
        for (let i = 0; i < rt.ticks.length; i++) rt.ticks[i](dt);
      }
      tickN++;
      if (tickN % 10 === 0) checkPlaces();
      if (tickN % 60 === 1) updateNpc();
      // focus
      let best = null;
      let bestD = Infinity;
      if (p.alive && !dlg.open) {
        const fly = p.move && p.move.mode === 'fly';
        for (let i = 0; i < interactables.length; i++) {
          const d = interactables[i];
          if (!d.enabled) continue;
          if (d.kind === 'npc' && npcEnt) { d.x = npcEnt.pos.x; d.y = npcEnt.pos.y; d.z = npcEnt.pos.z; }
          const r = Math.max(d.radius || 3, fly ? 6 : 0);
          const dx = p.pos.x - d.x;
          const dy = p.pos.y - d.y;
          const dz = p.pos.z - d.z;
          const dd = dx * dx + dy * dy * 0.25 + dz * dz;
          if (dd <= r * r && dd < bestD) { bestD = dd; best = d; }
        }
      }
      const id = best ? best.id : null;
      if (id !== focusId) {
        focusId = id;
        pFocus.id = id; pFocus.kind = best ? best.kind : null; pFocus.promptKey = best ? best.promptKey : null;
        c.bus.emit('interact:focus', pFocus);
      }
    },
  };

  const on = {
    loaded() {
      clearWorld();
      rebuildActive();
      buildRingstone();
      updateNpc();
      for (const qid of activeIds.slice()) setup(qid);
      autoStart();
    },
    ended() {
      clearWorld();
    },
    /** @param {any} p actor:died */
    died(p) {
      progress(matchDied, p);
      if (p.kind === 'object' && /^siphon_\d$/.test(p.defId)) {
        const w = S().world;
        if (w.siphons.indexOf(p.defId) < 0) w.siphons.push(p.defId);
        ctx.rpg.grantXp(Math.round(BALANCE.xp.bonus.siphon * ctx.rpg.xpToNext()), 'siphon');
      }
    },
    /** @param {any} p boss:end */
    bossEnd(p) {
      if (p.defeated) progress(matchBoss, p);
    },
    /** @param {any} p combat:techStart */
    techStart(p) {
      if (ctx.player && p.entId === ctx.player.id) progress(matchTech, p);
    },
    /** @param {any} p interact:used */
    used(p) {
      progress(matchUsed, p);
    },
  };

  return { quests, runSystem, on };
}

/**
 * Install the stand-in quests service under the owner 'standin:quests'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { quests, runSystem, on } = createQuests(ctx);
  ctx.provide('quests', quests, OWNER);
  ctx.systems.add(runSystem);
  ctx.bus.on('game:loaded', on.loaded, OWNER);
  ctx.bus.on('game:ended', on.ended, OWNER);
  ctx.bus.on('actor:died', on.died, OWNER);
  ctx.bus.on('boss:end', on.bossEnd, OWNER);
  ctx.bus.on('combat:techStart', on.techStart, OWNER);
  ctx.bus.on('interact:used', on.used, OWNER);
}
