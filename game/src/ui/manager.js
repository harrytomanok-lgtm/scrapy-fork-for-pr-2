/**
 * Screen manager of `ctx.ui` (ARCHITECTURE 4.13, ART_UX 7.2): the screen stack over the HUD, the menu pause
 * (`time.pause('menu')`) and input context 'ui' while any screen is open, `ui:screen` events, frame-rate input
 * from `input.onPress` (never `input.pressed`, the sim is paused), focus navigation for keyboard and gamepad with
 * the spatial graph of logic/focus.js, the shared tab bar of the pause sub-screens, and the in-UI confirm modal.
 * @module ui/manager
 */

import { moveFocus, focusProblems } from './logic/focus.js';

/**
 * @typedef {object} Screen
 * @property {HTMLElement} el
 * @property {(params:any) => void} onOpen
 * @property {() => void} onClose
 * @property {() => void} [onLang]
 * @property {(action:string) => boolean|void} [onInput]   true = handled (the manager does nothing more)
 * @property {boolean} [modal]        uiBack does not close it (title, loading, death, fatal, dialogue)
 * @property {string} [group]         tab group id (the pause sub-screens)
 * @property {() => HTMLElement|null} [initialFocus]
 */

/** Pause sub-screens that share the tab bar, in tab order. */
export const PAUSE_TABS = Object.freeze(['character', 'techniques', 'inventory', 'quests', 'map']);
const TAB_ICONS = Object.freeze({ character: 'person', techniques: 'ring', inventory: 'bag', quests: 'scroll', map: 'map' });

/**
 * @param {any} ctx
 * @param {import('./kit.js').Kit} kit
 */
export function createManager(ctx, kit) {
  const dom = ctx.dom;
  const layer = dom.layer('screens');
  /** @type {Map<string, Function>} */
  const factories = new Map();
  /** @type {Map<string, Screen>} */
  const screens = new Map();
  /** @type {string[]} */
  const stack = [];
  /** @type {Map<string, number>} frame number at which a screen opened */
  const openedAt = new Map();
  let frameNo = 0;
  /** @type {HTMLElement|null} */
  let focused = null;
  let swallowBack = -1;
  const pScreen = { id: '', open: false };

  /** @param {string} id @param {boolean} open */
  function emit(id, open) {
    pScreen.id = id;
    pScreen.open = open;
    ctx.bus.emit('ui:screen', pScreen);
  }

  /** @param {string} id @returns {Screen|null} */
  function screenOf(id) {
    let s = screens.get(id);
    if (s) return s;
    const f = factories.get(id);
    if (!f) return null;
    try {
      s = f(ctx);
    } catch (err) {
      ctx.log.error('ui', 'screen factory threw', id, err);
      return null;
    }
    if (!s || !s.el) return null;
    s.el.hidden = true;
    s.el.dataset.screen = id;
    layer.appendChild(s.el);
    screens.set(id, s);
    return s;
  }

  /** Focusable elements of a screen, in DOM order, visible only. @param {Screen} s */
  function focusables(s) {
    const out = [];
    const list = s.el.querySelectorAll('button:not([disabled]),input,textarea,[data-focus]');
    for (let i = 0; i < list.length; i++) {
      const n = /** @type {HTMLElement} */ (list[i]);
      if (n.closest('[hidden]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push(n);
    }
    return out;
  }

  /** @param {HTMLElement|null} n */
  function setFocus(n) {
    if (focused === n) return;
    if (focused) focused.classList.remove('ui-focus');
    focused = n;
    if (n) {
      n.classList.add('ui-focus');
      if (typeof n.scrollIntoView === 'function') {
        try {
          n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (e) {
          // older engines without options
        }
      }
    }
  }

  /** Focus the screen's preferred element, or its first focusable. @param {Screen} s */
  function focusInitial(s) {
    const pref = s.initialFocus ? s.initialFocus() : null;
    const list = focusables(s);
    setFocus(pref && list.indexOf(pref) >= 0 ? pref : list[0] || null);
  }

  /** @param {Screen} s @param {'up'|'down'|'left'|'right'} dir */
  function nav(s, dir) {
    const list = focusables(s);
    if (!list.length) return;
    let i = focused ? list.indexOf(focused) : -1;
    if (i < 0) {
      setFocus(list[0]);
      return;
    }
    const cur = list[i];
    if (cur.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (cur).type === 'range' && (dir === 'left' || dir === 'right')) {
      const r = /** @type {HTMLInputElement} */ (cur);
      const step = Number(r.step) || 0.1;
      const sign = (dir === 'right') !== (ctx.i18n.dir === 'rtl') ? 1 : -1;
      const v = Math.min(Number(r.max), Math.max(Number(r.min), Number(r.value) + sign * step));
      r.value = String(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const rects = [];
    for (const n of list) {
      const b = n.getBoundingClientRect();
      rects.push({ x: b.left, y: b.top, w: b.width, h: b.height });
    }
    i = moveFocus(rects, i, dir);
    if (i >= 0) {
      setFocus(list[i]);
      kit.sound('ui_move');
    }
  }

  /** @param {string} id */
  function hide(id) {
    const s = screens.get(id);
    if (!s) return;
    s.el.hidden = true;
    try {
      s.onClose();
    } catch (err) {
      ctx.log.error('ui', 'screen onClose threw', id, err);
    }
  }

  const mgr = {
    stack,
    screens,
    factories,
    get frameNo() {
      return frameNo;
    },

    /** @param {string} id @param {any} [params] */
    open(id, params) {
      const s = screenOf(id);
      if (!s) {
        ctx.log.warn('ui', 'unknown screen', id);
        return;
      }
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      const first = stack.length === 0;
      // Hide what is underneath except the pause hub's dim layer (menus stack visually one at a time).
      for (const other of stack) {
        const o = screens.get(other);
        if (o) o.el.hidden = true;
      }
      stack.push(id);
      openedAt.set(id, frameNo);
      s.el.hidden = false;
      layer.appendChild(s.el);
      if (first) {
        ctx.time.pause('menu');
        ctx.input.setContext('ui');
      }
      try {
        s.onOpen(params || {});
      } catch (err) {
        ctx.log.error('ui', 'screen onOpen threw', id, err);
      }
      focusInitial(s);
      if (!first || id !== 'loading') kit.sound('ui_open');
      emit(id, true);
    },

    /** @param {string} [id] */
    close(id) {
      const cid = id || stack[stack.length - 1];
      const i = cid ? stack.indexOf(cid) : -1;
      if (i < 0) return;
      const wasTop = i === stack.length - 1;
      stack.splice(i, 1);
      hide(cid);
      if (focused && screens.get(cid) && screens.get(cid).el.contains(focused)) setFocus(null);
      if (stack.length === 0) {
        ctx.time.resume('menu');
        ctx.input.setContext('game');
      } else if (wasTop) {
        const top = screens.get(stack[stack.length - 1]);
        if (top) {
          top.el.hidden = false;
          if (top.onLang) {
            try {
              top.onLang();
            } catch (err) {
              ctx.log.error('ui', 'screen refresh threw', err);
            }
          }
          focusInitial(top);
        }
      }
      emit(cid, false);
    },

    closeAll() {
      while (stack.length) mgr.close(stack[stack.length - 1]);
    },

    /** Swap the top screen for another without releasing the menu pause (tab switches). @param {string} id @param {any} [params] */
    replace(id, params) {
      const cur = stack[stack.length - 1];
      if (cur === id) return;
      if (!cur) {
        mgr.open(id, params);
        return;
      }
      stack.pop();
      hide(cur);
      setFocus(null);
      emit(cur, false);
      mgr.open(id, params);
    },

    top() {
      return stack.length ? stack[stack.length - 1] : 'hud';
    },

    /** @param {string} id */
    isOpen(id) {
      return id === 'hud' ? stack.length === 0 : stack.indexOf(id) >= 0;
    },

    /** @param {string} id @param {Function} factory */
    registerScreen(id, factory) {
      if (typeof factory !== 'function') return;
      const old = screens.get(id);
      if (old) {
        if (stack.indexOf(id) >= 0) mgr.close(id);
        old.el.remove();
        screens.delete(id);
      }
      factories.set(id, factory);
    },

    /** Frame-rate menu input (input.onPress). Returns true when a screen consumed it. @param {string} action */
    press(action) {
      const id = mgr.top();
      if (id === 'hud') return false;
      const s = screens.get(id);
      if (!s) return true;
      // The press that opened a screen must not also act inside it (Esc = pause + uiBack).
      if (openedAt.get(id) === frameNo) return true;
      if (action === 'uiBack' && swallowBack === frameNo) return true;
      if (s.onInput) {
        let handled = false;
        try {
          handled = !!s.onInput(action);
        } catch (err) {
          ctx.log.error('ui', 'screen input threw', id, err);
        }
        if (handled) return true;
      }
      switch (action) {
        case 'uiUp': nav(s, 'up'); break;
        case 'uiDown': nav(s, 'down'); break;
        case 'uiLeft': nav(s, 'left'); break;
        case 'uiRight': nav(s, 'right'); break;
        case 'uiConfirm':
          if (focused && s.el.contains(focused)) focused.click();
          break;
        case 'uiTabNext':
        case 'uiTabPrev':
          if (s.group === 'pause') {
            const k = PAUSE_TABS.indexOf(id);
            const n = PAUSE_TABS.length;
            mgr.replace(PAUSE_TABS[(k + (action === 'uiTabNext' ? 1 : n - 1)) % n], {});
            kit.sound('ui_move');
          }
          break;
        case 'pause':
          if (!s.modal) {
            swallowBack = frameNo;
            mgr.closeAll();
            kit.sound('ui_close');
          }
          break;
        case 'uiBack':
          if (!s.modal) {
            mgr.close(id);
            kit.sound('ui_back');
          }
          break;
        default:
          break;
      }
      return true;
    },

    /** Called once per frame by the ui frame system. */
    tick() {
      frameNo++;
      if (focused && !focused.isConnected) focused = null;
    },

    lang() {
      for (const id of stack) {
        const s = screens.get(id);
        if (s && s.onLang) {
          try {
            s.onLang();
          } catch (err) {
            ctx.log.error('ui', 'screen onLang threw', id, err);
          }
        }
      }
    },

    /** Focus problems of the open screen's real layout (scenarios). */
    focusReport() {
      const s = screens.get(mgr.top());
      if (!s) return { count: 0, problems: [] };
      const list = focusables(s);
      const rects = list.map((n) => {
        const b = n.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      });
      return { count: rects.length, problems: focusProblems(rects) };
    },

    refocus() {
      const s = screens.get(mgr.top());
      if (s) focusInitial(s);
    },

    /** Focused element (scenarios, tests). */
    get focused() {
      return focused;
    },

    /**
     * Build the shared tab bar of the pause sub-screens into `parent`.
     * @param {HTMLElement} parent @param {string} current
     */
    tabBar(parent, current) {
      const bar = dom.el('div', 'ui-tabs', parent);
      const prev = dom.el('span', 'ui-tabhint', bar);
      prev.dataset.glyph = 'uiTabPrev';
      for (const id of PAUSE_TABS) {
        const b = kit.button(bar, 'ui.tab.' + id, () => mgr.replace(id, {}), 'ui-tab', TAB_ICONS[id]);
        b.className = 'ui-tab' + (id === current ? ' ui-sel' : '');
        b.dataset.tab = id;
        kit.attr(b, 'aria-label', 'ui.tab.' + id);
      }
      const next = dom.el('span', 'ui-tabhint', bar);
      next.dataset.glyph = 'uiTabNext';
      return bar;
    },
  };
  return mgr;
}
