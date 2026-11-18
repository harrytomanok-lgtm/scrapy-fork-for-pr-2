/**
 * look scenarios: the visual quality gallery of the merged game on the low tier at res=1, in portrait (412x915)
 * and landscape (915x412). Every view uses the real follow camera unless it frames a character close up.
 * Run with `node tools/scenarios.mjs look [--only name]`. Screenshots go to tools/out/shots/look-*.png.
 */

/** Boot state: test journey, AI and ambient spawns off, everything unlocked, noon. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  await game((g) => {
    g.ai(false);
    g.ambient(false);
    g.unlockAll();
    g.setHour(12);
    g.killAll();
    g.step(2);
  });
}

/**
 * In the page: put the player at (x, z) facing yaw (alt > 0 flies), set the follow camera, settle and render.
 * Returns the frame stats. Kept as a string so it can be shared by every page call.
 */
const VIEW = `(g, o) => {
  g.cmd.actorsStage(null);
  g.teleport(o.x, o.z, { alt: o.alt || 0, yaw: o.yaw });
  g.setCamera({ yaw: o.yaw, pitch: o.pitch, dist: o.dist });
  g.step(3);
  g.cmd.flushBuilds();
  g.step(40);
  g.cmd.flushBuilds();
  g.step(20);
  const s = g.stats();
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs };
}`;

/** In the page: the world views of the gallery, in order. */
function worldViews(g) {
  const out = [];
  for (const r of g.ctx.world.regions) {
    // look across the region toward the island centre; the Spire region looks outward
    const yaw = r.id === 'spire' ? 0.6 : Math.atan2(-r.cx, -r.cz);
    out.push({ name: 'day-' + r.id, x: r.cx, z: r.cz, yaw, pitch: -0.08, hour: 12 });
  }
  const sp = g.ctx.world.landmark('sparkstead');
  out.push({ name: 'sparkstead-dusk', x: sp.x + 18, z: sp.z + 26, yaw: Math.atan2(-18, -26), pitch: -0.05, hour: 19.5 });
  out.push({ name: 'sparkstead-night', x: sp.x + 18, z: sp.z + 26, yaw: Math.atan2(-18, -26), pitch: -0.05, hour: 0 });
  const m = g.ctx.world.regions.find((r) => r.id === 'meadows');
  out.push({ name: 'flight-150', x: m.cx, z: m.cz, alt: 150, yaw: Math.atan2(-m.cx, -m.cz), pitch: -0.3, hour: 12 });
  const ap = g.ctx.world.landmark('spire_approach');
  out.push({ name: 'spire-approach', x: ap.x, z: ap.z, yaw: Math.atan2(-ap.x, -ap.z), pitch: 0.12, hour: 12 });
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
      const views = await game(worldViews);
      assert.ok(views.length === 11, 'eleven world views');
      for (const v of views) {
        const s = await game((g, src, o) => {
          g.setHour(o.hour);
          return (0, eval)('(' + src + ')')(g, o);
        }, VIEW, v);
        assert.ok(s.drawCalls <= 120 && s.triangles <= 250000 && s.programs <= 24, `${v.name}: within the low budget (${s.drawCalls} dc, ${s.triangles} tris, ${s.programs} programs)`);
        await shot(`look-${tag}-${v.name}`);
      }
      const errs = await game((g) => g.errors.filter((e) => e.indexOf('[error]') === 0 || e.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  };
}

/** @param {string} tag @param {number} width @param {number} height */
function actorScenario(tag, width, height) {
  return {
    name: 'look-actors-' + tag,
    width,
    height,
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const sp = await game((g) => {
        const s = g.ctx.world.landmark('sparkstead');
        return { x: s.x + 30, z: s.z + 40 };
      });
      // hero close up, base form and each Form, with the stage camera following the player
      for (const form of [null, 'ember', 'tempest', 'zenith']) {
        await game((g, src, o, f) => {
          (0, eval)('(' + src + ')')(g, o);
          g.setForm(f);
          g.step(60);
          g.cmd.actorsFollow(3.2, 0.5, 0.15);
          g.step(4);
        }, VIEW, { x: sp.x, z: sp.z, yaw: 2.4, pitch: -0.05 }, form);
        await shot(`look-${tag}-hero-${form || 'base'}`);
      }
      await game((g) => { g.setForm(null); g.cmd.actorsFollow(0); g.step(10); });
      // the nine enemies in a row
      await game((g) => {
        g.cmd.actorsLineup({ ids: ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard'],
          dist: 12, back: 9, up: 2.4, look: 1.0 });
        g.step(4);
      });
      await shot(`look-${tag}-enemies`);
      // each boss on its own, front three-quarter
      for (const b of ['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal']) {
        await game((g, id) => {
          const ids = g.cmd.actorsLineup({ ids: [id], dist: 14 });
          const e = g.ctx.ents.get(ids[0]);
          const bd = g.ctx.actors.bounds(id);
          const h = Math.max(2, bd.height || 3);
          const d = Math.max(4.5, h * 1.9);
          const a = e.yaw + 0.35;
          g.cmd.actorsStage([e.pos.x + Math.sin(a) * d, e.pos.y + h * 0.75, e.pos.z + Math.cos(a) * d], [e.pos.x, e.pos.y + h * 0.5, e.pos.z]);
          g.step(4);
        }, b);
        await shot(`look-${tag}-boss-${b}`);
      }
      // a combat moment with effects, through the real follow camera
      await game((g, src, o) => {
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
      }, VIEW, { x: sp.x, z: sp.z, yaw: 2.4, pitch: -0.12 });
      await shot(`look-${tag}-combat`);
      await game((g) => { g.use('ora_bolt'); g.step(6); });
      await shot(`look-${tag}-combat2`);
      const nan = await game((g) => g.cmd.actorsNaN());
      assert.equal(nan, 0, 'no NaN bone matrices');
    },
  };
}

export const scenarios = [
  worldScenario('portrait', 412, 915),
  worldScenario('landscape', 915, 412),
  actorScenario('portrait', 412, 915),
  actorScenario('landscape', 915, 412),
];
