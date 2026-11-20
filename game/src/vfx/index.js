/**
 * gfx package, vfx service root (ARCHITECTURE 2.3, 4.4, 8.3): replaces the stand-in `ctx.vfx` and subscribes the
 * automatic effects of 4.4.
 * @module vfx
 */
import { createVfx } from './service.js';
import { registerVfxTestbed } from './testbed.js';

export const pkg = {
  id: 'vfx',
  /** @param {any} ctx */
  install(ctx) {
    const { vfx, updateSystem, auto, build } = createVfx(ctx);
    ctx.provide('vfx', vfx, 'vfx');
    ctx.systems.add(updateSystem);
    const bus = ctx.bus;
    bus.on('combat:hit', auto.hit);
    bus.on('combat:techStart', auto.techStart);
    bus.on('combat:techPhase', auto.techPhase);
    bus.on('projectile:spawned', auto.projectileSpawned);
    bus.on('projectile:removed', auto.projectileRemoved);
    bus.on('combat:telegraph', auto.telegraph);
    bus.on('combat:flicker', auto.flicker);
    bus.on('actor:died', auto.died);
    bus.on('actor:knocked', auto.knocked);
    bus.on('actor:slam', auto.slam);
    bus.on('world:crater', auto.crater);
    bus.on('world:propDestroyed', auto.propDestroyed);
    bus.on('rpg:levelUp', auto.levelUp);
    bus.on('move:boost', auto.boost);
    bus.on('actor:landed', auto.landed);
    bus.on('actor:step', auto.step);
    bus.on('move:jump', auto.jump);
    bus.on('move:mode', auto.mode);
    bus.on('pickup:spawned', auto.pickup);
    bus.on('fx:impact', auto.impact);
    bus.on('quality:changed', auto.quality);
    registerVfxTestbed(ctx);
    ctx.onBoot(() => {
      if (ctx.vfx === vfx) build();
    });
  },
};
