/**
 * look scenarios: the visual quality gallery of the merged game on the low tier at res=1, in portrait (412x915)
 * and landscape (915x412). Every world view uses the real follow camera at ground level; close-ups of characters
 * use the actors stage camera. Each view also checks the low-tier budget (perf-budget numbers: 120 draw calls in
 * a fight, 250k triangles, 24 programs).
 * Run with `node tools/scenarios.mjs look [--only name]`. Screenshots go to tools/out/shots/look-*.png.
 */

/** Boot state: AI and ambient spawns off, everything unlocked, noon, nothing alive around. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  await game((g) => {
    g.ai(false);
    g.ambient(false);
    g.unlockAll();
    g.god(true);
    g.setLevel(25);
    g.setHour(12);
    g.killAll();
    g.step(2);
  });
}

/**
 * In the page: put the player at (x, z) facing yaw (alt > 0 flies), aim the follow camera, let streaming settle,
 * wait out the region banner, render. Returns the frame stats. Kept as a string so every page call can share it.
 */
const VIEW = `(g, o) => {
  g.cmd.actorsStage(null);
  g.teleport(o.x, o.z, { alt: o.alt || 0, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(3);
  g.cmd.flushBuilds();
  for (let i = 0; i < 6; i++) g.step(40);
  g.cmd.flushBuilds();
  if (o.alt) g.teleport(o.x, o.z, { alt: o.alt, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(30);
  const s = g.stats();
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs };
}`;

/**
 * In the page: a dry, gentle spot near (x, z) whose ground rises no more than 1.2 m over 8 m in any direction,
 * away from the Spire's foot. Spiral search; falls back to (x, z).
 */
const SPOT = `(g, x, z) => {
  const w = g.ctx.world;
  const ok = (px, pz) => {
    const h = w.heightAt(px, pz);
    if (h < 3 || Math.hypot(px, pz) < 170) return false;
    for (let a = 0; a < 8; a++) {
      const d = Math.abs(w.heightAt(px + Math.cos(a * 0.785) * 8, pz + Math.sin(a * 0.785) * 8) - h);
      if (d > 1.2) return false;
    }
    return w.waterDepthAt(px, pz) <= 0;
  };
  for (let r = 0; r < 900; r += 30) {
    const n = Math.max(1, Math.floor(r / 15));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}`;

/** In the page: the world views of the gallery, in order. */
function worldViews(g, spotSrc) {
  const spot = (0, eval)('(' + spotSrc + ')');
  const out = [];
  for (const r of g.ctx.world.regions) {
    const p = spot(g, r.id === 'spire' ? r.cx + 260 : r.cx, r.id === 'spire' ? r.cz + 260 : r.cz);
    // look toward the island centre so the Spire anchors the composition; the Spire region looks across it
    const yaw = Math.atan2(-p.x, -p.z) + (r.id === 'spire' ? 0.35 : 0.25);
    out.push({ name: 'day-' + r.id, x: p.x, z: p.z, yaw, pitch: -0.12, hour: 12 });
  }
  const sp = g.ctx.world.landmark('sparkstead');
  const yawS = Math.atan2(-18, -26);
  out.push({ name: 'sparkstead-dusk', x: sp.x + 18, z: sp.z + 26, yaw: yawS, pitch: -0.08, hour: 19.5 });
  out.push({ name: 'sparkstead-night', x: sp.x + 18, z: sp.z + 26, yaw: yawS, pitch: -0.08, hour: 0 });
  const m = g.ctx.world.regions.find((r) => r.id === 'meadows');
  out.push({ name: 'flight-150', x: m.cx, z: m.cz, alt: 150, yaw: Math.atan2(-m.cx, -m.cz), pitch: -0.3, hour: 12 });
  // the Spire approach: 70 m out from the settlement, looking up at the Spire (off the Ringstone, so no discovery)
  const ap = g.ctx.world.landmark('spire_approach');
  const d = Math.hypot(ap.x, ap.z) || 1;
  const ax = ap.x + (ap.x / d) * 70 + 20;
  const az = ap.z + (ap.z / d) * 70;
  out.push({ name: 'spire-approach', x: ax, z: az, yaw: Math.atan2(-ax, -az), pitch: 0.18, hour: 16 });
  return out;
}

/** @param {string} tag @param {number} width @param {number} height */
function worldScenario(tag, width, height) {
  return {
    name: 'look-world-' + tag,
    width,
    height,
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const views = await game(worldViews, SPOT);
      assert.ok(views.length === 11, 'eleven world views');
      for (const v of views) {
        const s = await game((g, src, o) => {
          g.setHour(o.hour);
          return (0, eval)('(' + src + ')')(g, o);
        }, VIEW, v);
        assert.ok(s.drawCalls <= 120 && s.triangles <= 250000 && s.programs <= 24, `${v.name}: within the low budget (${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs)`);
        console.log(`  ${tag} ${v.name}: ${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs`);
        await shot(`look-${tag}-${v.name}`);
      }
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

/** @param {string} tag @param {number} width @param {number} height */
function actorScenario(tag, width, height) {
  const portrait = height > width;
  return {
    name: 'look-actors-' + tag,
    width,
    height,
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const m = await game((g, src) => {
        const r = g.ctx.world.regions.find((q) => q.id === 'meadows');
        return (0, eval)('(' + src + ')')(g, r.cx + 120, r.cz - 60);
      }, SPOT);
      // hero close up, base form and each Form, with the stage camera following the player
      for (const form of [null, 'ember', 'tempest', 'zenith']) {
        await game((g, src, o, f) => {
          (0, eval)('(' + src + ')')(g, o);
          g.setForm(f);
          g.setOra(9999);
          g.step(60);
          g.cmd.actorsFollow(3.4, 0.55, 0.1);
          g.step(4);
        }, VIEW, { x: m.x, z: m.z, yaw: 2.4, pitch: -0.05 }, form);
        await shot(`look-${tag}-hero-${form || 'base'}`);
      }
      // the same Forms through the real follow camera (how the phone sees them)
      for (const form of ['ember', 'tempest', 'zenith']) {
        await game((g, f) => {
          g.cmd.actorsFollow(0);
          g.cmd.actorsStage(null);
          g.setForm(f);
          g.setOra(9999);
          g.setCamera({ yaw: 2.4 + 2.6, pitch: -0.1 });
          g.step(40);
        }, form);
        await shot(`look-${tag}-play-${form}`);
      }
      await game((g) => { g.setForm(null); g.cmd.actorsFollow(0); g.step(10); });
      // the nine enemies in a row
      await game((g, back) => {
        g.cmd.actorsLineup({ ids: ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard'],
          dist: 14, back, up: 2.6, look: 1.1 });
        g.step(4);
      }, portrait ? 22 : 10);
      await shot(`look-${tag}-enemies`);
      // each boss on its own, front three-quarter
      for (const b of ['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal']) {
        await game((g, id, port) => {
          const ids = g.cmd.actorsLineup({ ids: [id], dist: 14 });
          const e = g.ctx.ents.get(ids[0]);
          const bd = g.ctx.actors.bounds(id);
          const h = Math.max(2, bd.height || 3);
          const d = Math.max(5, h * (port ? 2.6 : 2.0));
          const a = e.yaw + 0.35;
          g.cmd.actorsStage([e.pos.x + Math.sin(a) * d, e.pos.y + h * 0.7, e.pos.z + Math.cos(a) * d], [e.pos.x, e.pos.y + h * 0.5, e.pos.z]);
          g.step(4);
        }, b, portrait);
        await shot(`look-${tag}-boss-${b}`);
      }
      // a combat moment with effects, through the real follow camera
      const s = await game((g, src, o) => {
        g.cmd.actorsClear();
        (0, eval)('(' + src + ')')(g, o);
        g.ai(true);
        for (let i = 0; i < 3; i++) g.spawn(i === 1 ? 'choir_vanguard' : 'choir_acolyte', { dist: 5 + i, aggro: true });
        g.step(20);
        g.setOra(9999);
        g.use('strike_string');
        g.step(8);
        g.use('nova_ring');
        g.step(9);
        const st = g.stats();
        return { drawCalls: st.drawCalls, triangles: st.triangles, programs: st.programs };
      }, VIEW, { x: m.x, z: m.z, yaw: 2.4, pitch: -0.12 });
      assert.ok(s.drawCalls <= 120 && s.triangles <= 250000 && s.programs <= 24, `combat: within the low budget (${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs)`);
      console.log(`  ${tag} combat: ${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs`);
      await shot(`look-${tag}-combat`);
      await game((g) => { g.use('ora_bolt'); g.step(6); });
      await shot(`look-${tag}-combat2`);
      const nan = await game((g) => g.cmd.actorsNaN());
      assert.equal(nan, 0, 'no NaN bone matrices');
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

/**
 * Moments: the Bramblehorn arena (dry), Iskra's blizzard (env.setFog with snow), sonic boost flight (speed lines
 * and wind streaks), and the Ringfall crater aftermath (the player must stay visible).
 * @param {string} tag @param {number} width @param {number} height
 */
function momentScenario(tag, width, height) {
  return {
    name: 'look-moments-' + tag,
    width,
    height,
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      // the Bramblehorn arena is dry ground all the way across
      const arena = await game((g, src) => {
        const lm = g.ctx.world.landmark('bramble_hollow');
        let wet = 0;
        let minH = 1e9;
        for (let r = 0; r <= 90; r += 15) {
          for (let a = 0; a < 12; a++) {
            const x = lm.x + Math.cos(a * 0.5236) * r;
            const z = lm.z + Math.sin(a * 0.5236) * r;
            const h = g.ctx.world.heightAt(x, z);
            minH = Math.min(minH, h);
            if (h < 0.5 || g.ctx.world.waterDepthAt(x, z) > 0) wet++;
          }
        }
        (0, eval)('(' + src + ')')(g, { x: lm.x + 40, z: lm.z + 30, yaw: Math.atan2(-40, -30), pitch: -0.15 });
        return { wet, minH };
      }, VIEW);
      assert.equal(arena.wet, 0, `the Bramblehorn arena has no water (lowest ${arena.minH.toFixed(1)} m)`);
      await shot(`look-${tag}-arena-bramble`);
      // Iskra's phase-2 blizzard through the env fog override
      const fog = await game((g, src, spotSrc) => {
        const r = g.ctx.world.regions.find((q) => q.id === 'frostspine');
        const p = (0, eval)('(' + spotSrc + ')')(g, r.cx, r.cz);
        (0, eval)('(' + src + ')')(g, { x: p.x, z: p.z, yaw: Math.atan2(-p.x, -p.z), pitch: -0.1 });
        g.ctx.env.setFog({ density: 0.0055, seconds: 0, snow: 1 });
        for (let i = 0; i < 4; i++) g.step(15);
        return { k: g.ctx.env.info().fog, weather: g.ctx.vfx.debugState().weather };
      }, VIEW, SPOT);
      assert.ok(fog.k > 0.99 && fog.weather > 0.2, `the blizzard is on (fog ${fog.k}, snow ${fog.weather})`);
      await shot(`look-${tag}-blizzard`);
      await game((g) => { g.ctx.env.clearFog(0); g.step(30); });
      // sonic boost flight
      const sonic = await game((g, src) => {
        const r = g.ctx.world.regions.find((q) => q.id === 'meadows');
        (0, eval)('(' + src + ')')(g, { x: r.cx, z: r.cz, alt: 70, yaw: Math.atan2(-r.cx, -r.cz), pitch: -0.15 });
        g.move(0, 1);
        g.hold('dash', true);
        for (let i = 0; i < 4; i++) g.step(40);
        const st = g.stats();
        return { boost: g.ctx.player.move.boost, speed: g.ctx.vfx.debugState().speed, fx: g.ctx.render.screenFx ? g.ctx.render.screenFx().speed : -1, dc: st.drawCalls };
      }, VIEW);
      console.log(`  ${tag} sonic: ${JSON.stringify(sonic)}`);
      assert.ok(sonic.boost === 2 && sonic.speed > 0.5, `sonic stage with wind streaks (${JSON.stringify(sonic)})`);
      await shot(`look-${tag}-sonic`);
      await game((g) => { g.hold('dash', false); g.move(0, 0); g.step(30); });
      // Ringfall: after the crater forms the player stands in it, in view
      await game((g, src, spotSrc) => {
        const r = g.ctx.world.regions.find((q) => q.id === 'meadows');
        const p = (0, eval)('(' + spotSrc + ')')(g, r.cx - 150, r.cz + 90);
        (0, eval)('(' + src + ')')(g, { x: p.x, z: p.z, yaw: 2.4, pitch: -0.12 });
        g.spawn('choir_acolyte', { dist: 4 });
        g.setSurge(100);
        g.setOra(9999);
        g.use('ringfall');
        // vfx advance at most 0.1 s per rendered frame, so step in 6-tick chunks to keep effect time in step with sim time
        for (let i = 0; i < 40; i++) g.step(6);
      }, VIEW, SPOT);
      const rf = await game((g) => {
        const p = g.ctx.player;
        const cam = g.ctx.three.camera;
        let minClear = 99;
        for (let k = 1; k < 20; k++) {
          const t = k / 20;
          const x = cam.position.x + (p.pos.x - cam.position.x) * t;
          const y = cam.position.y + (p.pos.y + 1.2 - cam.position.y) * t;
          const z = cam.position.z + (p.pos.z - cam.position.z) * t;
          minClear = Math.min(minClear, y - g.ctx.world.heightAt(x, z));
        }
        return { minClear, ground: p.pos.y - g.ctx.world.heightAt(p.pos.x, p.pos.z), shells: g.ctx.vfx.debugState().shells };
      });
      console.log(`  ${tag} ringfall: ${JSON.stringify(rf)}`);
      assert.ok(rf.minClear > 0, `the terrain does not hide the player in the crater (${rf.minClear.toFixed(2)} m clear)`);
      assert.ok(rf.ground < 0.5, 'the player stands on the crater floor');
      // No screenshot here: with the camera inside a fresh crater the scorch layers fill the screen and SwiftShader
      // under load takes the page screenshot past its 30 s timeout. The check above is the regression guard.
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

export const scenarios = [
  worldScenario('portrait', 412, 915),
  worldScenario('landscape', 915, 412),
  actorScenario('portrait', 412, 915),
  actorScenario('landscape', 915, 412),
  momentScenario('portrait', 412, 915),
  momentScenario('landscape', 915, 412),
];
