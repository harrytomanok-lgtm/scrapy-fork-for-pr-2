/**
 * fx scenarios: the effects review gallery (vfx package). Every player technique, Form, hit class, telegraph, death,
 * reward, world and movement effect is captured on its own, at its peak, on the phone tier (low, res=1, portrait
 * 412x915), then laid out as labelled contact sheets (tools/out/shots/fx-sheet-*.png) for review.
 * The gallery also holds the effect budgets: no program linked after compile, live particles within the tier cap,
 * and the draw calls of a fight within 120.
 * Run with `node tools/scenarios.mjs fx [--only name]`. Single shots go to tools/out/shots/fx-<name>.png.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_SHOTS } from '../lib/harness.mjs';

/** In the page: a dry, flat meadow spot near (x, z), away from the Spire (spiral search). */
const SPOT = `(g, x, z, flat) => {
  const w = g.ctx.world;
  const ok = (px, pz) => {
    const h = w.heightAt(px, pz);
    if (h < 4 || Math.hypot(px, pz) < 200) return false;
    for (let a = 0; a < 8; a++) {
      for (const d of [6, 14]) {
        if (Math.abs(w.heightAt(px + Math.cos(a * 0.785) * d, pz + Math.sin(a * 0.785) * d) - h) > flat) return false;
      }
    }
    return w.waterDepthAt(px, pz) <= 0;
  };
  for (let r = 0; r < 1200; r += 25) {
    const n = Math.max(1, Math.floor(r / 12));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}`;

/** In the page: install the gallery helpers on window.__fx (kept as a string so every call can share them). */
const HELPERS = `(g) => {
  const fx = {};
  /** step n ticks in chunks of at most 6 (vfx advance at most 0.1 s per rendered frame) */
  fx.run = (n) => { let k = n; while (k > 0) { const s = Math.min(6, k); g.step(s); k -= s; } };
  /** a point d metres ahead of P (and s to the right) on the ground */
  fx.at = (P, d, s = 0) => {
    const fx_ = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    const x = P.x + fx_ * d - fz * s, z = P.z + fz * d + fx_ * s;
    return { x, z, y: Math.max(0, g.ctx.world.groundAt(x, 800, z)) };
  };
  fx.dummy = (P, d, id = 'tusk_boar', s = 0) => {
    const q = fx.at(P, d, s);
    return g.spawn(id, { x: q.x, z: q.z, passive: true, level: 30 });
  };
  /** a fresh stage d metres to the hero's left (craters stay where they formed) */
  fx.stage = (P, d) => {
    const q = fx.at(P, 0, -d);
    const Q = { x: q.x, z: q.z, yaw: P.yaw };
    g.teleport(Q.x, Q.z, { yaw: Q.yaw });
    g.cmd.flushBuilds();
    g.step(2);
    return Q;
  };
  /** the follow camera at a yaw offset from the hero's facing */
  fx.cam = (P, off = 0.9, pitch = -0.12, dist = 6) => g.setCamera({ yaw: P.yaw + off, pitch, dist });
  /** a pooled-event shaped combat:hit at a point */
  fx.hit = (cls, x, y, z, o = {}) => g.ctx.bus.emit('combat:hit', Object.assign({ attackerId: g.ctx.player.id, targetId: 0, techId: 'strike_string',
    class: cls, amount: 10, x, y, z, dirX: 0, dirZ: 1, blocked: false, perfect: false, crit: false }, o));
  /** a clean stage: nothing alive, no pickups or projectiles, no effects, base form, full Ora, idle */
  fx.clean = (P) => {
    g.clearInput();
    g.killAll();
    for (const kind of ['pickup', 'projectile']) for (const e of g.ctx.ents.list(kind).slice()) g.ctx.ents.destroy(e.id);
    g.lock(0);
    if (g.ctx.player.combat.formId) g.setForm(null);
    g.teleport(P.x, P.z, { yaw: P.yaw });
    g.setOra(9999);
    g.setSurge(0);
    g.step(2);
    g.cmd.vfxReset();
    g.ctx.render.speedLines && g.ctx.render.speedLines(0);
    g.step(2);
  };
  window.__fx = fx;
}`;

/**
 * The gallery. Each entry: name, label, and the page function (g, P, fx) that stages the effect and steps to its
 * peak. P = { x, z, yaw } of the stage; the hero stands at P facing yaw.
 */
const EFFECTS = [
  // ---------------------------------------------------------------- melee
  { name: 'strike-1', label: 'Strike String hit 1 (light)', fn: (g, P, fx) => {
    fx.dummy(P, 2.4); fx.cam(P); g.step(2);
    g.use('strike_string', { force: true }); fx.run(5);
  } },
  { name: 'strike-3', label: 'Strike String hit 3 (heavy)', fn: (g, P, fx) => {
    fx.dummy(P, 2.4); fx.cam(P); g.step(2);
    g.use('strike_string', { force: true }); fx.run(8); g.press('attack'); fx.run(12); g.press('attack'); fx.run(9);
  } },
  { name: 'strike-5', label: 'Strike String hit 5 (finisher)', fn: (g, P, fx) => {
    fx.dummy(P, 2.4); fx.cam(P); g.step(2);
    g.use('strike_string', { force: true });
    for (let i = 0; i < 4; i++) { fx.run(8); g.press('attack'); fx.run(9); }
    fx.run(4);
  } },
  { name: 'breaker', label: 'Breaker (charged launch)', fn: (g, P, fx) => {
    fx.dummy(P, 2.6); fx.cam(P); g.step(2);
    g.use('breaker', { force: true, charge: 1 }); fx.run(12);
  } },
  { name: 'meteor-heel', label: 'Meteor Heel (air slam)', fn: (g, P, fx) => {
    fx.dummy(P, 3.5); fx.cam(P, 0.9, -0.2, 8);
    const q = fx.at(P, 1.5);
    g.teleport(q.x, q.z, { alt: 7, yaw: P.yaw, fly: false });
    g.step(2);
    g.use('meteor_heel', { force: true }); fx.run(16);
  } },
  { name: 'pursuit', label: 'Pursuit (dash to target)', fn: (g, P, fx) => {
    const id = fx.dummy(P, 14); fx.cam(P, 1.3, -0.1, 9); g.step(2);
    g.use('pursuit', { force: true, targetId: id }); fx.run(5);
  } },
  { name: 'guard', label: 'Guard shell', fn: (g, P, fx) => {
    fx.cam(P, 2.4, -0.1, 5); g.step(2);
    g.hold('guard', true); fx.run(18);
  } },
  { name: 'guard-block', label: 'Guard block', fn: (g, P, fx) => {
    fx.cam(P, 2.4, -0.1, 5); g.hold('guard', true); fx.run(18);
    const p = g.ctx.player.pos;
    fx.hit('lightHit', p.x + Math.sin(P.yaw) * 0.8, p.y + 1.1, p.z + Math.cos(P.yaw) * 0.8, { blocked: true, attackerId: 0, targetId: g.ctx.player.id });
    fx.run(3);
  } },
  { name: 'guard-perfect', label: 'Perfect guard', fn: (g, P, fx) => {
    fx.cam(P, 2.4, -0.1, 5); g.hold('guard', true); fx.run(18);
    const p = g.ctx.player.pos;
    fx.hit('lightHit', p.x + Math.sin(P.yaw) * 0.8, p.y + 1.1, p.z + Math.cos(P.yaw) * 0.8, { perfect: true, attackerId: 0, targetId: g.ctx.player.id });
    g.ctx.bus.emit('combat:perfect', { entId: g.ctx.player.id, kind: 'guard', attackerId: 0 });
    fx.run(4);
  } },
  { name: 'flicker', label: 'Flicker Step', fn: (g, P, fx) => {
    fx.cam(P, 1.57, -0.12, 9); g.step(2);
    g.use('flicker_step', { force: true, dirX: Math.cos(P.yaw), dirZ: -Math.sin(P.yaw) }); fx.run(6);
  } },
  { name: 'gather', wait: 0.6, label: 'Gather (charging Ora)', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.08, 5); g.setOra(10); g.step(2);
    g.hold('gather', true); fx.run(90);
  } },
  // ---------------------------------------------------------------- Ora energy
  { name: 'bolt-flight', label: 'Ora Bolt in flight', fn: (g, P, fx) => {
    fx.dummy(P, 22); fx.cam(P, 0.5, -0.06, 5); g.step(2);
    g.use('ora_bolt', { force: true }); fx.run(6);
  } },
  { name: 'bolt-hit', label: 'Ora Bolt impact', fn: (g, P, fx) => {
    const id = fx.dummy(P, 9); fx.cam(P, 0.7, -0.08, 6); g.step(2);
    g.use('ora_bolt', { force: true, targetId: id }); fx.run(10);
  } },
  { name: 'barrage', label: 'Flare Barrage', fn: (g, P, fx) => {
    const id = fx.dummy(P, 12); fx.cam(P, 0.6, -0.08, 6); g.step(2);
    g.use('flare_barrage', { force: true, targetId: id }); fx.run(36);
  } },
  { name: 'lance-charge-0', label: 'Dawn Lance charge, early', fn: (g, P, fx) => {
    fx.cam(P, 2.3, -0.05, 4.5); g.step(2);
    g.use('dawn_lance', { force: true, hold: true }); fx.run(14);
  } },
  { name: 'lance-charge-1', label: 'Dawn Lance charge, full', fn: (g, P, fx) => {
    fx.cam(P, 2.3, -0.05, 4.5); g.step(2);
    g.use('dawn_lance', { force: true, hold: true });
    const mx = g.ctx.defs.find('technique', 'dawn_lance').charge.max;
    fx.run(Math.max(10, Math.round(mx * 60) - 4));
  } },
  { name: 'lance-beam-0', label: 'Dawn Lance beam, uncharged', fn: (g, P, fx) => {
    fx.dummy(P, 16); fx.cam(P, 0.75, -0.08, 7); g.step(2);
    g.use('dawn_lance', { force: true, charge: 0 }); fx.run(24);
  } },
  { name: 'lance-beam-1', label: 'Dawn Lance beam, full charge', fn: (g, P, fx) => {
    fx.dummy(P, 16); fx.cam(P, 0.75, -0.08, 7); g.step(2);
    g.use('dawn_lance', { force: true, hold: true });
    fx.run(Math.round(g.ctx.defs.find('technique', 'dawn_lance').charge.max * 60) + 22);
  } },
  { name: 'nova', label: 'Nova Ring', fn: (g, P, fx) => {
    fx.dummy(P, 4); fx.dummy(P, 4, 'tusk_boar', 3); fx.cam(P, 0.9, -0.3, 11); g.step(2);
    g.use('nova_ring', { force: true }); fx.run(23);
  } },
  // ---------------------------------------------------------------- Forms
  { name: 'form-ember', wait: 0.85, label: 'Ember Form aura', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.08, 5); g.setForm('ember'); fx.run(60);
  } },
  { name: 'form-tempest', wait: 0.85, label: 'Tempest Form aura', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.08, 5); g.setForm('tempest'); fx.run(60);
  } },
  { name: 'form-zenith', wait: 0.85, label: 'Zenith Form aura', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.08, 5); g.setForm('zenith'); fx.run(60);
  } },
  { name: 'transform', label: 'Transformation (Ember)', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.08, 6); g.step(2);
    g.ctx.combat.setForm(g.ctx.player, 'ember', { free: true }); fx.run(36);
  } },
  { name: 'transform-burst', label: 'Transformation burst', fn: (g, P, fx) => {
    fx.cam(P, 2.6, -0.1, 8); g.step(2);
    g.ctx.combat.setForm(g.ctx.player, 'tempest', { free: true });
    let n = 0;
    while (g.ctx.player.combat.state === 'transform' && n < 400) { g.step(3); n += 3; }
    fx.run(4);
  } },
  // ---------------------------------------------------------------- hits by damage class (synthetic events at a dummy)
  { name: 'class-light', label: 'Hit class: light', fn: (g, P, fx) => {
    fx.dummy(P, 3); fx.cam(P, 0.55, -0.1, 5.5); g.step(2);
    const q = fx.at(P, 2.6); fx.hit('lightHit', q.x, q.y + 1, q.z, { dirX: Math.sin(P.yaw), dirZ: Math.cos(P.yaw) }); fx.run(2);
  } },
  { name: 'class-heavy', label: 'Hit class: heavy', fn: (g, P, fx) => {
    fx.dummy(P, 3); fx.cam(P, 0.55, -0.1, 5.5); g.step(2);
    const q = fx.at(P, 2.6); fx.hit('heavyHit', q.x, q.y + 1, q.z, { dirX: Math.sin(P.yaw), dirZ: Math.cos(P.yaw) }); fx.run(3);
  } },
  { name: 'class-finisher', label: 'Hit class: finisher', fn: (g, P, fx) => {
    fx.dummy(P, 3); fx.cam(P, 0.55, -0.1, 5.5); g.step(2);
    const q = fx.at(P, 2.6); fx.hit('finisher', q.x, q.y + 1, q.z, { dirX: Math.sin(P.yaw), dirZ: Math.cos(P.yaw) }); fx.run(4);
  } },
  { name: 'class-crit', label: 'Hit class: critical', fn: (g, P, fx) => {
    fx.dummy(P, 3); fx.cam(P, 0.55, -0.1, 5.5); g.step(2);
    const q = fx.at(P, 2.6); fx.hit('lightHit', q.x, q.y + 1, q.z, { crit: true, dirX: Math.sin(P.yaw), dirZ: Math.cos(P.yaw) }); fx.run(3);
  } },
  { name: 'class-enemy', label: 'Enemy hits the hero', fn: (g, P, fx) => {
    const id = fx.dummy(P, 2.2); fx.cam(P, 2.4, -0.1, 5); g.step(2);
    const p = g.ctx.player.pos;
    fx.hit('heavyHit', p.x, p.y + 1.1, p.z, { attackerId: id, targetId: g.ctx.player.id, dirX: -Math.sin(P.yaw), dirZ: -Math.cos(P.yaw) }); fx.run(3);
  } },
  { name: 'slam', label: 'Wall slam', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.2, 7); g.step(2);
    const q = fx.at(P, 4);
    g.ctx.bus.emit('actor:slam', { entId: 0, sourceId: g.ctx.player.id, x: q.x, y: q.y, z: q.z, speed: 26, surface: 'ground', damage: 10 }); fx.run(5);
  } },
  { name: 'launch', label: 'Launch and hurtle trail', fn: (g, P, fx) => {
    const id = fx.dummy(P, 2.4); fx.cam(P, 1.1, -0.1, 8); g.step(2);
    const e = g.ctx.ents.get(id);
    g.ctx.move.knock(e, Math.sin(P.yaw) * 16, 9, Math.cos(P.yaw) * 16, { hurtle: true, sourceId: g.ctx.player.id });
    fx.run(12);
  } },
  { name: 'explosion', label: 'Explosion M (enemy blast)', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.2, 9); g.step(2);
    const q = fx.at(P, 7); g.ctx.vfx.burst('explosion_m', q.x, q.y + 1, q.z, {}); fx.run(4);
  } },
  // ---------------------------------------------------------------- enemies
  { name: 'tele-white', label: 'Telegraph white', fn: (g, P, fx) => {
    const id = fx.dummy(P, 6); fx.cam(P, 0.6, -0.3, 7); g.step(2);
    const e = g.ctx.ents.get(id);
    g.ctx.bus.emit('combat:telegraph', { entId: id, kind: 'white', seconds: 1, shape: 'circle', radius: 3, x: e.pos.x, y: e.pos.y, z: e.pos.z, dirX: 0, dirZ: 1 });
    fx.run(24);
  } },
  { name: 'tele-red', label: 'Telegraph red (unblockable)', fn: (g, P, fx) => {
    const id = fx.dummy(P, 6); fx.cam(P, 0.6, -0.3, 7); g.step(2);
    const e = g.ctx.ents.get(id);
    g.ctx.bus.emit('combat:telegraph', { entId: id, kind: 'red', seconds: 1, shape: 'line', radius: 8, x: e.pos.x, y: e.pos.y, z: e.pos.z, dirX: -Math.sin(P.yaw), dirZ: -Math.cos(P.yaw) });
    fx.run(24);
  } },
  { name: 'tele-violet', label: 'Telegraph violet (grab)', fn: (g, P, fx) => {
    const id = fx.dummy(P, 6, 'choir_caster'); fx.cam(P, 0.6, -0.3, 7); g.step(2);
    const e = g.ctx.ents.get(id);
    g.ctx.bus.emit('combat:telegraph', { entId: id, kind: 'violet', seconds: 1, shape: 'cone', radius: 6, x: e.pos.x, y: e.pos.y, z: e.pos.z, dirX: -Math.sin(P.yaw), dirZ: -Math.cos(P.yaw) });
    fx.run(24);
  } },
  { name: 'death-beast', label: 'Death: beast', fn: (g, P, fx) => {
    const id = fx.dummy(P, 4); fx.cam(P, 0.9, -0.12, 7); g.step(2); g.kill(id); fx.run(8);
  } },
  { name: 'death-choir', label: 'Death: Choir', fn: (g, P, fx) => {
    const id = fx.dummy(P, 4, 'choir_acolyte'); fx.cam(P, 0.9, -0.12, 7); g.step(2); g.kill(id); fx.run(8);
  } },
  { name: 'xp-motes', label: 'XP motes flying to the hero', fn: (g, P, fx) => {
    const id = fx.dummy(P, 6, 'choir_acolyte'); fx.cam(P, 1.0, -0.14, 8); g.step(2); g.kill(id); fx.run(34);
  } },
  { name: 'boss-death', label: 'Boss death', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.2, 12); g.step(2);
    const q = fx.at(P, 9);
    g.ctx.bus.emit('actor:died', { entId: 0, sourceId: g.ctx.player.id, kind: 'boss', defId: 'durn', level: 20, questTag: '', x: q.x, y: q.y, z: q.z });
    fx.run(6);
  } },
  { name: 'boss-phase', label: 'Boss phase change', fn: (g, P, fx) => {
    const id = fx.dummy(P, 7, 'rust_golem'); fx.cam(P, 0.9, -0.15, 10); g.step(2);
    g.ctx.bus.emit('boss:phase', { bossId: 'durn', entId: id, phase: 2 }); fx.run(10);
  } },
  // ---------------------------------------------------------------- rewards and world
  { name: 'pickup', label: 'Pickups (common, fine, rare)', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.15, 7); g.step(2);
    const rows = [['common', -1.8], ['fine', 0], ['rare', 1.8]];
    for (const [rar, s] of rows) {
      const q = fx.at(P, 6, s);
      const e = g.ctx.ents.create('pickup');
      e.team = 0; e.defId = 'gallery'; e.radius = 0.3; e.height = 0.6;
      e.pos.set(q.x, q.y + 0.5, q.z); e.prev.copy(e.pos);
      e.data = { kind: 'item', itemId: null, amount: 0, level: 1, rarity: rar, life: 60 };
      g.ctx.bus.emit('pickup:spawned', { entId: e.id, kind: 'item', itemId: null, rarity: rar === 'common' ? null : rar });
    }
    fx.run(30);
  } },
  { name: 'level-up', label: 'Level-up', fn: (g, P, fx) => {
    fx.cam(P, 2.4, -0.1, 7); g.step(2);
    g.ctx.bus.emit('rpg:levelUp', { level: 26, statPoints: 3, tp: 1 }); fx.run(18);
  } },
  { name: 'ringstone', label: 'Ringstone activation', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.15, 9); g.step(2);
    const q = fx.at(P, 5);
    g.ctx.vfx.shockwave(q.x, q.y + 0.5, q.z, { radius: 6, color: 0x5fd3c4, seconds: 0.5 });
    g.ctx.bus.emit('ringstone:activated', { id: 'fx_gallery', first: true });
    fx.run(12);
  } },
  { name: 'siphon-break', label: 'Siphon destruction', fn: (g, P, fx) => {
    fx.cam(P, 0.9, -0.2, 16); g.step(2);
    const q = fx.at(P, 22);
    g.ctx.vfx.burst('siphon_break', q.x, q.y + 6, q.z, { scale: 0.35 });
    g.ctx.vfx.shockwave(q.x, q.y + 2, q.z, { radius: 60, color: 0x5fd3c4, seconds: 1.2, ground: true });
    fx.run(10);
  } },
  // ---------------------------------------------------------------- movement
  { name: 'land-heavy', label: 'Landing after a long fall', fn: (g, P, fx) => {
    fx.cam(P, 1.2, -0.15, 7); g.step(2);
    g.teleport(P.x, P.z, { alt: 26, yaw: P.yaw, fly: false });
    let n = 0;
    while (!g.ctx.player.move.grounded && n < 240) { g.step(3); n += 3; }
    fx.run(4);
  } },
  { name: 'run-dust', label: 'Sprint dust', fn: (g, P, fx) => {
    fx.cam(P, 2.0, -0.1, 6); g.step(2);
    g.move(0, 1); g.hold('dash', true); fx.run(80);
  } },
  { name: 'take-off', label: 'Take-off (jump to flight)', fn: (g, P, fx) => {
    fx.cam(P, 1.4, -0.1, 7); g.step(2);
    g.press('jump'); fx.run(10); g.press('jump'); fx.run(6);
  } },
  { name: 'boost-1', label: 'Flight boost stage 1', fn: (g, P, fx) => {
    g.teleport(P.x, P.z, { alt: 30, yaw: P.yaw }); fx.cam(P, 0.5, -0.12, 7); g.step(2);
    g.move(0, 1); g.hold('dash', true); fx.run(40);
  } },
  { name: 'boost-sonic', label: 'Sonic boost (stage change)', fn: (g, P, fx) => {
    g.teleport(P.x, P.z, { alt: 30, yaw: P.yaw }); fx.cam(P, 0.5, -0.12, 7); g.step(2);
    g.move(0, 1); g.hold('dash', true);
    let n = 0;
    while (g.ctx.player.move.boost < 2 && n < 400) { g.step(3); n += 3; }
    fx.run(5);
  } },
  // ---------------------------------------------------------------- craters last (each on its own ground)
  { name: 'ringfall-rise', label: 'Ringfall: rise', fn: (g, P0, fx) => {
    const P = fx.stage(P0, 45);
    fx.dummy(P, 5); fx.cam(P, 0.9, -0.12, 10); g.setSurge(100); g.step(2);
    g.use('ringfall', { force: true }); fx.run(14);
  } },
  { name: 'ringfall-sigil', label: 'Ringfall: sigil', fn: (g, P0, fx) => {
    const P = fx.stage(P0, 90);
    fx.dummy(P, 5); fx.cam(P, 0.9, -0.12, 10); g.setSurge(100); g.step(2);
    g.use('ringfall', { force: true }); fx.run(50);
  } },
  { name: 'ringfall-dive', label: 'Ringfall: dive', fn: (g, P0, fx) => {
    const P = fx.stage(P0, 135);
    fx.dummy(P, 5); fx.cam(P, 0.9, -0.12, 10); g.setSurge(100); g.step(2);
    g.use('ringfall', { force: true }); fx.run(68);
  } },
  { name: 'ringfall-impact', label: 'Ringfall: impact', fn: (g, P0, fx) => {
    const P = fx.stage(P0, 180);
    fx.dummy(P, 5); fx.cam(P, 0.9, -0.12, 10); g.setSurge(100); g.step(2);
    g.use('ringfall', { force: true }); fx.run(84);
  } },
  { name: 'crater', label: 'Crater (r 8)', fn: (g, P0, fx) => {
    const P = fx.stage(P0, 230);
    fx.cam(P, 0.9, -0.35, 14); g.step(2);
    const q = fx.at(P, 9); g.crater(q.x, q.z, 8, 1.5); fx.run(8);
  } },
];

/**
 * The player's aura ramps on rendered frames (real time, combat.visuals), so a Form or Gather shot waits until the
 * flame aura is up (or 15 s pass on a loaded machine). @param {any} page @param {number} min
 */
async function waitFlame(page, min) {
  try {
    await page.waitForFunction((m) => {
      const scene = window.__GAME__.ctx.three.scene;
      let up = false;
      scene.traverse((o) => { if (o.name === 'gfx.flame' && o.visible && o.material.uniforms.uAlpha.value > m) up = true; });
      return up;
    }, min, { timeout: 15000, polling: 250 });
  } catch (e) {
    // shoot anyway
  }
}

/** The low-tier fight budget (perf-budget). */
const FIGHT_DRAWS = 120;

export const scenarios = [
  {
    name: 'fx-gallery',
    width: 412,
    height: 915,
    query: 'res=1',
    async run({ page, game, assert, shot }) {
      const p = await game((g) => g.player());
      assert.ok(p, 'the player exists after boot');
      const only = process.env.FX_ONLY ? process.env.FX_ONLY.split(',') : null;
      const P = await game((g, spotSrc, helpers) => {
        g.ai(false);
        g.ambient(false);
        g.unlockAll();
        g.god(true);
        g.setLevel(25);
        g.setHour(15);
        g.killAll();
        (0, eval)('(' + helpers + ')')(g);
        const r = g.ctx.world.regions.find((q) => q.id === 'meadows');
        const s = (0, eval)('(' + spotSrc + ')')(g, r.cx + 120, r.cz - 60, 0.8);
        const yaw = Math.atan2(-s.x, -s.z) + 0.6;
        g.teleport(s.x, s.z, { yaw });
        g.cmd.flushBuilds();
        for (let i = 0; i < 6; i++) g.step(30);
        g.cmd.flushBuilds();
        return { x: s.x, z: s.z, yaw };
      }, SPOT, HELPERS);
      const prog0 = await game((g) => g.stats().programs);
      const cap = await game((g) => g.ctx.vfx.debugState().cap);
      let maxP = 0;
      let maxDraw = 0;
      /** @type {{ name:string, label:string, file:string }[]} */
      const done = [];
      for (const e of EFFECTS) {
        if (only && !only.includes(e.name)) continue;
        const st = await game((g, src, P0) => {
          const fx = window.__fx;
          fx.clean(P0);
          (0, eval)('(' + src + ')')(g, P0, fx);
          const s = g.stats();
          return { particles: s.particles, drawCalls: s.drawCalls, programs: s.programs };
        }, e.fn.toString(), P);
        maxP = Math.max(maxP, st.particles);
        maxDraw = Math.max(maxDraw, st.drawCalls);
        if (e.wait) await waitFlame(page, e.wait);
        const file = await shot('fx-' + e.name);
        done.push({ name: e.name, label: e.label, file });
        console.log(`    ${e.name}: ${st.particles} particles, ${st.drawCalls} dc`);
        assert.equal(st.programs, prog0, `${e.name}: no program linked`);
        await game((g) => { g.clearInput(); g.hold('guard', false); g.hold('gather', false); g.hold('dash', false); g.move(0, 0); g.step(2); });
      }
      assert.ok(maxP <= cap, `live particles within the tier cap (max ${maxP} of ${cap})`);
      // a fight with the strongest effects at once: within the low-tier draw-call budget
      const fight = await game((g, P0) => {
        const fx = window.__fx;
        fx.clean(P0);
        g.ai(true);
        for (let i = 0; i < 4; i++) fx.dummy(P0, 4 + i, i % 2 ? 'choir_acolyte' : 'tusk_boar', i - 1.5);
        g.ai(false);
        g.setForm('ember');
        fx.run(30);
        g.use('strike_string', { force: true }); fx.run(6);
        g.use('nova_ring', { force: true }); fx.run(20);
        g.use('ora_bolt', { force: true }); fx.run(4);
        const s = g.stats();
        return { drawCalls: s.drawCalls, particles: s.particles, programs: s.programs };
      }, P);
      await shot('fx-fight');
      console.log(`    fight: ${fight.drawCalls} dc, ${fight.particles} particles; gallery max ${maxDraw} dc`);
      assert.ok(fight.drawCalls <= FIGHT_DRAWS, `fight draw calls <= ${FIGHT_DRAWS} (${fight.drawCalls})`);
      assert.equal(fight.programs, prog0, 'no program linked in the fight');
      // contact sheets: 3 x 2 per sheet at half size, labelled
      const per = 6;
      const sheetPage = await page.context().newPage();
      await sheetPage.setViewportSize({ width: 3 * 206 + 16, height: 2 * (458 + 22) + 12 });
      for (let s = 0; s * per < done.length; s++) {
        const rows = done.slice(s * per, s * per + per).map((d) => {
          const b64 = readFileSync(d.file).toString('base64');
          return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${d.label}</figcaption></figure>`;
        }).join('');
        await sheetPage.setContent(`<html><body style="margin:4px;background:#222;display:grid;grid-template-columns:repeat(3,206px);gap:4px;font:12px sans-serif;color:#eee">
          <style>figure{margin:0}img{width:206px;height:458px;display:block}figcaption{height:18px;padding-top:2px;white-space:nowrap;overflow:hidden}</style>${rows}</body></html>`);
        await sheetPage.screenshot({ path: join(OUT_SHOTS, `fx-sheet-${String(s + 1).padStart(2, '0')}.png`) });
      }
      await sheetPage.close();
      const errs = await game((g) => g.errors.filter((x) => x.indexOf('[error]') === 0 || x.indexOf('[fatal]') === 0));
      assert.equal(errs.length, 0, 'no errors: ' + errs.join(' | '));
    },
  },
];
