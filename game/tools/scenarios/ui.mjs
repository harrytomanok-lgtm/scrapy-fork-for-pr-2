/**
 * ui package scenarios (ARCHITECTURE 8.9): the HUD layout rule in both languages and orientations, every screen
 * with representative state, and the main flows (new journey, inventory, techniques, shop, dialogue, death,
 * settings). State changes are verified through __GAME__.state() and the ui debug command.
 */

const SIZES = [
  { w: 640, h: 360 },
  { w: 400, h: 800 },
];
const LANGS = ['he', 'en'];

/**
 * In the page: HUD layout problems. Pieces (data-hud) must not intersect each other or any touch button
 * (data-action, the move and look gesture zones excepted) and must lie inside the viewport.
 */
function hudProblems() {
  const g = /** @type {any} */ (window).__GAME__;
  const d = g.cmd.ui();
  const W = innerWidth;
  const H = innerHeight;
  const out = [];
  const ps = d.pieces.filter((p) => p.name !== 'xp');
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const p of d.pieces) {
    if (p.x < -0.5 || p.y < -0.5 || p.x + p.w > W + 0.5 || p.y + p.h > H + 0.5) out.push(`${p.name} outside the viewport`);
  }
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (hit(ps[i], ps[j])) out.push(`${ps[i].name} x ${ps[j].name}`);
  }
  const acts = [];
  for (const el of document.querySelectorAll('[data-action]')) {
    const a = el.getAttribute('data-action');
    if (a === 'move' || a === 'look') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    acts.push({ name: a, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  for (const p of d.pieces) for (const a of acts) if (hit(p, a)) out.push(`${p.name} x control ${a.name}`);
  // Nothing in the centre covers the hero or the locked target (their projected screen boxes).
  const centre = d.pieces.filter((p) => ['toast', 'pill', 'prompt', 'combo'].indexOf(p.name) >= 0).concat(d.centre || []);
  for (const p of centre) for (const k of d.keepOut || []) if (hit(p, k)) out.push(`${p.name} covers the ${k.name}`);
  return { problems: out, mode: d.mode, pieces: d.pieces.map((p) => p.name), controls: acts.length, held: d.held };
}

/** In the page: no horizontal overflow on the root, dir as expected, no [key] placeholders in the visible DOM. */
function screenProblems(g, dir) {
  const app = document.getElementById('app');
  const out = [];
  if (app.scrollWidth > app.clientWidth + 1) out.push('root overflows: ' + app.scrollWidth + ' > ' + app.clientWidth);
  if (app.getAttribute('dir') !== dir) out.push('dir is ' + app.getAttribute('dir'));
  const text = app.innerText || '';
  const m = text.match(/\[[a-z]+\.[a-zA-Z0-9_.]+\]/g);
  if (m) out.push('placeholders: ' + m.slice(0, 5).join(' '));
  for (const s of document.querySelectorAll('.ui-scr:not([hidden])')) {
    if (s.scrollWidth > s.clientWidth + 1) out.push(s.getAttribute('data-screen') + ' overflows ' + s.scrollWidth + ' > ' + s.clientWidth);
    for (const b of s.querySelectorAll('.ui-pbody')) if (b.scrollWidth > b.clientWidth + 1) out.push(s.getAttribute('data-screen') + ' panel overflows');
  }
  return out;
}

/** Common HUD state: damage taken, Ora used, a locked target, a tracked quest, two toasts. */
function hudState(g) {
  g.setDevice('touch');
  const id = g.spawn('tusk_boar', { dist: 10, passive: true });
  g.lock(id);
  g.damage(id, 0.4);
  const p = g.player();
  g.damage(p.id, 0.3, { kind: 'true', sourceId: id });
  g.setOra(p.oraMax * 0.45);
  const q = g.ctx.quests.active();
  if (q.length) g.ctx.quests.track(q[0].questId);
  g.ctx.ui.toast('ui.toast.ringstone', null, 'good');
  g.ctx.ui.toast('ui.toast.questStarted', { title: g.ctx.i18n.t('quest.mq2.title') }, 'info');
  g.step(3);
  // A tutorial prompt and the interact pill take their slots too.
  g.ctx.bus.emit('tutorial:prompt', { action: 'attack', textKey: 'rpg.tut.attack' });
  g.ctx.bus.emit('interact:focus', { id: 'test', kind: 'npc', promptKey: 'rpg.prompt.talk' });
  // A combo and a centre banner take their places too.
  g.ctx.bus.emit('combat:combo', { count: 12, rank: 3, rankId: 'blaze', expired: false, best: 12 });
  g.ctx.ui.banner('level', 'ui.banner.levelUp', { level: '7' });
  g.step(2);
  g.render();
  return { target: g.ctx.combat.target(), tracked: g.ctx.quests.tracked };
}

/** ui-prompts: every prompt shows the glyph of the last-used device; touch rings the real control. */
const promptScenario = {
  name: 'ui-prompts',
  width: 640,
  height: 360,
  query: 'lang=en',
  async run({ game, assert, shot }) {
    await game((g) => g.step(3));
    const r = await game((g) => {
      const out = [];
      const actions = ['attack', 'bolt', 'dash', 'guard', 'jump', 'gather', 'lock', 'interact', 'item'];
      for (const dev of ['kbm', 'pad', 'touch']) {
        g.setDevice(dev);
        g.render();
        for (const a of actions) {
          g.ctx.bus.emit('tutorial:prompt', { action: a, textKey: null });
          g.render();
          const glyph = document.querySelector('.ui-prompt .ui-glyph');
          const ghost = document.querySelector('.ui-ghost');
          const want = g.ctx.input.glyph(a);
          const text = document.querySelector('.ui-prompt span:last-child').textContent;
          if (dev === 'touch') {
            const btn = document.querySelector(`[data-action="${a}"]`);
            const br = btn ? btn.getBoundingClientRect() : null;
            const shown = btn && br.width > 2;
            if (shown) {
              const gr = ghost.getBoundingClientRect();
              const dx = Math.abs(gr.left + gr.width / 2 - (br.left + br.width / 2));
              const dy = Math.abs(gr.top + gr.height / 2 - (br.top + br.height / 2));
              if (ghost.hidden || dx > 2 || dy > 2) out.push(`${dev}/${a}: ghost not over the control (${dx},${dy})`);
            }
            if (!glyph.classList.contains('ui-tap')) out.push(`${dev}/${a}: no tap glyph`);
          } else if (glyph.textContent !== (want.label || '?')) out.push(`${dev}/${a}: glyph '${glyph.textContent}' != '${want.label}'`);
          if (!text || text.startsWith('[')) out.push(`${dev}/${a}: text '${text}'`);
        }
      }
      g.ctx.bus.emit('tutorial:prompt', { action: 'jump', textKey: 'rpg.tut.jump' });
      g.render();
      return out;
    });
    await shot('ui-prompts-touch');
    assert.deepEqual(r, []);
  },
};

const hudScenarios = [];
for (const s of [...SIZES, { w: 844, h: 390 }, { w: 360, h: 640 }, { w: 320, h: 568 }, { w: 480, h: 854 }, { w: 915, h: 412 }]) {
  for (const lang of LANGS) {
    hudScenarios.push({
      name: `ui-hud-${s.w}x${s.h}-${lang}`,
      width: s.w,
      height: s.h,
      query: 'lang=' + lang,
      async run({ game, shot, assert }) {
        await game((g) => g.step(5));
        const st = await game(hudState);
        assert.ok(st.target > 0, 'a target is locked');
        const r = await game(hudProblems);
        assert.ok(r.controls > 0, 'touch controls are shown');
        // On the smallest phones the toasts may wait (held) while nothing else fits beside the hero.
        for (const want of ['medallion', 'hp', 'ora', 'resonance', 'compass', 'pause', 'map', ...(r.held.toasts ? [] : ['toast'])]) {
          assert.ok(r.pieces.indexOf(want) >= 0, want + ' is visible (' + r.pieces.join(',') + ')');
        }
        assert.ok(r.pieces.indexOf('target') >= 0 || r.pieces.indexOf('boss') >= 0, 'target frame visible');
        await shot(`ui-hud-${s.w}x${s.h}-${lang}`);
        assert.deepEqual(r.problems, [], `HUD layout ${s.w}x${s.h} ${lang} (${r.mode}): ${JSON.stringify(await game(() => window.__GAME__.cmd.ui().pieces.map((p) => p.name + ':' + [p.x, p.y, p.w, p.h].map(Math.round).join(','))))}`);
      },
    });
  }
}

/** Screens with representative state, prepared once per run. */
function prepare(g) {
  g.ctx.rpg.setStyle('manual');
  g.grantXp(400);
  g.ctx.rpg.addTp(6);
  g.give('training_wraps');
  g.give('meadow_garb');
  g.give('ember_charm');
  g.give('sunfruit', 3);
  g.give('ora_draught', 2);
  g.equip('meadow_garb');
  g.shells(450);
  g.unlockTech('dawn_lance');
  g.step(2);
}

const SCREENS = [
  ['pause', {}], ['character', {}], ['techniques', {}], ['inventory', {}], ['quests', {}], ['map', {}],
  ['settings', {}], ['settings', { tab: 'a11y' }], ['controls', {}], ['savecode', { tab: 'copy' }], ['savecode', { tab: 'restore' }],
  ['shop', { shopId: 'dov_stall' }], ['death', { bossId: 'durn' }], ['ending', {}], ['fatal', { message: 'TypeError: x is undefined\n  at frame (game.js:1:2)' }],
  ['newgame', {}], ['loading', {}], ['title', {}],
];

const screenScenarios = [];
for (const s of SIZES) {
  for (const lang of LANGS) {
    screenScenarios.push({
      name: `ui-screens-${s.w}x${s.h}-${lang}`,
      width: s.w,
      height: s.h,
      query: 'lang=' + lang,
      async run({ game, shot, assert }) {
        await game(prepare);
        const dir = lang === 'he' ? 'rtl' : 'ltr';
        for (const [id, params] of SCREENS) {
          const r = await game((g, a) => {
            g.closeAll();
            g.open(a.id, a.params);
            g.render();
            return { top: g.top(), focus: g.cmd.ui().focus };
          }, { id, params });
          assert.equal(r.top, id, 'opened ' + id);
          const probs = await game(screenProblems, dir);
          const tag = `${id}${params.tab ? '-' + params.tab : ''}`;
          await shot(`ui-screen-${tag}-${s.w}x${s.h}-${lang}`);
          assert.deepEqual(probs, [], `${tag} ${s.w}x${s.h} ${lang}`);
          assert.deepEqual(r.focus.problems, [], `${tag}: focus graph without dead ends (${r.focus.count} elements)`);
        }
        const d = await game((g) => {
          g.closeAll();
          g.ctx.quests.talk('dov_idle', { npcId: 'dov' });
          g.render();
          g.press('uiConfirm');
          g.render();
          return { top: g.top(), focus: g.cmd.ui().focus };
        });
        assert.equal(d.top, 'dialogue');
        assert.deepEqual(await game(screenProblems, dir), [], 'dialogue');
        await shot(`ui-screen-dialogue-${s.w}x${s.h}-${lang}`);
        assert.deepEqual(d.focus.problems, []);
        const missing = await game((g) => g.ctx.i18n.missing().filter((k) => !k.startsWith('standin.')));
        assert.deepEqual(missing, [], 'no missing strings');
        const errs = await game((g) => {
          g.closeAll();
          return g.errors.slice();
        });
        assert.deepEqual(errs, []);
      },
    });
  }
}

/** Flows run in Hebrew at 640x360 and in English at 400x800. */
const FLOW_RUNS = [
  { w: 640, h: 360, lang: 'he' },
  { w: 400, h: 800, lang: 'en' },
];

/** @param {any} page @param {string} sel */
async function tap(page, sel) {
  await page.locator(sel).first().click();
  await page.evaluate(() => window.__GAME__.render());
}

/** In the page: the action value of the first element matching a selector, or null. */
function attrOf(g, a) {
  const b = document.querySelector(a.sel);
  return b ? b.getAttribute(a.attr) : null;
}

const flows = [
  {
    name: 'ui-flow-newgame',
    async run({ page, game, assert, shot }) {
      await game((g) => {
        g.closeAll();
        g.open('title');
        g.render();
      });
      assert.equal(await game((g) => g.top()), 'title');
      await tap(page, '[data-screen=title] .ui-menu .ui-btn:nth-child(2)');
      assert.equal(await game((g) => g.top()), 'newgame');
      await tap(page, '[data-screen=newgame] .ui-slot:nth-child(2)');
      await tap(page, '[data-screen=newgame] .ui-chipbtn[data-value=story]');
      await shot('ui-flow-newgame');
      await tap(page, '[data-screen=newgame] .ui-btn.ui-accent');
      const r = await game((g) => {
        g.step(3);
        const st = g.state();
        return { top: g.top(), hud: !document.querySelector('.ui-hud').hidden, diff: st.player.difficulty, preset: st.player.preset, paused: g.ctx.time.paused };
      });
      assert.equal(r.top, 'hud');
      assert.equal(r.hud, true, 'the HUD is visible');
      assert.equal(r.diff, 'story');
      assert.equal(r.preset, 'hero_b');
      assert.equal(r.paused, false);
    },
  },
  {
    name: 'ui-inventory-equip',
    async run({ page, game, assert, shot }) {
      const uid = await game((g) => {
        g.give('training_wraps');
        g.give('sunfruit', 2);
        g.step(1);
        g.open('inventory');
        g.render();
        return g.ctx.rpg.items().find((i) => i.itemId === 'training_wraps').uid;
      });
      await tap(page, '[data-screen=inventory] .ui-cell[data-item=training_wraps]');
      await tap(page, '[data-screen=inventory] [data-act=equip]');
      const st = await game((g) => g.state().inv.equip);
      assert.equal(st.wraps, uid, 'equipped by taps');
      await shot('ui-inventory-equip');
      const t = await game((g) => {
        g.press('uiTabNext');
        g.render();
        const a = g.top();
        g.press('uiTabPrev');
        g.render();
        return [a, g.top()];
      });
      assert.deepEqual(t, ['quests', 'inventory'], 'injected tab switches');
      const un = await game((g) => {
        document.querySelector('[data-screen=inventory] .ui-cell[data-item=training_wraps]').click();
        g.render();
        for (let i = 0; i < 40; i++) {
          const f = document.querySelector('[data-screen=inventory] .ui-focus');
          if (f && f.dataset.act === 'unequip') break;
          g.press(i % 12 < 6 ? 'uiDown' : 'uiRight');
          g.render();
        }
        const f = document.querySelector('[data-screen=inventory] .ui-focus');
        g.press('uiConfirm');
        g.render();
        return { focused: f ? f.dataset.act || null : null, wraps: g.state().inv.equip.wraps };
      });
      assert.equal(un.focused, 'unequip', 'focus reached the unequip button');
      assert.equal(un.wraps, null, 'unequipped with injected ui actions');
      const used = await game((g) => {
        document.querySelector('[data-screen=inventory] .ui-cell[data-item=sunfruit]').click();
        g.render();
        const before = g.ctx.rpg.count('sunfruit');
        g.damage(g.player().id, 0.3);
        document.querySelector('[data-screen=inventory] [data-act=use]').click();
        g.render();
        return [before, g.ctx.rpg.count('sunfruit')];
      });
      assert.equal(used[1], used[0] - 1, 'a Sunfruit was used');
    },
  },
  {
    name: 'ui-techniques-learn',
    async run({ page, game, assert, shot }) {
      await game((g) => {
        g.ctx.rpg.addTp(4);
        g.open('techniques');
        g.render();
      });
      const before = await game((g) => ({ tp: g.state().player.tp }));
      const sel = { sel: '[data-screen=techniques] [data-learn]', attr: 'data-learn' };
      let learn = await game(attrOf, sel);
      for (const b of ['flare', 'spirit']) {
        if (learn) break;
        await tap(page, `[data-screen=techniques] .ui-tab[data-tab=${b}]`);
        learn = await game(attrOf, sel);
      }
      assert.ok(learn, 'a node can be learned');
      await tap(page, `[data-screen=techniques] [data-learn="${learn}"]`);
      const after = await game((g) => ({ tp: g.state().player.tp, nodes: g.state().player.nodes }));
      assert.ok(after.nodes.indexOf(learn) >= 0, 'node learned');
      assert.ok(after.tp < before.tp, 'TP spent');
      await shot('ui-techniques-learn');
      const slotted = await game((g) => {
        g.unlockTech('nova_ring');
        g.closeAll();
        g.open('techniques');
        g.render();
        for (const b of ['fist', 'flare', 'spirit']) {
          document.querySelector(`[data-screen=techniques] .ui-tab[data-tab=${b}]`).click();
          g.render();
          for (const li of document.querySelectorAll('[data-screen=techniques] .ui-li[data-node]')) {
            li.click();
            g.render();
            const btn = document.querySelector('[data-screen=techniques] [data-slot="0"]');
            if (btn) {
              btn.click();
              g.render();
              return g.state().player.slots[0];
            }
          }
        }
        return null;
      });
      assert.ok(slotted, 'a technique was put in slot 1');
    },
  },
  {
    name: 'ui-shop-buy',
    async run({ page, game, assert, shot }) {
      const b0 = await game((g) => {
        g.shells(300);
        g.open('shop', { shopId: 'dov_stall' });
        g.render();
        return { shells: g.state().inv.shells, fruit: g.ctx.rpg.count('sunfruit') };
      });
      await tap(page, '[data-screen=shop] [data-row="0"] .ui-row .ui-btn:last-child');
      await tap(page, '[data-screen=shop] [data-buy="0"]');
      const b1 = await game((g) => ({ shells: g.state().inv.shells, fruit: g.ctx.rpg.count('sunfruit') }));
      assert.equal(b1.fruit, b0.fruit + 2, 'bought two with the stepper');
      assert.ok(b1.shells < b0.shells, 'Shells spent');
      await shot('ui-shop-buy');
      await game((g) => {
        g.press('uiTabNext');
        g.render();
      });
      await tap(page, '[data-screen=shop] [data-sell]');
      const b2 = await game((g) => ({ shells: g.state().inv.shells }));
      assert.ok(b2.shells > b1.shells, 'sold for Shells');
    },
  },
  {
    name: 'ui-dialogue',
    async run({ page, game, assert, shot }) {
      const r0 = await game((g) => {
        g.ctx.quests.talk('dov_idle', { npcId: 'dov' });
        g.render();
        return { top: g.top(), waiting: !!document.querySelector('[data-screen=dialogue] .ui-choices[hidden]'), name: document.querySelector('.ui-dlgname').textContent };
      });
      assert.equal(r0.top, 'dialogue');
      assert.equal(r0.waiting, true, 'the line is typing; choices wait');
      assert.ok(r0.name.length > 0, 'speaker name shown');
      const r1 = await game((g) => {
        g.press('uiConfirm');
        g.render();
        return { line: document.querySelector('.ui-dlgline').textContent, full: g.ctx.i18n.t('dov.idle.greet'),
          choices: document.querySelectorAll('[data-screen=dialogue] .ui-choices:not([hidden]) button').length };
      });
      assert.equal(r1.line, r1.full, 'confirm completes the typing');
      assert.ok(r1.choices >= 2, 'choices shown');
      assert.equal(await game(() => document.querySelector('[data-screen=dialogue] .ui-dlgskip').hidden), true, 'no Skip at a choice');
      await shot('ui-dialogue');
      await game((g) => {
        const bs = document.querySelectorAll('[data-screen=dialogue] .ui-choices button');
        bs[bs.length - 2].click();
        g.render();
      });
      const mid = await game((g) => g.ctx.quests.dialogueState());
      assert.ok(mid && mid.nodeId === 'talk', 'the chosen branch is shown');
      for (let i = 0; i < 4 && (await game((g) => g.top())) === 'dialogue'; i++) await tap(page, '.ui-dlgpanel');
      assert.equal(await game((g) => g.top()), 'hud', 'the dialogue ended');
    },
  },
  {
    name: 'ui-dialogue-skip',
    async run({ page, game, assert, shot }) {
      const r0 = await game((g) => {
        g.ctx.quests.talk('mq1_wake', {});
        g.render();
        const b = document.querySelector('[data-screen=dialogue] .ui-dlgskip');
        const r = b.getBoundingClientRect();
        const p = document.querySelector('.ui-dlgpanel').getBoundingClientRect();
        return { top: g.top(), node: g.ctx.quests.dialogueState().nodeId, hidden: b.hidden, w: r.width, h: r.height, y: r.top, panelTop: p.top };
      });
      assert.equal(r0.top, 'dialogue');
      assert.equal(r0.hidden, false, 'Skip shown on a line without a choice');
      assert.ok(r0.w >= 48 && r0.h >= 48, 'Skip is a 48 px target ' + r0.w + 'x' + r0.h);
      assert.ok(r0.y + r0.h < r0.panelTop, 'Skip sits above the text panel');
      await shot('ui-dialogue-skip');
      await tap(page, '[data-screen=dialogue] .ui-dlgskip');
      const r1 = await game((g) => {
        g.render();
        return { top: g.top(), open: g.ctx.quests.dialogueOpen };
      });
      assert.equal(r1.open, false, 'Skip ran the rest of the conversation');
      assert.equal(r1.top, 'hud');
      // The keyboard's Back (Esc) skips too.
      const r2 = await game((g) => {
        g.ctx.quests.talk('mq1_wake', {});
        g.render();
        g.press('uiBack');
        g.render();
        return g.ctx.quests.dialogueOpen;
      });
      assert.equal(r2, false, 'uiBack skips');
    },
  },
  {
    name: 'ui-death',
    async run({ page, game, assert, shot }) {
      await game((g) => {
        g.kill(g.player().id);
        g.step(400);
      });
      assert.equal(await game((g) => g.top()), 'death');
      await shot('ui-death');
      assert.equal(await game(() => document.querySelectorAll('[data-screen=death] .ui-btn:not([hidden])').length), 1, 'no Retry after an open-world death');
      await tap(page, '[data-screen=death] .ui-btn');
      const r = await game((g) => {
        g.step(5);
        return { top: g.top(), hp: g.player().hp };
      });
      assert.equal(r.top, 'hud');
      assert.ok(r.hp > 0, 'risen with HP');
      // A lost trial fight offers Retry too (ctx.rpg.canRetry), not only a boss.
      const t = await game((g) => {
        g.ctx.quests.runActions([{ op: 'script', script: 'trial_gauntlet' }]);
        g.step(10);
        g.kill(g.player().id);
        g.step(400);
        return { top: g.top(), can: g.ctx.rpg.canRetry, retry: document.querySelectorAll('[data-screen=death] .ui-btn:not([hidden])').length };
      });
      assert.equal(t.top, 'death');
      assert.equal(t.can, true, 'the trial can be retried');
      assert.equal(t.retry, 2, 'Retry shown for a lost trial');
      await game((g) => {
        g.ctx.ui.close('death');
        g.ctx.rpg.respawn({ retry: false });
        g.step(5);
      });
    },
  },
  {
    name: 'ui-settings',
    async run({ page, game, assert, shot }) {
      const visible = () => {
        const out = [];
        const walk = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          const t = n.textContent.trim();
          if (!t || !/[A-Za-z֐-׿]/.test(t)) continue;
          const el = n.parentElement;
          if (!el || el.closest('[hidden],.ui-glyph,.ui-tabhint,bdi') || !el.getClientRects().length) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          out.push(t);
        }
        return out;
      };
      const start = await game((g) => g.ctx.i18n.lang);
      const other = start === 'he' ? 'en' : 'he';
      await game((g) => {
        g.open('settings');
        g.render();
      });
      const before = await game(visible);
      await tap(page, `[data-screen=settings] [data-lang=${other}]`);
      const after = await game(visible);
      const r = await game((g) => ({ lang: g.ctx.i18n.lang, dir: document.getElementById('app').getAttribute('dir'), setting: g.ctx.save.settings.lang }));
      assert.equal(r.lang, other);
      assert.equal(r.setting, other, 'stored through save.setSetting');
      assert.equal(r.dir, other === 'he' ? 'rtl' : 'ltr');
      const same = after.filter((t) => before.indexOf(t) >= 0 && !/^(עברית|English|EN|עב|RES|\d.*)$/.test(t));
      assert.deepEqual(same, [], 'all visible text changed');
      assert.deepEqual(await game(screenProblems, r.dir), []);
      await game((g) => {
        g.ctx.save.setSetting('textScale', 1.3);
        g.closeAll();
        g.open('pause');
        g.render();
      });
      assert.deepEqual(await game(screenProblems, r.dir), [], 'pause at 130%');
      await shot('ui-settings-130');
      const miss = await game((g) => {
        g.closeAll();
        g.step(2);
        return g.ctx.i18n.missing().filter((k) => !k.startsWith('standin.'));
      });
      assert.deepEqual(miss, [], 'no [key] placeholders');
      const back = await game((g, l) => {
        g.ctx.save.setSetting('lang', l);
        g.render();
        return g.ctx.i18n.lang;
      }, start);
      assert.equal(back, start);
    },
  },
  {
    // "Continue" shows only when a journey exists (the hidden button used to stay visible), and restoring a journey
    // code over an existing journey asks first (S6).
    name: 'ui-title-restore',
    async run({ page, game, assert, shot }) {
      const shown = () => {
        const b = document.querySelector('[data-screen=title] .ui-menu .ui-btn');
        return !!b && getComputedStyle(b).display !== 'none' && b.getClientRects().length > 0;
      };
      const none = await game((g, fn) => {
        g.ctx.save.erase(1);
        g.closeAll();
        g.open('title');
        g.render();
        return (0, eval)('(' + fn + ')')();
      }, shown.toString());
      assert.equal(none, false, 'no journey: no Continue');
      const some = await game((g, fn) => {
        g.save();
        g.closeAll();
        g.open('title');
        g.render();
        return (0, eval)('(' + fn + ')')();
      }, shown.toString());
      assert.equal(some, true, 'a saved journey: Continue');
      const code = await game(async (g) => {
        g.closeAll();
        const c = await g.ctx.save.exportCode();
        g.grantXp(500);
        g.save();
        return c;
      });
      const xp0 = await game((g) => g.ctx.store.state.player.xp + g.ctx.store.state.player.level * 1e6);
      await game((g) => {
        g.open('savecode', { tab: 'restore' });
        g.render();
      });
      await page.locator('[data-screen=savecode] textarea[data-code=in]').fill(code);
      await tap(page, '[data-screen=savecode] .ui-btn.ui-accent:visible');
      const asked = await game((g) => g.top());
      await shot('ui-restore-confirm');
      assert.equal(asked, 'confirm', 'restoring over a journey asks first');
      await tap(page, '[data-screen=confirm] .ui-btn.ui-ghostbtn');
      await page.waitForTimeout(100);
      assert.notEqual(await game((g) => g.top()), 'confirm', 'the confirm closed');
      const kept = await game((g) => g.ctx.store.state.player.xp + g.ctx.store.state.player.level * 1e6);
      assert.equal(kept, xp0, 'declining keeps the journey');
    },
  },
];

const flowScenarios = [];
for (const f of flows) {
  for (const r of FLOW_RUNS) {
    flowScenarios.push({
      name: `${f.name}-${r.lang}`,
      width: r.w,
      height: r.h,
      query: 'lang=' + r.lang,
      async run(h) {
        await h.game((g) => g.step(3));
        await f.run({ ...h, shot: (n) => h.shot(`${n}-${r.lang}`) });
        const errs = await h.game((g) => g.errors.slice());
        h.assert.deepEqual(errs, [], 'no errors');
      },
    });
  }
}

export const scenarios = [...hudScenarios, promptScenario, ...screenScenarios, ...flowScenarios];
