/**
 * World package manifest (ARCHITECTURE 2.3, 8.1): replaces the stand-in `ctx.world`.
 * @module world
 */

import { createWorld, OWNER } from './service.js';
import { REGIONS, LANDMARKS } from './gen/layout.js';

export const pkg = {
  id: 'world',
  /** @param {any} ctx */
  install(ctx) {
    ctx.defs.register('region', REGIONS.slice());
    ctx.defs.register('landmark', LANDMARKS.slice());
    const { world, streamSystem, resetRegion, restoreProps, invalidateProps } = createWorld(ctx);
    ctx.provide('world', world, OWNER);
    ctx.systems.add(streamSystem);
    ctx.bus.on('game:loaded', restoreProps, OWNER);
    ctx.bus.on('game:ended', resetRegion, OWNER);
    ctx.bus.on('quality:changed', invalidateProps, OWNER);
    ctx.debug.register('flushBuilds', () => ctx.world.flushBuilds());
    ctx.debug.register('worldInfo', () => ctx.world.info());
  },
};
