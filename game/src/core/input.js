/**
 * The action layer `ctx.input` (ARCHITECTURE 4.8): per-tick action state with edges, contexts,
 * the device source registry, deterministic injection, glyphs and haptics; plus the foundation's
 * keyboard-and-mouse source and basic standard-mapping gamepad source.
 *
 * The module touches the DOM only inside functions, so Node can import it.
 *
 * Timing: devices write raw state at any time (DOM events, or `poll` in the `pre` frame phase).
 * `core.input` (sim phase `input`) samples it into the per-tick state read by `down / pressed /
 * released / heldTime / axis`; `core.cleanup` clears the edges. A press shorter than a tick still
 * produces one pressed tick. `onPress` listeners are notified in the `pre` frame phase, even while
 * the sim is paused.
 * @module core/input
 */

import { ACTIONS, AXES, ALWAYS_ACTIONS, ACTION_INDEX, AXIS_INDEX, CONTEXTS, KBM_KEYS, KBM_MOVE_KEYS, KBM_LOOK_KEYS, KBM_MOUSE,
  KBM_WHEEL, PAD, PAD_BINDINGS, KBM_GLYPHS, PAD_GLYPHS } from './actions.js';
import { SIM_DT, KEY_LOOK_DEG_PER_S, MOUSE_DEG_PER_PX, PAD_LOOK_DEG_PER_S, PAD_DEAD_ZONE } from './constants.js';

export { ACTIONS, AXES } from './actions.js';

const NA = ACTIONS.length;
/** Source slots that carry a bit in the per-action masks. */
const MAX_SOURCES = 31;
/** Fixed source slots. */
const FIXED_SOURCES = Object.freeze(['kbm', 'pad', 'touch', 'inject']);
const INJECT_SLOT = 3;
/** Real device sources, ignored in test mode without autoplay. */
const DEVICE_SOURCES = new Set(['kbm', 'pad', 'touch']);
/** |axis| above this marks the source as the last used device. */
const DEVICE_AXIS_THRESHOLD = 0.5;

/**
 * @typedef {object} InputSource
 * @property {(input:Input, dt:number) => void} [poll]  Called every frame in the `pre` phase.
 * @property {() => void} [dispose]                      Called when the source is replaced.
 */

/**
 * @typedef {object} Input
 * @property {(action:string) => boolean} down
 * @property {(action:string) => boolean} pressed      True for exactly one sim tick.
 * @property {(action:string) => boolean} released     True for exactly one sim tick.
 * @property {(action:string) => number} heldTime      Seconds held (unscaled sim ticks * SIM_DT); 0 when up.
 * @property {(action:string) => void} consume         Clears pressed for the rest of the tick.
 * @property {(fn:(action:string)=>void) => (() => void)} onPress  Frame-rate press notification (UI code).
 * @property {(name:string) => number} axis            moveX right, moveY forward (-1..1, length <= 1); lookX right, lookY up (degrees this tick).
 * @property {'kbm'|'touch'|'pad'} device               Last used device; `input:device` is emitted on change.
 * @property {'game'|'ui'|'cine'} context
 * @property {(context:'game'|'ui'|'cine') => void} setContext
 * @property {(device:'kbm'|'touch'|'pad') => void} setDevice  Force the device (debug `__GAME__.setDevice`); emits input:device on change.
 * @property {boolean} padAvailable                     False once the Gamepad API is found blocked or missing; pad glyphs are never shown then.
 * @property {(id:string, source:InputSource) => void} registerSource  One source per id; an existing one is disposed first.
 * @property {(action:string, isDown:boolean, source:string) => void} setButton
 * @property {(name:string, value:number, source:string) => void} setAxis
 *   moveX / moveY: the source's current value. lookX / lookY: a delta in degrees, same as {@link Input.addLook}.
 * @property {(dxDeg:number, dyDeg:number, source?:string) => void} addLook   Accumulate look degrees for the next tick.
 * @property {() => void} requestPointerLock           Optional; failure is silent.
 * @property {(strong:number, weak:number, ms:number) => void} rumble  No-op in P0.
 * @property {(pattern:number|number[]) => void} vibrate  Honours settings.vibration; disabled for the session after the first rejection or throw.
 * @property {(action:string) => { device:string, label:string, icon:string|null }} glyph  Prompt glyph for the current device; accepts 'move' and 'look'.
 * @property {{ press:(action:string, ticks?:number)=>void, hold:(action:string, on:boolean)=>void, move:(x:number, y:number)=>void,
 *              look:(dx:number, dy:number)=>void, clear:()=>void }} inject  Deterministic injection (tests and debug API).
 * @property {() => void} sample      `core.input` internal: build this tick's action state.
 * @property {() => void} endTick     `core.cleanup` internal: clear per-tick edges.
 * @property {(dt:number) => void} poll  `core.inputPoll` internal: poll sources, notify onPress, emit input:device.
 */

/**
 * Create the input service. Sources are not registered here; see {@link installDefaultSources}.
 * @param {object} ctx Context read at call time for `flags`, `bus`, `log`, `save`, `three`, `dom`.
 * @returns {Input}
 */
export function createInput(ctx) {
  const c = /** @type {any} */ (ctx);
  const always = new Uint8Array(NA);
  for (const a of ALWAYS_ACTIONS) always[ACTION_INDEX[a]] = 1;

  const srcMask = new Int32Array(NA);
  const simLatch = new Uint8Array(NA);
  const frameLatch = new Uint8Array(NA);
  const injTicks = new Int32Array(NA);
  const injHold = new Uint8Array(NA);
  const downS = new Uint8Array(NA);
  const pressedS = new Uint8Array(NA);
  const releasedS = new Uint8Array(NA);
  const heldTicks = new Int32Array(NA);
  const moveSrc = new Float64Array(MAX_SOURCES * 2);
  const axes = new Float64Array(AXES.length);
  let lookAccX = 0;
  let lookAccY = 0;

  /** @type {Map<string, number>} */
  const slotOf = new Map(FIXED_SOURCES.map((s, i) => [s, i]));
  /** Registered source ids and sources, parallel arrays in registration order. */
  /** @type {string[]} */
  const sourceIds = [];
  /** @type {InputSource[]} */
  const sourceList = [];
  /** @type {Array<(action:string)=>void>} */
  let pressListeners = [];
  /** @type {Set<string>} */
  const warned = new Set();
  let lastEmittedDevice = 'kbm';
  let vibrateState = 0;

  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    if (c.log && typeof c.log.warn === 'function') c.log.warn('input', ...args);
  }

  /** @param {string} action @returns {number} */
  function indexOf(action) {
    const i = ACTION_INDEX[action];
    if (i === undefined) {
      warnOnce('action:' + action, `unknown action '${action}'`);
      return -1;
    }
    return i;
  }

  /** @param {string} source @returns {number} */
  function slot(source) {
    let s = slotOf.get(source);
    if (s === undefined) {
      s = slotOf.size < MAX_SOURCES ? slotOf.size : MAX_SOURCES - 1;
      slotOf.set(source, s);
    }
    return s;
  }

  /** @param {string} source */
  function ignored(source) {
    const f = c.flags;
    return !!(f && f.test && !f.autoplay) && DEVICE_SOURCES.has(source);
  }

  /** @param {string} source */
  function noteDevice(source) {
    if (DEVICE_SOURCES.has(source)) input.device = /** @type {any} */ (source);
  }

  /** @param {number} i */
  function allowed(i) {
    return input.context === 'game' || always[i] === 1;
  }

  /** @param {string} source Clear every bit and axis of a source. */
  function releaseSource(source) {
    const s = slotOf.get(source);
    if (s === undefined) return;
    const bit = 1 << s;
    for (let i = 0; i < NA; i++) srcMask[i] &= ~bit;
    moveSrc[s * 2] = 0;
    moveSrc[s * 2 + 1] = 0;
  }

  function emitDevice() {
    if (input.device === lastEmittedDevice) return;
    lastEmittedDevice = input.device;
    if (c.bus) c.bus.emit('input:device', { device: input.device });
  }

  /** @param {number} axisIndex 0 or 1 @returns {number} the value of largest magnitude over all sources */
  function combinedMove(axisIndex) {
    let v = 0;
    for (let s = 0; s < MAX_SOURCES; s++) {
      const x = moveSrc[s * 2 + axisIndex];
      if (Math.abs(x) > Math.abs(v)) v = x;
    }
    return v;
  }

  /** @type {Input} */
  const input = {
    device: 'kbm',
    context: 'game',
    padAvailable: true,

    down(action) {
      const i = ACTION_INDEX[action];
      return i !== undefined && downS[i] === 1 && allowed(i);
    },
    pressed(action) {
      const i = ACTION_INDEX[action];
      return i !== undefined && pressedS[i] === 1 && allowed(i);
    },
    released(action) {
      const i = ACTION_INDEX[action];
      return i !== undefined && releasedS[i] === 1;
    },
    heldTime(action) {
      const i = ACTION_INDEX[action];
      return i !== undefined && allowed(i) ? heldTicks[i] * SIM_DT : 0;
    },
    consume(action) {
      const i = ACTION_INDEX[action];
      if (i !== undefined) pressedS[i] = 0;
    },
    onPress(fn) {
      pressListeners = pressListeners.concat([fn]);
      return () => {
        pressListeners = pressListeners.filter((f) => f !== fn);
      };
    },
    axis(name) {
      const i = AXIS_INDEX[name];
      if (i === undefined) {
        warnOnce('axis:' + name, `unknown axis '${name}'`);
        return 0;
      }
      return input.context === 'game' ? axes[i] : 0;
    },

    setContext(context) {
      if (!CONTEXTS.includes(context)) throw new Error(`input.setContext: unknown context '${context}'`);
      input.context = context;
    },
    setDevice(device) {
      if (!DEVICE_SOURCES.has(device)) throw new Error(`input.setDevice: unknown device '${device}'`);
      input.device = device;
      emitDevice();
    },

    registerSource(id, source) {
      const at = sourceIds.indexOf(id);
      const prev = at >= 0 ? sourceList[at] : null;
      if (prev && prev !== source && typeof prev.dispose === 'function') {
        try {
          prev.dispose();
        } catch (err) {
          if (c.log) c.log.error('input', `source '${id}' dispose threw:`, err);
        }
      }
      releaseSource(id);
      if (at >= 0) {
        sourceList[at] = source;
      } else {
        sourceIds.push(id);
        sourceList.push(source);
      }
    },

    setButton(action, isDown, source) {
      const i = indexOf(action);
      if (i < 0 || ignored(source)) return;
      const bit = 1 << slot(source);
      if (isDown) {
        if ((srcMask[i] & bit) !== 0) return;
        if (srcMask[i] === 0) {
          simLatch[i] = 1;
          frameLatch[i] = 1;
        }
        srcMask[i] |= bit;
        noteDevice(source);
      } else {
        srcMask[i] &= ~bit;
      }
    },

    setAxis(name, value, source) {
      const a = AXIS_INDEX[name];
      if (a === undefined) {
        warnOnce('axis:' + name, `unknown axis '${name}'`);
        return;
      }
      if (ignored(source)) return;
      if (a >= 2) {
        if (a === 2) input.addLook(value, 0, source);
        else input.addLook(0, value, source);
        return;
      }
      const v = value > 1 ? 1 : value < -1 ? -1 : value || 0;
      moveSrc[slot(source) * 2 + a] = v;
      if (Math.abs(v) > DEVICE_AXIS_THRESHOLD) noteDevice(source);
    },

    addLook(dxDeg, dyDeg, source) {
      if (source !== undefined) {
        if (ignored(source)) return;
        if (dxDeg !== 0 || dyDeg !== 0) noteDevice(source);
      }
      lookAccX += dxDeg;
      lookAccY += dyDeg;
    },

    requestPointerLock() {
      try {
        const three = c.three;
        const el = (three && three.renderer && three.renderer.domElement) || (c.dom && c.dom.root);
        if (!el || typeof el.requestPointerLock !== 'function') return;
        const r = el.requestPointerLock();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (err) {
        /* pointer lock is optional (ARCHITECTURE 7.2 rule 10) */
      }
    },

    rumble() {},

    vibrate(pattern) {
      const settings = c.save && c.save.settings;
      if (settings && settings.vibration === false) return;
      if (vibrateState === 0) {
        vibrateState = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? 1 : -1;
      }
      if (vibrateState < 0) return;
      try {
        if (navigator.vibrate(pattern) === false) vibrateState = -1;
      } catch (err) {
        vibrateState = -1;
      }
    },

    glyph(action) {
      const device = input.device === 'pad' && !input.padAvailable ? 'kbm' : input.device;
      if (device === 'touch') return { device, label: action, icon: action };
      const table = /** @type {Record<string, string>} */ (device === 'pad' ? PAD_GLYPHS : KBM_GLYPHS);
      return { device, label: table[action] || '', icon: null };
    },

    inject: {
      press(action, ticks = 1) {
        const i = indexOf(action);
        if (i < 0) return;
        const n = Math.max(1, Math.floor(ticks));
        if (n > injTicks[i]) injTicks[i] = n;
        frameLatch[i] = 1;
      },
      hold(action, on) {
        const i = indexOf(action);
        if (i < 0) return;
        if (on && injHold[i] === 0 && srcMask[i] === 0) frameLatch[i] = 1;
        injHold[i] = on ? 1 : 0;
      },
      move(x, y) {
        moveSrc[INJECT_SLOT * 2] = x > 1 ? 1 : x < -1 ? -1 : x || 0;
        moveSrc[INJECT_SLOT * 2 + 1] = y > 1 ? 1 : y < -1 ? -1 : y || 0;
      },
      look(dx, dy) {
        lookAccX += dx;
        lookAccY += dy;
      },
      clear() {
        injTicks.fill(0);
        injHold.fill(0);
        moveSrc[INJECT_SLOT * 2] = 0;
        moveSrc[INJECT_SLOT * 2 + 1] = 0;
        lookAccX = 0;
        lookAccY = 0;
      },
    },

    sample() {
      const game = input.context === 'game';
      for (let i = 0; i < NA; i++) {
        const raw = srcMask[i] !== 0 || simLatch[i] === 1 || injTicks[i] > 0 || injHold[i] === 1;
        simLatch[i] = 0;
        if (injTicks[i] > 0) injTicks[i]--;
        const eff = raw && (game || always[i] === 1);
        const was = downS[i] === 1;
        pressedS[i] = eff && !was ? 1 : 0;
        releasedS[i] = !eff && was ? 1 : 0;
        downS[i] = eff ? 1 : 0;
        heldTicks[i] = eff ? heldTicks[i] + 1 : 0;
      }
      let mx = combinedMove(0);
      let my = combinedMove(1);
      const len = Math.sqrt(mx * mx + my * my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      axes[0] = game ? mx : 0;
      axes[1] = game ? my : 0;
      axes[2] = game ? lookAccX : 0;
      axes[3] = game ? lookAccY : 0;
      lookAccX = 0;
      lookAccY = 0;
    },

    endTick() {
      pressedS.fill(0);
      releasedS.fill(0);
    },

    poll(dt) {
      for (let s = 0; s < sourceList.length; s++) {
        const src = sourceList[s];
        if (typeof src.poll !== 'function') continue;
        try {
          src.poll(input, dt);
        } catch (err) {
          warnOnce('poll:' + sourceIds[s], `source '${sourceIds[s]}' poll threw:`, err);
        }
      }
      const list = pressListeners;
      for (let i = 0; i < NA; i++) {
        if (frameLatch[i] === 0) continue;
        frameLatch[i] = 0;
        const name = ACTIONS[i];
        for (let j = 0; j < list.length; j++) {
          try {
            list[j](name);
          } catch (err) {
            if (c.log) c.log.error('input', 'onPress listener threw:', err);
          }
        }
      }
      emitDevice();
    },
  };
  return input;
}

/* ------------------------------------------------------------------ sources -- */

/**
 * True when a DOM event target is a text field (the journey-code box): keys go to it, not to the game.
 * @param {any} t
 */
function isEditable(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);
}

/**
 * True when a mouse target is an interactive UI element (buttons, touch controls), which must not fire `attack`.
 * @param {any} t
 */
function isInteractive(t) {
  return !!t && typeof t.closest === 'function' && t.closest('button,a,input,textarea,select,[data-action]') !== null;
}

/**
 * Press and release an action through a source, so it reads as pressed for one tick and reaches onPress once.
 * @param {Input} input @param {string} action @param {string} source
 */
function pulse(input, action, source) {
  input.setButton(action, true, source);
  input.setButton(action, false, source);
}

/**
 * The keyboard and mouse source (ART_UX 6.4): bindings of {@link KBM_KEYS}, WASD move, arrow-key look at
 * 120 deg/s, mouse look under pointer lock or while dragging with the right or middle button, wheel lock
 * switching, pointer lock on click, and `pause` when pointer lock is lost during play.
 * Without a DOM (Node) it is inert.
 * @param {Input} input
 * @returns {InputSource}
 */
export function createKbmSource(input) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return {};
  const ID = 'kbm';
  /** @type {Set<string>} */
  const held = new Set();
  const counts = new Int32Array(NA);
  /** Held look keys: index 2 = lookX, 3 = lookY, each summed with its sign. */
  const look = new Int32Array(4);
  let locked = false;

  /** @param {string} action @param {boolean} on */
  function count(action, on) {
    const i = ACTION_INDEX[action];
    if (on) {
      if (counts[i]++ === 0) input.setButton(action, true, ID);
    } else if (counts[i] > 0 && --counts[i] === 0) {
      input.setButton(action, false, ID);
    }
  }

  function updateMove() {
    let mx = 0;
    let my = 0;
    for (const code of held) {
      const m = /** @type {Record<string, number[]>} */ (KBM_MOVE_KEYS)[code];
      if (!m) continue;
      if (m[0] === 0) mx += m[1];
      else my += m[1];
    }
    input.setAxis('moveX', mx, ID);
    input.setAxis('moveY', my, ID);
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const acts = /** @type {Record<string, string[]>} */ (KBM_KEYS)[e.code];
    const isMove = e.code in KBM_MOVE_KEYS;
    const isLook = e.code in KBM_LOOK_KEYS;
    if (!acts && !isMove && !isLook) return;
    if (e.code !== 'Escape') e.preventDefault();
    if (held.has(e.code)) return;
    held.add(e.code);
    if (acts) for (const a of acts) count(a, true);
    if (isMove) updateMove();
    if (isLook) {
      const m = /** @type {Record<string, number[]>} */ (KBM_LOOK_KEYS)[e.code];
      look[m[0]] += m[1];
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeyUp(e) {
    if (!held.has(e.code)) return;
    held.delete(e.code);
    const acts = /** @type {Record<string, string[]>} */ (KBM_KEYS)[e.code];
    if (acts) for (const a of acts) count(a, false);
    if (e.code in KBM_MOVE_KEYS) updateMove();
    const m = /** @type {Record<string, number[]>} */ (KBM_LOOK_KEYS)[e.code];
    if (m) look[m[0]] -= m[1];
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (isInteractive(e.target) || isEditable(e.target)) return;
    const a = /** @type {Record<number, string>} */ (KBM_MOUSE)[e.button];
    if (a) count(a, true);
    if (e.button === 0 && !locked && input.context === 'game') input.requestPointerLock();
  }

  /** @param {MouseEvent} e */
  function onMouseUp(e) {
    const a = /** @type {Record<number, string>} */ (KBM_MOUSE)[e.button];
    if (a) count(a, false);
  }

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    if (!locked && (e.buttons & 6) === 0) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (dx !== 0 || dy !== 0) input.addLook(dx * MOUSE_DEG_PER_PX, -dy * MOUSE_DEG_PER_PX, ID);
  }

  /** @param {WheelEvent} e */
  function onWheel(e) {
    if (isEditable(e.target) || e.deltaY === 0) return;
    pulse(input, e.deltaY > 0 ? KBM_WHEEL.down : KBM_WHEEL.up, ID);
  }

  function onLockChange() {
    const now = !!document.pointerLockElement;
    if (locked && !now && input.context === 'game') pulse(input, 'pause', ID);
    locked = now;
  }

  function releaseAll() {
    held.clear();
    look.fill(0);
    for (let i = 0; i < NA; i++) {
      if (counts[i] > 0) input.setButton(ACTIONS[i], false, ID);
      counts[i] = 0;
    }
    input.setAxis('moveX', 0, ID);
    input.setAxis('moveY', 0, ID);
  }

  /** @type {Array<[EventTarget, string, any, any]>} */
  const listeners = [
    [window, 'keydown', onKeyDown, false],
    [window, 'keyup', onKeyUp, false],
    [window, 'blur', releaseAll, false],
    [window, 'mousedown', onMouseDown, false],
    [window, 'mouseup', onMouseUp, false],
    [window, 'mousemove', onMouseMove, false],
    [window, 'wheel', onWheel, { passive: true }],
    [document, 'pointerlockchange', onLockChange, false],
  ];
  for (const [t, type, fn, opt] of listeners) t.addEventListener(type, fn, opt);

  return {
    poll(inp, dt) {
      if (look[2] !== 0 || look[3] !== 0) inp.addLook(look[2] * KEY_LOOK_DEG_PER_S * dt, look[3] * KEY_LOOK_DEG_PER_S * dt, ID);
    },
    dispose() {
      for (const [t, type, fn, opt] of listeners) t.removeEventListener(type, fn, opt);
      releaseAll();
    },
  };
}

/**
 * The basic standard-mapping gamepad source (ART_UX 6.5): face buttons, LT modifier, shoulders, D-pad,
 * View and Menu, left stick move and right stick look with a 0.18 radial dead zone, and the UI navigation
 * mapping. `navigator.getGamepads` is called inside try/catch; if it throws or is missing the source turns
 * itself off and sets `input.padAvailable = false`. The control package replaces it with the full mapping.
 * @param {Input} input
 * @returns {InputSource}
 */
export function createPadSource(input) {
  const ID = 'pad';
  const managed = new Uint8Array(NA);
  for (const b of PAD_BINDINGS) managed[ACTION_INDEX[b[1]]] = 1;
  const want = new Uint8Array(NA);
  const cur = new Uint8Array(NA);
  let off = false;
  let active = false;

  /** @param {any} pad @param {number} i */
  function btn(pad, i) {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  }

  function releaseAll() {
    for (let i = 0; i < NA; i++) {
      if (cur[i]) input.setButton(ACTIONS[i], false, ID);
      cur[i] = 0;
    }
    input.setAxis('moveX', 0, ID);
    input.setAxis('moveY', 0, ID);
    active = false;
  }

  const stick = new Float64Array(2);
  /** Radial dead zone with rescale; writes into `stick`. @param {number} x @param {number} y */
  function deadZone(x, y) {
    const m = Math.sqrt(x * x + y * y);
    if (m < PAD_DEAD_ZONE) {
      stick[0] = 0;
      stick[1] = 0;
      return;
    }
    const k = Math.min(1, (m - PAD_DEAD_ZONE) / (1 - PAD_DEAD_ZONE)) / m;
    stick[0] = x * k;
    stick[1] = y * k;
  }

  return {
    poll(inp, dt) {
      if (off) return;
      let pads = null;
      try {
        if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') throw new Error('no Gamepad API');
        pads = navigator.getGamepads();
      } catch (err) {
        off = true;
        inp.padAvailable = false;
        releaseAll();
        return;
      }
      let pad = null;
      if (pads) {
        for (let i = 0; i < pads.length; i++) {
          const p = pads[i];
          if (p && p.connected && p.mapping === 'standard') {
            pad = p;
            break;
          }
        }
      }
      if (!pad) {
        if (active) releaseAll();
        return;
      }
      active = true;
      const lt = btn(pad, PAD.LT);
      want.fill(0);
      for (let i = 0; i < PAD_BINDINGS.length; i++) {
        const b = PAD_BINDINGS[i];
        if (!btn(pad, b[0])) continue;
        if (b[2] === 2 || (b[2] === 0 && !lt) || (b[2] === 1 && lt)) want[ACTION_INDEX[b[1]]] = 1;
      }
      for (let i = 0; i < NA; i++) {
        if (managed[i] === 0 || want[i] === cur[i]) continue;
        cur[i] = want[i];
        inp.setButton(ACTIONS[i], want[i] === 1, ID);
      }
      const ax = pad.axes;
      deadZone(ax[0] || 0, ax[1] || 0);
      inp.setAxis('moveX', stick[0], ID);
      inp.setAxis('moveY', -stick[1], ID);
      deadZone(ax[2] || 0, ax[3] || 0);
      if (stick[0] !== 0 || stick[1] !== 0) {
        inp.addLook(stick[0] * PAD_LOOK_DEG_PER_S * dt, -stick[1] * PAD_LOOK_DEG_PER_S * dt, ID);
      }
    },
    dispose() {
      releaseAll();
    },
  };
}

/**
 * Register the foundation's `'kbm'` and basic `'pad'` sources (4.8). Safe to call in Node (the kbm source is inert there).
 * @param {Input} input
 */
export function installDefaultSources(input) {
  input.registerSource('kbm', createKbmSource(input));
  input.registerSource('pad', createPadSource(input));
}
