/**
 * Settings (Language, Graphics, Audio, Controls, Accessibility, Gameplay; every option through save.setSetting),
 * controls (the current device's layout), savecode (Copy and Restore tabs around save.exportCode / importCode),
 * dialogue (speaker ribbon, typing at 45 characters per second, tap completes then advances, 48 px ribbon
 * choices) and shop (merchant ribbon, Buy and Sell tabs, 64 px rows, price in Shells, quantity stepper, coin chime).
 * @module ui/screens/other
 */

import * as F from '../../core/formulas.js';
import { KBM_GLYPHS, PAD_GLYPHS } from '../../core/actions.js';
import { icon } from '../icons.js';
import { shell, tabRow, chips, switchRow, sliderRow, itemRing, itemNameKey, speakerKey } from './common.js';
import { setLang } from './boot.js';
import { formatInt, typedChars } from '../logic/format.js';
import { formatDeviceReport } from '../logic/perfLog.js';

const CPS = 45;

/**
 * @param {any} ctx
 * @param {import('../kit.js').Kit} kit
 * @param {any} ui
 * @param {(id:string, f:Function) => void} reg
 */
export function registerOtherScreens(ctx, kit, ui, reg) {
  const dom = ctx.dom;
  const doc = dom.doc;
  const S = () => ctx.save.settings;
  /** @param {string} k @param {any} v */
  const set = (k, v) => ctx.save.setSetting(k, v);

  // ------------------------------------------------------------------ settings
  reg('settings', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.pause.settings', ribbonIcon: 'gear', size: 'wide' });
    const sections = [
      { id: 'lang', key: 'ui.set.tab.lang', icon: 'globe' }, { id: 'gfx', key: 'ui.set.tab.gfx', icon: 'eye' },
      { id: 'audio', key: 'ui.set.tab.audio', icon: 'sound' }, { id: 'ctl', key: 'ui.set.tab.ctl', icon: 'pad' },
      { id: 'a11y', key: 'ui.set.tab.a11y', icon: 'text' }, { id: 'play', key: 'ui.set.tab.play', icon: 'sword' },
    ];
    const tabs = tabRow(kit, body, sections, (id) => show(id));
    tabs.bar.classList.add('ui-iconic-narrow');
    /** @type {Record<string, HTMLElement>} */
    const pages = {};
    /** @type {Array<() => void>} */
    const syncs = [];
    for (const s of sections) {
      const pg = kit.el('div', 'ui-col', body);
      pg.dataset.page = s.id;
      kit.el('h3', 'ui-h3', pg, s.key);
      pages[s.id] = pg;
    }
    // Language
    const langRow = kit.el('div', 'ui-slots', pages.lang);
    /** @type {Record<string, HTMLButtonElement>} */
    const langBtns = {};
    for (const l of /** @type {Array<'he'|'en'>} */ (['he', 'en'])) {
      const b = kit.button(langRow, 'core.lang.' + l, () => {
        setLang(ctx, l);
        syncAll();
      }, 'ui-ghostbtn', 'globe');
      b.dataset.lang = l;
      langBtns[l] = b;
    }
    syncs.push(() => {
      for (const l of Object.keys(langBtns)) langBtns[l].classList.toggle('ui-accent', S().lang === l);
    });
    // Graphics: a plain choice wired to the renderer's tiers and shadow map. Smooth = phone tier without shadows,
    // Balanced = the automatic choice for this device, Sharp = the desktop tier.
    const LOOK = { smooth: 'low', balanced: 'auto', sharp: 'high' };
    const q = chips(kit, pages.gfx, ['smooth', 'balanced', 'sharp'].map((id) => ({ id, key: 'ui.set.gfx.' + id })), (id) => {
      set('quality', LOOK[id]);
      if (id === 'smooth') setShadows(ctx, false);
      syncAll();
    });
    const lookDesc = kit.el('p', 'ui-small', pages.gfx);
    const shadowRow = switchRow(kit, pages.gfx, 'ui.set.shadows', () => shadowsOn(ctx), (v) => setShadows(ctx, v));
    const shadowNote = kit.el('p', 'ui-small', pages.gfx, 'ui.set.shadowsNote');
    syncs.push(() => {
      const ql = S().quality;
      const id = ql === 'low' ? 'smooth' : ql === 'high' ? 'sharp' : 'balanced';
      q.set(id);
      lookDesc.textContent = kit.t('ui.set.gfx.' + id + '.desc');
      const can = shadowsPossible(ctx);
      shadowRow.row.hidden = !can;
      shadowNote.hidden = !can;
      shadowRow.sync();
    });
    // Device report: how the game runs on this device, as text the player can screenshot or copy and send back.
    kit.el('h3', 'ui-h3', pages.gfx, 'ui.set.device');
    kit.el('p', 'ui-small', pages.gfx, 'ui.set.deviceHint');
    const report = kit.el('pre', 'ui-devrep k-select', pages.gfx);
    syncs.push(() => {
      report.textContent = formatDeviceReport(/** @type {any} */ (ui).perfLog.summary(), deviceFacts(ctx));
    });
    // Audio
    for (const [k, key] of [['volMaster', 'ui.set.volMaster'], ['volMusic', 'ui.set.volMusic'], ['volSfx', 'ui.set.volSfx']]) {
      syncs.push(sliderRow(kit, pages.audio, key, { min: 0, max: 1, step: 0.05 }, () => S()[k], (v) => set(k, v)).sync);
    }
    // Controls
    syncs.push(sliderRow(kit, pages.ctl, 'ui.set.camSens', { min: 0.3, max: 2, step: 0.1 }, () => S().camSens, (v) => set('camSens', v)).sync);
    for (const [k, key] of [['invertY', 'ui.set.invertY'], ['pitchFlight', 'ui.set.pitchFlight'], ['leftHanded', 'ui.set.leftHanded'], ['vibration', 'ui.set.vibration']]) {
      syncs.push(switchRow(kit, pages.ctl, key, () => S()[k], (v) => set(k, v)).sync);
    }
    // Accessibility
    kit.el('span', 'ui-small', pages.a11y, 'ui.set.textScale');
    const ts = chips(kit, pages.a11y, [0.9, 1, 1.15, 1.3].map((v) => ({ id: String(v), key: 'ui.set.pct', args: { pct: Math.round(v * 100) } })), (id) => {
      set('textScale', Number(id));
    });
    syncs.push(() => ts.set(String(S().textScale)));
    syncs.push(sliderRow(kit, pages.a11y, 'ui.set.shake', { min: 0, max: 1, step: 0.25 }, () => S().shake, (v) => set('shake', v)).sync);
    for (const [k, key] of [['reducedMotion', 'ui.set.reducedMotion'], ['photosensitive', 'ui.set.photosensitive']]) {
      syncs.push(switchRow(kit, pages.a11y, key, () => S()[k], (v) => {
        set(k, v);
        dom.root.classList.toggle('ui-reduced', !!S().reducedMotion);
      }).sync);
    }
    // Gameplay
    kit.el('span', 'ui-small', pages.play, 'ui.newgame.difficulty');
    const diff = chips(kit, pages.play, ['story', 'warrior', 'master'].map((id) => ({ id, key: 'core.difficulty.' + id })), (id) => {
      if (ctx.rpg && ctx.session.running) ctx.rpg.setDifficulty(id);
    });
    const diffNote = kit.el('p', 'ui-small', pages.play, 'ui.set.difficultyNote');
    syncs.push(() => {
      const running = !!(ctx.session && ctx.session.running && ctx.rpg);
      diff.box.hidden = !running;
      diffNote.hidden = running;
      if (running) diff.set(ctx.rpg.difficulty);
    });
    for (const [k, key] of [['damageNumbers', 'ui.set.damageNumbers'], ['shortTransform', 'ui.set.shortTransform']]) {
      syncs.push(switchRow(kit, pages.play, key, () => S()[k], (v) => set(k, v)).sync);
    }
    const foot = kit.el('div', 'ui-row', body);
    kit.button(foot, 'ui.common.back', () => ui.close('settings'), 'ui-ghostbtn', 'back');
    kit.button(foot, 'ui.credits.title', () => ui.open('credits', {}), 'ui-ghostbtn', 'scroll').dataset.open = 'credits';
    function show(id) {
      for (const k of Object.keys(pages)) pages[k].hidden = k !== id;
    }
    function syncAll() {
      for (const f of syncs) f();
    }
    return {
      el: root,
      /** @param {any} p */
      onOpen(p) {
        const id = p && p.tab ? p.tab : 'lang';
        tabs.set(id);
        show(id);
        syncAll();
      },
      onClose() {},
      onLang: syncAll,
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiTabNext' || a === 'uiTabPrev') {
          tabs.step(a === 'uiTabNext' ? 1 : -1);
          return true;
        }
        return false;
      },
    };
  });

  // ------------------------------------------------------------------ controls
  reg('controls', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.pause.controls', ribbonIcon: 'pad', size: 'wide' });
    const dev = tabRow(kit, body, [{ id: 'touch', key: 'core.device.touch', icon: 'hand' }, { id: 'kbm', key: 'core.device.kbm', icon: 'key' },
      { id: 'pad', key: 'core.device.pad', icon: 'pad' }], () => render());
    const box = kit.el('div', 'ui-col', body);
    kit.button(body, 'ui.common.back', () => ui.close('controls'), 'ui-ghostbtn', 'back');
    const ACTS = ['move', 'look', 'attack', 'bolt', 'dash', 'guard', 'jump', 'descend', 'gather', 'tech1', 'tech2', 'ultimate', 'form', 'lock', 'interact', 'item', 'map', 'pause'];
    function render() {
      kit.forget(box);
      dom.clear(box);
      const d = dev.current;
      if (d === 'touch') {
        const dg = kit.el('div', 'ui-diagram', box);
        const btns = dom.root.querySelectorAll('.k-layer-touch [data-action]');
        const W = window.innerWidth || 1;
        const H = window.innerHeight || 1;
        let any = 0;
        for (let i = 0; i < btns.length; i++) {
          const b = /** @type {HTMLElement} */ (btns[i]);
          const a = b.dataset.action || '';
          if (a === 'look' || a === 'move') continue;
          const r = b.getBoundingClientRect();
          if (r.width < 2) continue;
          any++;
          const c = kit.el('div', 'ui-dg', dg, 'ui.action.' + a);
          c.style.left = (((r.left + r.width / 2) / W) * 100).toFixed(1) + '%';
          c.style.top = (((r.top + r.height / 2) / H) * 100).toFixed(1) + '%';
          c.style.width = ((r.width / W) * 100).toFixed(1) + '%';
          c.style.aspectRatio = '1';
        }
        if (!any) {
          dg.remove();
          kit.el('p', 'ui-small', box, 'ui.controls.touchHint');
        }
      }
      const grid = kit.el('div', 'ui-controls', box);
      for (const a of ACTS) {
        const label = d === 'pad' ? PAD_GLYPHS[a] : d === 'kbm' ? KBM_GLYPHS[a] : '';
        if (d !== 'touch' && !label) continue;
        const row = kit.el('div', 'ui-ctlrow', grid);
        const g = kit.el('span', 'ui-glyph' + (d === 'touch' ? ' ui-tap' : ''), row);
        if (d === 'touch') g.appendChild(icon(doc, a === 'move' || a === 'look' ? 'hand' : 'ring'));
        else g.textContent = label;
        kit.el('span', '', row, 'ui.action.' + a);
      }
    }
    return {
      el: root,
      onOpen() {
        const d = ctx.input.device;
        dev.set(d === 'pad' || d === 'kbm' ? d : 'touch');
        render();
      },
      onClose() {},
      onLang: render,
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiTabNext' || a === 'uiTabPrev') {
          dev.step(a === 'uiTabNext' ? 1 : -1);
          return true;
        }
        return false;
      },
    };
  });

  // ------------------------------------------------------------------ savecode
  reg('savecode', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.code.title', ribbonIcon: 'copy' });
    const tabs = tabRow(kit, body, [{ id: 'copy', key: 'core.save.copyCode', icon: 'copy' }, { id: 'restore', key: 'core.save.restoreCode', icon: 'restore' }], (id) => show(id));
    const copyPg = kit.el('div', 'ui-col', body);
    kit.el('p', 'ui-small', copyPg, 'ui.code.copyHelp');
    const out = /** @type {HTMLTextAreaElement} */ (kit.el('textarea', 'ui-text k-select', copyPg));
    out.readOnly = true;
    out.spellcheck = false;
    out.dataset.code = 'out';
    const copyRow = kit.el('div', 'ui-row', copyPg);
    const canClip = typeof navigator !== 'undefined' && !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
    const copyBtn = kit.button(copyRow, 'ui.code.copy', () => {
      try {
        navigator.clipboard.writeText(out.value).then(() => ui.toast('ui.code.copied', null, 'good'), () => selectAll());
      } catch (e) {
        selectAll();
      }
    }, 'ui-accent', 'copy');
    copyBtn.hidden = !canClip;
    kit.button(copyRow, 'ui.code.selectAll', () => selectAll(), 'ui-ghostbtn');
    const restorePg = kit.el('div', 'ui-col', body);
    kit.el('p', 'ui-small', restorePg, 'ui.code.restoreHelp');
    const inp = /** @type {HTMLTextAreaElement} */ (kit.el('textarea', 'ui-text k-select', restorePg));
    inp.spellcheck = false;
    inp.dataset.code = 'in';
    const msg = kit.el('p', 'ui-tag ui-bad', restorePg);
    msg.hidden = true;
    kit.button(restorePg, 'ui.code.restore', () => {
      const text = inp.value.trim();
      if (!text) return;
      // A code replaces the saved journey for good: ask first when there is one (or one is being played).
      let has = !!(ctx.session && ctx.session.running);
      try {
        const s = ctx.save.slots();
        has = has || !!(s[0] && s[0].exists);
      } catch (e) {
        // no slots: nothing to replace
      }
      if (!has) restore(text);
      else {
        ui.confirm('ui.code.restoreConfirm', null).then((ok) => {
          if (ok) restore(text);
        });
      }
    }, 'ui-accent', 'restore');
    /** @param {string} text */
    function restore(text) {
      ctx.save.importCode(text).then((r) => {
        if (!r || !r.ok) {
          msg.textContent = kit.t((r && r.reasonKey) || 'core.save.codeInvalid');
          msg.hidden = false;
          kit.sound('ui_error');
          return;
        }
        msg.hidden = true;
        ui.closeAll();
        if (ctx.session.start({ slot: 1, newGame: false })) ui.toast('core.save.restored', null, 'good');
      });
    }
    kit.button(body, 'ui.common.back', () => ui.close('savecode'), 'ui-ghostbtn', 'back');
    function selectAll() {
      try {
        out.focus();
        out.select();
      } catch (e) {
        // optional
      }
    }
    function show(id) {
      copyPg.hidden = id !== 'copy';
      restorePg.hidden = id !== 'restore';
      if (id === 'copy') {
        out.value = '';
        const has = !!(ctx.session && ctx.session.running);
        if (!has) {
          out.value = kit.t('ui.code.none');
          return;
        }
        if (typeof ctx.save.write === 'function' && !ctx.save.memoryOnly) ctx.save.write('manual');
        ctx.save.exportCode().then((code) => {
          out.value = code;
        }, () => {
          out.value = kit.t('core.save.failed');
        });
      }
    }
    return {
      el: root,
      /** @param {any} p */
      onOpen(p) {
        const id = p && p.tab === 'restore' ? 'restore' : 'copy';
        tabs.set(id);
        msg.hidden = true;
        show(id);
      },
      onClose() {},
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiTabNext' || a === 'uiTabPrev') {
          tabs.step(1);
          return true;
        }
        return false;
      },
    };
  });

  // ------------------------------------------------------------------ dialogue
  reg('dialogue', () => {
    const root = kit.el('div', 'ui-scr ui-dlg', null);
    const panel = kit.el('div', 'ui-dlgpanel', root);
    const name = kit.el('div', 'ui-dlgname', panel);
    const pin = kit.el('div', 'ui-pin', panel);
    const body = kit.el('div', 'ui-pbody', pin);
    const line = kit.el('p', 'ui-dlgline', body);
    const more = kit.el('span', 'ui-dlgmore', body);
    more.appendChild(icon(doc, 'diamond'));
    const choices = kit.el('div', 'ui-choices', body);
    let text = '';
    let t = 0;
    let shown = 0;
    /** @type {any} */
    let cur = null;
    function typing() {
      return shown < text.length;
    }
    function complete() {
      shown = text.length;
      line.textContent = text;
      reveal();
    }
    function reveal() {
      const done = !typing();
      choices.hidden = !done || !cur || !cur.choices.length;
      more.hidden = !done || (cur && cur.choices.length > 0);
      if (done && cur && cur.choices.length && ui.top() === 'dialogue') ui.refocus();
    }
    /** Tap: complete the line, then advance. */
    function tap() {
      if (!cur) return;
      if (typing()) {
        complete();
        return;
      }
      if (!cur.choices.length) {
        kit.sound('ui_confirm');
        if (ctx.quests) ctx.quests.advance(0);
      }
    }
    // The whole screen advances the dialogue, not only the text panel: on a phone a tap anywhere means "continue".
    root.addEventListener('click', tap);
    function renderLine() {
      if (!cur) return;
      const sk = speakerKey(ctx, cur.speakerId);
      name.hidden = !sk;
      name.textContent = sk ? kit.t(sk) : '';
      text = kit.t(cur.textKey);
      if (shown >= text.length || shown > 0) shown = Math.min(shown, text.length);
      line.textContent = text.slice(0, shown);
      kit.forget(choices);
      dom.clear(choices);
      cur.choices.forEach((c, i) => {
        const b = kit.button(choices, c.textKey, (e) => {
          if (e) e.stopPropagation();
          if (ctx.quests) ctx.quests.advance(i);
        }, 'ui-full', 'next');
        b.dataset.choice = String(i);
      });
      reveal();
    }
    return {
      el: root,
      modal: true,
      onOpen() {
        cur = null;
        text = '';
        shown = 0;
        line.textContent = '';
        dom.clear(choices);
        name.hidden = true;
      },
      onClose() {
        cur = null;
      },
      /** @param {any} p dialogue:line */
      line(p) {
        cur = { speakerId: p.speakerId, textKey: p.textKey, choices: p.choices.map((c) => ({ textKey: c.textKey })) };
        t = 0;
        shown = 0;
        const reduced = !!(S() && S().reducedMotion);
        renderLine();
        if (reduced) complete();
      },
      /** @param {number} dt */
      tick(dt) {
        if (!cur || !typing()) return;
        t += dt;
        const n = typedChars(text.length, t, CPS);
        if (n !== shown) {
          shown = n;
          line.textContent = text.slice(0, shown);
          if (!typing()) reveal();
        }
      },
      get typing() {
        return typing();
      },
      onLang: renderLine,
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiConfirm' || a === 'interact' || a === 'attack' || a === 'skip') {
          if (typing()) {
            complete();
            return true;
          }
          if (cur && !cur.choices.length) {
            tap();
            return true;
          }
          return false;
        }
        return a === 'uiBack' || a === 'pause';
      },
      initialFocus: () => /** @type {HTMLElement|null} */ (choices.querySelector('button')),
    };
  });

  // ------------------------------------------------------------------ shop
  reg('shop', () => {
    const { root, body, ribbon } = shell(kit, { ribbon: 'ui.shop.title', ribbonIcon: 'shell', cls: 'ui-menuscr' });
    const head = kit.el('div', 'ui-spread', body);
    const tabs = tabRow(kit, head, [{ id: 'buy', key: 'ui.shop.buy' }, { id: 'sell', key: 'ui.shop.sell' }], () => render());
    tabs.bar.classList.add('ui-grow');
    const purse = kit.el('span', 'ui-tag', head);
    const list = kit.el('div', 'ui-list', body);
    kit.button(body, 'ui.common.back', () => ui.close('shop'), 'ui-ghostbtn', 'back');
    let shopId = '';
    /** @type {Record<number, number>} */
    const qty = {};
    const ribbonText = /** @type {HTMLElement} */ (ribbon && ribbon.lastChild);
    function merchant() {
      for (const n of ctx.defs.all('npc') || []) if (n.shop === shopId) return 'npc.' + n.id + '.name';
      return null;
    }
    function sellPrice(def, row) {
      let buy = 0;
      if (def.type === 'gear') buy = F.itemPrice(def.rarity || 'common', row.level);
      else if (typeof def.basePrice === 'number') buy = def.basePrice + (def.pricePerLevel || 0) * ctx.rpg.level;
      return F.sellPrice(Math.round(buy));
    }
    function render() {
      const rpg = ctx.rpg;
      const mk = merchant();
      if (ribbonText) ribbonText.textContent = mk ? kit.t('ui.shop.of', { name: kit.t(mk) }) : kit.t('ui.shop.title');
      purse.textContent = '';
      purse.appendChild(icon(doc, 'shell'));
      kit.num(purse, '').textContent = formatInt(rpg.shells);
      kit.forget(list);
      dom.clear(list);
      if (tabs.current === 'buy') {
        for (const r of rpg.shop(shopId)) {
          const def = ctx.defs.find('item', r.itemId);
          const n = qty[r.index] || 1;
          const li = kit.el('div', 'ui-li', list);
          li.dataset.row = String(r.index);
          itemRing(kit, li, def);
          const m = kit.el('div', 'ui-li-main', li);
          kit.el('span', 'ui-li-title', m, itemNameKey(r.itemId));
          const sub = kit.el('span', 'ui-row', m);
          const price = kit.el('span', 'ui-tag' + (rpg.shells >= r.price * n ? '' : ' ui-bad'), sub);
          price.appendChild(icon(doc, 'shell'));
          kit.num(price, '').textContent = formatInt(r.price * n);
          if (def && def.type === 'gear') kit.el('span', 'ui-tag', sub, 'ui.inv.itemLevel', { level: formatInt(r.level) });
          else {
            const have = kit.el('span', 'ui-tag', sub, 'ui.shop.have', { n: formatInt(rpg.count(r.itemId)) });
            void have;
          }
          if (def && def.type !== 'gear') {
            const step = kit.el('div', 'ui-row', li);
            const minus = kit.button(step, null, () => {
              qty[r.index] = Math.max(1, n - 1);
              render();
            }, 'ui-icon ui-sm ui-ghostbtn', 'minus');
            kit.attr(minus, 'aria-label', 'ui.shop.less');
            kit.num(step, '').textContent = formatInt(n);
            const plus = kit.button(step, null, () => {
              qty[r.index] = Math.min(9, n + 1);
              render();
            }, 'ui-icon ui-sm ui-ghostbtn', 'plus');
            kit.attr(plus, 'aria-label', 'ui.shop.more');
          }
          const b = kit.button(li, 'ui.shop.buyBtn', () => {
            const res = ctx.rpg.buy(shopId, r.index, n);
            if (res.ok) {
              kit.sound('shells');
              ui.toast(n === 1 ? 'ui.toast.boughtOne' : 'ui.toast.bought', { name: kit.t(itemNameKey(r.itemId)), n: formatInt(n) }, 'good');
              qty[r.index] = 1;
            } else {
              kit.sound('ui_error');
              ui.toast(res.reasonKey || 'rpg.shop.unknown', null, 'warn');
            }
            render();
          }, 'ui-accent ui-sm');
          b.dataset.buy = String(r.index);
          b.disabled = rpg.shells < r.price * n;
        }
      } else {
        const items = rpg.items();
        let any = false;
        for (const it of items) {
          const def = ctx.defs.find('item', it.itemId);
          if (!def || def.type === 'quest' || it.equipped) continue;
          any = true;
          const li = kit.el('div', 'ui-li', list);
          li.dataset.uid = String(it.uid);
          itemRing(kit, li, def);
          const m = kit.el('div', 'ui-li-main', li);
          kit.el('span', 'ui-li-title', m, itemNameKey(it.itemId));
          const sub = kit.el('span', 'ui-row', m);
          const price = kit.el('span', 'ui-tag ui-ok', sub);
          price.appendChild(icon(doc, 'shell'));
          kit.num(price, '').textContent = '+' + formatInt(sellPrice(def, it));
          if (it.count > 1) kit.el('span', 'ui-tag', sub, 'ui.shop.have', { n: formatInt(it.count) });
          const b = kit.button(li, 'ui.shop.sellBtn', () => {
            const res = ctx.rpg.sell(it.uid, 1);
            if (res.ok) {
              kit.sound('shells');
              ui.toast(res.shells === 1 ? 'ui.toast.soldOne' : 'ui.toast.sold', { name: kit.t(itemNameKey(it.itemId)), n: formatInt(res.shells) }, 'good');
            }
            render();
          }, 'ui-sm');
          b.dataset.sell = String(it.uid);
        }
        if (!any) kit.el('div', 'ui-empty', list, 'ui.shop.nothing');
      }
    }
    return {
      el: root,
      /** @param {any} p */
      onOpen(p) {
        shopId = (p && p.shopId) || 'dov_stall';
        for (const k of Object.keys(qty)) delete qty[k];
        tabs.set('buy');
        render();
      },
      onClose() {},
      onLang: render,
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiTabNext' || a === 'uiTabPrev') {
          tabs.step(1);
          render();
          return true;
        }
        return false;
      },
    };
  });
}

/** Storage key of the player's shadow choice (a session option of the renderer, kept per device). */
const SHADOW_KEY = 'kethra.ui.shadows';

/** @param {any} ctx @returns {boolean} the renderer can draw a shadow map on this tier */
function shadowsPossible(ctx) {
  const r = ctx.render;
  return !!(r && typeof r.setShadows === 'function' && r.caps && r.caps.shadowSize > 0);
}

/** @param {any} ctx @returns {boolean} */
function shadowsOn(ctx) {
  const r = ctx.render;
  try {
    const q = r && typeof r.quality === 'function' ? r.quality() : null;
    return !!(q && q.shadowAllowed);
  } catch (e) {
    return false;
  }
}

/** Allow or forbid the shadow map and remember the choice on this device. @param {any} ctx @param {boolean} on */
export function setShadows(ctx, on) {
  const r = ctx.render;
  if (r && typeof r.setShadows === 'function') r.setShadows(!!on);
  try {
    ctx.dom.safeStorage.set(SHADOW_KEY, on ? '1' : '0');
  } catch (e) {
    // storage is optional
  }
}

/** Apply a stored shadow choice (boot). @param {any} ctx */
export function applyStoredShadows(ctx) {
  let v = null;
  try {
    v = ctx.dom.safeStorage.get(SHADOW_KEY);
  } catch (e) {
    v = null;
  }
  const r = ctx.render;
  if ((v === '0' || v === '1') && r && typeof r.setShadows === 'function') r.setShadows(v === '1');
}

/**
 * Facts for the device report. Every read is guarded: this runs on unknown hardware.
 * @param {any} ctx
 * @returns {Record<string, any>}
 */
function deviceFacts(ctx) {
  /** @type {Record<string, any>} */
  const d = { gpu: '', cssW: 0, cssH: 0, dpr: 1, canvasW: 0, canvasH: 0, scale: 1, tier: '', costMs: NaN, cap: 0, drawCalls: 0, triangles: 0, programs: 0, linkFailures: 0, heapMb: 0, audio: '-', storage: '-', bake: '-', device: '-', ua: '' };
  try {
    const win = ctx.dom.doc.defaultView || window;
    d.cssW = win.innerWidth;
    d.cssH = win.innerHeight;
    d.dpr = win.devicePixelRatio || 1;
    d.ua = win.navigator.userAgent;
    const mem = /** @type {any} */ (win.performance).memory;
    if (mem && mem.usedJSHeapSize) d.heapMb = mem.usedJSHeapSize / 1048576;
  } catch (e) { /* keep defaults */ }
  try {
    const r = ctx.three && ctx.three.renderer;
    if (r) {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      d.gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      d.canvasW = r.domElement.width;
      d.canvasH = r.domElement.height;
    }
  } catch (e) { /* keep defaults */ }
  try {
    const st = ctx.render.stats();
    d.scale = typeof st.scale === 'number' ? st.scale : ctx.render.scale;
    d.tier = ctx.render.tier;
    d.drawCalls = st.drawCalls || 0;
    d.programs = st.programs || 0;
    d.linkFailures = st.linkFailures || 0;
    d.triangles = st.triangles || 0;
    d.costMs = ctx.loop.stats.costMs;
    d.cap = ctx.loop.stats.cap;
  } catch (e) { /* keep defaults */ }
  try {
    d.audio = ctx.audio && ctx.audio.debug ? ctx.audio.debug().state : '-';
    d.storage = ctx.save.memoryOnly ? 'memory only' : 'saved on device';
    d.bake = ctx.world && ctx.world.bakeMode ? ctx.world.bakeMode : '-';
    d.device = ctx.input.device;
  } catch (e) { /* keep defaults */ }
  return d;
}
