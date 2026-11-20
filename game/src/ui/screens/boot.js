/**
 * Screens around the journey (ART_UX 7.2): loading (ring filling while the island bakes, the island drawn inside it,
 * rotating lore tips), title (Haven Aster flyover at golden hour, logo with a light sweep, both-language subtitle,
 * Continue, New Journey, Restore from code, Settings, language pill; the first tap unlocks audio), newgame (look,
 * form of address in Hebrew, difficulty; an in-UI confirmation offers the journey code before replacing a journey),
 * death (the world desaturates; Rise at the Ringstone, Retry in boss fights), ending, fatal and the confirm modal.
 * @module ui/screens/boot
 */

import { BALANCE } from '../../core/balance.js';
import { icon } from '../icons.js';
import { shell, chips } from './common.js';
import { formatPct } from '../logic/format.js';
import { APP_VERSION } from '../../core/store.js';

const TIPS = 8;
const TIP_SECONDS = 4;

/**
 * @param {any} ctx
 * @param {import('../kit.js').Kit} kit
 * @param {any} ui  the ctx.ui service (open, close, closeAll, confirm, toast)
 * @param {(id:string, f:Function) => void} reg
 */
export function registerBootScreens(ctx, kit, ui, reg) {
  const dom = ctx.dom;
  const doc = dom.doc;

  // ------------------------------------------------------------------ loading
  reg('loading', () => {
    const root = kit.el('div', 'ui-scr ui-solid ui-load', null);
    kit.el('div', 'ui-logo-sub', root, 'core.game.title');
    const ringBox = kit.el('div', 'ui-load-ring', root);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'ui-lr');
    const track = doc.createElementNS(NS, 'circle');
    const fill = doc.createElementNS(NS, 'circle');
    const L = 2 * Math.PI * 45;
    for (const c of [track, fill]) {
      c.setAttribute('cx', '50');
      c.setAttribute('cy', '50');
      c.setAttribute('r', '45');
      svg.appendChild(c);
    }
    track.setAttribute('stroke', '#4A3F5C');
    fill.setAttribute('stroke', '#7FF2E0');
    fill.setAttribute('stroke-linecap', 'round');
    fill.setAttribute('stroke-dasharray', L.toFixed(1));
    fill.setAttribute('stroke-dashoffset', L.toFixed(1));
    ringBox.appendChild(svg);
    const isle = /** @type {HTMLCanvasElement} */ (kit.el('canvas', '', ringBox));
    isle.width = 128;
    isle.height = 128;
    let drawn = false;
    const line = kit.el('div', 'ui-small', root);
    const pct = kit.num(root, 'ui-load-pct');
    const tip = kit.el('p', 'ui-load-tip', root);
    let tipIndex = 0;
    let phase = 'boot';
    let progress = 0;
    const render = () => {
      fill.setAttribute('stroke-dashoffset', (L * (1 - progress)).toFixed(1));
      const k = 'core.loading.' + phase;
      line.textContent = kit.t(ctx.i18n.has(k) ? k : 'core.loading.boot');
      pct.textContent = kit.t('core.loading.progress', { pct: formatPct(progress) });
      tip.textContent = kit.t('ui.tip.' + (tipIndex + 1));
      if (!drawn && ctx.world && typeof ctx.world.mapCanvas === 'function' && progress >= 0.9) {
        let src = null;
        try {
          src = ctx.world.mapCanvas(256);
        } catch (e) {
          src = null;
        }
        const g = src ? isle.getContext('2d') : null;
        if (g) {
          drawn = true;
          g.save();
          g.beginPath();
          g.arc(64, 64, 64, 0, Math.PI * 2);
          g.clip();
          g.drawImage(src, 0, 0, 128, 128);
          g.restore();
        }
      }
    };
    return {
      el: root,
      modal: true,
      onOpen() {
        tipIndex = Math.floor((ctx.flags.seed || 0) % TIPS);
        render();
      },
      onClose() {},
      onLang: render,
      /** @param {string} ph @param {number} p */
      update(ph, p) {
        phase = ph;
        progress = Math.max(0, Math.min(1, p));
        render();
      },
      /** @param {number} t seconds since open */
      tick(t) {
        const k = Math.floor(t / TIP_SECONDS) % TIPS;
        if (k !== tipIndex) {
          tipIndex = k;
          render();
        }
      },
    };
  });

  // ------------------------------------------------------------------ title
  reg('title', () => {
    const root = kit.el('div', 'ui-scr ui-clear ui-title', null);
    const logo = kit.el('div', 'ui-logo', root);
    // The ring emblem behind the name: a kite-paper ring of light, turning slowly, with eight vein ticks.
    const NS = 'http://www.w3.org/2000/svg';
    const emb = doc.createElementNS(NS, 'svg');
    emb.setAttribute('viewBox', '0 0 200 200');
    emb.setAttribute('class', 'ui-logo-ring');
    emb.setAttribute('aria-hidden', 'true');
    const g = doc.createElementNS(NS, 'g');
    for (const [r, w, cls] of [[86, 3, 'a'], [70, 1.5, 'b']]) {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('cx', '100');
      c.setAttribute('cy', '100');
      c.setAttribute('r', String(r));
      c.setAttribute('stroke-width', String(w));
      c.setAttribute('class', cls);
      g.appendChild(c);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = doc.createElementNS(NS, 'path');
      const r0 = i % 2 ? 74 : 62;
      l.setAttribute('d', 'M' + (100 + Math.sin(a) * r0).toFixed(1) + ' ' + (100 - Math.cos(a) * r0).toFixed(1) + 'L' + (100 + Math.sin(a) * 94).toFixed(1) + ' ' + (100 - Math.cos(a) * 94).toFixed(1));
      l.setAttribute('class', 't');
      g.appendChild(l);
    }
    emb.appendChild(g);
    logo.appendChild(emb);
    kit.el('h1', 'ui-logo-main', logo, 'core.game.title');
    kit.el('div', 'ui-logo-sub', logo, 'core.game.subtitle');
    const alt = kit.el('div', 'ui-logo-alt', logo);
    const menu = kit.el('div', 'ui-menu', root);
    const cont = kit.button(menu, 'ui.title.continue', () => {
      if (!ctx.session.start({ slot: 1, newGame: false })) {
        ui.toast('ui.title.noSave', null, 'warn');
        return;
      }
      ui.closeAll();
    }, 'ui-full', 'play');
    kit.button(menu, 'ui.title.newGame', () => ui.open('newgame', {}), 'ui-full ui-ghostbtn');
    kit.button(menu, 'core.save.restoreCode', () => ui.open('savecode', { tab: 'restore' }), 'ui-full ui-ghostbtn', 'restore');
    kit.button(menu, 'ui.pause.settings', () => ui.open('settings', {}), 'ui-full ui-ghostbtn', 'gear');
    const small = kit.el('div', 'ui-row ui-titlerow', menu);
    const pill = kit.el('div', 'ui-langpill', small);
    const he = /** @type {HTMLButtonElement} */ (kit.el('button', '', pill, 'ui.lang.short.he'));
    const en = /** @type {HTMLButtonElement} */ (kit.el('button', '', pill, 'ui.lang.short.en'));
    he.type = 'button';
    en.type = 'button';
    kit.attr(he, 'aria-label', 'core.lang.he');
    kit.attr(en, 'aria-label', 'core.lang.en');
    he.addEventListener('click', () => setLang(ctx, 'he'));
    en.addEventListener('click', () => setLang(ctx, 'en'));
    const cred = kit.button(small, 'ui.credits.title', () => ui.open('credits', {}), 'ui-sm ui-ghostbtn', 'scroll');
    cred.dataset.open = 'credits';
    root.addEventListener('pointerdown', () => {
      const a = ctx.audio;
      if (a && typeof a.unlock === 'function') {
        try {
          a.unlock();
        } catch (e) {
          // audio is optional
        }
      }
    });
    let open = false;
    const refresh = () => {
      let exists = false;
      try {
        const s = ctx.save.slots();
        exists = !!(s[0] && s[0].exists);
      } catch (e) {
        exists = false;
      }
      cont.hidden = !exists;
      he.classList.toggle('ui-sel', ctx.i18n.lang === 'he');
      en.classList.toggle('ui-sel', ctx.i18n.lang === 'en');
      alt.textContent = kit.t(ctx.i18n.lang === 'he' ? 'ui.title.altEn' : 'ui.title.altHe');
    };
    function flyover() {
      const cam = ctx.cam;
      const world = ctx.world;
      if (!cam || typeof cam.play !== 'function' || !world) return;
      const lm = world.landmark ? world.landmark('haven_aster') : null;
      const cx = lm ? lm.x : -360;
      const cz = lm ? lm.z : 1150;
      const gy = world.heightAt ? world.heightAt(cx, cz) : 0;
      const look = { x: cx, y: gy + 22, z: cz };
      const at = (a, r, h) => ({ x: cx + Math.sin(a) * r, y: gy + h, z: cz + Math.cos(a) * r });
      const shots = [
        { seconds: 10, from: at(0.4, 150, 46), to: at(1.3, 120, 34), lookAt: look, fov: 48, ease: 'inOut' },
        { seconds: 10, from: at(1.3, 120, 34), to: at(2.4, 170, 60), lookAt: look, fov: 50, ease: 'inOut' },
        { seconds: 10, from: at(2.4, 170, 60), to: at(3.4, 140, 40), lookAt: look, fov: 46, ease: 'inOut' },
      ];
      let p = null;
      try {
        p = cam.play('title', shots, { skippable: false });
      } catch (e) {
        p = null;
      }
      if (p && typeof p.then === 'function') {
        p.then((r) => {
          if (open && !(r && r.skipped)) flyover();
        });
      }
    }
    return {
      el: root,
      modal: true,
      onOpen() {
        open = true;
        refresh();
        const env = ctx.env;
        if (env) {
          if (typeof env.setHour === 'function') env.setHour(17.5);
          if (typeof env.setClockScale === 'function') env.setClockScale(0);
        }
        if (ctx.world && ctx.world.setFocus) {
          const lm = ctx.world.landmark ? ctx.world.landmark('haven_aster') : null;
          if (lm) ctx.world.setFocus(lm.x, (ctx.world.heightAt ? ctx.world.heightAt(lm.x, lm.z) : 0) + 40, lm.z);
        }
        flyover();
      },
      onClose() {
        open = false;
        const cam = ctx.cam;
        if (cam && cam.busy && typeof cam.play === 'function') {
          // End the unskippable flyover through the public API: replace it with an empty skippable cut.
          cam.play('title_end', [], { skippable: true });
          if (typeof cam.skip === 'function') cam.skip();
        }
        const env = ctx.env;
        if (env && typeof env.setClockScale === 'function') env.setClockScale(1);
      },
      onLang: refresh,
      initialFocus: () => (cont.hidden ? null : cont),
    };
  });

  // ------------------------------------------------------------------ newgame
  reg('newgame', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.title.newGame', ribbonIcon: 'play', size: '' });
    const cols = kit.el('div', 'ui-two', body);
    const colA = kit.el('div', 'ui-col', cols);
    const colB = kit.el('div', 'ui-col', cols);
    const pick = { preset: 'hero_a', gender: /** @type {'m'|'f'} */ ('m'), difficulty: 'warrior' };
    kit.el('h3', 'ui-h3', colA, 'ui.newgame.look');
    const looks = kit.el('div', 'ui-slots ui-eqslots ui-looks', colA);
    /** @type {Record<string, HTMLButtonElement>} */
    const lookBtns = {};
    for (const id of ['hero_a', 'hero_b']) {
      const b = /** @type {HTMLButtonElement} */ (kit.el('button', 'ui-slot', looks));
      b.type = 'button';
      const ring = kit.el('span', 'ui-ringico', b);
      ring.style.setProperty('--rc', id === 'hero_a' ? 'var(--warn)' : 'var(--rarity-r)');
      ring.appendChild(icon(doc, 'person'));
      const m = kit.el('span', 'ui-li-main', b);
      kit.el('span', 'ui-li-title', m, 'ui.preset.' + id);
      kit.el('span', 'ui-li-sub', m, 'ui.preset.' + id + '.desc');
      b.addEventListener('click', () => {
        pick.preset = id;
        sync();
        kit.sound('ui_move');
      });
      lookBtns[id] = b;
    }
    const genderBox = kit.el('div', 'ui-col', colB);
    kit.el('h3', 'ui-h3', genderBox, 'ui.newgame.address');
    const gender = chips(kit, genderBox, [{ id: 'm', key: 'core.gender.m' }, { id: 'f', key: 'core.gender.f' }], (id) => {
      pick.gender = id === 'f' ? 'f' : 'm';
    });
    kit.el('h3', 'ui-h3', colB, 'ui.newgame.difficulty');
    const diff = chips(kit, colB, ['story', 'warrior', 'master'].map((id) => ({ id, key: 'core.difficulty.' + id })), (id) => {
      pick.difficulty = id;
      sync();
    });
    const diffDesc = kit.el('p', 'ui-small', colB);
    const exists = kit.el('div', 'ui-card', colA);
    kit.el('p', 'ui-small', exists, 'ui.newgame.replaces');
    kit.button(exists, 'core.save.copyCode', () => ui.open('savecode', { tab: 'copy' }), 'ui-sm ui-ghostbtn', 'copy');
    const row = kit.el('div', 'ui-row', colB);
    kit.button(row, 'ui.common.back', () => ui.close('newgame'), 'ui-ghostbtn', 'back');
    const start = kit.button(row, 'ui.newgame.start', () => {
      const go = () => {
        ui.closeAll();
        if (ctx.i18n.lang !== 'he') pick.gender = 'm';
        ctx.session.start({ slot: 1, newGame: true, preset: pick.preset, gender: pick.gender, difficulty: pick.difficulty });
      };
      if (hasJourney()) {
        ui.confirm('ui.newgame.confirm', null).then((ok) => {
          if (ok) go();
        });
      } else go();
    }, 'ui-accent ui-grow', 'play');
    function hasJourney() {
      try {
        const s = ctx.save.slots();
        return !!(s[0] && s[0].exists);
      } catch (e) {
        return false;
      }
    }
    function sync() {
      for (const k of Object.keys(lookBtns)) lookBtns[k].classList.toggle('ui-sel', k === pick.preset);
      gender.set(pick.gender);
      diff.set(pick.difficulty);
      genderBox.hidden = ctx.i18n.lang !== 'he';
      diffDesc.textContent = kit.t('ui.difficulty.' + pick.difficulty + '.desc');
      exists.hidden = !hasJourney();
    }
    return {
      el: root,
      onOpen() {
        sync();
      },
      onClose() {},
      onLang: sync,
      initialFocus: () => start,
    };
  });

  // ------------------------------------------------------------------ death
  reg('death', () => {
    const root = kit.el('div', 'ui-scr ui-clear ui-death', null);
    kit.el('h1', 'ui-big', root, 'core.death.title');
    const sub = kit.el('p', 'ui-small', root);
    const col = kit.el('div', 'ui-menu', root);
    let bossId = null;
    const rise = kit.button(col, 'ui.death.rise', () => {
      ui.close('death');
      if (ctx.rpg) ctx.rpg.respawn({ retry: false });
    }, 'ui-full', 'ring');
    const retry = kit.button(col, 'ui.death.retry', () => {
      ui.close('death');
      if (ctx.rpg) ctx.rpg.respawn({ retry: true });
    }, 'ui-full ui-ghostbtn', 'restore');
    const canvasLayer = dom.layer('canvas');
    const render = () => {
      // Retry puts the player back into the fight they lost: a boss, or a trial fight (ctx.rpg.canRetry knows both).
      retry.hidden = !(bossId || (ctx.rpg && ctx.rpg.canRetry));
      const d = ctx.rpg ? ctx.rpg.difficulty : 'warrior';
      const loss = BALANCE.difficulty[d] ? BALANCE.difficulty[d].shellLoss : 0;
      sub.textContent = loss > 0 ? kit.t('ui.death.shellLoss', { pct: formatPct(loss) }) : kit.t('ui.death.sub');
    };
    return {
      el: root,
      modal: true,
      /** @param {any} p */
      onOpen(p) {
        bossId = p && p.bossId ? p.bossId : null;
        canvasLayer.style.transition = 'filter 800ms ease-out';
        canvasLayer.style.filter = 'grayscale(0.85) brightness(0.8)';
        render();
      },
      onClose() {
        canvasLayer.style.filter = '';
      },
      onLang: render,
      initialFocus: () => rise,
    };
  });

  // ------------------------------------------------------------------ ending
  reg('ending', () => {
    const root = kit.el('div', 'ui-scr ui-clear ui-ending', null);
    kit.el('div', 'ui-logo-sub', root, 'ui.ending.kicker');
    kit.el('h1', 'ui-big', root, 'ui.ending.title');
    const credits = kit.el('div', 'ui-credits', root);
    for (let i = 1; i <= 4; i++) kit.el('p', 'ui-p', credits, 'ui.ending.line' + i);
    const col = kit.el('div', 'ui-menu', root);
    const go = kit.button(col, 'ui.ending.continue', () => ui.closeAll(), 'ui-full', 'play');
    return { el: root, modal: false, onOpen() {}, onClose() {}, initialFocus: () => go };
  });

  // ------------------------------------------------------------------ credits and licences
  reg('credits', () => {
    const { root, body } = shell(kit, { ribbon: 'ui.credits.title', ribbonIcon: 'scroll', size: '', cls: 'ui-menuscr' });
    // Back sits at the top, so the page opens at its start with the focus on it (a long licence text follows).
    const back = kit.button(body, 'ui.common.back', () => ui.close('credits'), 'ui-ghostbtn ui-sm', 'back');
    back.style.alignSelf = 'flex-start';
    const head = kit.el('div', 'ui-credhead', body);
    kit.el('div', 'ui-credname', head, 'core.game.title');
    kit.el('div', 'ui-logo-sub', head, 'core.game.subtitle');
    kit.el('div', 'ui-small', head, 'ui.credits.version', { v: APP_VERSION });
    kit.el('p', 'ui-p', body, 'ui.credits.made');
    kit.el('h3', 'ui-h3', body, 'ui.credits.libs');
    const lib = kit.el('div', 'ui-card ui-col', body);
    kit.el('div', 'ui-li-title', lib, 'ui.credits.three');
    kit.el('div', 'ui-small', lib, 'ui.credits.threeCopy');
    kit.el('p', 'ui-legal', lib, 'ui.credits.mit');
    kit.el('h3', 'ui-h3', body, 'ui.credits.fonts');
    const fonts = kit.el('div', 'ui-card ui-col', body);
    kit.el('div', 'ui-p', fonts, 'ui.credits.secular');
    kit.el('div', 'ui-p', fonts, 'ui.credits.rubik');
    kit.el('p', 'ui-small', fonts, 'ui.credits.fontsNote');
    kit.el('p', 'ui-small', body, 'ui.credits.legalNote');
    return { el: root, onOpen() {
      const b = root.querySelector('.ui-pbody');
      if (b) b.scrollTop = 0;
    }, onClose() {}, initialFocus: () => back };
  });

  // ------------------------------------------------------------------ fatal
  reg('fatal', () => {
    const { root, body } = shell(kit, { ribbon: 'core.fatal.title', ribbonIcon: 'warn', size: 'narrow', cls: 'ui-solid' });
    kit.el('p', 'ui-p', body, 'core.fatal.body');
    const msg = kit.el('pre', 'ui-fatalmsg k-select', body);
    const row = kit.el('div', 'ui-row', body);
    const reload = kit.button(row, 'core.fatal.reload', () => {
      try {
        location.reload();
      } catch (e) {
        // nothing else to do
      }
    }, 'ui-accent', 'restore');
    kit.button(row, 'ui.fatal.low', () => {
      try {
        const u = new URL(location.href);
        u.searchParams.set('quality', 'low');
        location.replace(u.toString());
      } catch (e) {
        // ignore
      }
    }, 'ui-ghostbtn');
    return {
      el: root,
      modal: true,
      /** @param {any} p */
      onOpen(p) {
        msg.textContent = p && p.message ? String(p.message) : '';
      },
      onClose() {},
      initialFocus: () => reload,
    };
  });

  // ------------------------------------------------------------------ confirm
  reg('confirm', () => {
    const { root, body } = shell(kit, { size: 'narrow' });
    const text = kit.el('p', 'ui-p', body);
    const row = kit.el('div', 'ui-row', body);
    /** @type {any} */
    let state = null;
    const no = kit.button(row, 'ui.common.cancel', () => finish(false), 'ui-ghostbtn ui-grow');
    const yes = kit.button(row, 'ui.common.yes', () => finish(true), 'ui-accent ui-grow');
    void yes;
    /** @param {boolean} v */
    function finish(v) {
      const r = ui.confirmResolve();
      ui.close('confirm');
      if (r) r(v);
    }
    return {
      el: root,
      /** @param {any} p */
      onOpen(p) {
        state = p || {};
        text.textContent = state.key ? kit.t(state.key, state.args) : '';
      },
      onClose() {
        const r = ui.confirmResolve();
        if (r) r(false);
      },
      onLang() {
        if (state && state.key) text.textContent = kit.t(state.key, state.args);
      },
      /** @param {string} a */
      onInput(a) {
        if (a === 'uiBack') {
          finish(false);
          return true;
        }
        return false;
      },
      initialFocus: () => no,
    };
  });
}

/**
 * Switch the language now and store it (settings:changed reaches the foundation glue too).
 * @param {any} ctx @param {'he'|'en'} lang
 */
export function setLang(ctx, lang) {
  ctx.save.setSetting('lang', lang);
  if (ctx.i18n.lang !== lang) ctx.i18n.setLang(lang);
}
