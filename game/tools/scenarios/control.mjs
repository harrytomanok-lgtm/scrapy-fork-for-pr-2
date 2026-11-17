/**
 * Control package scenarios (ARCHITECTURE 8.5): movement, camera modes, touch layouts, knock and slam.
 * Run: node tools/scenarios.mjs control [--only name]
 */

/** @param {any} game @param {any} assert */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  return p;
}

/** In the page: rectangles of every visible touch control. */
function touchRects() {
  const out = [];
  for (const el of document.querySelectorAll('.ctl-touch [data-action]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    out.push({ action: el.getAttribute('data-action'), x: r.left, y: r.top, w: r.width, h: r.height, btn: el.classList.contains('ctl-btn') });
  }
  return { list: out, W: innerWidth, H: innerHeight, shown: !!document.querySelector('.ctl-touch.ctl-on') };
}

/**
 * Touch scenario body for one orientation: layout checks, the stick walks the player, Attack starts a technique,
 * the flight sub-layout shows Descend, a short tap in the camera zone locks on.
 * @param {string} name @param {number} w @param {number} h
 */
function touchScenario(name, w, h) {
  return {
    name,
    width: w,
    height: h,
    touch: true,
    query: 'autoplay=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => {
        g.pause();
        g.unlockAll();
        g.setDevice('touch');
        g.ctx.loop.stepSim(2);
        g.render();
      });
      await game((g) => g.screenshotReady());
      await game((g) => { g.ctx.loop.stepSim(12); g.render(); });
      const ui = await game(touchRects);
      assert.equal(ui.shown, true, 'touch controls are visible on the touch device');
      const btns = ui.list.filter((r) => r.btn);
      const actions = btns.map((b) => b.action);
      for (const a of ['attack', 'bolt', 'dash', 'guard', 'jump']) assert.ok(actions.includes(a), `${a} is shown`);
      assert.ok(!actions.includes('descend'), 'Descend is hidden on the ground');
      for (const z of ['move', 'look']) assert.ok(ui.list.some((r) => r.action === z), `zone ${z}`);
      for (const b of btns) {
        assert.ok(b.w >= 48 && b.h >= 48, `${b.action} is at least 48 px (${b.w})`);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= ui.W && b.y + b.h <= ui.H, `${b.action} inside the viewport`);
      }
      for (let i = 0; i < btns.length; i++) {
        for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i];
          const b = btns[j];
          const gap = Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) - a.w / 2 - b.w / 2;
          assert.ok(gap >= 7.5, `${a.action} and ${b.action} keep 8 px apart (${gap.toFixed(1)})`);
        }
      }
      // The floating stick walks the player forward.
      const moved = await game((g) => {
        const zone = document.querySelector('.ctl-touch [data-action="move"]');
        const r = zone.getBoundingClientRect();
        const x = r.left + Math.min(110, r.width / 2);
        const y = r.bottom - 120;
        const ev = (type, px, py) => zone.dispatchEvent(new PointerEvent(type, {
          pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
        }));
        const p0 = g.player();
        ev('pointerdown', x, y);
        ev('pointermove', x + 4, y - 30);
        ev('pointermove', x + 4, y - 70);
        const knobOn = document.querySelector('.ctl-touch.ctl-stick-on') !== null;
        g.ctx.loop.stepSim(1);
        const axis = g.ctx.input.axis('moveY');
        g.ctx.loop.stepSim(79);
        const p1 = g.player();
        g.render();
        return { d: Math.hypot(p1.x - p0.x, p1.z - p0.z), axis, knobOn, device: g.ctx.input.device, x, y };
      });
      assert.ok(moved.knobOn, 'the floating stick appears under the thumb');
      assert.ok(moved.axis > 0.8, `the stick pushes forward (moveY ${moved.axis.toFixed(2)})`);
      assert.ok(moved.d > 4, `the touch stick walks the player (${moved.d.toFixed(2)} m)`);
      assert.equal(moved.device, 'touch');
      await shot(name + '-stick');
      await game((g, pt) => {
        const zone = document.querySelector('.ctl-touch [data-action="move"]');
        zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: pt.x, clientY: pt.y - 70, bubbles: true }));
        g.ctx.loop.stepSim(20);
      }, { x: moved.x, y: moved.y });
      // Tap Attack next to an enemy: a technique starts.
      const id = await game((g) => g.spawn('tusk_boar', { dist: 3, passive: true }));
      const tapped = await game((g, eid) => {
        const btn = document.querySelector('.ctl-touch [data-action="attack"]');
        const b = btn.getBoundingClientRect();
        const ev = (type) => btn.dispatchEvent(new PointerEvent(type, {
          pointerId: 9, pointerType: 'touch', isPrimary: false, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true,
        }));
        g.lock(eid);
        const before = g.events(['combat:techStart']).length;
        ev('pointerdown');
        const down = btn.classList.contains('ctl-down');
        g.ctx.loop.stepSim(3);
        ev('pointerup');
        g.ctx.loop.stepSim(30);
        g.render();
        return { started: g.events(['combat:techStart']).length - before, down };
      }, id);
      assert.equal(tapped.down, true, 'Attack shows its pressed state');
      assert.ok(tapped.started >= 1, 'tapping Attack starts a technique');
      // A short tap on the enemy in the camera zone locks on through combat.pickAtScreen.
      const locked = await game((g, eid) => {
        g.lock(0);
        g.ctx.loop.stepSim(2);
        g.render();
        const e = g.ctx.ents.get(eid);
        const pt = { x: 0, y: 0, visible: false, depth: 0 };
        g.ctx.render.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, pt);
        const app = document.getElementById('app').getBoundingClientRect();
        const cx = app.left + pt.x;
        const cy = app.top + pt.y;
        const el = document.elementFromPoint(cx, cy);
        const target = el && el.getAttribute('data-action') === 'look' ? el : document.querySelector('.ctl-touch [data-action="look"]');
        const ev = (type) => target.dispatchEvent(new PointerEvent(type, {
          pointerId: 11, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true,
        }));
        ev('pointerdown');
        ev('pointerup');
        g.ctx.loop.stepSim(2);
        return { target: g.ctx.combat.target(), eid, hitLook: !!el && el.getAttribute('data-action') === 'look', vis: pt.visible };
      }, id);
      assert.ok(locked.vis, 'the enemy is on screen');
      assert.equal(locked.target, locked.eid, 'a tap on the enemy locks on');
      // Flight sub-layout: Descend appears while flying, and the double-tap latch lights Dash.
      const flight = await game((g) => {
        g.lock(0);
        g.killAll();
        const dash = document.querySelector('.ctl-touch [data-action="dash"]');
        const jump = document.querySelector('.ctl-touch [data-action="jump"]');
        const tap = (el, idn) => {
          const b = el.getBoundingClientRect();
          const o = { pointerId: idn, pointerType: 'touch', clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true };
          el.dispatchEvent(new PointerEvent('pointerdown', o));
          g.ctx.loop.stepSim(2);
          el.dispatchEvent(new PointerEvent('pointerup', o));
        };
        tap(jump, 21);
        g.ctx.loop.stepSim(6);
        tap(jump, 22);
        g.ctx.loop.stepSim(40);
        g.render();
        g.ctx.input.inject.move(0, 1);
        tap(dash, 23);
        g.ctx.loop.stepSim(6);
        tap(dash, 24);
        g.ctx.loop.stepSim(30);
        g.render();
        const descend = document.querySelector('.ctl-touch [data-action="descend"]');
        return {
          mode: g.player().mode, boost: g.ctx.player.move.boost, latched: dash.classList.contains('ctl-latched'),
          descend: getComputedStyle(descend).display !== 'none',
        };
      });
      assert.equal(flight.mode, 'fly', 'two taps on Jump take off');
      assert.ok(flight.descend, 'Descend appears in flight');
      assert.ok(flight.latched, 'the double tap on Dash lights the latch ring');
      assert.ok(flight.boost >= 1, 'the latch boosts');
      await shot(name + '-flight');
      await game((g) => { g.ctx.input.inject.move(0, 0); g.resume(); });
    },
  };
}

/**
 * Touch flight (the player's phone path): take off, boost and climb 200 m with synthetic pointer events only.
 * Two taps on Jump take off; the stick pushes forward; a double tap on Dash latches the boost; Jump held climbs
 * and a camera drag pitches the view up. No injected axes or actions.
 * @param {string} name @param {number} w @param {number} h
 */
function touchFlightScenario(name, w, h) {
  return {
    name,
    width: w,
    height: h,
    touch: true,
    query: 'autoplay=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => {
        g.pause();
        g.unlockAll();
        g.setHour(10);
        g.ai(false);
        g.setDevice('touch');
        g.ctx.loop.stepSim(2);
        g.render();
      });
      await game((g) => g.screenshotReady());
      const r = await game((g) => {
        /** @param {string} a */
        const el = (a) => document.querySelector('.ctl-touch [data-action="' + a + '"]');
        const centre = (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
        const fire = (e, type, id, x, y) => e.dispatchEvent(new PointerEvent(type, {
          pointerId: id, pointerType: 'touch', isPrimary: id === 31, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
        }));
        const tap = (a, id) => { const e = el(a); const c = centre(e); fire(e, 'pointerdown', id, c.x, c.y); g.ctx.loop.stepSim(2); fire(e, 'pointerup', id, c.x, c.y); };
        const out = { log: [] };
        const p0 = g.player();
        const y0 = p0.y;
        // 1. Take off: two taps on Jump.
        tap('jump', 41);
        g.ctx.loop.stepSim(8);
        tap('jump', 42);
        g.ctx.loop.stepSim(30);
        out.mode1 = g.player().mode;
        // 2. The stick forward, held for the whole climb.
        const zone = el('move');
        const zr = zone.getBoundingClientRect();
        const sx = zr.left + Math.min(110, zr.width / 2);
        const sy = zr.bottom - 120;
        fire(zone, 'pointerdown', 31, sx, sy);
        fire(zone, 'pointermove', 31, sx + 2, sy - 30);
        fire(zone, 'pointermove', 31, sx + 2, sy - 70);
        g.ctx.loop.stepSim(10);
        // 3. Double tap on Dash: the boost latch.
        tap('dash', 43);
        g.ctx.loop.stepSim(6);
        tap('dash', 44);
        g.ctx.loop.stepSim(20);
        g.render();
        out.latched = el('dash').classList.contains('ctl-latched');
        out.boost1 = g.ctx.player.move.boost;
        // 4. Pitch the camera up with a drag up the camera zone (one drag up climbs, ART_UX 6.1).
        const look = el('look');
        const lr = look.getBoundingClientRect();
        const lx = lr.left + lr.width * 0.7;
        const ly = lr.top + lr.height * 0.8;
        fire(look, 'pointerdown', 51, lx, ly);
        for (let i = 1; i <= 8; i++) { fire(look, 'pointermove', 51, lx, ly - i * 12); g.ctx.loop.stepSim(1); }
        fire(look, 'pointerup', 51, lx, ly - 96);
        out.up = g.ctx.player.intent.up;
        // 5. Hold Jump (climb) and keep flying until 200 m above the start, or 25 s.
        const j = el('jump');
        const jc = centre(j);
        fire(j, 'pointerdown', 45, jc.x, jc.y);
        let t = 0;
        let maxBoost = out.boost1;
        for (; t < 25 * 60; t += 30) {
          g.ctx.loop.stepSim(30);
          const pl = g.player();
          maxBoost = Math.max(maxBoost, g.ctx.player.move.boost);
          if (t % 120 === 0) out.log.push([Math.round(pl.y - y0), pl.mode, g.ctx.player.move.boost, Math.round(g.ctx.player.move.speed)]);
          if (pl.y - y0 >= 200) break;
        }
        out.secs = t / 60;
        const p1 = g.player();
        out.climb = p1.y - y0;
        out.mode2 = p1.mode;
        out.maxBoost = maxBoost;
        out.dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        out.stickOn = document.querySelector('.ctl-touch.ctl-stick-on') !== null;
        out.device = g.ctx.input.device;
        g.render();
        return out;
      });
      console.log('    ' + name + ': ' + JSON.stringify(r));
      assert.equal(r.mode1, 'fly', 'two taps on Jump take off');
      assert.equal(r.device, 'touch');
      assert.ok(r.stickOn, 'the stick is held');
      assert.ok(r.latched, 'the Dash double tap lights the latch');
      assert.ok(r.maxBoost >= 1, 'the latch boosts');
      assert.ok(r.climb >= 200, `climbed 200 m with touch only (${r.climb.toFixed(0)} m in ${r.secs.toFixed(1)} s)`);
      assert.equal(r.mode2, 'fly', 'still flying');
      await shot(name);
      // Release the stick and Jump: the latch drops with the stick centred, the player hovers.
      const end = await game((g) => {
        const fire = (a, type, id) => {
          const e = document.querySelector('.ctl-touch [data-action="' + a + '"]');
          const b = e.getBoundingClientRect();
          e.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true, cancelable: true }));
        };
        fire('jump', 'pointerup', 45);
        fire('move', 'pointerup', 31);
        g.ctx.loop.stepSim(40);
        const out = { boost: g.ctx.player.move.boost, mode: g.player().mode, axis: g.ctx.input.axis('moveY') };
        g.resume();
        return out;
      });
      assert.equal(end.axis, 0, 'releasing the stick centres it');
      assert.equal(end.boost, 0, 'the boost stops with the stick released');
      assert.equal(end.mode, 'fly', 'hovering after the release');
    },
  };
}

export const scenarios = [
  touchScenario('control-touch-landscape', 844, 390),
  touchScenario('control-touch-portrait', 400, 860),
  touchFlightScenario('control-touch-flight', 844, 390),
  touchFlightScenario('control-touch-flight-portrait', 400, 860),
  {
    name: 'control-walk-fly',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const p0 = await opening(game, assert);
      await game((g) => {
        g.move(0, 1);
        g.step(120);
      });
      const p1 = await game((g) => ({ ...g.player(), speed: g.ctx.player.move.speed, run: g.ctx.player.stats.runSpeed }));
      assert.equal(p1.mode, 'ground', 'walking stays on the ground');
      assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, 'two seconds of running cover ground');
      assert.ok(Math.abs(p1.speed - p1.run) < 1.5, `run speed reached (${p1.speed.toFixed(2)} of ${p1.run})`);
      await shot('control-walk');
      const air = await game((g) => {
        g.press('jump');
        g.step(8);
        const m1 = g.player().mode;
        g.press('jump');
        g.step(4);
        const m2 = g.player().mode;
        g.hold('jump', true);
        g.step(90);
        g.hold('jump', false);
        g.step(10);
        return { m1, m2, alt: g.ctx.move.altitude(g.ctx.player) };
      });
      assert.equal(air.m1, 'air', 'the first jump leaves the ground');
      assert.equal(air.m2, 'fly', 'the second jump takes off');
      assert.ok(air.alt > 15, `holding Jump climbs (${air.alt.toFixed(1)} m)`);
      const fly = await game((g) => {
        const a = g.player();
        g.move(0, 1);
        let n = 0;
        while (n < 1500) {
          g.step(30);
          n += 30;
          const b = g.player();
          if (Math.hypot(b.x - a.x, b.z - a.z) >= 300) break;
        }
        const b = g.player();
        return { d: Math.hypot(b.x - a.x, b.z - a.z), mode: b.mode, secs: n / 60 };
      });
      assert.ok(fly.d >= 300, `flew 300 m (${fly.d.toFixed(0)} m in ${fly.secs} s)`);
      assert.equal(fly.mode, 'fly');
      await shot('control-flight');
      const boost = await game((g) => {
        const before = g.events(['move:boost']).length;
        g.hold('dash', true);
        g.step(20);
        const stage1 = g.ctx.player.move.boost;
        g.step(130);
        const stage2 = g.ctx.player.move.boost;
        const evs = g.events(['move:boost']).slice(before).map((e) => e.payload ? e.payload.stage : e.stage);
        return { stage1, stage2, evs, speed: g.ctx.player.move.speed };
      });
      assert.equal(boost.stage1, 1, 'holding Dash in flight boosts');
      assert.equal(boost.stage2, 2, 'the sonic stage after 2 s');
      assert.ok(boost.speed > 80, `sonic speed ${boost.speed.toFixed(0)} m/s`);
      await shot('control-sonic');
      const landed = await game((g) => {
        g.hold('dash', false);
        g.move(0, 0);
        g.step(30);
        g.hold('descend', true);
        let n = 0;
        while (g.player().mode === 'fly' && n < 3000) {
          g.step(30);
          n += 30;
        }
        g.hold('descend', false);
        g.step(10);
        return { mode: g.player().mode, boost: g.ctx.player.move.boost, alt: g.ctx.move.altitude(g.ctx.player) };
      });
      assert.equal(landed.mode, 'ground', 'descending lands');
      assert.equal(landed.boost, 0);
      assert.ok(Math.abs(landed.alt) < 0.05, 'feet on the ground');
    },
  },
  {
    name: 'control-camera-modes',
    width: 640,
    height: 360,
    async run({ page, game, assert, shot }) {
      await opening(game, assert);
      /** Settle the camera with frame passes, then read its state. */
      const camState = () => game((g) => {
        for (let i = 0; i < 40; i++) g.step(1);
        const c = g.ctx.three.camera;
        const p = g.ctx.player;
        const pt = { x: 0, y: 0, visible: false, depth: 0 };
        g.ctx.render.project(p.pos.x, p.pos.y + p.height * 0.6, p.pos.z, pt);
        return {
          mode: g.ctx.cam.mode, fov: c.fov, d: Math.hypot(c.position.x - p.pos.x, c.position.y - p.pos.y, c.position.z - p.pos.z),
          px: pt.x / innerWidth, py: pt.y / innerHeight, visible: pt.visible,
          above: c.position.y - g.ctx.world.heightAt(c.position.x, c.position.z),
        };
      });
      await game((g) => { g.move(0, 1); g.step(60); g.move(0, 0); g.step(30); });
      const ex = await camState();
      assert.equal(ex.mode, 'explore');
      assert.ok(ex.d > 4 && ex.d < 8, `explore distance ${ex.d.toFixed(2)}`);
      assert.ok(Math.abs(ex.fov - 60) < 1.5, `explore fov ${ex.fov.toFixed(1)}`);
      assert.ok(ex.visible && Math.abs(ex.px - 0.5) < 0.08, 'the player is centred horizontally');
      assert.ok(ex.py > 0.36 && ex.py < 0.56, `landscape framing near 55% of the height (${ex.py.toFixed(2)})`);
      assert.ok(ex.above >= 0.45, 'the camera stays above the terrain');
      await shot('control-cam-explore');
      await game((g) => {
        g.press('jump'); g.step(8); g.press('jump'); g.step(4);
        g.hold('jump', true); g.step(120); g.hold('jump', false);
        g.move(0, 1); g.step(60);
      });
      const fl = await camState();
      assert.equal(fl.mode, 'flight');
      assert.ok(fl.d > 6 && fl.d < 11, `flight distance ${fl.d.toFixed(2)}`);
      assert.ok(fl.fov > 63 && fl.fov < 70, `flight fov ${fl.fov.toFixed(1)}`);
      await shot('control-cam-flight');
      await game((g) => { g.hold('dash', true); g.step(30); });
      const bo = await camState();
      assert.equal(bo.mode, 'boost');
      assert.ok(bo.fov > 72, `boost fov ${bo.fov.toFixed(1)}`);
      assert.ok(bo.visible, 'the player stays on screen while boosting');
      await shot('control-cam-boost');
      // Lock on a spawned enemy on the ground.
      const lock = await game((g) => {
        g.hold('dash', false);
        g.move(0, 0);
        g.ai(false);
        const p = g.player();
        g.teleport(p.x, p.z, { yaw: 0 });
        g.step(5);
        const id = g.spawn('tusk_boar', { dist: 9, passive: true });
        g.lock(id);
        for (let i = 0; i < 50; i++) g.step(1);
        const e = g.ctx.ents.get(id);
        const pt = { x: 0, y: 0, visible: false, depth: 0 };
        g.ctx.render.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, pt);
        const pp = { x: 0, y: 0, visible: false, depth: 0 };
        const pl = g.ctx.player;
        g.ctx.render.project(pl.pos.x, pl.pos.y + pl.height * 0.5, pl.pos.z, pp);
        return { id, mode: g.ctx.cam.mode, target: pt, player: pp, W: innerWidth };
      });
      assert.equal(lock.mode, 'lock', 'locking switches the camera to lock framing');
      assert.ok(lock.target.visible && lock.player.visible, 'player and target are both on screen');
      assert.ok(Math.abs(lock.target.x - lock.player.x) > lock.W * 0.08, 'player and target on different thirds');
      await shot('control-cam-lock');
      await game((g) => { g.lock(0); g.killAll(); g.step(30); });
      await page.setViewportSize({ width: 400, height: 800 });
      await game((g) => g.screenshotReady());
      const po = await camState();
      assert.equal(po.mode, 'explore');
      assert.ok(Math.abs(po.fov - 72) < 1.5, `portrait fov ${po.fov.toFixed(1)}`);
      assert.ok(po.py < 0.47 && po.py > 0.28, `portrait: the player sits above the control deck (${po.py.toFixed(2)})`);
      await shot('control-cam-portrait');
    },
  },
  {
    name: 'control-knock',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.ai(false);
        const w = g.ctx.world;
        const p = g.player();
        // Find a steep hillside near the start: the largest rise over 6 m within 600 m.
        let best = null;
        for (let x = p.x - 600; x <= p.x + 600; x += 12) {
          for (let z = p.z - 600; z <= p.z + 600; z += 12) {
            const h0 = w.heightAt(x, z);
            if (h0 < 2) continue;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              const dx = Math.sin(a);
              const dz = Math.cos(a);
              const rise = w.heightAt(x + dx * 6, z + dz * 6) - h0;
              const flat = Math.abs(w.heightAt(x - dx * 8, z - dz * 8) - h0);
              if (flat < 1.5 && (!best || rise > best.rise)) best = { x, z, dx, dz, rise };
            }
          }
        }
        if (!best) return { err: 'no hillside' };
        // Stand 12 m back from the foot of the slope; the enemy 3 m in front.
        const px = best.x - best.dx * 12;
        const pz = best.z - best.dz * 12;
        g.teleport(px, pz, { yaw: Math.atan2(best.dx, best.dz) });
        g.setCamera({ yaw: Math.atan2(best.dx, best.dz) + 0.6, pitch: -0.15 });
        g.step(5);
        const id = g.spawn('tusk_boar', { x: px + best.dx * 4, z: pz + best.dz * 4, passive: true });
        g.step(2);
        const e = g.ctx.ents.get(id);
        const before = g.events(['actor:slam']).length;
        const pl = g.ctx.player;
        g.ctx.move.knock(e, best.dx * 30, 3, best.dz * 30, { hurtle: true, sourceId: pl.id, slamDamage: 20 });
        const mode = e.move.mode;
        g.step(45);
        const evs = g.events(['actor:slam']).slice(before);
        const slam = evs.map((x) => x.payload || x).find((x) => x.entId === id) || null;
        g.step(20);
        return { rise: best.rise, mode, slam, after: e.move.mode };
      });
      assert.ok(!r.err, r.err);
      assert.equal(r.mode, 'hurtle', 'a hurtle knock makes the body ballistic');
      assert.ok(r.slam, `slammed into the hillside (rise ${r.rise.toFixed(1)} m over 6 m)`);
      assert.ok(r.slam.speed >= 14, 'slam speed over the threshold');
      assert.equal(r.slam.damage, 20, 'the slam carries slamDamage');
      assert.equal(r.slam.surface, 'terrain');
      assert.notEqual(r.after, 'hurtle');
      await shot('control-knock');
    },
  },
  {
    name: 'control-edge',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        const w = g.ctx.world;
        const a = 0.7;
        const r0 = w.edgeStart - 150;
        g.teleport(Math.sin(a) * r0, Math.cos(a) * r0, { alt: 120, yaw: a });
        g.setCamera({ yaw: a, pitch: -0.1 });
        const before = g.events(['world:edge']).length;
        g.move(0, 1);
        g.hold('dash', true);
        let maxR = 0;
        for (let i = 0; i < 40; i++) {
          g.step(15);
          const p = g.ctx.player.pos;
          maxR = Math.max(maxR, Math.hypot(p.x, p.z));
        }
        g.hold('dash', false);
        g.move(0, 0);
        g.step(240);
        const p = g.ctx.player.pos;
        const evs = g.events(['world:edge']).slice(before).map((e) => (e.payload || e).factor);
        return { maxR, end: Math.hypot(p.x, p.z), hard: w.edgeHard, evs, mode: g.player().mode };
      });
      assert.ok(r.maxR <= r.hard + 8.5, `the Veilstorm holds (max radius ${r.maxR.toFixed(0)}, wall ${r.hard})`);
      assert.ok(r.maxR > r.hard - 60, 'the flight reached the wall');
      assert.ok(r.evs.some((f) => f >= 0.9), 'world:edge reports the storm');
      assert.ok(r.end < r.hard, 'turned back inside the wall');
      await shot('control-edge');
    },
  },
  {
    name: 'control-cinematic',
    width: 640,
    height: 360,
    async run({ game, assert }) {
      const p = await opening(game, assert);
      const r = await game(async (g, pl) => {
        const y = pl.y;
        const shots = [
          { seconds: 0.5, from: { x: pl.x + 10, y: y + 6, z: pl.z }, to: { x: pl.x + 6, y: y + 4, z: pl.z + 6 }, lookAt: { entId: pl.id }, fov: 50, ease: 'inOut' },
          { seconds: 0.5, orbit: { entId: pl.id, dist: 4, height: 2, yawFrom: 0, yawTo: 1 }, fov: 45 },
          { seconds: 0.5, to: { x: pl.x, y: y + 20, z: pl.z - 20 }, lookAt: { x: pl.x, y, z: pl.z }, ease: 'out' },
        ];
        const before = g.events(['cine:start', 'cine:end']).length;
        let done = null;
        g.ctx.cam.play('test_three', shots, { skippable: true }).then((v) => { done = v; });
        const busy = g.ctx.cam.busy;
        const mode = g.ctx.cam.mode;
        for (let i = 0; i < 12; i++) g.step(10);
        await Promise.resolve();
        const first = done;
        // A second run is skipped with the skip action.
        let done2 = null;
        g.ctx.cam.play('test_skip', shots, { skippable: true }).then((v) => { done2 = v; });
        g.step(5);
        g.press('skip');
        g.step(2);
        await Promise.resolve();
        await Promise.resolve();
        const evs = g.events(['cine:start', 'cine:end']).slice(before).map((e) => e.type);
        return { busy, mode, first, second: done2, after: g.ctx.cam.busy, evs, ctxAfter: g.ctx.input.context };
      }, p);
      assert.equal(r.busy, true);
      assert.equal(r.mode, 'cinematic');
      assert.deepEqual(r.first, { skipped: false }, 'the three-shot path completes');
      assert.deepEqual(r.second, { skipped: true }, 'the skip action skips');
      assert.equal(r.after, false);
      assert.equal(r.ctxAfter, 'game', 'input context restored');
      assert.deepEqual(r.evs, ['cine:start', 'cine:end', 'cine:start', 'cine:end']);
    },
  },
];
