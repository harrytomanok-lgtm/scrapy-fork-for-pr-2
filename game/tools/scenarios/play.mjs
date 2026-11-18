/**
 * Integration play-through scenarios: the game played the way the player plays it.
 * - play-first-ten-*: from the title screen, in Hebrew, with synthetic touch on the real controls, through every
 *   tutorial beat of GDD 2 to the end of MQ1 and the start of MQ2 (portrait 400x860 and landscape 844x390).
 * - play-main-path: MQ2 to MQ7 and the ending through the real events, with debug shortcuts for travel and damage.
 * - play-sandbox: three scripted minutes of free play.
 * - play-fairness: a level-1 touch player who only pushes the stick and taps Attack against three level-1 enemies.
 * Run: node tools/scenarios.mjs play [--only name]
 */

/**
 * In the page: install `window.__P`, the synthetic-touch and diagnostics helpers. Every helper steps the sim in
 * chunks (no render per tick) and dispatches real PointerEvents on the real controls.
 */
function installHelpers() {
  const g = /** @type {any} */ (window).__GAME__;
  const ctx = g.ctx;
  const q = (s) => document.querySelector(s);
  const P = {};
  P.ctl = (a) => q('.ctl-touch [data-action="' + a + '"]');
  P.visible = (e) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(e).display !== 'none';
  };
  P.centre = (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  P.fire = (e, type, id, x, y) => e.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: false, clientX: x, clientY: y, bubbles: true, cancelable: true,
    buttons: type === 'pointerup' ? 0 : 1,
  }));
  /** Step the sim in chunks of at most 20 ticks, without a render per tick. */
  P.sim = (n) => {
    while (n > 0) {
      const k = Math.min(n, 20);
      ctx.loop.stepSim(k);
      n -= k;
    }
  };
  P.nid = 100;
  /** Tap a touch control. False when it is not shown. */
  P.tap = (a, hold = 2) => {
    const e = P.ctl(a);
    if (!P.visible(e)) return false;
    const c = P.centre(e);
    const id = P.nid++;
    P.fire(e, 'pointerdown', id, c.x, c.y);
    P.sim(hold);
    P.fire(e, 'pointerup', id, c.x, c.y);
    P.sim(1);
    return true;
  };
  P.held = {};
  P.down = (a) => {
    const e = P.ctl(a);
    if (!P.visible(e)) return false;
    const c = P.centre(e);
    const id = P.nid++;
    P.held[a] = id;
    P.fire(e, 'pointerdown', id, c.x, c.y);
    return true;
  };
  P.up = (a) => {
    const e = P.ctl(a);
    const id = P.held[a];
    if (!e || id === undefined) return;
    const c = P.centre(e);
    P.fire(e, 'pointerup', id, c.x, c.y);
    delete P.held[a];
  };
  // The floating stick: one pointer held in the move zone.
  P.stk = { id: -1, x: 0, y: 0 };
  /** Push the stick: sx right, sy forward, both -1..1. */
  P.stick = (sx, sy) => {
    const z = P.ctl('move');
    if (P.stk.id < 0) {
      const r = z.getBoundingClientRect();
      P.stk.id = P.nid++;
      P.stk.x = r.left + Math.min(110, r.width / 2);
      P.stk.y = r.bottom - Math.min(120, r.height / 2);
      P.fire(z, 'pointerdown', P.stk.id, P.stk.x, P.stk.y);
    }
    P.fire(z, 'pointermove', P.stk.id, P.stk.x + sx * 46, P.stk.y - sy * 46);
  };
  P.stickOff = () => {
    if (P.stk.id < 0) return;
    const z = P.ctl('move');
    P.fire(z, 'pointerup', P.stk.id, P.stk.x, P.stk.y);
    P.stk.id = -1;
  };
  /** Stick direction toward a world point, relative to the camera. */
  P.steer = (x, z, mag = 1) => {
    const p = ctx.player;
    const dx = x - p.pos.x;
    const dz = z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const yaw = ctx.cam.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const sx = (dx * -fz + dz * fx) / l;
    const sy = (dx * fx + dz * fz) / l;
    P.stick(sx * mag, sy * mag);
  };
  /** Walk (or fly) toward a point with the stick until within r; returns the distance left. */
  P.walkTo = (x, z, r, maxTicks = 1200) => {
    let t = 0;
    let d = 1e9;
    for (; t < maxTicks; t += 6) {
      const p = ctx.player;
      d = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (d <= r) break;
      P.steer(x, z);
      P.sim(6);
    }
    P.stickOff();
    P.sim(2);
    return d;
  };
  /** Drag in the camera zone: dx right, dy down (px), in n moves. */
  P.drag = (dx, dy, n = 8) => {
    const z = P.ctl('look');
    const r = z.getBoundingClientRect();
    const x0 = r.left + r.width * 0.6;
    const y0 = r.top + r.height * 0.5;
    const id = P.nid++;
    P.fire(z, 'pointerdown', id, x0, y0);
    for (let i = 1; i <= n; i++) {
      P.fire(z, 'pointermove', id, x0 + (dx * i) / n, y0 + (dy * i) / n);
      P.sim(1);
    }
    P.fire(z, 'pointerup', id, x0 + dx, y0 + dy);
  };
  /** Turn the camera toward a world point with drags in the camera zone (0.25 deg per px). */
  P.faceCam = (x, z) => {
    for (let k = 0; k < 4; k++) {
      const p = ctx.player;
      const want = Math.atan2(x - p.pos.x, z - p.pos.z);
      let d = want - ctx.cam.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < 0.08) return true;
      // lookX positive turns right; yaw grows to the left (east of south), so a drag right lowers the yaw.
      const px = Math.max(-300, Math.min(300, (-d * 180) / Math.PI / 0.25));
      P.drag(px, 0, 10);
      P.sim(4);
    }
    return false;
  };
  /** Screen position of a world point, or null when behind the camera. */
  P.project = (x, y, z) => {
    const cam = ctx.three.camera;
    cam.updateMatrixWorld();
    const m = cam.matrixWorldInverse.elements;
    const pm = cam.projectionMatrix.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const cx = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12];
    const cy = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13];
    const cw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15];
    if (cw <= 0.01) return null;
    const canvas = ctx.three.renderer.domElement.getBoundingClientRect();
    return { x: canvas.left + ((cx / cw + 1) / 2) * canvas.width, y: canvas.top + ((1 - cy / cw) / 2) * canvas.height };
  };
  /** Tap on an entity in the camera zone (touch lock-on). */
  P.tapEnt = (id) => {
    const e = ctx.ents.get(id);
    if (!e) return false;
    g.render();
    const s = P.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
    if (!s) return false;
    const z = P.ctl('look');
    const pid = P.nid++;
    P.fire(z, 'pointerdown', pid, s.x, s.y);
    P.sim(2);
    P.fire(z, 'pointerup', pid, s.x, s.y);
    P.sim(1);
    return ctx.combat.target() === id;
  };
  /** Tap through every open dialogue (the panel, or the first choice). Returns the lines seen. */
  P.dlg = (max = 60) => {
    const lines = [];
    for (let i = 0; i < max && ctx.ui.top() === 'dialogue'; i++) {
      g.render();
      const line = q('.ui-dlgline');
      const ch = document.querySelector('[data-screen=dialogue] .ui-choices:not([hidden]) button');
      if (ch) {
        ch.click();
      } else {
        q('.ui-dlgpanel').click();
        if (line && lines[lines.length - 1] !== line.textContent) lines.push(line.textContent);
      }
      g.render();
    }
    return lines;
  };
  /** Run the sim and drain dialogues for n ticks. */
  P.run = (n) => {
    for (let t = 0; t < n; t += 10) {
      P.sim(10);
      if (ctx.ui.top() === 'dialogue') P.dlg();
    }
  };
  P.step = (qid) => {
    const a = ctx.quests.active().find((x) => x.questId === qid);
    return a ? a.stepId : ctx.quests.state(qid);
  };
  /** What a player sees: top screen, tracker, prompt, ghost alignment, untranslated text, overlaps. */
  P.look = () => {
    g.render();
    const out = { top: ctx.ui.top(), problems: [] };
    const tr = q('.ui-tracker');
    out.tracker = tr && !tr.hidden ? tr.innerText.replace(/\s+/g, ' ').trim() : '';
    const pr = q('.ui-prompt');
    out.prompt = pr && !pr.hidden ? pr.innerText.replace(/\s+/g, ' ').trim() : '';
    const ghost = q('.ui-ghost');
    out.ghost = !!(ghost && !ghost.hidden);
    const pill = q('.ui-pill');
    out.pill = pill && !pill.hidden ? pill.innerText.trim() : '';
    const app = document.getElementById('app');
    const text = app.innerText || '';
    const ph = text.match(/\[[a-z]+\.[a-zA-Z0-9_.]+\]/g);
    if (ph) out.problems.push('placeholders: ' + ph.slice(0, 4).join(' '));
    if (ctx.i18n.lang === 'he') {
      const walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const t = n.textContent.trim();
        if (!/[A-Za-z]{3,}/.test(t) || /^(RES|HP|XP|Lv)\b/.test(t)) continue;
        const el = n.parentElement;
        if (!el || el.closest('[hidden],bdi,.ui-glyph,svg,.ui-logo-alt') || !el.getClientRects().length) continue;
        if (getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).opacity === '0') continue;
        out.problems.push('english: ' + t.slice(0, 40));
      }
    }
    // HUD pieces against each other and against the touch controls
    const d = g.cmd.ui();
    const ps = d.pieces.filter((p) => p.name !== 'xp');
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (hit(ps[i], ps[j])) out.problems.push('overlap ' + ps[i].name + ' x ' + ps[j].name);
    for (const p of d.pieces) {
      if (p.x < -0.5 || p.y < -0.5 || p.x + p.w > innerWidth + 0.5 || p.y + p.h > innerHeight + 0.5) out.problems.push(p.name + ' outside the viewport');
      for (const el of document.querySelectorAll('.ctl-touch [data-action]')) {
        const a = el.getAttribute('data-action');
        if (a === 'move' || a === 'look' || !P.visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (hit(p, { x: r.left, y: r.top, w: r.width, h: r.height })) out.problems.push(p.name + ' x control ' + a);
      }
    }
    return out;
  };
  /** @type {any} */ (window).__P = P;
  return true;
}

/** Ring gates spawned by the tutorial scripts, observed on env.spawnProp (positions only). */
function watchRings() {
  const ctx = /** @type {any} */ (window).__GAME__.ctx;
  const P = /** @type {any} */ (window).__P;
  P.rings = [];
  const env = ctx.env;
  const orig = env.spawnProp;
  env.spawnProp = function (kind, x, y, z, opts) {
    const h = orig.call(this, kind, x, y, z, opts);
    if (kind === 'ringGate') P.rings.push({ x, y, z, yaw: opts && opts.yaw ? opts.yaw : 0 });
    return h;
  };
  return true;
}

/**
 * Fly through the recorded rings `from..to-1`: a teleport shortens the trip to 18 m before each ring, then the stick
 * (and the camera, by drags) carries the player through it.
 */
function flyRings(g, a) {
  const P = /** @type {any} */ (window).__P;
  const ctx = g.ctx;
  const log = [];
  for (let i = a.from; i < a.to; i++) {
    const r = P.rings[i];
    const yaw = r.yaw;
    const sx = r.x - Math.sin(yaw) * 18;
    const sz = r.z - Math.cos(yaw) * 18;
    g.teleport(sx, sz, { y: r.y - 1.6, yaw, fly: true });
    ctx.cam.setOrbit(yaw, ctx.cam.pitch);
    P.sim(2);
    let t = 0;
    const before = g.events(['race:gate']).length;
    for (; t < 240; t += 4) {
      const p = ctx.player;
      // climb or sink toward the ring height with Jump / Descend held, steer with the stick
      const dy = r.y - 1 - p.pos.y;
      if (dy > 1.2) {
        if (P.held.jump === undefined) P.down('jump');
      } else if (P.held.jump !== undefined) P.up('jump');
      if (dy < -1.2) {
        if (P.held.descend === undefined) P.down('descend');
      } else if (P.held.descend !== undefined) P.up('descend');
      P.steer(r.x + Math.sin(yaw) * 10, r.z + Math.cos(yaw) * 10, a.mag || 1);
      P.sim(4);
      if (g.events(['race:gate']).length > before) break;
    }
    P.up('jump');
    P.up('descend');
    log.push({ i, ticks: t, passed: g.events(['race:gate']).length > before, mode: ctx.player.move.mode, boost: ctx.player.move.boost });
  }
  P.stickOff();
  P.sim(2);
  return log;
}

/** Shared body of play-first-ten for one orientation. */
function firstTen(name, w, h) {
  return {
    name,
    width: w,
    height: h,
    touch: true,
    query: 'autoplay=1&tutorial=1&lang=he&quality=low',
    async run({ page, game, assert, shot }) {
      const report = [];
      let n = 0;
      const look = async (tag) => {
        const r = await game(() => window.__P.look());
        const file = `${name}-${String(++n).padStart(2, '0')}-${tag}`;
        await shot(file);
        report.push({ shot: file, ...r });
        console.log(`    [${file}] top=${r.top} tracker="${r.tracker}" prompt="${r.prompt}" ghost=${r.ghost} pill="${r.pill}"` + (r.problems.length ? ' PROBLEMS: ' + r.problems.join('; ') : ''));
        return r;
      };
      // The test journey that boot starts is ended; the player arrives at the title screen.
      await game((g) => {
        g.pause();
        g.ctx.session.end({ toTitle: false });
        g.closeAll();
        g.open('title');
        g.render();
      });
      await game(installHelpers);
      await game(watchRings);
      await game((g) => g.setDevice('touch'));
      await look('title');
      assert.equal(await game((g) => g.top()), 'title');
      // New Journey -> the choices -> Start, with real taps.
      await page.tap('[data-screen=title] .ui-menu .ui-btn:nth-child(2)');
      assert.equal(await game((g) => g.top()), 'newgame');
      await page.tap('[data-screen=newgame] .ui-slot:nth-child(2)');
      await page.tap('[data-screen=newgame] .ui-chipbtn[data-value=f]');
      await page.tap('[data-screen=newgame] .ui-chipbtn[data-value=warrior]');
      await look('newgame');
      await page.tap('[data-screen=newgame] .ui-btn.ui-accent');
      const s0 = await game((g) => {
        const P = window.__P;
        P.sim(30);
        return { top: g.top(), mq1: P.step('mq1'), preset: g.state().player.preset, gender: g.state().player.gender, diff: g.state().player.difficulty, lv: g.ctx.rpg.level };
      });
      assert.equal(s0.mq1, 's1', 'MQ1 starts with the new journey');
      assert.equal(s0.gender, 'f');
      // The opening: Sela's first line, tapped through.
      await look('opening');
      const open = await game((g) => window.__P.dlg());
      console.log('    opening lines: ' + JSON.stringify(open));

      // Beat 1: move to the post with the stick.
      await game((g) => window.__P.sim(10));
      const b1 = await look('move');
      assert.ok(b1.prompt && b1.ghost, 'the move prompt and its ghost ring are shown');
      const mv = await game((g) => {
        const P = window.__P;
        const post = g.ctx.quests.objects().find((o) => o.id === 'training_post');
        const p = g.ctx.player;
        // a short teleport keeps the walk to about 12 m
        const d0 = Math.hypot(post.x - p.pos.x, post.z - p.pos.z);
        if (d0 > 14) {
          const k = 12 / d0;
          g.teleport(post.x - (post.x - p.pos.x) * k, post.z - (post.z - p.pos.z) * k, { yaw: Math.atan2(post.x - p.pos.x, post.z - p.pos.z) });
          P.sim(3);
        }
        P.faceCam(post.x, post.z);
        const left = P.walkTo(post.x, post.z, 3.2, 900);
        P.run(20);
        return { d0, left, step: P.step('mq1') };
      });
      console.log('    move: ' + JSON.stringify(mv));
      assert.equal(mv.step, 's2', 'walking to the post completes the move beat');

      // Beat 2: strike the post three times with Attack.
      const b2 = await look('attack');
      const atk = await game((g) => {
        const P = window.__P;
        let taps = 0;
        for (; taps < 30 && P.step('mq1') === 's2'; taps++) {
          const post = g.ctx.quests.objects().find((o) => o.id === 'training_post');
          if (post && taps % 3 === 0) {
            P.steer(post.x, post.z, 0.3);
            P.sim(2);
            P.stickOff();
          }
          P.tap('attack');
          P.sim(16);
        }
        P.sim(10);
        return { taps, step: P.step('mq1'), top: g.top() };
      });
      console.log('    attack: ' + JSON.stringify(atk) + ' prompt was "' + b2.prompt + '"');
      assert.equal(atk.step, 's3', 'Attack breaks the post');

      // Beat 3: the Ora wakes; Jump, Jump again to take off, three rings.
      await look('wake');
      await game((g) => window.__P.dlg());
      await game((g) => window.__P.sim(5));
      const b3 = await look('jump');
      const fly = await game((g) => {
        const P = window.__P;
        const pre = { ctx: g.ctx.input.context, busy: g.ctx.cam.busy, mode: g.ctx.player.move.mode, grounded: g.ctx.player.move.grounded, cstate: g.ctx.player.combat.state, top: g.top(), on: !!document.querySelector('.ctl-touch.ctl-on') };
        const tapped = P.tap('jump');
        const trace = [];
        for (let i = 0; i < 10; i++) {
          P.sim(1);
          trace.push(g.ctx.player.move.mode[0] + Math.round(g.ctx.player.vel.y));
        }
        const air = g.ctx.player.move.mode;
        g.render();
        const prompt = document.querySelector('.ui-prompt').innerText;
        P.tap('jump');
        P.sim(20);
        P.dlg();
        return { air, prompt, mode: g.ctx.player.move.mode, rings: P.rings.length, pre, tapped, trace };
      });
      console.log('    takeoff: ' + JSON.stringify(fly) + ' jump prompt "' + b3.prompt + '"');
      assert.equal(fly.mode, 'fly', 'two Jump taps take off');
      await look('rings');
      const r3 = await game(flyRings, { from: 0, to: 3 });
      await game((g) => window.__P.run(10));
      console.log('    rings: ' + JSON.stringify(r3));
      assert.equal(await game(() => window.__P.step('mq1')), 's4', 'three rings');

      // Beat 4: boost through the longer ring line (double tap on Dash latches the boost).
      const b4 = await look('boost');
      const boost = await game((g) => {
        const P = window.__P;
        P.stick(0, 1);
        P.sim(4);
        P.tap('dash');
        P.sim(4);
        P.tap('dash');
        P.sim(10);
        g.render();
        const latched = P.ctl('dash').classList.contains('ctl-latched');
        const b = g.ctx.player.move.boost;
        return { latched, boost: b };
      });
      const r4 = await game(flyRings, { from: 3, to: 8 });
      await game((g) => window.__P.run(10));
      console.log('    boost: ' + JSON.stringify(boost) + ' ' + JSON.stringify(r4) + ' prompt "' + b4.prompt + '"');
      assert.equal(await game(() => window.__P.step('mq1')), 's5', 'the boost ring line');

      // Beat 5: four Ember Wisps; Bolt with the soft lock.
      await game((g) => window.__P.run(20));
      const b5 = await look('wisps');
      const wisps = await game((g) => {
        const P = window.__P;
        let taps = 0;
        for (; taps < 120 && P.step('mq1') === 's5'; taps++) {
          P.tap('bolt');
          P.sim(12);
          if (g.ctx.ui.top() === 'dialogue') P.dlg();
        }
        P.run(20);
        const p = g.ctx.player;
        const ws = g.ctx.ents.list('enemy').filter((e) => e.alive).map((e) => ({ d: e.defId, hp: Math.round(e.stats.hp), dx: Math.round(e.pos.x - p.pos.x), dy: Math.round(e.pos.y - p.pos.y), dz: Math.round(e.pos.z - p.pos.z) }));
        return { taps, step: P.step("mq1"), hp: Math.round(g.ctx.player.stats.hp), mode: g.ctx.player.move.mode, ws, ora: Math.round(p.stats.ora) };
      });
      console.log('    wisps: ' + JSON.stringify(wisps) + ' prompt "' + b5.prompt + '"');
      assert.equal(wisps.step, 's6', 'four wisps down with Bolt');

      // Beat 6: hold Gather to full Ora -> the Ora Awakening.
      const b6 = await look('gather');
      const aw = await game((g) => {
        const P = window.__P;
        const res0 = g.ctx.rpg.resonance();
        const ok = P.down('gather');
        let t = 0;
        for (; t < 60 * 30 && P.step('mq1') === 's6' && !g.state().player.awakened; t += 10) P.sim(10);
        const banner = document.querySelector('.ui-banner') ? document.querySelector('.ui-banner').innerText : '';
        P.up('gather');
        return { ok, t, res0, awakened: g.state().player.awakened, banner };
      });
      await look('awakening');
      const aw2 = await game((g) => {
        const P = window.__P;
        P.run(200);
        return { step: P.step('mq1'), res: g.ctx.rpg.resonance() };
      });
      console.log('    awakening: ' + JSON.stringify(aw) + ' ' + JSON.stringify(aw2) + ' prompt "' + b6.prompt + '"');
      assert.ok(aw.ok, 'the Gather button is shown');
      assert.ok(aw.awakened, 'holding Gather at full Ora awakens');
      assert.equal(aw2.step, 's7');

      // Beat 7: two Tusk Boars; tap to lock, Attack strings, Dash on the red ring, hold Attack for the Breaker.
      await game((g) => window.__P.run(30));
      const b7 = await look('boars');
      const boars = await game((g) => {
        const P = window.__P;
        const ctx = g.ctx;
        const out = { locks: 0, flicker: 0, breaker: 0, taps: 0, red: 0, hpMin: 1e9, landTicks: 0 };
        // The Awakening leaves the player in the air: hold Descend (the prompt says so) until landed.
        g.render();
        out.landPrompt = document.querySelector('.ui-prompt').innerText;
        if (ctx.player.move.mode === 'fly') {
          P.down('descend');
          for (; out.landTicks < 60 * 20 && ctx.player.move.mode === 'fly'; out.landTicks += 10) P.sim(10);
          P.up('descend');
          P.sim(20);
        }
        g.render();
        out.lockPrompt = document.querySelector('.ui-prompt').innerText;
        let redSeen = g.events(['combat:telegraph']).length;
        const t0 = ctx.time.tick;
        while (ctx.time.tick - t0 < 60 * 90 && P.step('mq1') === 's7') {
          const p = ctx.player;
          out.hpMin = Math.min(out.hpMin, p.stats.hp);
          if (ctx.ui.top() === 'death') break;
          let boar = null;
          for (const e of ctx.ents.list('enemy')) if (e.alive && e.questTag === 'mq1_boars' && (!boar || e.id < boar.id)) boar = e;
          if (!boar) {
            P.sim(10);
            continue;
          }
          if (ctx.combat.target() !== boar.id) {
            P.faceCam(boar.pos.x, boar.pos.z);
            if (P.tapEnt(boar.id)) out.locks++;
          }
          const tel = g.events(['combat:telegraph']);
          let red = false;
          for (let i = redSeen; i < tel.length; i++) if (tel[i].payload.kind === 'red') red = true;
          redSeen = tel.length;
          if (red) {
            out.red++;
            P.tap('dash');
            out.flicker++;
            P.sim(10);
            continue;
          }
          const d = Math.hypot(boar.pos.x - p.pos.x, boar.pos.z - p.pos.z);
          if (d > 3.5) {
            P.steer(boar.pos.x, boar.pos.z);
            P.sim(6);
            continue;
          }
          P.stickOff();
          if (out.taps % 6 === 5) {
            // hold Attack = Breaker
            P.down('attack');
            P.sim(50);
            P.up('attack');
            P.sim(30);
            out.breaker++;
          } else {
            P.tap('attack');
            P.sim(10);
          }
          out.taps++;
          if (ctx.ui.top() === 'dialogue') P.dlg();
        }
        P.stickOff();
        P.run(30);
        out.step = P.step('mq1');
        out.level = ctx.rpg.level;
        out.top = ctx.ui.top();
        out.hpMax = p0hpMax();
        function p0hpMax() { return ctx.player.stats.hpMax; }
        return out;
      });
      console.log('    boars: ' + JSON.stringify(boars) + ' prompt "' + b7.prompt + '"');
      await look('level2');
      assert.equal(boars.step, 's8', 'the boars are down');
      assert.ok(boars.level >= 2, 'level 2 lands with the fight');

      // Beat 8: to Sparkstead; touch the Ringstone (the interact pill).
      const ring = await game((g) => {
        const P = window.__P;
        P.run(30);
        const rs = g.pois('ringstone').find((x) => x.id === 'ringstone_sparkstead');
        g.teleport(rs.x - 6, rs.z - 6, { yaw: Math.atan2(10, 17) });
        P.sim(5);
        // The stone (and its interactable) stands 4 m east and 10 m south of the POI point (ARCHITECTURE 11).
        const tx = rs.x + 4;
        const tz = rs.z + 7;
        P.faceCam(tx, tz);
        const left = P.walkTo(tx, tz, 2.5, 600);
        P.sim(4);
        return { left, focus: g.ctx.quests.focus, dlg: g.ctx.quests.dialogueState(), top: g.top(), p: [g.ctx.player.pos.x, g.ctx.player.pos.y, g.ctx.player.pos.z, g.ctx.player.move.mode] };
      });
      const b8 = await look('ringstone');
      const done = await game((g) => {
        const P = window.__P;
        const pill = document.querySelector('.ui-pill');
        const shown = pill && !pill.hidden;
        if (shown) pill.click();
        P.sim(10);
        const lines = P.dlg();
        P.run(60);
        return { shown, lines: lines.length, mq1: g.ctx.quests.state('mq1'), mq2: P.step('mq2'), tracked: g.ctx.quests.tracked, level: g.ctx.rpg.level };
      });
      console.log('    ringstone: ' + JSON.stringify(ring) + ' ' + JSON.stringify(done) + ' pill "' + b8.pill + '"');
      assert.ok(done.shown, 'the interact pill appears at the Ringstone');
      assert.equal(done.mq1, 'done', 'MQ1 complete');
      assert.equal(done.mq2, 's1', 'MQ2 starts');
      const fin = await look('mq2');
      assert.ok(fin.tracker.length > 0, 'the tracker shows MQ2');
      const all = report.flatMap((r) => r.problems.map((p) => r.shot + ': ' + p));
      assert.deepEqual(all, [], 'no layout, translation or overlap problems');
    },
  };
}

/**
 * In the page: `window.__M`, the main-path drivers on top of `__P`. Travel is by teleport (debug), but every quest
 * step is completed through its real event: dialogues tapped through the UI, kills and destroys by the player's
 * damage, the bosses' real phases, interacts by the Interact action.
 */
function installMain() {
  const g = /** @type {any} */ (window).__GAME__;
  const ctx = g.ctx;
  const P = /** @type {any} */ (window).__P;
  const M = { log: [], deaths: 0, phases: {}, fallbacks: [] };
  const note = (s) => M.log.push(s);
  M.step = (qid) => {
    const a = ctx.quests.active().find((x) => x.questId === qid);
    return a ? a.stepId : ctx.quests.state(qid);
  };
  M.def = (qid) => {
    const a = ctx.quests.active().find((x) => x.questId === qid);
    if (!a) return null;
    return ctx.defs.find('quest', qid).steps[a.stepIndex];
  };
  /** Run the sim, tapping through dialogues; stop early when the death screen is up. */
  M.run = (n) => {
    for (let t = 0; t < n; t += 10) {
      if (ctx.ui.top() === 'dialogue') P.dlg();
      if (ctx.ui.top() === 'death') return false;
      if (ctx.ui.top() === 'ending') return false;
      P.sim(10);
    }
    if (ctx.ui.top() === 'dialogue') P.dlg();
    return true;
  };
  M.go = (x, z, o) => {
    g.teleport(x, z, o || {});
    M.run(20);
  };
  M.marker = (qid) => {
    for (const m of ctx.quests.markers()) if (m.questId === qid) return { x: m.x, z: m.z };
    return null;
  };
  /** Walk up to an NPC and press Interact; the dialogue is tapped through. */
  M.talk = (qid, npc) => {
    const mk = M.marker(qid);
    if (mk) M.go(mk.x + 2.5, mk.z + 2.5);
    M.run(70);
    const nid = ctx.quests.npcEntity(npc);
    const e = nid ? ctx.ents.get(nid) : null;
    if (e) {
      g.teleport(e.pos.x + 2, e.pos.z + 2);
      M.run(12);
    }
    let how = 'interact';
    if (ctx.quests.focus) {
      g.press('interact');
      P.sim(2);
    }
    if (!ctx.quests.dialogueOpen) {
      how = 'talkTo';
      M.fallbacks.push(qid + ':' + npc + ' focus=' + ctx.quests.focus + ' npc=' + !!e);
      ctx.quests.talkTo(npc);
    }
    const lines = P.dlg(120);
    M.run(10);
    note(qid + ' talk ' + npc + ' (' + how + ', ' + lines.length + ' lines)');
  };
  /** Damage enemies that match until the step moves on. */
  M.kill = (qid, match, spawn) => {
    const s0 = M.step(qid);
    for (let k = 0; k < 60 && M.step(qid) === s0; k++) {
      let any = false;
      for (const e of ctx.ents.list('enemy')) {
        if (!e.alive || !match(e)) continue;
        any = true;
        g.teleport(e.pos.x + 3, e.pos.z + 3);
        P.sim(2);
        g.damage(e.id, 0.6);
        P.sim(4);
        if (e.alive && e.stats.hp > 0) g.damage(e.id, 0.6);
        P.sim(2);
      }
      if (!any && spawn) spawn();
      M.run(20);
    }
    note(qid + ' kill -> ' + M.step(qid));
  };
  /** Fight a boss the quest started: damage in chunks so every phase plays. */
  M.boss = (qid, bossId, onTick) => {
    const s0 = M.step(qid);
    const ph = [];
    let boss = null;
    for (let k = 0; k < 30 && !boss; k++) {
      boss = ctx.ents.list('boss').find((b) => b.alive && b.defId === bossId) || null;
      if (!boss) M.run(10);
    }
    if (!boss) {
      note(qid + ' boss ' + bossId + ' never spawned');
      return;
    }
    const id = boss.id;
    for (let k = 0; k < 400 && M.step(qid) === s0; k++) {
      const b = ctx.ents.get(id);
      if (onTick && onTick(b)) continue;
      if (b && b.alive && (b.tags & 64) === 0) {
        g.teleport(b.pos.x + 7, b.pos.z + 7, { alt: b.move && b.move.mode === 'fly' ? b.pos.y - g.heightAt(b.pos.x, b.pos.z) : 0 });
        P.sim(2);
        g.damage(id, 0.05);
      }
      if (!M.run(20)) break;
    }
    for (const e of g.events(['boss:phase'])) if (e.payload.bossId === bossId) ph.push(e.payload.phase);
    M.phases[bossId] = ph;
    const bb = ctx.ents.get(id);
    note(qid + ' boss ' + bossId + ' phases ' + JSON.stringify(ph) + ' -> ' + M.step(qid) + (bb && bb.alive ? ' (alive hp ' + Math.round(bb.stats.hp) + '/' + Math.round(bb.stats.hpMax) + ' tags ' + bb.tags + ' cs ' + bb.combat.state + ')' : ''));
  };
  M.destroy = (qid, objId) => {
    const s0 = M.step(qid);
    for (let k = 0; k < 300 && M.step(qid) === s0; k++) {
      const o = ctx.quests.objects().find((x) => x.id === objId);
      if (!o) break;
      const e = o.entId ? ctx.ents.get(o.entId) : null;
      if (!e) {
        M.go(o.x + 14, o.z + 14);
        continue;
      }
      const d = Math.hypot(e.pos.x - ctx.player.pos.x, e.pos.z - ctx.player.pos.z);
      if (d > 30) g.teleport(e.pos.x + 14, e.pos.z + 14);
      g.damage(e.id, 0.08);
      if (!M.run(20)) break;
    }
    note(qid + ' destroy ' + objId + ' -> ' + M.step(qid));
  };
  M.interact = (qid, objId) => {
    const o = ctx.quests.objects().find((x) => x.id === objId);
    if (!o) return note(qid + ' no object ' + objId);
    M.go(o.x + 1.5, o.z + 1.5);
    const f = ctx.quests.focus;
    g.press('interact');
    M.run(10);
    note(qid + ' interact ' + objId + ' focus=' + f);
  };
  M.gotoStep = (qid) => {
    const mk = M.marker(qid);
    if (mk) M.go(mk.x, mk.z);
    M.run(30);
    note(qid + ' goto -> ' + M.step(qid));
  };
  /** Death: watch for the death screen and tap a button (Rise or Retry). */
  M.deathTap = (which) => {
    // The death screen opens from the ui frame, so frames are rendered while waiting.
    for (let k = 0; k < 60 && ctx.ui.top() !== 'death'; k++) g.step(10);
    if (ctx.ui.top() !== 'death') return false;
    g.render();
    const bs = document.querySelectorAll('[data-screen=death] .ui-btn');
    const b = which === 'retry' ? bs[1] : bs[0];
    if (!b || b.hidden) return false;
    b.click();
    M.deaths++;
    M.run(20);
    return true;
  };
  /** Bring the player to a level with XP grants (each level-up is a real rpg:levelUp). */
  M.level = (l) => {
    for (let k = 0; k < 400 && ctx.rpg.level < l; k++) g.grantXp(40 * ctx.rpg.level * ctx.rpg.level + 100);
    M.run(10);
  };
  /** @type {any} */ (window).__M = M;
  return true;
}

/** The MQ7 tether phase: carry each thread from its anchor to the Spire base with Interact. */
function tetherTick(b) {
  const g = /** @type {any} */ (window).__GAME__;
  const ctx = g.ctx;
  const M = /** @type {any} */ (window).__M;
  const a = ctx.quests.active().find((x) => x.questId === 'mq7');
  if (!a || a.objectiveKey !== 'quest.mq7.tether') return false;
  M.tethers = (M.tethers || 0) + 1;
  for (const d of ctx.defs.all('object')) {
    if (!d.id.startsWith('tether_')) continue;
    g.teleport(d.x + 1, d.z + 1);
    M.run(4);
    if (ctx.quests.focus !== d.id) continue;
    g.press('interact');
    M.run(4);
    g.teleport(6, 6, { alt: 4 });
    M.run(6);
  }
  M.run(10);
  return true;
}

const mainPath = {
  name: 'play-main-path',
  width: 844,
  height: 390,
  touch: true,
  query: 'lang=he&quality=low',
  async run({ page, game, assert, shot, harness }) {
    const setup = async () => {
      await game(installHelpers);
      await game(installMain);
      await game((g) => {
        g.setDevice('touch');
        g.god(true);
      });
    };
    await setup();
    // A frame after a long teleport chain builds many terrain chunks: warm up first, retry once under load.
    const snap = async (name) => {
      await game((g) => {
        g.ctx.world.flushBuilds();
        g.render();
        g.render();
      });
      try {
        await shot(name);
      } catch (err) {
        console.log('    shot retry ' + name + ': ' + String(err).split('\n')[0]);
        await shot(name);
      }
    };
    const tap = async (sel) => {
      await game((g) => g.render());
      await page.tap(sel);
      await game((g) => g.render());
    };

    // ---- MQ2: Dov, Mira (equip the wraps with taps), the raid, Durn (die once, Retry), Kerrin, Siphon I, Sela.
    const a = await game(() => {
      const M = window.__M;
      M.talk('mq2', 'dov');
      M.talk('mq2', 'mira');
      return { step: M.step('mq2'), wraps: window.__GAME__.ctx.rpg.count('training_wraps'), log: M.log.slice() };
    });
    console.log('    ' + JSON.stringify(a));
    assert.equal(a.step, 's3', 'Dov and Mira talked to');
    await game((g) => {
      g.open('inventory');
      g.render();
    });
    await tap('[data-screen=inventory] .ui-cell[data-item=training_wraps]');
    await tap('[data-screen=inventory] [data-act=equip]');
    const eq = await game((g) => {
      const w = g.state().inv.equip.wraps;
      g.closeAll();
      return w;
    });
    assert.ok(eq, 'the Training Wraps are equipped with taps');
    const b = await game((g) => {
      const M = window.__M;
      M.kill('mq2', (e) => e.questTag === 'mq2_raid');
      // Durn: die once in the arena and take the Retry.
      let boss = null;
      for (let k = 0; k < 20 && !boss; k++) {
        boss = g.ctx.ents.list('boss').find((x) => x.alive) || null;
        if (!boss) M.run(10);
      }
      if (boss) g.teleport(boss.pos.x + 6, boss.pos.z + 6);
      M.dbg = { boss: !!boss, bosses: g.ctx.ents.list('boss').map((x) => x.defId + x.alive), top: g.top(), q: M.step('mq2') };
      M.run(10);
      g.god(false);
      g.kill(g.player().id);
      const retried = M.deathTap('retry');
      g.god(true);
      const restarted = g.events(['boss:start']).filter((e) => e.payload.bossId === 'durn').length;
      M.boss('mq2', 'durn');
      M.run(200);
      M.talk('mq2', 'kerrin');
      M.gotoStep('mq2');
      M.destroy('mq2', 'siphon_1');
      M.talk('mq2', 'sela');
      g.closeAll();
      const st = g.state();
      const bev = g.events(['boss:start', 'boss:end', 'boss:phase', 'player:died', 'player:respawned']).map((x) => x.type + JSON.stringify(x.payload));
      return { bev, retried, restarted, mq2: g.questState('mq2'), level: g.ctx.rpg.level, forms: st.player.forms, techs: st.player.techs,
        active: g.ctx.quests.active().map((x) => x.questId + ':' + x.stepId), log: M.log.slice(), fallbacks: M.fallbacks, dbg: M.dbg };
    });
    console.log('    ' + JSON.stringify(b));
    assert.ok(b.retried, 'died in the Durn fight and took the Retry');
    assert.ok(b.restarted >= 2, 'the boss fight restarted');
    assert.equal(b.mq2, 'done', 'MQ2 complete');
    assert.ok(b.level >= 2, 'levelled up');
    await snap('play-main-path-01-mq2');

    // ---- A shop purchase and a technique learned and slotted, with taps.
    await game((g) => {
      g.shells(400);
      g.open('shop', { shopId: 'dov_stall' });
      g.render();
    });
    const sh0 = await game((g) => ({ shells: g.state().inv.shells, fruit: g.ctx.rpg.count('sunfruit') }));
    await tap('[data-screen=shop] [data-row="0"] .ui-row .ui-btn:last-child');
    await tap('[data-screen=shop] [data-buy="0"]');
    const sh1 = await game((g) => ({ shells: g.state().inv.shells, fruit: g.ctx.rpg.count('sunfruit') }));
    await snap('play-main-path-02-shop');
    // A pause-tab screen hides the HUD (nothing shows through the backdrop).
    const ch = await game((g) => {
      g.closeAll();
      g.open('character');
      g.render();
      g.render();
      const hud = document.querySelector('.ui-hud');
      return { top: g.top(), hud: !!hud && !hud.hidden };
    });
    await snap('play-main-path-02b-character');
    assert.equal(ch.hud, false, 'the HUD is hidden under the character screen');
    assert.ok(sh1.fruit > sh0.fruit && sh1.shells < sh0.shells, 'bought in the shop');
    await game((g) => {
      g.closeAll();
      window.__M.level(8);
      g.open('techniques');
      g.render();
    });
    const learnSel = await game((g) => {
      for (const b of ['fist', 'flare', 'spirit']) {
        document.querySelector(`[data-screen=techniques] .ui-tab[data-tab=${b}]`).click();
        g.render();
        const el = document.querySelector('[data-screen=techniques] [data-learn]');
        if (el) return { tab: b, id: el.getAttribute('data-learn') };
      }
      return null;
    });
    assert.ok(learnSel, 'a technique node can be learned');
    await tap(`[data-screen=techniques] .ui-tab[data-tab=${learnSel.tab}]`);
    await tap(`[data-screen=techniques] [data-learn="${learnSel.id}"]`);
    await snap('play-main-path-03-techniques');
    const learned = await game((g) => {
      const st = g.state().player;
      return { nodes: st.nodes.slice(), slots: st.slots.slice() };
    });
    assert.ok(learned.nodes.includes(learnSel.id), 'learned with a tap');
    const slotSel = await game((g) => {
      for (const b of ['fist', 'flare', 'spirit']) {
        document.querySelector(`[data-screen=techniques] .ui-tab[data-tab=${b}]`).click();
        g.render();
        for (const li of document.querySelectorAll('[data-screen=techniques] .ui-li[data-node]')) {
          li.click();
          g.render();
          const btn = document.querySelector('[data-screen=techniques] [data-slot="1"]');
          if (btn) return { tab: b, node: li.getAttribute('data-node') };
        }
      }
      return null;
    });
    if (slotSel) {
      await tap(`[data-screen=techniques] .ui-tab[data-tab=${slotSel.tab}]`);
      await tap(`[data-screen=techniques] .ui-li[data-node="${slotSel.node}"]`);
      await tap('[data-screen=techniques] [data-slot="1"]');
    }
    const slots = await game((g) => {
      const s = g.state().player.slots.slice();
      g.closeAll();
      return s;
    });
    console.log('    learned ' + learnSel.id + ' slots ' + JSON.stringify(slots) + ' slotSel ' + JSON.stringify(slotSel));
    assert.ok(slotSel && slots[1], 'a technique slotted with taps');

    // ---- MQ3 up to the middle, then save, reload the page, restore the journey code and continue.
    const c = await game((g) => {
      const M = window.__M;
      M.level(10);
      M.talk('mq3', 'talia');
      const lm = g.ctx.world.landmark('bramble_hollow');
      M.go(lm.x + 120, lm.z + 120);
      M.kill('mq3', (e) => e.defId === 'bramble_boar', () => g.spawn('bramble_boar', { dist: 9, aggro: true }));
      // Die in the open and Rise at the Ringstone.
      g.god(false);
      g.kill(g.player().id);
      const rose = M.deathTap('rise');
      g.god(true);
      return { step: M.step('mq3'), rose, log: M.log.slice(-3) };
    });
    console.log('    ' + JSON.stringify(c));
    assert.equal(c.step, 's3', 'MQ3 at the goto step');
    assert.ok(c.rose, 'died and took Rise');
    const code = await game(async (g) => {
      g.save();
      return g.exportCode();
    });
    const before = await game((g) => ({ level: g.ctx.rpg.level, active: g.ctx.quests.active().map((x) => x.questId + ':' + x.stepId + ':' + x.count).sort(), shells: g.state().inv.shells }));
    await harness.reload();
    await game((g) => {
      g.ctx.session.end({ toTitle: false });
      g.closeAll();
      g.open('title');
      g.render();
    });
    await tap('[data-screen=title] .ui-menu .ui-btn:nth-child(3)');
    await game((g, text) => {
      const ta = document.querySelector('[data-screen=savecode] textarea[data-code=in]');
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = ta.parentElement.querySelector('.ui-btn');
      btn.click();
    }, code);
    for (let i = 0; i < 40 && (await game((g) => g.top())) !== 'hud'; i++) await game(() => new Promise((r) => setTimeout(r, 100)));
    const restoreMsg = await game(() => {
      const m = document.querySelector('[data-screen=savecode] .ui-tag.ui-bad');
      return m && !m.hidden ? m.textContent : '';
    });
    assert.equal(restoreMsg, '', 'the journey code is accepted');
    await setup();
    const after = await game((g) => {
      window.__P.sim(10);
      return { level: g.ctx.rpg.level, active: g.ctx.quests.active().map((x) => x.questId + ':' + x.stepId + ':' + x.count).sort(), shells: g.state().inv.shells, top: g.top() };
    });
    console.log('    reload: ' + JSON.stringify({ before, after }));
    assert.deepEqual(after.active, before.active, 'the quests continue where they were saved');
    assert.equal(after.level, before.level);

    // ---- The rest of MQ3, MQ4 (Dawn Lance through the pillar), MQ5, MQ6.
    const d = await game((g) => {
      const M = window.__M;
      M.gotoStep('mq3');
      M.boss('mq3', 'bramblehorn');
      M.destroy('mq3', 'siphon_2');
      M.talk('mq3', 'talia');
      M.level(10);
      M.talk('mq4', 'bren');
      // Dawn Lance: lock on the pillar, hold the technique to charge, release; three times.
      const pil = g.ctx.quests.objects().find((o) => o.id === 'saltglass_pillar');
      const lances = [];
      for (let k = 0; k < 6 && M.step('mq4') === 's2'; k++) {
        const e = pil && pil.entId ? g.ctx.ents.get(pil.entId) : null;
        if (!e) {
          M.go(pil.x + 14, pil.z + 14);
          continue;
        }
        g.teleport(e.pos.x + 12, e.pos.z + 12, { yaw: Math.atan2(-12, -12) });
        M.run(4);
        g.heal();
        g.lock(e.id);
        const slot = g.state().player.slots.indexOf('dawn_lance');
        const act = slot === 0 ? 'tech1' : 'tech2';
        g.hold(act, true);
        window.__P.sim(70);
        g.hold(act, false);
        M.run(60);
        // Dawn Lance has an 8 s cooldown.
        for (let w = 0; w < 30 && !g.ctx.combat.canUse(g.ctx.player, 'dawn_lance'); w++) M.run(30);
        lances.push(act + ':' + (g.ctx.quests.active().find((x) => x.questId === 'mq4') || {}).count);
      }
      M.kill('mq4', (e) => e.questTag === 'mq4_wave');
      M.destroy('mq4', 'siphon_3');
      M.talk('mq4', 'bren');
      M.level(15);
      M.talk('mq5', 'yael');
      M.gotoStep('mq5');
      M.boss('mq5', 'gorrumaw');
      M.destroy('mq5', 'siphon_4');
      M.talk('mq5', 'yael');
      M.level(20);
      M.talk('mq6', 'noa');
      for (const bell of ['bell_1', 'bell_2', 'bell_3']) M.interact('mq6', bell);
      M.gotoStep('mq6');
      M.boss('mq6', 'iskra');
      M.talk('mq6', 'noa');
      M.destroy('mq6', 'siphon_5');
      g.closeAll();
      return { lances, q: ['mq3', 'mq4', 'mq5', 'mq6', 'mq7'].map((q) => q + ':' + M.step(q)), log: M.log.slice(), fallbacks: M.fallbacks, phases: M.phases, siphons: g.state().world.siphons };
    });
    console.log('    ' + JSON.stringify(d));
    assert.deepEqual(d.q.slice(0, 4), ['mq3:done', 'mq4:done', 'mq5:done', 'mq6:done'], 'MQ3 to MQ6 complete');
    await snap('play-main-path-04-mq6');

    // ---- MQ7: Sela, the gate, Vorrhal and the tethers, the ending, the epilogue.
    const e = await game((g, tsrc) => {
      const M = window.__M;
      const tick = (0, eval)('(' + tsrc + ')');
      M.level(26);
      M.talk('mq7', 'sela');
      M.kill('mq7', (x) => x.questTag === 'mq7_gate');
      M.boss('mq7', 'vorrhal', tick);
      M.run(60);
      const bev = g.events(['boss:start', 'boss:end', 'boss:phase', 'quest:step', 'actor:died', 'player:died']).filter((x) => x.type !== 'actor:died' || x.payload.kind === 'boss').map((x) => x.type + JSON.stringify(x.payload).slice(0, 90));
      return { bev, step: M.step('mq7'), top: g.top(), tethers: M.tethers || 0, form: g.player().formId, log: M.log.slice(-4), phases: M.phases.vorrhal };
    }, tetherTick.toString());
    console.log('    ' + JSON.stringify(e));
    // Script promise chains (say -> wait -> open) settle between evaluate calls, as between real frames.
    let top = e.top;
    for (let i = 0; i < 8 && top !== 'ending'; i++) top = await game((g) => (window.__M.run(30), g.top()));
    assert.equal(top, 'ending', 'the ending screen is shown');
    await snap('play-main-path-05-ending');
    await tap('[data-screen=ending] .ui-btn');
    for (let i = 0; i < 4; i++) await game(() => window.__M.run(20));
    const f = await game((g) => {
      const M = window.__M;
      M.run(60);
      M.talk('mq7', 'sela');
      M.run(30);
      return { mq7: g.questState('mq7'), top: g.top(), credits: !!g.state().quests.flags.credits, fallbacks: M.fallbacks, deaths: M.deaths };
    });
    console.log('    ' + JSON.stringify(f));
    assert.equal(f.mq7, 'done', 'MQ7 complete: the game can be finished');
    await snap('play-main-path-06-epilogue');
  },
};

/** In the page: `window.__S`, injected-input play (stick toward a point relative to the camera, taps). */
function installStick() {
  const g = /** @type {any} */ (window).__GAME__;
  const ctx = g.ctx;
  const S = {};
  /** Push the injected stick toward a world point, relative to the camera yaw (as a thumb would). */
  S.steer = (x, z, mag = 1) => {
    const p = ctx.player;
    const dx = x - p.pos.x;
    const dz = z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const yaw = ctx.cam.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    g.move(((dx * -fz + dz * fx) / l) * mag, ((dx * fx + dz * fz) / l) * mag);
  };
  S.sim = (n) => {
    while (n > 0) {
      const k = Math.min(n, 20);
      ctx.loop.stepSim(k);
      n -= k;
    }
  };
  S.drain = () => {
    let n = 0;
    while (ctx.quests.dialogueOpen && n++ < 80) ctx.quests.advance(0);
    if (ctx.ui.top() === 'dialogue') ctx.ui.closeAll();
  };
  S.nearest = (match) => {
    const p = ctx.player;
    let best = null;
    let bd = Infinity;
    for (const e of ctx.ents.list('enemy')) {
      if (!e.alive || (match && !match(e))) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  };
  /** Fly (boosting) toward a point; returns the regions crossed. */
  S.flyTo = (x, z, maxTicks, regions) => {
    const p = ctx.player;
    if (p.move.mode !== 'fly') {
      g.press('jump');
      S.sim(8);
      g.press('jump');
      S.sim(12);
    }
    g.hold('dash', true);
    let t = 0;
    for (; t < maxTicks; t += 10) {
      const d = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (d < 40) break;
      // Face the camera along the route (a drag of the view) and push the stick forward.
      const want = Math.atan2(x - p.pos.x, z - p.pos.z);
      g.setCamera({ yaw: want, pitch: -0.05 });
      const alt = p.pos.y - g.heightAt(p.pos.x, p.pos.z);
      g.hold('jump', alt < 40);
      S.steer(x, z, 1);
      S.sim(10);
      S.drain();
      const r = g.regionAt(p.pos.x, p.pos.z);
      if (r && regions.indexOf(r) < 0) regions.push(r);
    }
    g.hold('dash', false);
    g.hold('jump', false);
    g.move(0, 0);
    return t;
  };
  /** Walk at the nearest enemy and tap Attack, nothing else. */
  S.brawl = (match, maxTicks, every = 12, healBelow = 0) => {
    const p = ctx.player;
    const out = { ticks: 0, deathAt: -1, hpMin: p.stats.hp, hpMax: p.stats.hpMax, taps: 0, killed: 0, heals: 0 };
    for (; out.ticks < maxTicks; out.ticks += 6) {
      if (!p.alive || p.combat.state === 'dead') {
        out.deathAt = out.ticks;
        break;
      }
      // The sandbox player drinks a healing item when low (the tap-only bot never guards or dodges).
      if (healBelow > 0 && p.stats.hp < p.stats.hpMax * healBelow) {
        g.heal();
        out.heals++;
      }
      const e = S.nearest(match);
      if (!e) break;
      S.steer(e.pos.x, e.pos.z, 1);
      if (out.ticks % every === 0) {
        g.press('attack');
        out.taps++;
      }
      S.sim(6);
      out.hpMin = Math.min(out.hpMin, p.stats.hp);
      S.drain();
    }
    g.move(0, 0);
    return out;
  };
  /** @type {any} */ (window).__S = S;
  return true;
}

const sandbox = {
  name: 'play-sandbox',
  width: 844,
  height: 390,
  query: 'lang=he&quality=low',
  async run({ game, assert, shot }) {
    await game(installStick);
    await game((g) => {
      g.setDevice('touch');
      g.ambient(true);
    });
    const t0 = await game((g) => g.tick());
    // 1. Boost flight across three regions.
    const fl = await game((g) => {
      const S = window.__S;
      const regions = [g.regionAt(g.ctx.player.pos.x, g.ctx.player.pos.z)];
      const legs = [];
      legs.push(S.flyTo(-360, 1150, 1500, regions));
      legs.push(S.flyTo(860, 2300, 2400, regions));
      legs.push(S.flyTo(1860, 1150, 2400, regions));
      return { regions, legs, mode: g.ctx.player.move.mode, boostEv: g.events(['move:boost']).length };
    });
    console.log('    flight: ' + JSON.stringify(fl));
    assert.ok(fl.regions.length >= 3, 'crossed three regions');
    await shot('play-sandbox-01-flight');
    // 2. Back in the Meadows: a fight with an ambient group (any group the spawner puts near the player).
    const fight = await game((g) => {
      const S = window.__S;
      g.teleport(-1000, 1150, {});
      S.sim(30);
      let src = 'ambient';
      const near = (e) => Math.hypot(e.pos.x - g.ctx.player.pos.x, e.pos.z - g.ctx.player.pos.z) < 170;
      let waited = 0;
      for (; waited < 40 && !S.nearest(near); waited++) S.sim(30);
      const pop = g.ctx.ai.population();
      const seen = g.ctx.ents.list('enemy').filter((e) => e.alive).map((e) => e.defId + ':' + Math.round(Math.hypot(e.pos.x - g.ctx.player.pos.x, e.pos.z - g.ctx.player.pos.z))).join(' ');
      if (!S.nearest(near)) {
        src = 'spawned';
        for (let i = 0; i < 3; i++) g.spawn('tusk_boar', { dist: 12 + i * 2, aggro: true, level: g.ctx.rpg.level });
      }
      src += ' after ' + waited * 30 + ' ticks';
      const n0 = g.ctx.ents.list('enemy').filter((e) => e.alive && near(e)).length;
      const r = S.brawl(near, 60 * 50, 10, 0.3);
      // Finish the stragglers (flyers out of melee reach) with bolts.
      for (let k = 0; k < 60 && S.nearest(near); k++) {
        const e = S.nearest(near);
        g.lock(e.id);
        g.press('bolt');
        S.sim(15);
        if (k > 40) g.damage(e.id, 0.5);
      }
      g.heal();
      return { pop, seen, src, n0, r, left: g.ctx.ents.list('enemy').filter((e) => e.alive && near(e)).length };
    });
    console.log('    fight: ' + JSON.stringify(fight));
    assert.ok(fight.n0 >= 1 && fight.left === 0, 'the group is beaten');
    // 3. Clear a camp: the chest unlocks and bonus XP is paid.
    const camp = await game((g) => {
      const S = window.__S;
      const p = g.ctx.player;
      let best = null;
      for (const c of g.cmd.aiCamps()) {
        const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
        if (c.regionId === 'meadows' && (!best || d < best.d)) best = { c, d };
      }
      const c = best.c;
      g.teleport(c.x + 30, c.z, {});
      S.sim(60);
      const xp0 = g.ctx.rpg.xp;
      const lv0 = g.ctx.rpg.level;
      for (let k = 0; k < 40; k++) {
        const ids = g.actors().filter((a) => a.kind === 'enemy' && Math.hypot(a.x - c.x, a.z - c.z) < 40).map((a) => a.id);
        if (!ids.length) break;
        for (const id of ids) {
          const e = g.ctx.ents.get(id);
          g.teleport(e.pos.x + 2.5, e.pos.z + 2.5, {});
          g.lock(id);
          g.press('attack');
          S.sim(10);
          g.damage(id, 0.7);
          S.sim(6);
        }
        S.sim(20);
        S.drain();
      }
      g.heal();
      const cleared = g.events(['camp:cleared']).filter((e) => e.payload.campId === c.id).length;
      const xp = g.events(['rpg:xp']).filter((e) => e.payload.source === 'camp').length;
      const chest = g.ctx.quests.objects().find((o) => o.id === 'campchest_' + c.id);
      let opened = null;
      if (chest) {
        g.teleport(chest.x + 1.5, chest.z + 1.5, {});
        S.sim(10);
        g.press('interact');
        S.sim(20);
        S.drain();
        opened = g.state().quests.flags['camp.' + c.id + '.chest'];
      }
      return { camp: c.id, cleared, xp, opened, lv0, xp0, lv: g.ctx.rpg.level };
    });
    console.log('    camp: ' + JSON.stringify(camp));
    assert.equal(camp.cleared, 1, 'camp cleared');
    assert.ok(camp.xp >= 1, 'bonus XP for the camp');
    assert.equal(camp.opened, 'open', 'the camp chest opened');
    // 4. A ring race.
    const race = await game((g) => {
      const S = window.__S;
      const c = g.ctx.defs.find('course', 'windmill_run');
      g.teleport(c.start.x, c.start.z, { yaw: Math.atan2(c.gates[0].x - c.start.x, c.gates[0].z - c.start.z) });
      S.sim(5);
      const ok = g.ctx.quests.raceStart('windmill_run');
      S.sim(5);
      let prev = c.start;
      for (const gt of c.gates) {
        const y = g.ctx.world.heightAt(gt.x, gt.z) + gt.alt;
        const yaw = Math.atan2(gt.x - prev.x, gt.z - prev.z);
        g.teleport(gt.x - Math.sin(yaw) * 10, gt.z - Math.cos(yaw) * 10, { y: y - 1, fly: true, yaw });
        g.setCamera({ yaw, pitch: 0 });
        S.sim(2);
        g.move(0, 1);
        S.sim(40);
        g.move(0, 0);
        prev = gt;
      }
      S.sim(10);
      S.drain();
      const end = g.events(['race:end']).at(-1);
      return { ok, gates: g.events(['race:gate']).filter((x) => x.payload.courseId === 'windmill_run').length, n: c.gates.length, end: end ? end.payload : null };
    });
    console.log('    race: ' + JSON.stringify(race));
    assert.ok(race.ok && race.end && race.end.finished, 'the race finished');
    // 5. Destroy a Siphon (Siphon II, ahead of MQ3).
    const sip = await game((g) => {
      const S = window.__S;
      g.god(true);
      const o = g.ctx.quests.objects().find((x) => x.id === 'siphon_2');
      g.teleport(o.x + 16, o.z + 16, {});
      S.sim(30);
      for (let k = 0; k < 200 && g.state().world.siphons.indexOf('siphon_2') < 0; k++) {
        const ob = g.ctx.quests.objects().find((x) => x.id === 'siphon_2');
        if (ob.entId) g.damage(ob.entId, 0.1);
        S.sim(20);
        S.drain();
      }
      g.god(false);
      g.heal();
      return { destroyed: g.state().world.siphons.indexOf('siphon_2') >= 0 };
    });
    assert.ok(sip.destroyed, 'Siphon II destroyed');
    // End state: nothing stuck, population inside the caps, the HUD right.
    const end = await game((g, t0) => {
      const S = window.__S;
      // Fly home to Sparkstead and stroll about: the Siphon guards go home behind the player.
      S.flyTo(-1404, 1584, 3000, []);
      for (let k = 0; k < 12; k++) {
        g.move(Math.sin(k), 1);
        S.sim(60);
        S.drain();
      }
      g.move(0, 0);
      S.sim(60);
      g.render();
      g.render();
      const ctx = g.ctx;
      const enemies = ctx.ents.list('enemy').filter((e) => e.alive).length;
      const actors = ['player', 'enemy', 'boss', 'npc'].reduce((n, k) => n + ctx.ents.count(k), 0);
      const hud = document.querySelector('.ui-hud');
      const lvText = (document.querySelector('.ui-hud .ui-lv, .ui-hud .ui-med') || {}).textContent || '';
      const tr = document.querySelector('.ui-tracker');
      return {
        minutes: (g.tick() - t0) / 3600, top: g.top(), paused: ctx.time.reasons(), context: ctx.input.context, alive: ctx.player.alive,
        cstate: ctx.player.combat.state, mode: ctx.player.move.mode, enemies, actors, projectiles: ctx.ents.count('projectile'),
        hud: !!hud && !hud.hidden, level: ctx.rpg.level, lvText, tracker: tr && !tr.hidden ? tr.innerText.replace(/\s+/g, ' ') : '',
        tracked: ctx.quests.tracked, pop: ctx.ai.population(),
        list: ctx.ents.list('enemy').filter((e) => e.alive).map((e) => e.defId + ':' + Math.round(Math.hypot(e.pos.x - ctx.player.pos.x, e.pos.z - ctx.player.pos.z)) + ':' + (e.questTag || '')).join(' '),
      };
    }, t0);
    console.log('    end: ' + JSON.stringify(end));
    await shot('play-sandbox-02-end');
    assert.ok(end.minutes >= 2.5, 'about three minutes of play');
    assert.equal(end.top, 'hud');
    assert.deepEqual(end.paused, [], 'nothing paused');
    assert.equal(end.context, 'game', 'input in the game context');
    assert.ok(end.alive && end.cstate !== 'dead', 'the player is up');
    assert.ok(end.enemies <= 12, 'active enemies within the low-tier cap of 12');
    assert.ok(!/_guard/.test(end.list), 'Siphon guards go home when the player leaves');
    assert.ok(end.actors <= 64 && end.projectiles <= 96, 'population within the caps');
    assert.ok(end.hud, 'the HUD is shown');
    assert.ok(end.lvText.indexOf(String(end.level)) >= 0, 'the HUD shows the level');
    assert.ok(end.tracker.length > 0, 'the tracker shows the tracked quest');
  },
};

/** Fairness: a level-1 Warrior player who only holds the stick toward the enemy and taps Attack. */
const fairness = {
  name: 'play-fairness',
  width: 844,
  height: 390,
  query: 'lang=he&quality=low',
  async run({ game, assert }) {
    await game(installStick);
    const r = await game((g) => {
      const S = window.__S;
      const ctx = g.ctx;
      ctx.rpg.setDifficulty('warrior');
      g.ambient(false);
      const runs = [];
      for (const [enemy, seedOff] of [['tusk_boar', 0], ['tusk_boar', 1], ['ember_wisp', 2], ['ember_wisp', 3]]) {
        g.killAll();
        S.sim(30);
        g.teleport(-1250 + seedOff * 40, 1350, { yaw: 0 });
        g.setCamera({ yaw: 0, pitch: 0.1 });
        g.heal();
        S.sim(20);
        const alt = enemy === 'ember_wisp' ? 6 : 0;
        for (let i = 0; i < 3; i++) g.spawn(enemy, { x: -1250 + seedOff * 40 + (i - 1) * 4, z: 1350 + 14, alt, aggro: true, level: 1 });
        S.sim(2);
        const res = S.brawl(null, 60 * 60, 12);
        res.enemy = enemy;
        res.left = ctx.ents.list('enemy').filter((e) => e.alive).length;
        res.byPlayer = g.events(['actor:died']).filter((e) => e.payload.kind === 'enemy' && e.payload.sourceId === ctx.player.id).length;
        res.selfBurst = g.events(['actor:died']).filter((e) => e.payload.kind === 'enemy' && e.payload.sourceId === 0).length;
        res.hpLost = Math.round(res.hpMax - res.hpMin);
        res.level = ctx.rpg.level;
        runs.push(res);
        if (res.deathAt >= 0) {
          g.closeAll();
          ctx.rpg.respawn({ retry: false });
          S.sim(20);
        }
      }
      return { diff: ctx.rpg.difficulty, runs };
    });
    for (const x of r.runs) console.log('    fairness: ' + JSON.stringify(x));
    for (const x of r.runs) {
      assert.ok(x.deathAt < 0 || x.deathAt >= 30 * 60, 'did not die within 30 s (' + x.enemy + ' died at ' + (x.deathAt / 60).toFixed(1) + ' s)');
      assert.equal(x.left, 0, 'killed all three within 60 s (' + x.enemy + ')');
    }
  },
};

export const scenarios = [
  firstTen('play-first-ten-portrait', 400, 860),
  firstTen('play-first-ten-landscape', 844, 390),
  mainPath,
  sandbox,
  fairness,
];
