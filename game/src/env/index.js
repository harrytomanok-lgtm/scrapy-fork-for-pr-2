/**
 * env package, service root (ARCHITECTURE 2.3, 4.2, 8.2): replaces the stand-in `ctx.env` with the clock, the
 * five-key lighting, the sky dome, the settlements and the gameplay prop visuals. (The audio half of the package
 * lives in src/audio and is installed separately.)
 * @module env
 */
import { createEnv } from './service.js';
import { SETTLEMENTS } from './data/settlements.js';

export const pkg = {
  id: 'env',
  /** @param {any} ctx */
  install(ctx) {
    ctx.defs.register('settlement', SETTLEMENTS.map((d) => JSON.parse(JSON.stringify(d))));
    const e = createEnv(ctx);
    ctx.provide('env', e.env, 'env');
    ctx.systems.add(e.clockSystem);
    ctx.bus.on('game:loaded', e.onLoaded);
    ctx.onBoot(() => {
      if (ctx.env === e.env) e.build();
    });
    if (ctx.debug && typeof ctx.debug.register === 'function') {
      ctx.debug.register('envInfo', () => e.env.info());
    }
  },
};
