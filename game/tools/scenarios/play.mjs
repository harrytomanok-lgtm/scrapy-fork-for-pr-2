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
        if (!el || el.closest('[hidden],bdi,.ui-glyph,svg') || !el.getClientRects().length) continue;
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
        return { taps, step: P.step('mq1'), hp: Math.round(g.ctx.player.stats.hp), mode: g.ctx.player.move.mode };
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
        const out = { locks: 0, flicker: 0, breaker: 0, taps: 0, red: 0, hpMin: 1e9 };
        let redSeen = g.events(['combat:telegraph']).length;
        for (let t = 0; t < 60 * 90 && P.step('mq1') === 's7'; t += 1) {
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
        const q = g.ctx.quests.objects().find((o) => o.id === 'ringstone_sparkstead');
        const tx = q ? q.x : rs.x + 4;
        const tz = q ? q.z : rs.z + 10;
        P.faceCam(tx, tz);
        const left = P.walkTo(tx, tz, 2.5, 600);
        P.sim(4);
        return { left, focus: g.ctx.quests.focus };
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

export const scenarios = [
  firstTen('play-first-ten-portrait', 400, 860),
  firstTen('play-first-ten-landscape', 844, 390),
];
