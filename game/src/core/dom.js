/**
 * DOM platform layer (ARCHITECTURE 3.9): the `#app` root, the fixed layer stack, idempotent styles, small
 * element helpers, and `safeStorage`, the only way to reach localStorage (7.2 rule 10).
 * Nothing here touches `window` or `document` at module scope, so `createSafeStorage` runs in Node.
 * @module core/dom
 */

/** Layers in z-order, bottom first (3.9). */
export const LAYERS = Object.freeze(['canvas', 'touch', 'hud', 'screens', 'overlay', 'fatal']);

/**
 * @typedef {object} SafeStorage
 * @property {(key:string) => string|null} get
 * @property {(key:string, value:string) => void} set
 * @property {(key:string) => void} remove
 * @property {boolean} memoryOnly   true when the backing storage is missing, refused or failed; data then lives in memory only
 */

/**
 * @typedef {object} StorageLike
 * @property {(key:string) => string|null} getItem
 * @property {(key:string, value:string) => void} setItem
 * @property {(key:string) => void} removeItem
 */

/** Key written and removed once to probe that the storage accepts writes. */
const PROBE_KEY = 'kethra.probe';

/**
 * Storage wrapper with try/catch around every access and an in-memory Map fallback. It never throws.
 * The first failure (or a refused probe write) switches it to memory for the rest of the session; values
 * written before that stay readable because every write is also kept in memory.
 * @param {{ backing?:StorageLike|(() => StorageLike|null)|null, memoryOnly?:boolean }} [opts]
 *   backing: a Storage or a getter for it (getting `window.localStorage` itself can throw in sandboxed frames);
 *   memoryOnly: force memory (test mode, `nosave=1`)
 * @returns {SafeStorage}
 */
export function createSafeStorage(opts = {}) {
  /** @type {Map<string, string>} */
  const mem = new Map();
  /** @type {StorageLike|null} */
  let backing = null;
  let memoryOnly = !!opts.memoryOnly;
  if (!memoryOnly) {
    try {
      backing = typeof opts.backing === 'function' ? opts.backing() : opts.backing || null;
      if (backing) {
        backing.setItem(PROBE_KEY, '1');
        backing.removeItem(PROBE_KEY);
      }
    } catch (e) {
      backing = null;
    }
    if (!backing) memoryOnly = true;
  }

  const fail = () => {
    memoryOnly = true;
    backing = null;
  };

  return {
    get memoryOnly() {
      return memoryOnly;
    },
    get(key) {
      if (!memoryOnly && backing) {
        try {
          const v = backing.getItem(key);
          return v === undefined ? null : v;
        } catch (e) {
          fail();
        }
      }
      const v = mem.get(key);
      return v === undefined ? null : v;
    },
    set(key, value) {
      const s = String(value);
      mem.set(key, s);
      if (memoryOnly || !backing) return;
      try {
        backing.setItem(key, s);
      } catch (e) {
        fail();
      }
    },
    remove(key) {
      mem.delete(key);
      if (memoryOnly || !backing) return;
      try {
        backing.removeItem(key);
      } catch (e) {
        fail();
      }
    },
  };
}

/** @returns {StorageLike|null} window.localStorage when reachable (may throw; createSafeStorage catches) */
export function browserStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

/**
 * @typedef {object} Dom
 * @property {HTMLElement} root                          #app
 * @property {(name:string) => HTMLElement} layer        created on first use, fixed z-order (LAYERS)
 * @property {(id:string, cssText:string) => HTMLStyleElement} addStyle   idempotent `<style data-id>`; a new text replaces the old
 * @property {SafeStorage} safeStorage
 * @property {(tag:string, className?:string, parent?:HTMLElement|null, text?:string) => HTMLElement} el   create an element
 * @property {(node:HTMLElement) => void} clear          remove every child
 * @property {(node:HTMLElement) => void} guardTouch     non-passive touchstart that calls preventDefault (gesture hygiene, ART_UX 6.1)
 * @property {Document} doc
 */

/**
 * Create the DOM service: finds `#app` (or creates it under body) and prepares the layer stack.
 * @param {{ doc?:Document, storage?:SafeStorage }} [opts]  storage defaults to localStorage through createSafeStorage
 * @returns {Dom}
 */
export function createDom(opts = {}) {
  const doc = opts.doc || document;
  let root = /** @type {HTMLElement|null} */ (doc.getElementById('app'));
  if (!root) {
    root = doc.createElement('div');
    root.id = 'app';
    doc.body.appendChild(root);
  }
  /** @type {Record<string, HTMLElement>} */
  const layers = Object.create(null);

  /** @type {Dom} */
  const dom = {
    doc,
    root,
    safeStorage: opts.storage || createSafeStorage({ backing: browserStorage }),

    layer(name) {
      const existing = layers[name];
      if (existing) return existing;
      const z = LAYERS.indexOf(name);
      if (z < 0) throw new Error(`dom.layer: unknown layer '${name}' (one of ${LAYERS.join(', ')})`);
      // Adopt a layer the HTML shell already contains (the static boot splash of tools/build.mjs).
      for (let c = dom.root.firstElementChild; c; c = c.nextElementSibling) {
        const el = /** @type {HTMLElement} */ (c);
        if (el.dataset && el.dataset.layer === name) {
          layers[name] = el;
          return el;
        }
      }
      const node = doc.createElement('div');
      node.className = 'k-layer k-layer-' + name;
      node.dataset.layer = name;
      node.style.zIndex = String((z + 1) * 10);
      // Keep the DOM order equal to the z-order so later layers also win for equal stacking contexts.
      let before = null;
      for (let i = z + 1; i < LAYERS.length && !before; i++) before = layers[LAYERS[i]] || null;
      dom.root.insertBefore(node, before);
      layers[name] = node;
      return node;
    },

    addStyle(id, cssText) {
      let node = /** @type {HTMLStyleElement|null} */ (doc.head.querySelector(`style[data-id="${id}"]`));
      if (!node) {
        node = doc.createElement('style');
        node.dataset.id = id;
        doc.head.appendChild(node);
      }
      if (node.textContent !== cssText) node.textContent = cssText;
      return node;
    },

    el(tag, className, parent, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      if (parent) parent.appendChild(node);
      return node;
    },

    clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    },

    guardTouch(node) {
      node.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
    },
  };
  return dom;
}
