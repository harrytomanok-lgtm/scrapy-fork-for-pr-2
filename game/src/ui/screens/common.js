/**
 * Shared building blocks of the ui screens: the cut-paper panel shell, local tab rows, chip groups, switches,
 * sliders, ring icons with rarity badges, and name lookups through i18n.
 * @module ui/screens/common
 */

import { icon, itemIcon } from '../icons.js';

/**
 * A screen root with one cut-paper panel (ART_UX 7.1).
 * @param {import('../kit.js').Kit} kit
 * @param {{ cls?:string, size?:'wide'|'narrow'|'', ribbon?:string|null, ribbonIcon?:string|null }} [o]
 */
export function shell(kit, o = {}) {
  const root = kit.el('div', 'ui-scr' + (o.cls ? ' ' + o.cls : ''), null);
  const panel = kit.el('div', 'ui-panel' + (o.size ? ' ui-' + o.size : ''), root);
  const pin = kit.el('div', 'ui-pin', panel);
  const body = kit.el('div', 'ui-pbody', pin);
  /** @type {HTMLElement|null} */
  let ribbon = null;
  if (o.ribbon) {
    ribbon = kit.el('h2', 'ui-ribbon', body);
    if (o.ribbonIcon) ribbon.appendChild(icon(ribbon.ownerDocument, o.ribbonIcon));
    kit.el('span', '', ribbon, o.ribbon);
  }
  return { root, panel, body, ribbon };
}

/**
 * A row of local tabs (settings sections, branches, Buy and Sell). Returns a controller.
 * @param {import('../kit.js').Kit} kit
 * @param {HTMLElement} parent
 * @param {Array<{ id:string, key:string, icon?:string }>} items
 * @param {(id:string) => void} onPick
 */
export function tabRow(kit, parent, items, onPick) {
  const bar = kit.el('div', 'ui-tabs', parent);
  /** @type {Record<string, HTMLButtonElement>} */
  const btns = {};
  let cur = items[0].id;
  for (const it of items) {
    const b = kit.button(bar, it.key, () => {
      ctl.set(it.id);
      onPick(it.id);
    }, 'ui-tab', it.icon || null);
    b.className = 'ui-tab' + (it.icon ? ' ui-hasico' : '');
    b.dataset.tab = it.id;
    btns[it.id] = b;
  }
  const ctl = {
    bar,
    get current() {
      return cur;
    },
    /** @param {string} id */
    set(id) {
      cur = id;
      for (const k of Object.keys(btns)) btns[k].classList.toggle('ui-sel', k === id);
    },
    /** @param {1|-1} dir */
    step(dir) {
      const ids = items.map((i) => i.id);
      const k = ids.indexOf(cur);
      const next = ids[(k + dir + ids.length) % ids.length];
      ctl.set(next);
      onPick(next);
    },
  };
  ctl.set(cur);
  return ctl;
}

/**
 * A group of selectable chips.
 * @param {import('../kit.js').Kit} kit
 * @param {HTMLElement} parent
 * @param {Array<{ id:string, key:string, args?:any }>} items
 * @param {(id:string) => void} onPick
 */
export function chips(kit, parent, items, onPick) {
  const box = kit.el('div', 'ui-chips', parent);
  /** @type {Record<string, HTMLButtonElement>} */
  const btns = {};
  for (const it of items) {
    const b = kit.button(box, it.key, () => {
      ctl.set(it.id);
      onPick(it.id);
    }, 'ui-chipbtn', null, it.args);
    b.className = 'ui-chipbtn';
    b.dataset.value = it.id;
    btns[it.id] = b;
  }
  const ctl = {
    box,
    /** @param {string} id */
    set(id) {
      for (const k of Object.keys(btns)) btns[k].classList.toggle('ui-sel', k === id);
    },
  };
  return ctl;
}

/**
 * A labelled on/off switch row.
 * @param {import('../kit.js').Kit} kit @param {HTMLElement} parent @param {string} key
 * @param {() => boolean} get @param {(v:boolean) => void} set
 */
export function switchRow(kit, parent, key, get, set) {
  const row = kit.el('label', 'ui-field', parent);
  kit.el('span', '', row, key);
  const sw = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-switch', row));
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  kit.attr(sw, 'aria-label', key);
  const sync = () => {
    const v = !!get();
    sw.classList.toggle('ui-on', v);
    sw.setAttribute('aria-checked', v ? 'true' : 'false');
  };
  sw.addEventListener('click', (e) => {
    e.preventDefault();
    set(!get());
    kit.sound('ui_move');
    sync();
  });
  sync();
  return { row, sync };
}

/**
 * A labelled range slider row.
 * @param {import('../kit.js').Kit} kit @param {HTMLElement} parent @param {string} key
 * @param {{ min:number, max:number, step:number }} r
 * @param {() => number} get @param {(v:number) => void} set
 */
export function sliderRow(kit, parent, key, r, get, set) {
  const row = kit.el('label', 'ui-field', parent);
  kit.el('span', '', row, key);
  const input = /** @type {HTMLInputElement} */ (kit.el('input', 'ui-range', row));
  input.type = 'range';
  input.min = String(r.min);
  input.max = String(r.max);
  input.step = String(r.step);
  kit.attr(input, 'aria-label', key);
  const sync = () => {
    input.value = String(get());
  };
  input.addEventListener('change', () => set(Number(input.value)));
  input.addEventListener('input', () => set(Number(input.value)));
  sync();
  return { row, sync, input };
}

/**
 * Ring icon with a rarity colour and letter badge (ART_UX 7.2 inventory; colour-blind safe).
 * @param {import('../kit.js').Kit} kit @param {HTMLElement} parent @param {any} def ItemDef
 */
export function itemRing(kit, parent, def) {
  const r = kit.el('span', 'ui-ringico' + (def && def.rarity ? ' ui-r-' + def.rarity : ''), parent);
  r.appendChild(icon(parent.ownerDocument, itemIcon(def)));
  if (def && def.rarity) kit.el('b', 'ui-letterb', r, 'ui.rarity.letter.' + def.rarity);
  return r;
}

/** @param {any} ctx @param {string} speakerId @returns {string|null} i18n key of the speaker's name */
export function speakerKey(ctx, speakerId) {
  if (!speakerId || speakerId === 'system') return null;
  if (speakerId === 'tavi') return 'core.player.name';
  if (speakerId === 'villager') return 'ui.speaker.villager';
  if (ctx.i18n.has('npc.' + speakerId + '.name')) return 'npc.' + speakerId + '.name';
  if (ctx.i18n.has('boss.' + speakerId + '.name')) return 'boss.' + speakerId + '.name';
  if (ctx.i18n.has('enemy.' + speakerId + '.name')) return 'enemy.' + speakerId + '.name';
  return null;
}

/** @param {string} id @returns {string} */
export function itemNameKey(id) {
  return 'item.' + id + '.name';
}

/**
 * Name key of a technique-tree node.
 * @param {any} ctx @param {{ id:string, techId:string|null }} row
 */
export function nodeNameKey(ctx, row) {
  if (row.techId) return 'tech.' + row.techId + '.name';
  if (ctx.i18n.has('node.' + row.id + '.name')) return 'node.' + row.id + '.name';
  return 'ui.tech.passive';
}
