/**
 * gfx scenarios (ARCHITECTURE 8.3): materials, the VFX gallery, beam and auras, tiers.
 * Run with `node tools/scenarios.mjs gfx [--only name]`. Screenshots go to tools/out/shots.
 */

/** Boot state shared by every scenario: test journey running, HUD on top. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  return p;
}

export const scenarios = [
  {
    name: 'gfx-materials',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const progAfterCompile = await game((g) => g.stats().programs);
      await game((g) => {
        g.setHour(12);
        g.cmd.gfxTestRow({});
        g.setCamera({ pitch: 0.12, dist: 4 });
        g.step(20);
      });
      await shot('gfx-materials-noon');
      const s = await game((g) => g.stats());
      assert.ok(s.programs <= 30, `programs on low <= 30 (got ${s.programs})`);
      assert.equal(s.programs, progAfterCompile, 'no program linked after compile');
      assert.ok(s.drawCalls <= 120, `draw calls <= 120 (got ${s.drawCalls})`);
      await game((g) => {
        g.setHour(0);
        g.step(20);
      });
      await shot('gfx-materials-midnight');
      const s2 = await game((g) => g.stats());
      assert.equal(s2.programs, progAfterCompile, 'no program linked at night');
      console.log(`    programs after compile: ${progAfterCompile}, draw calls ${s.drawCalls}, triangles ${s.triangles}`);
    },
  },
  {
    name: 'gfx-vfx-gallery',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const prog0 = await game((g) => g.stats().programs);
      const n = await game((g) => {
        g.setHour(12);
        g.ai(false);
        g.setCamera({ pitch: -0.7, dist: 24 });
        g.step(2);
        const k = g.cmd.gfxGallery({ dist: 16, cols: 8, spacing: 5 });
        g.step(4);
        return k;
      });
      assert.ok(n >= 46, 'every IDS.vfx recipe triggered');
      await shot('gfx-vfx-gallery-a');
      let maxP = 0;
      for (let i = 0; i < 4; i++) {
        const p = await game((g) => {
          g.step(5);
          return g.stats().particles;
        });
        maxP = Math.max(maxP, p);
      }
      await shot('gfx-vfx-gallery-b');
      const s = await game((g) => g.stats());
      assert.ok(maxP <= 800, `particles on low <= 800 (max ${maxP})`);
      assert.ok(maxP > 100, `the gallery emitted particles (max ${maxP})`);
      assert.equal(s.programs, prog0, 'no program linked by the gallery');
      console.log(`    gallery: max particles ${maxP}, draw calls ${s.drawCalls}, programs ${s.programs}`);
    },
  },
  {
    name: 'gfx-beam-aura',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const prog0 = await game((g) => g.stats().programs);
      const ids = await game((g) => {
        g.setHour(17.5);
        g.ai(false);
        g.setCamera({ pitch: -0.18, dist: 5 });
        const r = g.cmd.gfxBeamAura({ dist: 9 });
        for (let i = 0; i < 10; i++) g.step(3);
        return r;
      });
      assert.equal(ids.length, 4, 'four actors with auras');
      await shot('gfx-beam-aura');
      const st = await game((g) => g.cmd.gfxVfxState());
      assert.ok(st.beams >= 1, 'a beam is live');
      assert.ok(st.shells >= 4, 'four aura shells are live');
      const s = await game((g) => g.stats());
      assert.equal(s.programs, prog0, 'no program linked by beams and auras');
      await game((g) => {
        g.setHour(0);
        g.step(6);
      });
      await shot('gfx-beam-aura-night');
    },
  },
  {
    name: 'gfx-telegraphs',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      await game((g) => {
        g.setHour(12);
        g.ai(false);
        g.setCamera({ pitch: -0.55, dist: 9 });
        g.step(2);
        g.cmd.gfxTelegraphs({ dist: 13, seconds: 1.5 });
        for (let i = 0; i < 9; i++) g.step(5);
      });
      await shot('gfx-telegraphs');
      const st = await game((g) => g.cmd.gfxVfxState());
      assert.ok(st.decals >= 6, `rings and ground shapes are live (${st.decals})`);
      assert.ok(st.beams >= 1, 'the violet tether line is live');
    },
  },
  {
    name: 'gfx-tiers',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const view = (g) => {
        g.setHour(17.5);
        g.ai(false);
        g.setCamera({ pitch: -0.15, dist: 5 });
        g.step(4);
      };
      await game(view);
      const low0 = await game((g) => g.stats());
      assert.equal(low0.tier, 'low');
      assert.ok(low0.programs <= 30, `programs on low <= 30 (${low0.programs})`);
      await game((g) => {
        g.cmd.gfxBeamAura({ dist: 9 });
        g.step(6);
      });
      await shot('gfx-tiers-low');
      const low1 = await game((g) => g.stats());
      assert.ok(low1.drawCalls <= 120, `low draw calls <= 120 (${low1.drawCalls})`);
      await game((g) => {
        g.setTier('high');
        g.step(6);
      });
      await shot('gfx-tiers-high');
      const high0 = await game((g) => g.stats());
      assert.equal(high0.tier, 'high');
      assert.ok(high0.programs <= 32, `programs on high <= 32 (${high0.programs})`);
      // a scripted mix of materials, recipes, auras, telegraphs and screen effects: no new program
      await game((g) => {
        const c = g.ctx;
        g.cmd.gfxTestRow({});
        g.cmd.gfxGallery({ dist: 18 });
        g.cmd.gfxTelegraphs({ dist: 14 });
        c.render.flash(0xffffff, 0.3, 0.2);
        c.render.vignette(0x1b1626, 0.6, 1);
        c.render.desaturate(0.5, 1);
        for (let i = 0; i < 40; i++) {
          c.render.speedLines(0.8);
          g.step(3);
        }
      });
      const high1 = await game((g) => g.stats());
      assert.equal(high1.programs, high0.programs, `programs constant on high (${high0.programs} -> ${high1.programs})`);
      assert.ok(high1.drawCalls <= 350, `high draw calls <= 350 (${high1.drawCalls})`);
      assert.ok(high1.particles <= 3500);
      console.log(`    low: programs ${low1.programs}, draws ${low1.drawCalls}; high: programs ${high1.programs}, draws ${high1.drawCalls}`);
    },
  },
  {
    name: 'gfx-flash-settings',
    async run({ game, assert }) {
      await opening(game, assert);
      const r = await game((g) => {
        const c = g.ctx;
        let shown = 0;
        let maxA = 0;
        for (let i = 0; i < 10; i++) {
          if (c.render.flash(0xffffff, 0.9, 0.1)) shown++;
          maxA = Math.max(maxA, c.render.screenFx().flash);
        }
        g.step(120);
        c.save.setSetting('photosensitive', true);
        let shownP = 0;
        let maxP = 0;
        for (let i = 0; i < 10; i++) {
          if (c.render.flash(0xffffff, 0.9, 0.1)) shownP++;
          maxP = Math.max(maxP, c.render.screenFx().flash);
        }
        c.save.setSetting('photosensitive', false);
        return { shown, maxA, shownP, maxP };
      });
      assert.ok(r.shown <= 3 && r.shown > 0, `normal: at most 3 flashes (${r.shown})`);
      assert.ok(r.maxA <= 0.4 + 1e-6, `normal: alpha <= 0.4 (${r.maxA})`);
      assert.ok(r.shownP <= 2 && r.shownP > 0, `photosensitive: at most 2 (${r.shownP})`);
      assert.ok(r.maxP <= 0.25 + 1e-6, `photosensitive: alpha <= 0.25 (${r.maxP})`);
    },
  },
  {
    name: 'gfx-resize',
    async run({ page, game, assert, shot }) {
      await opening(game, assert);
      await game((g) => g.step(4));
      await page.setViewportSize({ width: 400, height: 800 });
      await page.waitForTimeout(300);
      await game((g) => {
        g.step(4);
        g.cmd.gfxBeamAura({ dist: 8 });
        g.step(6);
      });
      await shot('gfx-resize-portrait');
      const s = await game((g) => {
        const cv = g.ctx.three.renderer.domElement;
        return { w: cv.width, h: cv.height, cam: g.ctx.three.camera.aspect, errors: g.errors.length };
      });
      assert.ok(s.h > s.w, `portrait drawing buffer (${s.w}x${s.h})`);
      assert.ok(Math.abs(s.cam - 0.5) < 0.02, `camera aspect follows (${s.cam})`);
      assert.equal(s.errors, 0);
    },
  },
  {
    name: 'gfx-combat-auto',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.setHour(12);
        g.god(true);
        const id = g.spawn('tusk_boar', { dist: 40, passive: true });
        g.setCamera({ pitch: -0.12, dist: 4 });
        g.step(2);
        g.press('bolt');
        g.step(6);
        g.press('bolt');
        g.step(3);
        return { id, st: g.cmd.gfxVfxState() };
      });
      await shot('gfx-combat-bolts');
      assert.ok(r.st.projectiles >= 1, 'projectile visuals tracked');
      const k = await game((g) => {
        g.killAll();
        g.step(8);
        return g.cmd.gfxVfxState();
      });
      await shot('gfx-combat-death');
      assert.ok(k.orbs >= 1 || k.particles > 0, 'death particles and XP orbs');
    },
  },
  {
    // render polish: the phone tier's shadow map (on by default, shed on request), the blob fade, and ?res up to 2
    name: 'gfx-shadows',
    query: 'res=2&hour=16',
    width: 412,
    height: 915,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const on = await game((g) => {
        g.step(20);
        g.render();
        const q = g.ctx.render.quality();
        return { q, dc: g.stats().drawCalls, programs: g.stats().programs };
      });
      assert.equal(on.q.shadows, true, 'the low tier draws the shadow map');
      assert.equal(on.q.shadow.size, 1024);
      assert.equal(on.q.scale, 2, 'res=2 asks for pixel ratio 2 on the low tier');
      assert.deepEqual(on.q.canvas, [412, 915], 'but never above the device ratio (1 in the harness)');
      assert.ok(on.programs <= 30, `programs ${on.programs} <= 30`);
      await shot('gfx-shadows-on');
      const off = await game((g) => {
        g.ctx.render.setShadows(false);
        g.render();
        const q = g.ctx.render.quality();
        return { q, dc: g.stats().drawCalls, p: g.ctx.render.globals.uShadowP.value.w };
      });
      assert.equal(off.q.shadows, false);
      assert.equal(off.p, 0, 'receivers are off');
      assert.ok(off.dc < on.dc, `the shadow pass costs draw calls (${on.dc} on, ${off.dc} off)`);
      await shot('gfx-shadows-off');
      const back = await game((g) => {
        g.ctx.render.setShadows(true);
        g.render();
        return g.ctx.render.quality().shadows;
      });
      assert.equal(back, true);
    },
  },
];
