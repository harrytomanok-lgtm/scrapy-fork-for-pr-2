/**
 * DOM building kit of the ui package: elements whose text is bound to i18n keys (refreshed on lang:changed),
 * buttons with the press pulse and UI sound, numbers inside <bdi>, ribbons, chips, toggles and sliders.
 * Every user-visible string goes through `ctx.i18n.t` (ARCHITECTURE 7.2 rule 9).
 * @module ui/kit
 */

import { icon } from './icons.js';

/**
 * @typedef {object} Kit
 * @property {(key:string, args?:any) => string} t
 * @property {(tag:string, cls?:string, parent?:HTMLElement|null, key?:string|null, args?:any) => HTMLElement} el
 * @property {(node:Element, name:string, key:string, args?:any) => void} attr
 * @property {(parent:HTMLElement|null, key:string|null, onClick:(e?:any) => void, cls?:string, iconName?:string|null, args?:any) => HTMLButtonElement} button
 * @property {(parent:HTMLElement|null, cls?:string) => HTMLElement} num
 * @property {(node:HTMLElement, key:string, args?:any) => void} rebind
 * @property {() => void} refresh
 * @property {(node:Node) => void} forget
 * @property {(name:string) => void} sound
 */

/**
 * @param {any} ctx
 * @returns {Kit}
 */
export function createKit(ctx) {
  const dom = ctx.dom;
  /** @type {Array<{ node:any, key:string, args:any, attr:string|null }>} */
  const bound = [];
  const t = (key, args) => ctx.i18n.t(key, args || undefined);

  /** @param {string} name */
  function sound(name) {
    const a = ctx.audio;
    if (!a || typeof a.play !== 'function') return;
    try {
      a.play(name);
    } catch (e) {
      // audio is optional
    }
  }

  const kit = {
    t,
    sound,
    el(tag, cls, parent, key, args) {
      const n = dom.el(tag, cls || '', parent || undefined);
      if (key) {
        n.textContent = t(key, args);
        bound.push({ node: n, key, args: args || null, attr: null });
      }
      return n;
    },
    attr(node, name, key, args) {
      node.setAttribute(name, t(key, args));
      bound.push({ node, key, args: args || null, attr: name });
    },
    rebind(node, key, args) {
      for (const b of bound) {
        if (b.node === node && !b.attr) {
          b.key = key;
          b.args = args || null;
          node.textContent = t(key, args);
          return;
        }
      }
      node.textContent = t(key, args);
      bound.push({ node, key, args: args || null, attr: null });
    },
    button(parent, key, onClick, cls, iconName, args) {
      const b = /** @type {HTMLButtonElement} */ (dom.el('button', 'ui-btn' + (cls ? ' ' + cls : ''), parent || undefined));
      b.type = 'button';
      if (iconName) b.appendChild(icon(dom.doc, iconName, 'ui-ico'));
      if (key) {
        const s = dom.el('span', 'ui-btn-label', b);
        s.textContent = t(key, args);
        bound.push({ node: s, key, args: args || null, attr: null });
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.disabled) return;
        b.classList.remove('ui-press');
        void b.offsetWidth;
        b.classList.add('ui-press');
        sound('ui_confirm');
        onClick(e);
      });
      return b;
    },
    num(parent, cls) {
      return dom.el('bdi', 'ui-num' + (cls ? ' ' + cls : ''), parent || undefined);
    },
    refresh() {
      for (let i = bound.length - 1; i >= 0; i--) {
        const b = bound[i];
        if (!b.node.isConnected && !b.keep) {
          // Detached rows of rebuilt lists are dropped; screen roots stay bound while hidden (they stay connected).
          bound.splice(i, 1);
          continue;
        }
        const text = t(b.key, b.args);
        if (b.attr) b.node.setAttribute(b.attr, text);
        else if (b.node.textContent !== text) b.node.textContent = text;
      }
    },
    forget(node) {
      for (let i = bound.length - 1; i >= 0; i--) if (node.contains(bound[i].node)) bound.splice(i, 1);
    },
  };
  return kit;
}
