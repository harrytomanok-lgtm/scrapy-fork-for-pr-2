/**
 * The pause hub and its tabbed sub-screens (ART_UX 7.2): pause (journey summary and every menu), character
 * (Resonance, stats with base + gear and plus buttons, allocation style chips, derived values), techniques (Fist,
 * Flare and Spirit branches, rank pips, TP cost, Learn, detail sheet, two slots and the Ultimate slot), inventory
 * (four equipment slots, 64 px cells with rarity ring and letter badge, compare sheet with deltas, use and quick
 * item), quests (Main and Side, detail, Track) and map (parchment from world.mapCanvas, paper clouds over unseen
 * regions, icons, player arrow, pinch zoom and drag). Every action goes through ctx.rpg / ctx.quests / ctx.save.
 * @module ui/screens/menu
 */

import { icon, itemIcon } from '../icons.js';
import { shell, tabRow, chips, itemRing, itemNameKey, nodeNameKey } from './common.js';
import { formatInt, formatDelta, formatClock } from '../logic/format.js';

const STATS = Object.freeze(['mgt', 'spr', 'vit', 'swf']);
const STYLES = Object.freeze(['balanced', 'brawler', 'blaster', 'manual']);
const EQUIP = Object.freeze(['wraps', 'garb', 'charm1', 'charm2']);
const BRANCHES = Object.freeze(['fist', 'flare', 'spirit']);
/** Map places: world POI type, icon, class. */
const POI_ICONS = Object.freeze([['camp', 'skull', 'ui-c'], ['chest', 'bag', 'ui-k'], ['crownChest', 'bag', 'ui-k'], ['race', 'flare', ''],
  ['shrine', 'spirit', ''], ['siphon', 'core', 'ui-s'], ['ringstone', 'ring', 'ui-r']]);

/**
 * @param {any} ctx
 * @param {import('../kit.js').Kit} kit
 * @param {any} ui the ui service
 * @param {any} mgr the screen manager (tab bar)
 * @param {(id:string, f:Function) => void} reg
 */
export function registerMenuScreens(ctx, kit, ui, mgr, reg) {
  const dom = ctx.dom;
  const doc = dom.doc;

  /** A pause sub-screen shell: tab bar + body. @param {string} id @param {string} ribbonKey */
  function tabbed(id, ribbonKey) {
    const s = shell(kit, { size: 'wide' });
    const head = kit.el('div', 'ui-spread', s.body);
    mgr.tabBar(head, id).classList.add('ui-grow');
    const close = kit.button(head, null, () => ui.closeAll(), 'ui-icon ui-ghostbtn', 'close');
    kit.attr(close, 'aria-label', 'ui.common.close');
    void ribbonKey;
    return s;
  }

  // ------------------------------------------------------------------ pause
  reg('pause', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.pause.title', ribbonIcon: 'pause', size: 'wide' });
    const two = kit.el('div', 'ui-two', body);
    const grid = kit.el('div', 'ui-col', two);
    const card = kit.el('div', 'ui-card ui-spread', grid);
    const left = kit.el('div', 'ui-col', card);
    left.style.gap = '2px';
    const lv = kit.el('div', 'ui-li-title', left);
    const region = kit.el('div', 'ui-li-sub', left);
    const time = kit.el('div', 'ui-li-sub', left);
    const right = kit.el('div', 'ui-col', card);
    right.style.alignItems = 'flex-end';
    right.style.gap = '0';
    kit.el('span', 'ui-small', right, 'core.term.res');
    const resNum = kit.num(right, 'ui-resbig');
    const resume = kit.button(grid, 'ui.pause.resume', () => ui.closeAll(), 'ui-full ui-accent', 'play');
    const quit = kit.el('div', 'ui-row', grid);
    kit.button(quit, 'ui.pause.save', () => {
      const ok = ctx.save.write('manual');
      ui.toast(ok ? (ctx.save.memoryOnly ? 'ui.toast.savedMemory' : 'core.save.saved') : 'core.save.failed', null, ok ? 'good' : 'warn');
    }, 'ui-ghostbtn ui-grow', 'save');
    kit.button(quit, 'ui.pause.quit', () => {
      ui.confirm('ui.pause.quitConfirm', null).then((ok) => {
        if (!ok) return;
        ctx.save.write('quit');
        ui.closeAll();
        ctx.session.end({ toTitle: true });
      });
    }, 'ui-ghostbtn ui-grow', 'home');
    const menus = kit.el('div', 'ui-slots ui-menugrid', two);
    const sub = [
      ['character', 'person'], ['techniques', 'ring'], ['inventory', 'bag'], ['quests', 'scroll'], ['map', 'map'],
      ['settings', 'gear'], ['controls', 'pad'], ['savecode', 'copy'],
    ];
    for (const [id, ic] of sub) {
      const b = kit.button(menus, id === 'savecode' ? 'ui.code.title' : id === 'settings' || id === 'controls' ? 'ui.pause.' + id : 'ui.tab.' + id,
        () => ui.open(id, id === 'savecode' ? { tab: 'copy' } : {}), 'ui-ghostbtn ui-left', ic);
      b.dataset.open = id;
    }
    const render = () => {
      const rpg = ctx.rpg;
      lv.textContent = kit.t('core.stat.level', { level: formatInt(rpg.level) });
      const p = ctx.player;
      const rid = p && ctx.world ? ctx.world.regionAt(p.pos.x, p.pos.z) : null;
      region.textContent = rid ? kit.t('region.' + rid + '.name') : '';
      resNum.textContent = formatInt(rpg.resonance());
      const secs = ctx.store.state.meta ? ctx.store.state.meta.playSeconds : 0;
      time.textContent = kit.t('ui.pause.time', { time: formatClock(secs) });
    };
    return { el: root, onOpen: render, onClose() {}, onLang: render, initialFocus: () => resume };
  });

  // ------------------------------------------------------------------ character
  reg('character', () => {
    const { root, body } = tabbed('character', 'ui.tab.character');
    root.classList.add('ui-charscr');
    const two = kit.el('div', 'ui-two ui-char', body);
    const hero = kit.el('div', 'ui-hero ui-card', two);
    const sil = kit.el('div', 'ui-hero-sil', hero);
    sil.appendChild(icon(doc, 'person'));
    const heroText = kit.el('div', 'ui-col', hero);
    heroText.style.alignItems = 'center';
    kit.el('div', 'ui-li-title', heroText, 'core.player.name');
    const lv = kit.el('div', 'ui-small', heroText);
    kit.el('div', 'ui-small', heroText, 'core.term.resonance');
    const res = kit.num(heroText, 'ui-resbig');
    const xp = kit.el('div', 'ui-small', heroText);
    const der = kit.el('div', 'ui-col ui-der', two);
    kit.el('h3', 'ui-h3', der, 'ui.char.derived');
    const derived = kit.el('dl', 'ui-kv', der);
    const main = kit.el('div', 'ui-col ui-main', two);
    const points = kit.el('div', 'ui-spread', main);
    kit.el('h3', 'ui-h3', points, 'ui.char.stats');
    const pts = kit.el('span', 'ui-tag ui-ok', points);
    /** @type {Record<string, { val:HTMLElement, gear:HTMLElement, plus:HTMLButtonElement }>} */
    const rows = {};
    for (const k of STATS) {
      const line = kit.el('div', 'ui-statline', main);
      const g = kit.el('div', 'ui-grow', line);
      kit.el('span', 'ui-stat-name', g, 'core.stat.' + k);
      const gear = kit.el('span', 'ui-li-sub', g);
      const val = kit.num(line, 'ui-stat-val');
      const plus = kit.button(line, null, () => {
        if (ctx.rpg.allocate(k, 1)) {
          kit.sound('ui_confirm');
          render();
        }
      }, 'ui-icon ui-accent', 'plus');
      kit.attr(plus, 'aria-label', 'ui.char.add', { stat: kit.t('core.stat.' + k) });
      plus.dataset.stat = k;
      rows[k] = { val, gear, plus };
    }
    kit.el('h3', 'ui-h3', main, 'ui.char.style');
    const style = chips(kit, main, STYLES.map((id) => ({ id, key: 'core.style.' + id })), (id) => {
      ctx.rpg.setStyle(id);
      render();
    });
    const styleDesc = kit.el('p', 'ui-small', main);
    function dd(labelKey, value) {
      kit.el('dt', '', derived, labelKey);
      const d = kit.el('dd', '', derived);
      kit.num(d, '').textContent = value;
    }
    function render() {
      const rpg = ctx.rpg;
      const base = ctx.store.state.player.base;
      const eff = rpg.base();
      const n = rpg.statPoints;
      lv.textContent = kit.t('core.stat.level', { level: formatInt(rpg.level) });
      res.textContent = formatInt(rpg.resonance());
      xp.textContent = kit.t('ui.char.xp', { xp: formatInt(rpg.xp), need: formatInt(rpg.xpToNext()) });
      pts.textContent = kit.t('ui.char.points', { n: formatInt(n) });
      pts.hidden = n <= 0;
      for (const k of STATS) {
        const r = rows[k];
        r.val.textContent = formatInt(eff[k]);
        const g = Math.round(eff[k] - base[k]);
        r.gear.textContent = kit.t('ui.char.baseGear', { base: formatInt(base[k]), gear: formatDelta(g) });
        r.plus.hidden = n <= 0;
      }
      style.set(ctx.store.state.player.autoStyle);
      styleDesc.textContent = kit.t('ui.style.' + ctx.store.state.player.autoStyle + '.desc');
      kit.forget(derived);
      dom.clear(derived);
      const st = rpg.stats();
      if (st) {
        dd('ui.char.hp', formatInt(st.hpMax));
        dd('ui.char.ora', formatInt(st.oraMax));
        dd('ui.char.melee', formatInt(st.meleeRating));
        dd('ui.char.oraRating', formatInt(st.oraRating));
        dd('core.stat.def', formatInt(st.defense));
        dd('ui.char.crit', formatInt(st.critChance * 100) + '%');
        dd('ui.char.speed', formatInt(st.runSpeed));
      }
      dd('core.term.tp', formatInt(rpg.tp));
      dd('core.term.shells', formatInt(rpg.shells));
    }
    /**
     * The hero on show: the game camera frames the hero inside the hero card's window (no second renderer).
     * Falls back to the silhouette when the camera cannot play a shot.
     */
    function frameHero() {
      const cam = ctx.cam;
      const p = ctx.player;
      const r3 = ctx.three && ctx.three.camera;
      root.classList.remove('ui-live');
      if (!cam || typeof cam.play !== 'function' || !p || !r3) return;
      const W = window.innerWidth || 1;
      const H = window.innerHeight || 1;
      const b = hero.getBoundingClientRect();
      if (b.width < 40 || b.height < 60) return;
      const nx = ((b.left + b.width / 2) / W) * 2 - 1;
      const ny = -(((b.top + b.height / 2) / H) * 2 - 1);
      const fov = 38;
      const t = Math.tan((fov * Math.PI) / 360);
      // The hero's 2.2 m fill the window's height.
      const d = Math.min(14, Math.max(2.4, (2.2 * H) / b.height / (2 * t)));
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const hx = p.pos.x;
      const hy = p.pos.y + 0.95;
      const hz = p.pos.z;
      const halfH = d * t;
      const halfW = halfH * (W / H);
      // Camera right when looking back at the hero (along -forward) is (fz, 0, -fx).
      const lx = hx - nx * halfW * fz;
      const lz = hz + nx * halfW * fx;
      const ly = hy - ny * halfH;
      const from = { x: hx + fx * d - fz * 0.35 * d * 0.2, y: hy + 0.25, z: hz + fz * d + fx * 0.35 * d * 0.2 };
      const to = { x: hx + fx * d, y: hy + 0.2, z: hz + fz * d };
      try {
        cam.play('ui_char', [{ seconds: 1.2, from, to, lookAt: { x: lx, y: ly, z: lz }, fov, ease: 'out' },
          { seconds: 600, from: to, to, lookAt: { x: lx, y: ly, z: lz }, fov }], { skippable: true });
        root.classList.add('ui-live');
      } catch (e) {
        root.classList.remove('ui-live');
      }
    }
    return {
      el: root,
      group: 'pause',
      onOpen() {
        render();
        frameHero();
      },
      onClose() {
        const cam = ctx.cam;
        if (root.classList.contains('ui-live') && cam && cam.busy && typeof cam.skip === 'function') cam.skip();
        root.classList.remove('ui-live');
      },
      onLang: render,
    };
  });

  // ------------------------------------------------------------------ techniques
  reg('techniques', () => {
    const { root, body } = tabbed('techniques', 'ui.tab.techniques');
    const top = kit.el('div', 'ui-spread', body);
    const tp = kit.el('span', 'ui-tag ui-ok', top);
    const branch = tabRow(kit, top, BRANCHES.map((b) => ({ id: b, key: 'core.branch.' + b, icon: b })), () => {
      sel = null;
      render();
    });
    branch.bar.classList.add('ui-grow');
    const two = kit.el('div', 'ui-two', body);
    const list = kit.el('div', 'ui-list ui-tree', two);
    const col2 = kit.el('div', 'ui-col', two);
    const sheet = kit.el('div', 'ui-sheet ui-card', col2);
    const slots = kit.el('div', 'ui-col', col2);
    kit.el('h3', 'ui-h3', slots, 'ui.tech.loadout');
    const slotRow = kit.el('div', 'ui-slots', slots);
    /** @type {string|null} */
    let sel = null;
    function slotLabel(techId) {
      return techId ? kit.t('tech.' + techId + '.name') : kit.t('ui.tech.empty');
    }
    function render() {
      const rpg = ctx.rpg;
      tp.textContent = kit.t('ui.tech.tp', { n: formatInt(rpg.tp) });
      kit.forget(list);
      dom.clear(list);
      const rows = rpg.nodes().filter((r) => r.branch === branch.current);
      if (!sel && rows.length) sel = rows[0].id;
      for (const r of rows) {
        const stc = r.state === 'owned' ? 'owned' : r.state === 'available' ? 'avail' : 'locked';
        const li = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-li ui-node ui-st-' + stc + (r.id === sel ? ' ui-sel' : ''), list));
        li.type = 'button';
        li.dataset.node = r.id;
        const ring = kit.el('span', 'ui-ringico', li);
        ring.style.setProperty('--rc', r.state === 'owned' ? 'var(--accent)' : r.state === 'available' ? 'var(--paper)' : 'var(--line)');
        ring.appendChild(icon(doc, r.techId ? branch.current : 'charm'));
        if (stc !== 'avail') {
          const b = kit.el('b', 'ui-nodebadge', ring);
          b.appendChild(icon(doc, stc === 'owned' ? 'check' : 'lockd'));
        }
        const m = kit.el('span', 'ui-li-main', li);
        kit.el('span', 'ui-li-title', m, nodeNameKey(ctx, r));
        const subl = kit.el('span', 'ui-row', m);
        if (r.rank) {
          const pips = kit.el('span', 'ui-pips', subl);
          const owned = r.techId ? rpg.rank(r.techId) : r.state === 'owned' ? r.rank : 0;
          const max = Math.max(r.rank, 3);
          for (let i = 1; i <= max; i++) kit.el('i', i <= owned ? 'ui-on' : '', pips);
        }
        if (r.rank > 1) kit.el('span', 'ui-tag', subl, 'node.rank', { rank: formatInt(r.rank) });
        if (r.state === 'owned') kit.el('span', 'ui-tag ui-ok', subl, 'ui.tech.owned');
        else kit.el('span', 'ui-tag', subl, 'ui.tech.cost', { n: formatInt(r.tp) });
        if (r.state === 'available') {
          const b = kit.button(li, 'ui.tech.learn', (e) => {
            if (e) e.stopPropagation();
            if (ctx.rpg.learn(r.id)) {
              kit.sound('level_up');
              ui.toast('ui.toast.learned', { name: kit.t(nodeNameKey(ctx, r)) }, 'good');
            } else ui.toast(r.reasonKey || 'rpg.node.needTp', null, 'warn');
            sel = r.id;
            render();
          }, 'ui-sm ui-accent');
          b.dataset.learn = r.id;
        }
        li.addEventListener('click', () => {
          sel = r.id;
          render();
        });
      }
      if (!rows.length) kit.el('div', 'ui-empty', list, 'ui.tech.none');
      renderSheet(rows);
      renderSlots();
    }
    /** @param {any[]} rows */
    function renderSheet(rows) {
      kit.forget(sheet);
      dom.clear(sheet);
      let r = null;
      for (const x of rows) if (x.id === sel) r = x;
      if (!r) {
        kit.el('div', 'ui-empty', sheet, 'ui.tech.pick');
        return;
      }
      kit.el('div', 'ui-li-title', sheet, nodeNameKey(ctx, r));
      const descKey = r.techId ? 'tech.' + r.techId + '.desc' : 'node.' + r.id.replace(/_\d+$/, '') + '.desc';
      if (ctx.i18n.has(descKey)) kit.el('p', 'ui-small', sheet, descKey);
      const kv = kit.el('dl', 'ui-kv', sheet);
      kit.el('dt', '', kv, 'ui.tech.costLabel');
      kit.num(kit.el('dd', '', kv), '').textContent = formatInt(r.tp);
      if (r.rank) {
        kit.el('dt', '', kv, 'ui.tech.rankLabel');
        kit.num(kit.el('dd', '', kv), '').textContent = formatInt(r.rank);
      }
      if (r.state !== 'owned' && r.reasonKey) kit.el('p', 'ui-tag ui-bad', sheet, r.reasonKey);
      const def = r.techId ? ctx.defs.find('technique', r.techId) : null;
      if (def && ctx.rpg.hasTech(r.techId) && (def.slot === 'slot' || def.slot === 'ultimate')) {
        const row = kit.el('div', 'ui-row', sheet);
        if (def.slot === 'slot') {
          for (const i of [0, 1]) {
            const b = kit.button(row, 'ui.tech.toSlot', () => assign(i, r.techId), 'ui-sm', null, { n: i + 1 });
            b.dataset.slot = String(i);
          }
        } else {
          const b = kit.button(row, 'ui.tech.toUltimate', () => assign('ultimate', r.techId), 'ui-sm');
          b.dataset.slot = 'ultimate';
        }
      }
    }
    /** @param {0|1|'ultimate'} i @param {string} techId */
    function assign(i, techId) {
      if (ctx.rpg.setSlot(i, techId)) {
        kit.sound('ui_confirm');
        ui.toast('ui.toast.slotted', { name: kit.t('tech.' + techId + '.name') }, 'good');
      } else ui.toast('ui.tech.cannotSlot', null, 'warn');
      render();
    }
    function renderSlots() {
      kit.forget(slotRow);
      dom.clear(slotRow);
      const s = ctx.rpg.slots();
      const cells = [[0, s.slots[0]], [1, s.slots[1]], ['ultimate', s.ultimate]];
      for (const [i, techId] of cells) {
        const b = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-slot', slotRow));
        b.type = 'button';
        b.dataset.loadout = String(i);
        const ring = kit.el('span', 'ui-ringico', b);
        ring.style.setProperty('--rc', techId ? 'var(--accent)' : 'var(--line)');
        ring.appendChild(icon(doc, i === 'ultimate' ? 'flare' : 'ring'));
        const m = kit.el('span', 'ui-li-main', b);
        kit.el('span', 'ui-li-sub', m, i === 'ultimate' ? 'ui.tech.ultimate' : 'ui.tech.slotN', { n: Number(i) + 1 });
        const name = kit.el('span', 'ui-li-title', m);
        name.textContent = slotLabel(/** @type {string|null} */ (techId));
        b.addEventListener('click', () => {
          if (techId && ctx.rpg.setSlot(/** @type {any} */ (i), null)) render();
        });
      }
    }
    return {
      el: root,
      group: 'pause',
      onOpen() {
        sel = null;
        render();
      },
      onClose() {},
      onLang: render,
    };
  });

  // ------------------------------------------------------------------ inventory
  reg('inventory', () => {
    const { root, body } = tabbed('inventory', 'ui.tab.inventory');
    const two = kit.el('div', 'ui-three', body);
    const side = kit.el('div', 'ui-col', two);
    kit.el('h3', 'ui-h3', side, 'ui.inv.equipped');
    const slotsBox = kit.el('div', 'ui-slots ui-eqslots', side);
    const shells = kit.el('div', 'ui-tag', side);
    const main = kit.el('div', 'ui-col', two);
    const cells = kit.el('div', 'ui-cells', main);
    const sheet = kit.el('div', 'ui-sheet ui-card', two);
    /** @type {number} */
    let sel = 0;
    function render() {
      const rpg = ctx.rpg;
      const eq = rpg.equipped();
      const items = rpg.items();
      kit.forget(slotsBox);
      dom.clear(slotsBox);
      for (const slot of EQUIP) {
        const uid = eq[slot];
        let row = null;
        for (const it of items) if (it.uid === uid) row = it;
        const def = row ? ctx.defs.find('item', row.itemId) : null;
        const b = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-slot' + (row && row.uid === sel ? ' ui-sel' : ''), slotsBox));
        b.type = 'button';
        b.dataset.equip = slot;
        if (def) itemRing(kit, b, def);
        else {
          const r = kit.el('span', 'ui-ringico', b);
          r.appendChild(icon(doc, slot.indexOf('charm') === 0 ? 'charm' : slot));
          r.style.opacity = '.5';
        }
        const m = kit.el('span', 'ui-li-main', b);
        kit.el('span', 'ui-li-sub', m, 'core.slot.' + (slot.indexOf('charm') === 0 ? 'charm' : slot));
        if (def) kit.el('span', 'ui-li-title', m, itemNameKey(def.id));
        else kit.el('span', 'ui-li-sub', m, 'ui.inv.emptySlot');
        b.addEventListener('click', () => {
          if (row) sel = row.uid;
          render();
        });
      }
      shells.textContent = '';
      shells.appendChild(icon(doc, 'shell'));
      kit.num(shells, '').textContent = formatInt(rpg.shells);
      kit.forget(cells);
      dom.clear(cells);
      if (!sel && items.length) sel = items[0].uid;
      let found = false;
      /** Total stat value of an equipped or carried piece. @param {number} uid */
      const score = (uid) => {
        const st = uid ? rpg.itemStats(uid) : null;
        let t = 0;
        if (st && st.stats) for (const k of Object.keys(st.stats)) t += st.stats[k] || 0;
        return t;
      };
      for (const it of items) {
        const def = ctx.defs.find('item', it.itemId);
        const c = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-cell' + (def && def.rarity ? ' ui-r-' + def.rarity : '') + (it.uid === sel ? ' ui-sel' : ''), cells));
        c.type = 'button';
        c.dataset.uid = String(it.uid);
        c.dataset.item = it.itemId;
        kit.attr(c, 'aria-label', itemNameKey(it.itemId));
        itemRing(kit, c, def);
        if (it.count > 1 || (def && def.type === 'consumable')) kit.num(c, 'ui-cnt').textContent = formatInt(it.count);
        if (it.equipped) {
          const e = kit.el('span', 'ui-eq', c);
          e.appendChild(icon(doc, 'check', 'ui-ico ui-eq'));
        } else if (def && def.type === 'gear') {
          // Better or worse than what that slot holds now (the weaker charm for charms; an empty slot is worse).
          const slots = def.slot === 'charm' ? ['charm1', 'charm2'] : [def.slot];
          let other = Infinity;
          for (const sl of slots) other = Math.min(other, eq[sl] ? score(eq[sl]) : -1);
          const mine = score(it.uid);
          if (mine !== other) {
            const better = mine > other;
            const a = kit.el('span', 'ui-cmp ' + (better ? 'ui-up' : 'ui-down'), c);
            a.appendChild(icon(doc, better ? 'up' : 'down'));
            kit.attr(a, 'aria-label', better ? 'ui.inv.better' : 'ui.inv.worse');
          }
        }
        if (it.uid === sel) found = true;
        c.addEventListener('click', () => {
          sel = it.uid;
          kit.sound('ui_move');
          render();
        });
      }
      if (!items.length) kit.el('div', 'ui-empty', cells, 'ui.inv.empty');
      if (!found) sel = items.length ? items[0].uid : 0;
      renderSheet(items, eq);
    }
    function renderSheet(items, eq) {
      kit.forget(sheet);
      dom.clear(sheet);
      let it = null;
      for (const x of items) if (x.uid === sel) it = x;
      if (!it) {
        sheet.hidden = true;
        return;
      }
      sheet.hidden = false;
      const rpg = ctx.rpg;
      const def = ctx.defs.find('item', it.itemId);
      const head = kit.el('div', 'ui-row', sheet);
      itemRing(kit, head, def);
      const m = kit.el('div', 'ui-li-main', head);
      kit.el('span', 'ui-li-title', m, itemNameKey(it.itemId));
      const tags = kit.el('span', 'ui-row', m);
      if (def && def.rarity) kit.el('span', 'ui-tag', tags, 'core.rarity.' + def.rarity);
      if (def && def.type === 'gear') kit.el('span', 'ui-tag', tags, 'ui.inv.itemLevel', { level: formatInt(it.level) });
      if (ctx.i18n.has('item.' + it.itemId + '.desc')) kit.el('p', 'ui-small', sheet, 'item.' + it.itemId + '.desc');
      const actions = kit.el('div', 'ui-row', sheet);
      if (def && def.type === 'gear') {
        // Compare with what the same slot holds now.
        const mine = rpg.itemStats(it.uid);
        let other = null;
        const slots = def.slot === 'charm' ? ['charm1', 'charm2'] : [def.slot];
        for (const s of slots) if (eq[s] && eq[s] !== it.uid && !other) other = rpg.itemStats(eq[s]);
        const keys = Object.keys(Object.assign({}, mine.stats || {}, other ? other.stats || {} : {}));
        if (keys.length) {
          const kv = kit.el('dl', 'ui-kv', sheet);
          for (const k of keys) {
            const a = (mine.stats && mine.stats[k]) || 0;
            const b = (other && other.stats && other.stats[k]) || 0;
            kit.el('dt', '', kv, 'core.stat.' + k);
            const d = kit.el('dd', '', kv);
            kit.num(d, '').textContent = formatInt(a);
            if (!it.equipped && a !== b) {
              const delta = kit.num(d, a > b ? 'ui-up' : 'ui-down');
              delta.textContent = ' ' + formatDelta(a - b);
            }
          }
        }
        if (it.equipped) {
          kit.button(actions, 'ui.inv.unequip', () => {
            let slot = null;
            for (const s of EQUIP) if (eq[s] === it.uid) slot = s;
            if (slot && rpg.unequip(slot)) render();
          }, 'ui-ghostbtn', 'close').dataset.act = 'unequip';
        } else {
          kit.button(actions, 'ui.inv.equip', () => {
            if (rpg.equip(it.uid)) {
              ui.toast('ui.toast.equipped', { name: kit.t(itemNameKey(it.itemId)) }, 'good');
              render();
            }
          }, 'ui-accent', 'check').dataset.act = 'equip';
        }
      } else if (def && def.type === 'consumable') {
        kit.button(actions, 'ui.inv.use', () => {
          if (rpg.useItem(it.itemId)) {
            ui.toast('ui.toast.used', { name: kit.t(itemNameKey(it.itemId)) }, 'good');
            render();
          } else ui.toast('ui.inv.cannotUse', null, 'warn');
        }, 'ui-accent').dataset.act = 'use';
        const quick = rpg.quickItem === it.itemId;
        const q = kit.button(actions, quick ? 'ui.inv.isQuick' : 'ui.inv.setQuick', () => {
          for (let i = 0; i < 8 && rpg.quickItem !== it.itemId; i++) rpg.cycleQuickItem();
          render();
        }, 'ui-ghostbtn');
        q.disabled = quick;
        q.dataset.act = 'quick';
      }
    }
    return {
      el: root,
      group: 'pause',
      /** @param {any} p */
      onOpen(p) {
        sel = p && p.uid ? p.uid : 0;
        render();
      },
      onClose() {},
      onLang: render,
    };
  });

  // ------------------------------------------------------------------ quests
  reg('quests', () => {
    const { root, body } = tabbed('quests', 'ui.tab.quests');
    const kind = tabRow(kit, body, [{ id: 'main', key: 'ui.quest.main' }, { id: 'side', key: 'ui.quest.side' }, { id: 'records', key: 'ui.rec.tab' }], (id) => {
      // Records is a tab only once a record exists (after the ending's rematches and trials).
      if (id === 'records' && !records().length) kind.set('main');
      sel = '';
      render();
    });
    const recTab = /** @type {HTMLElement} */ (kind.bar.querySelector('[data-tab=records]'));
    const two = kit.el('div', 'ui-two', body);
    const list = kit.el('div', 'ui-list', two);
    const sheet = kit.el('div', 'ui-sheet ui-card', two);
    let sel = '';
    /** Best times and medals of the rematches and trials (quest flags rematch.<boss> and trial.<trial>). */
    function records() {
      const f = ctx.store.state.quests.flags || {};
      const out = [];
      for (const k of Object.keys(f)) {
        const v = f[k];
        if (!v || typeof v !== 'object' || !(v.best > 0)) continue;
        const dot = k.indexOf('.');
        const group = k.slice(0, dot);
        const id = k.slice(dot + 1);
        if (group === 'rematch') out.push({ key: k, titleKey: 'boss.' + id + '.name', kindKey: 'ui.rec.rematch', best: v.best, medals: v.medals || [] });
        else if (group === 'trial') out.push({ key: k, titleKey: 'rpg.' + id, kindKey: 'ui.rec.trial', best: v.best, medals: v.medals || [] });
      }
      return out;
    }
    function renderRecords() {
      kit.forget(list);
      dom.clear(list);
      kit.forget(sheet);
      dom.clear(sheet);
      sheet.hidden = true;
      for (const r of records()) {
        const top = r.medals.indexOf('gold') >= 0 ? 'gold' : r.medals.indexOf('silver') >= 0 ? 'silver' : r.medals.indexOf('bronze') >= 0 ? 'bronze' : '';
        const li = kit.el('div', 'ui-li ui-rec', list);
        li.dataset.record = r.key;
        const ring = kit.el('span', 'ui-ringico ui-medal' + (top ? ' ui-medal-' + top : ''), li);
        ring.appendChild(icon(doc, top ? 'check' : 'diamond'));
        const m = kit.el('span', 'ui-li-main', li);
        kit.el('span', 'ui-li-title', m, ctx.i18n.has(r.titleKey) ? r.titleKey : r.kindKey);
        const sub = kit.el('span', 'ui-row', m);
        kit.el('span', 'ui-tag', sub, r.kindKey);
        kit.el('span', 'ui-tag ui-ok', sub, 'ui.rec.best', { seconds: (Math.round(r.best * 10) / 10).toFixed(1) });
        if (top) kit.el('span', 'ui-tag ui-medaltag ui-medal-' + top, sub, 'ui.rec.' + top);
      }
    }
    function render() {
      recTab.hidden = !records().length;
      if (kind.current === 'records') {
        if (recTab.hidden) kind.set('main');
        else {
          renderRecords();
          return;
        }
      }
      const q = ctx.quests;
      const st = ctx.store.state.quests;
      const active = q.active();
      const ids = [];
      for (const r of active) ids.push(r.questId);
      for (const id of st.done) if (ids.indexOf(id) < 0) ids.push(id);
      const want = kind.current;
      const mine = ids.filter((id) => {
        const d = ctx.defs.find('quest', id);
        return d && (d.kind === 'main') === (want === 'main');
      });
      kit.forget(list);
      dom.clear(list);
      if (!sel || mine.indexOf(sel) < 0) sel = mine[0] || '';
      for (const id of mine) {
        const done = st.done.indexOf(id) >= 0;
        const li = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-li' + (id === sel ? ' ui-sel' : ''), list));
        li.type = 'button';
        li.dataset.quest = id;
        const ring = kit.el('span', 'ui-ringico', li);
        ring.style.setProperty('--rc', done ? 'var(--ok)' : q.tracked === id ? 'var(--warn)' : 'var(--line)');
        ring.appendChild(icon(doc, done ? 'check' : 'diamond'));
        const m = kit.el('span', 'ui-li-main', li);
        kit.el('span', 'ui-li-title', m, 'quest.' + id + '.title');
        kit.el('span', 'ui-li-sub', m, done ? 'ui.quest.done' : q.tracked === id ? 'ui.quest.tracked' : 'ui.quest.active');
        li.addEventListener('click', () => {
          sel = id;
          render();
        });
      }
      if (!mine.length) kit.el('div', 'ui-empty', list, 'ui.quest.none');
      kit.forget(sheet);
      dom.clear(sheet);
      sheet.hidden = !sel;
      if (!sel) return;
      kit.el('div', 'ui-li-title', sheet, 'quest.' + sel + '.title');
      let row = null;
      for (const r of active) if (r.questId === sel) row = r;
      // The steps so far as a checklist: done steps ticked, the current one highlighted, later ones not revealed.
      const qdef = ctx.defs.find('quest', sel);
      const steps = qdef && Array.isArray(qdef.steps) ? qdef.steps : [];
      const doneQ = !row;
      const upto = row ? row.stepIndex : steps.length - 1;
      const check = kit.el('div', 'ui-checklist', sheet);
      for (let i = 0; i <= upto && i < steps.length; i++) {
        const cur = !doneQ && i === upto;
        const key = cur ? row.objectiveKey : 'quest.' + sel + '.' + steps[i].id;
        if (!ctx.i18n.has(key)) continue;
        const st = kit.el('div', 'ui-qstep' + (cur ? ' ui-cur' : ' ui-done'), check);
        st.appendChild(icon(doc, cur ? 'diamond' : 'check'));
        kit.el('span', '', st, key, cur ? row.objectiveArgs : null);
      }
      if (row) {
        const tracked = q.tracked === sel;
        const b = kit.button(sheet, tracked ? 'ui.quest.untrack' : 'ui.quest.track', () => {
          q.track(tracked ? null : sel);
          render();
        }, tracked ? 'ui-ghostbtn' : 'ui-accent', 'diamond');
        b.dataset.act = 'track';
      } else kit.el('p', 'ui-small', sheet, 'ui.quest.completed');
    }
    return {
      el: root,
      group: 'pause',
      onOpen() {
        sel = ctx.quests.tracked || '';
        const d = sel ? ctx.defs.find('quest', sel) : null;
        kind.set(d && d.kind !== 'main' ? 'side' : 'main');
        render();
      },
      onClose() {},
      onLang: render,
    };
  });

  // ------------------------------------------------------------------ map
  reg('map', () => {
    const { root, body } = tabbed('map', 'ui.tab.map');
    const wrap = kit.el('div', 'ui-mapwrap', body);
    const inner = kit.el('div', 'ui-mapinner', wrap);
    const cv = /** @type {HTMLCanvasElement} */ (kit.el('canvas', '', inner));
    cv.width = 512;
    cv.height = 512;
    const icons = kit.el('div', '', inner);
    const arrow = kit.el('div', 'ui-maparrow', inner);
    arrow.appendChild(icon(doc, 'arrow'));
    // A refused or explained Ringstone travel (in a fight, a race, a conversation).
    const note = kit.el('div', 'ui-tag ui-bad ui-mapnote', body);
    note.hidden = true;
    const legend = kit.el('div', 'ui-row ui-small ui-legend', body);
    const count = kit.el('span', 'ui-tag ui-ok', legend);
    const shardTag = kit.el('span', 'ui-tag ui-shardtag', legend);
    shardTag.appendChild(kit.el('i', 'ui-sharddot', null));
    const shardText = kit.el('span', '', shardTag);
    const trackedLine = kit.el('span', 'ui-tag ui-trk', legend);
    for (const [ic, key, cls] of [['ring', 'ui.map.ringAwake', 'ui-r'], ['ring', 'ui.map.ringAsleep', 'ui-r ui-asleep'], ['spirit', 'ui.poi.shrine', ''],
      ['core', 'ui.poi.siphon', 'ui-s'], ['diamond', 'ui.map.quest', 'ui-q'], ['eye', 'ui.map.viewpoint', 'ui-v'], ['ring', 'ui.map.unvisited', 'ui-unseen']]) {
      const t = kit.el('span', 'ui-tag ui-legico ' + cls, legend);
      t.appendChild(icon(doc, ic));
      kit.el('span', '', t, key);
    }
    const uv = { u: 0, v: 0 };
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    /** @type {Map<number, {x:number,y:number}>} */
    const pts = new Map();
    let pinch0 = 0;
    let zoom0 = 1;
    const apply = () => {
      const w = wrap.clientWidth || 1;
      const maxPan = (zoom - 1) * w;
      panX = Math.min(0, Math.max(-maxPan, panX));
      panY = Math.min(0, Math.max(-maxPan, panY));
      inner.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      arrow.style.scale = String(1 / zoom);
      for (const c of /** @type {any} */ (icons.children)) c.style.scale = String(1 / zoom);
    };
    /** A press that may be a tap on an awake Ringstone (the wrap captures the pointer, so clicks never reach icons). */
    const press = { id: '', x: 0, y: 0, moved: false };
    wrap.addEventListener('pointerdown', (e) => {
      const hit = e.target && /** @type {any} */ (e.target).closest ? /** @type {any} */ (e.target).closest('[data-travel]') : null;
      press.id = pts.size === 0 && hit ? hit.dataset.travel : '';
      press.x = e.clientX;
      press.y = e.clientY;
      press.moved = false;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch (err) {
        // optional
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        zoom0 = zoom;
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        panX += e.clientX - p.x;
        panY += e.clientY - p.y;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 10 || pts.size > 1) press.moved = true;
      if (pts.size === 2 && pinch0 > 0) {
        const [a, b] = [...pts.values()];
        zoom = Math.min(4, Math.max(1, zoom0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0)));
      }
      apply();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = 0;
      if (e.type === 'pointerup' && press.id && !press.moved && pts.size === 0) askTravel(press.id);
      press.id = '';
    };
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      apply();
    }, { passive: false });

    /** Why a travel cannot happen now (the service only answers false), or null. */
    function travelBlock() {
      if (ctx.quests && ctx.quests.dialogueOpen) return 'ui.map.noTravelTalk';
      if (ui.racing) return 'ui.map.noTravelRace';
      if ((ctx.ai && ctx.ai.boss) || (ctx.combat && ctx.combat.inCombat)) return 'ui.map.noTravelFight';
      return null;
    }
    /** @param {string} key */
    function showNote(key) {
      note.hidden = !key;
      note.textContent = key ? kit.t(key) : '';
    }
    /** Tap on an awake Ringstone: explain a block, or ask, then travel and close the map. @param {string} id */
    function askTravel(id) {
      if (!ctx.quests || typeof ctx.quests.travel !== 'function') return;
      const block = travelBlock();
      if (block) {
        kit.sound('ui_error');
        showNote(block);
        return;
      }
      let place = null;
      for (const r of ctx.world.pois('ringstone')) if (r.id === id) place = r;
      const lk = place && place.data ? 'landmark.' + place.data.landmarkId + '.name' : '';
      const name = lk && ctx.i18n.has(lk) ? kit.t(lk) : kit.t('ui.poi.ringstone');
      ui.confirm('ui.map.travelAsk', { place: name }).then((ok) => {
        if (!ok || !ui.isOpen('map')) return;
        if (ctx.quests.travel(id)) {
          ui.closeAll();
          return;
        }
        showNote(travelBlock() || 'ui.map.noTravel');
      });
    }
    /** @param {number} x @param {number} z @param {string} ic @param {string} cls @param {string|null} labelKey @param {string} id */
    function place(x, z, ic, cls, labelKey, id) {
      ctx.world.toMap(x, z, uv);
      const n = kit.el('div', 'ui-mapico ' + cls, icons);
      n.style.left = (uv.u * 100).toFixed(2) + '%';
      n.style.top = (uv.v * 100).toFixed(2) + '%';
      n.dataset.poi = id;
      n.appendChild(icon(doc, ic));
      if (labelKey && (wrap.clientWidth || 0) >= 380) {
        const l = kit.el('span', 'ui-maplabel', n, labelKey);
        l.style.left = '50%';
        l.style.top = '100%';
      }
      return n;
    }
    function draw() {
      const g = cv.getContext('2d');
      const world = ctx.world;
      if (!g || !world) return;
      let src = null;
      try {
        src = world.mapCanvas(512);
      } catch (e) {
        src = null;
      }
      g.fillStyle = '#E9DCC0';
      g.fillRect(0, 0, 512, 512);
      if (src) g.drawImage(src, 0, 0, 512, 512);
      // Paper clouds over regions not seen yet (a 64 x 64 sampling of the region map).
      const seen = ctx.store.state.world.regionsSeen || [];
      if (seen.length && typeof world.regionAt === 'function') {
        const N = 64;
        const cell = 512 / N;
        const half = 3584;
        g.fillStyle = 'rgba(243,235,221,0.88)';
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const x = ((i + 0.5) / N) * 2 * half - half;
            const z = ((j + 0.5) / N) * 2 * half - half;
            const rid = world.regionAt(x, z);
            if (rid && seen.indexOf(rid) < 0) {
              g.beginPath();
              g.arc((i + 0.5) * cell, (j + 0.5) * cell, cell * 0.95, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
      }
    }
    function render() {
      kit.forget(icons);
      dom.clear(icons);
      const world = ctx.world;
      if (!world || typeof world.toMap !== 'function') return;
      const disc = ctx.store.state.world.discovered || [];
      const lms = ctx.defs.all('landmark') || [];
      for (const lm of lms) {
        if (lm.type !== 'settlement' && lm.type !== 'spire') continue;
        const w = world.landmark(lm.id) || lm;
        place(w.x, w.z, lm.type === 'spire' ? 'spirit' : 'home', '', 'landmark.' + lm.id + '.name', lm.id);
      }
      // Places: visited ones, and every place of a region a viewpoint revealed (those not visited yet look faded and
      // dashed). Siphon Spires always show (their beacons are seen from afar). Awake Ringstones are travel targets.
      const sh = ctx.quests && typeof ctx.quests.shards === 'function' ? ctx.quests.shards() : null;
      const revealed = sh ? sh.revealed : [];
      const awake = ctx.store.state.world.ringstones || [];
      for (const [type, ic, cls] of POI_ICONS) {
        for (const p of world.pois(type)) {
          const known = disc.indexOf(p.id) >= 0;
          if (type !== 'siphon' && !known && revealed.indexOf(p.regionId) < 0) continue;
          let c = cls + (known || type === 'siphon' ? '' : ' ui-unseen');
          const on = type === 'ringstone' && awake.indexOf(p.id) >= 0;
          if (type === 'ringstone') c += on ? ' ui-awake' : ' ui-asleep';
          const n = place(p.x, p.z, ic, c, null, p.id);
          if (on) {
            n.dataset.travel = p.id;
            kit.attr(n, 'aria-label', 'ui.map.travelTo', { place: kit.t('landmark.' + (p.data && p.data.landmarkId) + '.name') });
          }
        }
      }
      // Ora shards: the ones found, and the viewpoints (the highest peak of a region) of regions already seen.
      const seenR = ctx.store.state.world.regionsSeen || [];
      if (sh) {
        for (const s of sh.list) {
          if (s.found) place(s.x, s.z, 'diamond', 'ui-shard', null, s.id);
          else if (s.view && seenR.indexOf(s.regionId) >= 0 && revealed.indexOf(s.regionId) < 0) place(s.x, s.z, 'eye', 'ui-v', null, s.id);
        }
        const next = sh.next;
        shardText.textContent = kit.t('ui.map.shards', { n: formatInt(sh.found), all: formatInt(sh.total) }) + ' · ' +
          (next ? kit.t('ui.map.shardsNext', { at: formatInt(next.at) }) : kit.t('ui.map.shardsAll'));
      }
      shardTag.hidden = !sh || !sh.total;
      const ms = ctx.quests ? ctx.quests.markers() : [];
      const tr = ctx.quests ? ctx.quests.tracked : null;
      for (const m of ms) if (m.kind !== 'giver') place(m.x, m.z, 'diamond', 'ui-q' + (m.questId === tr ? ' ui-tracked' : ''), null, 'quest:' + m.questId);
      // Places found so far, of every Ringstone and Shrine on the island.
      let found = 0;
      let all = 0;
      for (const type of ['ringstone', 'shrine']) {
        for (const pp of world.pois(type)) {
          all++;
          if (disc.indexOf(pp.id) >= 0) found++;
        }
      }
      count.textContent = kit.t('ui.map.found', { n: formatInt(found), all: formatInt(all) });
      trackedLine.textContent = tr ? kit.t('ui.map.tracking', { title: kit.t('quest.' + tr + '.title') }) : '';
      trackedLine.hidden = !tr;
      const p = ctx.player;
      if (p) {
        world.toMap(p.pos.x, p.pos.z, uv);
        arrow.style.left = (uv.u * 100).toFixed(2) + '%';
        arrow.style.top = (uv.v * 100).toFixed(2) + '%';
        // The arrow icon points up (north = -z); yaw pi faces north.
        arrow.style.transform = 'rotate(' + ((Math.PI - p.yaw) * 180 / Math.PI).toFixed(1) + 'deg)';
        arrow.hidden = false;
      } else arrow.hidden = true;
      apply();
    }
    return {
      el: root,
      group: 'pause',
      onOpen() {
        zoom = 1;
        panX = 0;
        panY = 0;
        showNote('');
        draw();
        render();
      },
      onClose() {},
      onLang: render,
      /** @param {string} a */
      onInput(a) {
        if (a === 'map') {
          ui.closeAll();
          return true;
        }
        return false;
      },
    };
  });
  void itemIcon;
}
