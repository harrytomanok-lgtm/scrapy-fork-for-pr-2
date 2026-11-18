/**
 * Quest engine (ARCHITECTURE 4.12, 5.6, GDD 8.1). Pure: the state lives in `store.quests`
 * (`active: { [questId]: { step, counts } }`, `done`, `tracked`), and everything with a side effect goes through
 * the injected host (events, actions, step runtimes). Several quests run in parallel; progress events are matched
 * against the current step of every active quest, in quest order.
 * @module rpg/logic/questEngine
 */

export const STEP_TYPES = Object.freeze(['talk', 'goto', 'kill', 'defeat', 'collect', 'deliver', 'interact', 'destroy', 'useTechnique',
  'reach', 'race', 'script']);
export const MEDALS = Object.freeze(['none', 'bronze', 'silver', 'gold']);
/**
 * onStart ops that are re-run when a saved step resumes (the world they set up is not saved). Free scripts are
 * re-run too, with `resumed` set (they skip their story lines) and `left` (the matches the step still needs), so a
 * step that spawns its enemies, hints or objects from a script rebuilds them after a load.
 */
export const RESUME_OPS = Object.freeze(['spawnGroup', 'startBoss', 'setHour', 'moveNpc', 'script']);

/**
 * @typedef {object} QuestHost
 * @property {() => any} q                         store.quests
 * @property {(id:string) => any} quest            QuestDef or null
 * @property {() => any[]} quests                  every QuestDef
 * @property {() => number} level                  player level
 * @property {() => number} siphons                silenced Siphons
 * @property {(key:string) => any} flag
 * @property {(itemId:string) => number} count     inventory count
 * @property {(itemId:string, n:number) => boolean} removeItem
 * @property {(type:string, payload:object) => void} emit
 * @property {(actions:any[], resume?:{ resumed:boolean, left:number }) => void} run   run declarative actions (resume: re-run after a load)
 * @property {(questId:string, step:any, index:number, resumed:boolean) => void} enter   build the step runtime
 * @property {(questId:string) => void} leave      tear the step runtime down
 * @property {(questId:string) => ({ key:string, args:any }|null)} [objective]  runtime objective override
 * @property {(objectId:string) => boolean} [destroyed]  the object was destroyed before (a destroy step polled on it completes)
 */

/**
 * Number of matches a step needs.
 * @param {any} step @returns {number}
 */
export function needOf(step) {
  if (!step) return 1;
  if (step.type === 'interact' && Array.isArray(step.objects)) return step.objects.length;
  if (step.type === 'destroy' && Array.isArray(step.objects)) return step.objects.length;
  return typeof step.count === 'number' && step.count > 0 ? step.count : 1;
}

/**
 * Prerequisites of a quest that is neither active nor done.
 * @param {any} def @param {any} q store.quests @param {number} level @param {number} siphons
 * @returns {'locked'|'available'}
 */
export function prereqState(def, q, level, siphons) {
  const pr = def.prereq || {};
  if (pr.quests) for (const id of pr.quests) if (q.done.indexOf(id) < 0) return 'locked';
  if (typeof pr.level === 'number' && level < pr.level) return 'locked';
  if (typeof pr.siphons === 'number' && siphons < pr.siphons) return 'locked';
  return 'available';
}

/**
 * @param {QuestHost} host
 */
export function createQuestEngine(host) {
  /** Active quest ids in quest order. @type {string[]} */
  const ids = [];
  /** Scratch copy for iterations that may change `ids`. @type {string[]} */
  const scratch = [];
  const pProgress = { questId: '', stepId: '', count: 0, need: 0 };

  const order = (id) => {
    const d = host.quest(id);
    return d ? d.order : 0;
  };

  function rebuild() {
    ids.length = 0;
    for (const id of Object.keys(host.q().active)) ids.push(id);
    ids.sort((a, b) => order(a) - order(b));
  }

  /** @param {string} qid @returns {any} the current step def or null */
  function current(qid) {
    const a = host.q().active[qid];
    const def = host.quest(qid);
    return a && def ? def.steps[a.step] || null : null;
  }

  function snapshot() {
    scratch.length = 0;
    for (let i = 0; i < ids.length; i++) scratch.push(ids[i]);
    return scratch;
  }

  /** @param {string} qid @param {number} idx */
  function enterStep(qid, idx) {
    const def = host.quest(qid);
    const a = host.q().active[qid];
    if (!def || !a) return;
    if (idx >= def.steps.length) {
      completeQuest(qid);
      return;
    }
    const step = def.steps[idx];
    a.step = idx;
    if (typeof a.counts[step.id] !== 'number') a.counts[step.id] = 0;
    host.emit('quest:step', { questId: qid, stepId: step.id, index: idx });
    if (step.onStart) host.run(step.onStart);
    if (host.q().active[qid] !== a || a.step !== idx) return;
    host.enter(qid, step, idx, false);
    // Steps whose condition already holds complete at once (collect with the items in the bag, reach a level).
    if (host.q().active[qid] === a && a.step === idx && holds(step)) engine.completeStep(qid);
  }

  /** @param {any} step @returns {boolean} the polled condition of collect and reach steps */
  function holds(step) {
    if (step.type === 'collect') return host.count(step.item) >= needOf(step);
    if (step.type === 'reach') {
      if (typeof step.level === 'number' && host.level() < step.level) return false;
      if (step.flag && !host.flag(step.flag)) return false;
      return typeof step.level === 'number' || !!step.flag;
    }
    return false;
  }

  /** @param {string} qid */
  function completeQuest(qid) {
    const q = host.q();
    const def = host.quest(qid);
    host.leave(qid);
    delete q.active[qid];
    if (q.done.indexOf(qid) < 0) q.done.push(qid);
    rebuild();
    host.emit('quest:completed', { questId: qid });
    if (def && def.rewards) host.run(def.rewards);
    if (q.tracked === qid || q.tracked === null || !q.active[q.tracked]) engine.track(pickTracked());
    engine.autoStart();
  }

  /** The quest to track after the tracked one ends: the first main quest, else the first active. */
  function pickTracked() {
    for (let i = 0; i < ids.length; i++) {
      const d = host.quest(ids[i]);
      if (d && d.kind === 'main') return ids[i];
    }
    return ids.length ? ids[0] : null;
  }

  /**
   * Count one match on a quest's current step.
   * @param {string} qid @param {any} step @param {string|null} [key] distinct key (objects): counted once
   */
  function bump(qid, step, key) {
    const a = host.q().active[qid];
    if (!a) return;
    if (key) {
      const k = step.id + ':' + key;
      if (a.counts[k]) return;
      a.counts[k] = 1;
    }
    const need = needOf(step);
    a.counts[step.id] = Math.min(need, (a.counts[step.id] || 0) + 1);
    pProgress.questId = qid; pProgress.stepId = step.id; pProgress.count = a.counts[step.id]; pProgress.need = need;
    host.emit('quest:progress', pProgress);
    if (a.counts[step.id] >= need) engine.completeStep(qid);
  }

  const engine = {
    /** Active quest ids in order (live array; do not mutate). */
    ids,
    rebuild,
    current,
    holds,

    /** @param {string} id */
    state(id) {
      const q = host.q();
      if (q.done.indexOf(id) >= 0) return 'done';
      if (q.active[id]) return 'active';
      const def = host.quest(id);
      if (!def) return 'locked';
      return prereqState(def, q, host.level(), host.siphons());
    },

    /** Start a quest (prerequisites are not re-checked: actions and debug may force a start). @param {string} id */
    start(id) {
      const def = host.quest(id);
      const q = host.q();
      if (!def || q.active[id] || q.done.indexOf(id) >= 0 || !def.steps || !def.steps.length) return false;
      q.active[id] = { step: 0, counts: {} };
      rebuild();
      host.emit('quest:started', { questId: id });
      if (!q.tracked || (def.kind === 'main' && !isMain(q.tracked))) engine.track(id);
      enterStep(id, 0);
      return true;
    },

    /** @param {string} id */
    completeStep(id) {
      const a = host.q().active[id];
      const def = host.quest(id);
      if (!a || !def) return;
      const step = def.steps[a.step];
      host.leave(id);
      if (step && step.onComplete) host.run(step.onComplete);
      if (host.q().active[id] !== a) return;
      enterStep(id, a.step + 1);
    },

    /** Start every autoStart quest whose prerequisites hold. */
    autoStart() {
      for (const d of host.quests()) if (d.autoStart && engine.state(d.id) === 'available') engine.start(d.id);
    },

    /** @param {string|null} id */
    track(id) {
      const q = host.q();
      const v = id && q.active[id] ? id : null;
      if (q.tracked === v) return;
      q.tracked = v;
      host.emit('quest:tracked', { questId: v });
    },

    /** Rebuild the order and the runtimes of the saved current steps (after a load). */
    resume() {
      rebuild();
      for (const id of snapshot()) {
        const step = current(id);
        const a = host.q().active[id];
        if (!step || !a) continue;
        if (step.onStart) {
          const acts = [];
          for (const x of step.onStart) if (RESUME_OPS.indexOf(x.op) >= 0) acts.push(x);
          if (acts.length) host.run(acts, { resumed: true, left: Math.max(0, needOf(step) - (a.counts[step.id] || 0)) });
        }
        host.enter(id, step, a.step, true);
      }
    },

    /**
     * Objective rows of the active quests.
     * @returns {Array<{ questId:string, stepIndex:number, stepId:string, objectiveKey:string, objectiveArgs:any, count:number, need:number }>}
     */
    active() {
      const out = [];
      const q = host.q();
      for (const id of ids) {
        const a = q.active[id];
        const step = current(id);
        if (!a || !step) continue;
        const need = needOf(step);
        const count = a.counts[step.id] || 0;
        const o = host.objective ? host.objective(id) : null;
        out.push({ questId: id, stepIndex: a.step, stepId: step.id, objectiveKey: o ? o.key : 'quest.' + id + '.' + step.id,
          objectiveArgs: o && o.args ? o.args : { count, need }, count, need });
      }
      return out;
    },

    /**
     * `actor:died`: kill steps (player side only; by enemy id or quest tag; optional region) and destroy steps.
     * @param {any} p actor:died payload @param {boolean} playerSide @param {string|null} regionId
     */
    onDied(p, playerSide, regionId) {
      for (const id of snapshot()) {
        const s = current(id);
        if (!s) continue;
        if (s.type === 'kill' && playerSide && (p.kind === 'enemy' || p.kind === 'boss')) {
          if (s.enemy && s.enemy !== p.defId) continue;
          if (s.tag && s.tag !== p.questTag) continue;
          if (!s.enemy && !s.tag) continue;
          if (s.region && s.region !== regionId) continue;
          bump(id, s, null);
        } else if (s.type === 'destroy' && p.kind === 'object') {
          if (s.object === p.defId || (s.objects && s.objects.indexOf(p.defId) >= 0)) bump(id, s, s.objects ? p.defId : null);
        }
      }
    },

    /** @param {string} bossId */
    onBossDefeated(bossId) {
      for (const id of snapshot()) {
        const s = current(id);
        if (s && s.type === 'defeat' && s.boss === bossId) bump(id, s, null);
      }
    },

    /**
     * A player technique started (steps without a target tag) or hit a tagged target (steps with one; counted
     * once per use).
     * @param {string} techId @param {string|null} targetTag @param {number} useSerial
     */
    onTech(techId, targetTag, useSerial) {
      for (const id of snapshot()) {
        const s = current(id);
        if (!s || s.type !== 'useTechnique' || s.tech !== techId) continue;
        if (s.targetTag) {
          if (targetTag !== s.targetTag) continue;
          const a = host.q().active[id];
          const k = s.id + ':use';
          if (a.counts[k] === useSerial) continue;
          a.counts[k] = useSerial;
        } else if (targetTag !== null) continue;
        bump(id, s, null);
      }
    },

    /** `interact:used`. @param {string} objectId */
    onUsed(objectId) {
      for (const id of snapshot()) {
        const s = current(id);
        if (!s || s.type !== 'interact') continue;
        if (s.object === objectId) bump(id, s, null);
        else if (s.objects && s.objects.indexOf(objectId) >= 0) bump(id, s, objectId);
      }
    },

    /** `race:end`. @param {string} courseId @param {string} medal */
    onRace(courseId, medal) {
      for (const id of snapshot()) {
        const s = current(id);
        if (!s || s.type !== 'race' || s.course !== courseId) continue;
        if (MEDALS.indexOf(medal) >= MEDALS.indexOf(s.medal || 'bronze')) bump(id, s, null);
      }
    },

    /**
     * Polled conditions: goto (the caller resolves the target), collect and reach.
     * @param {number} px @param {number} pz @param {number} alt metres above ground
     * @param {(step:any, out:{x:number,z:number})=>boolean} target
     * @param {{x:number,z:number}} tmp
     */
    poll(px, pz, alt, target, tmp) {
      const list = snapshot();
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        const s = current(id);
        if (!s) continue;
        if (s.type === 'goto') {
          if (!target(s, tmp)) continue;
          const r = s.radius || 30;
          const dx = px - tmp.x;
          const dz = pz - tmp.z;
          if (dx * dx + dz * dz <= r * r && (!s.minAlt || alt >= s.minAlt)) engine.completeStep(id);
        } else if ((s.type === 'collect' || s.type === 'reach') && holds(s)) {
          if (s.type === 'collect') {
            const a = host.q().active[id];
            a.counts[s.id] = needOf(s);
          }
          engine.completeStep(id);
        } else if (s.type === 'destroy' && s.object && host.destroyed && host.destroyed(s.object)) {
          // Destroyed before the quest asked for it (a Siphon silenced in free roam): the step is already done.
          const a = host.q().active[id];
          a.counts[s.id] = needOf(s);
          engine.completeStep(id);
        }
      }
    },

    /**
     * The quest step a conversation with this NPC serves: a talk step, or a deliver step while the items are held.
     * @param {string} npcId
     * @returns {{ questId:string, step:any, index:number }|null}
     */
    talkStep(npcId) {
      const q = host.q();
      for (const id of ids) {
        const s = current(id);
        if (!s || s.npc !== npcId) continue;
        if (s.type === 'talk' || (s.type === 'deliver' && host.count(s.item) >= needOf(s))) return { questId: id, step: s, index: q.active[id].step };
      }
      return null;
    },

    /**
     * The conversation of a talk or deliver step ended: deliver removes the items, then the step completes
     * (if the quest is still on it).
     * @param {string} questId @param {number} index
     */
    finishTalk(questId, index) {
      const a = host.q().active[questId];
      if (!a || a.step !== index) return;
      const s = current(questId);
      if (s && s.type === 'deliver') {
        if (!host.removeItem(s.item, needOf(s))) return;
        a.counts[s.id] = needOf(s);
      }
      engine.completeStep(questId);
    },
  };

  /** @param {string|null} id */
  function isMain(id) {
    const d = id ? host.quest(id) : null;
    return !!d && d.kind === 'main';
  }

  return engine;
}
