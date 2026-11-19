/**
 * System registry and phase runner `ctx.systems` (ARCHITECTURE 3.4).
 * @module core/systems
 */

import { SIM_PHASES, FRAME_PHASES, GAMEPLAY_PHASES, FAULT_MAX_THROWS, FAULT_WINDOW_TICKS } from './constants.js';

/**
 * @typedef {object} System
 * @property {string} id                 `<package>.<name>`, unique.
 * @property {string|{ step?:string, frame?:string }} phase
 *   A sim phase name (3.4) for `step`, a frame phase name for `frame`, or `{ step, frame }` to name both.
 *   When a plain string names a sim phase and the system also has `frame`, the frame callback runs in the
 *   frame phase `world`; when it names a frame phase and the system also has `step`, the step callback runs
 *   in the sim phase `post`. Use the object form to choose explicitly.
 * @property {number} [order]            Within a phase: ascending `order` (default 0), then registration order.
 * @property {(ctx:object, dt:number) => void} [step]                 Sim callback; dt = SIM_DT * time.scale.
 * @property {(ctx:object, dt:number, alpha:number) => void} [frame]  Frame callback; dt = real seconds (clamped to 0.1), alpha = interpolation.
 * @property {string} [owner]            Defaults to the context's current install owner (`ctx.owner`), else 'core'.
 */

/** Frame phase used for the frame callback of a system whose string phase names a sim phase. */
const DEFAULT_FRAME_PHASE = 'world';
/** Sim phase used for the step callback of a system whose string phase names a frame phase. */
const DEFAULT_STEP_PHASE = 'post';

/**
 * @typedef {object} Entry
 * @property {System} sys
 * @property {string} id
 * @property {string} owner
 * @property {number} order
 * @property {number} seq
 * @property {number} stepPhase   Index into SIM_PHASES or -1.
 * @property {number} framePhase  Index into FRAME_PHASES or -1.
 * @property {boolean} removed
 * @property {boolean} disabled
 * @property {number[]} faults    Ticks of the last FAULT_MAX_THROWS throws.
 */

/**
 * @typedef {object} Systems
 * @property {(system:System) => void} add          Register a system. Throws on a missing id, a duplicate id, an unknown phase or no callback.
 * @property {(id:string) => boolean} remove        Remove by id; true when it existed.
 * @property {(owner:string) => number} removeOwner Remove every system of `owner`; returns how many.
 * @property {(id:string) => boolean} has
 * @property {(id:string) => boolean} isDisabled    True when the system was disabled after repeated throws.
 * @property {() => Array<{ id:string, owner:string, step:string|null, frame:string|null, order:number, disabled:boolean }>} list
 *   Snapshot for diagnostics, in run order.
 * @property {(dt:number, frozen:boolean) => void} runStep       Loop internal: run every sim phase (gameplay phases skipped when frozen).
 * @property {(dt:number, alpha:number) => void} runFrame        Loop internal: run every frame phase.
 */

/**
 * Create the system registry.
 * @param {object} ctx Context passed to every callback; `ctx.log`, `ctx.time` and `ctx.owner` are read at call time.
 * @returns {Systems}
 */
export function createSystems(ctx) {
  const c = /** @type {any} */ (ctx);
  /** @type {Entry[]} */
  let entries = [];
  /** @type {Entry[][]} */
  let stepLists = SIM_PHASES.map(() => []);
  /** @type {Entry[][]} */
  let frameLists = FRAME_PHASES.map(() => []);
  const gameplay = SIM_PHASES.map((p) => GAMEPLAY_PHASES.includes(p));
  let dirty = false;
  let seq = 0;

  function log(level, ...args) {
    const l = c.log;
    if (l && typeof l[level] === 'function') l[level]('systems', ...args);
  }

  /** @param {Entry} a @param {Entry} b */
  function byOrder(a, b) {
    return a.order - b.order || a.seq - b.seq;
  }

  function rebuild() {
    dirty = false;
    entries = entries.filter((e) => !e.removed);
    stepLists = SIM_PHASES.map((_, i) => entries.filter((e) => e.stepPhase === i).sort(byOrder));
    frameLists = FRAME_PHASES.map((_, i) => entries.filter((e) => e.framePhase === i).sort(byOrder));
  }

  /**
   * Resolve phase indices for a system.
   * @param {System} sys @returns {{ step:number, frame:number }}
   */
  function resolvePhases(sys) {
    const ph = sys.phase;
    let stepName = null;
    let frameName = null;
    if (typeof ph === 'string') {
      if (SIM_PHASES.includes(ph)) {
        stepName = ph;
        frameName = DEFAULT_FRAME_PHASE;
      } else if (FRAME_PHASES.includes(ph)) {
        frameName = ph;
        stepName = DEFAULT_STEP_PHASE;
      } else {
        throw new Error(`systems.add('${sys.id}'): unknown phase '${ph}'`);
      }
    } else if (ph && typeof ph === 'object') {
      stepName = ph.step || null;
      frameName = ph.frame || null;
    } else {
      throw new Error(`systems.add('${sys.id}'): phase is required`);
    }
    const step = typeof sys.step === 'function' ? SIM_PHASES.indexOf(/** @type {string} */ (stepName)) : -1;
    const frame = typeof sys.frame === 'function' ? FRAME_PHASES.indexOf(/** @type {string} */ (frameName)) : -1;
    if (typeof sys.step === 'function' && step < 0) throw new Error(`systems.add('${sys.id}'): unknown sim phase '${stepName}'`);
    if (typeof sys.frame === 'function' && frame < 0) throw new Error(`systems.add('${sys.id}'): unknown frame phase '${frameName}'`);
    return { step, frame };
  }

  /**
   * @param {Entry} e @param {unknown} err
   */
  function fault(e, err) {
    const tick = c.time ? c.time.tick : 0;
    e.faults.shift();
    e.faults.push(tick);
    log('error', `system '${e.id}' threw:`, err);
    if (tick - e.faults[0] < FAULT_WINDOW_TICKS) {
      e.disabled = true;
      log('warn', `system '${e.id}' disabled after ${FAULT_MAX_THROWS} throws within ${FAULT_WINDOW_TICKS} ticks`);
    }
  }

  /** @param {string} id */
  function find(id) {
    for (let i = 0; i < entries.length; i++) if (entries[i].id === id && !entries[i].removed) return entries[i];
    return null;
  }

  // Optional profiler (diagnostics only): total milliseconds and calls per system, split into step and frame.
  /** @type {Map<string, number[]>|null} id -> [stepMs, steps, frameMs, frames] */
  let prof = null;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** @param {string} id @param {0|1} kind @param {number} ms */
  function note(id, kind, ms) {
    const m = /** @type {Map<string, number[]>} */ (prof);
    let a = m.get(id);
    if (!a) {
      a = [0, 0, 0, 0];
      m.set(id, a);
    }
    a[kind * 2] += ms;
    a[kind * 2 + 1]++;
  }

  /** @type {Systems} */
  const systems = {
    /**
     * Start (true) or stop (false) timing every system. Returns the report collected so far, slowest first:
     * milliseconds per call for the step and the frame callback of each system.
     * @param {boolean} on
     * @returns {{ id:string, stepMs:number, frameMs:number, steps:number, frames:number }[]}
     */
    profile(on) {
      const out = [];
      if (prof) {
        for (const [id, a] of prof) out.push({ id, stepMs: a[1] ? a[0] / a[1] : 0, frameMs: a[3] ? a[2] / a[3] : 0, steps: a[1], frames: a[3] });
        out.sort((x, y) => (y.stepMs + y.frameMs) - (x.stepMs + x.frameMs));
      }
      prof = on ? new Map() : null;
      return out;
    },

    add(system) {
      if (!system || typeof system.id !== 'string' || system.id === '') throw new Error('systems.add: system.id is required');
      if (typeof system.step !== 'function' && typeof system.frame !== 'function') {
        throw new Error(`systems.add('${system.id}'): a system needs step or frame`);
      }
      if (find(system.id)) throw new Error(`systems.add: duplicate system id '${system.id}'`);
      const phases = resolvePhases(system);
      const faults = [];
      for (let i = 0; i < FAULT_MAX_THROWS; i++) faults.push(-Infinity);
      entries.push({
        sys: system,
        id: system.id,
        owner: system.owner || c.owner || 'core',
        order: Number.isFinite(system.order) ? /** @type {number} */ (system.order) : 0,
        seq: seq++,
        stepPhase: phases.step,
        framePhase: phases.frame,
        removed: false,
        disabled: false,
        faults,
      });
      dirty = true;
    },

    remove(id) {
      const e = find(id);
      if (!e) return false;
      e.removed = true;
      dirty = true;
      return true;
    },

    removeOwner(owner) {
      let n = 0;
      for (const e of entries) {
        if (!e.removed && e.owner === owner) {
          e.removed = true;
          n++;
        }
      }
      if (n > 0) dirty = true;
      return n;
    },

    has(id) {
      return find(id) !== null;
    },

    isDisabled(id) {
      const e = find(id);
      return !!e && e.disabled;
    },

    list() {
      if (dirty) rebuild();
      const out = [];
      const seen = new Set();
      const push = (e) => {
        if (seen.has(e)) return;
        seen.add(e);
        out.push({
          id: e.id, owner: e.owner, order: e.order, disabled: e.disabled,
          step: e.stepPhase >= 0 ? SIM_PHASES[e.stepPhase] : null,
          frame: e.framePhase >= 0 ? FRAME_PHASES[e.framePhase] : null,
        });
      };
      stepLists.forEach((l) => l.forEach(push));
      frameLists.forEach((l) => l.forEach(push));
      return out;
    },

    runStep(dt, frozen) {
      if (dirty) rebuild();
      for (let p = 0; p < stepLists.length; p++) {
        if (frozen && gameplay[p]) continue;
        const list = stepLists[p];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.removed || e.disabled) continue;
          const t0 = prof ? clock() : 0;
          try {
            /** @type {Function} */ (e.sys.step).call(e.sys, ctx, dt);
          } catch (err) {
            fault(e, err);
          }
          if (prof) note(e.id, 0, clock() - t0);
        }
      }
    },

    runFrame(dt, alpha) {
      if (dirty) rebuild();
      for (let p = 0; p < frameLists.length; p++) {
        const list = frameLists[p];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.removed || e.disabled) continue;
          const t0 = prof ? clock() : 0;
          try {
            /** @type {Function} */ (e.sys.frame).call(e.sys, ctx, dt, alpha);
          } catch (err) {
            fault(e, err);
          }
          if (prof) note(e.id, 1, clock() - t0);
        }
      }
    },
  };
  return systems;
}
