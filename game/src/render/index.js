/**
 * gfx package, render service root (ARCHITECTURE 2.3, 4.3, 8.3): replaces the stand-in `ctx.render`.
 * @module render
 */
import { createRender } from './renderer.js';
import { STRINGS } from './strings.js';
import { registerTestbed } from './testbed.js';

export const pkg = {
  id: 'render',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(STRINGS);
    const r = createRender(ctx);
    ctx.provide('render', r.render, 'render');
    ctx.systems.add(r.drawSystem);
    ctx.bus.on('settings:changed', r.onSettings);
    ctx.bus.on('cine:start', r.onCine);
    ctx.bus.on('cine:end', r.onCineEnd);
    ctx.bus.on('player:spawned', r.onSpawn);
    registerTestbed(ctx);
  },
};
