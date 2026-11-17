/**
 * Journey start and end (ARCHITECTURE 3.1, final): `session.start` runs exactly the six steps of 3.1 and
 * `session.end` destroys all entities, emits `game:ended` and returns to the title.
 * @module game/session
 */

import { defaultState } from '../core/store.js';

/**
 * @typedef {object} StartOptions
 * @property {number} [slot=1]
 * @property {boolean} [newGame=false]
 * @property {string} [preset]      'hero_a' | 'hero_b' (new game)
 * @property {'m'|'f'} [gender]     form of address (new game)
 * @property {'story'|'warrior'|'master'} [difficulty]   (new game)
 */

/**
 * @typedef {object} Session
 * @property {(opts?:StartOptions) => boolean} start   false when the slot holds no loadable journey
 * @property {(opts?:{ toTitle?:boolean }) => void} end  toTitle defaults to true (opens the title screen)
 * @property {boolean} running
 * @property {number} slot
 */

/**
 * Seed of `rng.sim` and `rng.fx` for a journey: the `seed` flag, else the save's createdAt, else (a new
 * journey outside test mode) the wall clock at start. Test mode without a seed flag uses 1.
 * @param {any} flags @param {any} state
 * @returns {number}
 */
export function journeySeed(flags, state) {
  if (Number.isFinite(flags.seed)) return flags.seed;
  if (flags.test) return 1;
  const created = state && state.meta ? state.meta.createdAt : 0;
  return (created || Date.now()) >>> 0;
}

/**
 * Create `ctx.session`.
 * @param {any} ctx  every service is read at call time
 * @returns {Session}
 */
export function createSession(ctx) {
  /** @type {Session} */
  const session = {
    running: false,
    slot: 1,

    start(opts = {}) {
      const slot = Number.isInteger(opts.slot) ? /** @type {number} */ (opts.slot) : 1;
      const newGame = !!opts.newGame;
      // (1) load the slot or create a fresh state
      /** @type {any} */
      let state;
      if (newGame) {
        state = defaultState();
        state.meta.slot = slot;
        if (opts.preset) state.player.preset = opts.preset;
        if (opts.gender === 'm' || opts.gender === 'f') state.player.gender = opts.gender;
        if (opts.difficulty) state.player.difficulty = opts.difficulty;
      } else {
        state = ctx.save.load(slot);
        if (!state) {
          ctx.log.warn('session', 'no loadable journey in slot', slot);
          return false;
        }
      }
      if (session.running) session.end({ toTitle: false });
      const seed = journeySeed(ctx.flags, state);
      ctx.rng.sim.reset(seed);
      ctx.rng.fx.reset(seed ^ 0x9e3779b9);
      ctx.store.reset(state);
      const s = ctx.store.state;
      session.slot = slot;

      // (2) form of address
      ctx.i18n.setGender(s.player.gender);

      // (3) new-game listeners write the store only; then the spawn flag
      if (newGame) ctx.bus.emit('game:newGame', { slot });
      applySpawnFlag(ctx, s);

      // (4) the player entity
      const p = s.player;
      const ent = ctx.ents.create('player', { team: 1, defId: p.preset, yaw: p.yaw });
      if (!ent) throw new Error('session: the player entity could not be created');
      ctx.rpg.attachPlayer(ent);
      ctx.actors.create(ent, p.preset, {});
      ctx.combat.initActor(ent);
      ctx.move.initActor(ent, { canFly: !!p.canFly });
      const groundY = ctx.world.heightAt(p.x, p.z);
      ctx.move.teleport(ent, p.x, Math.max(p.y, groundY), p.z, p.yaw);
      ctx.cam.setTarget(ent.id);
      ctx.player = ent;
      ctx.input.setContext('game');
      ctx.bus.emit('actor:spawned', { entId: ent.id, kind: 'player', defId: ent.defId });

      // (5) packages sync runtime values out of the store
      ctx.save.runAfterLoad();

      // (6)
      session.running = true;
      ctx.bus.emit('player:spawned', { entId: ent.id });
      ctx.bus.emit('game:loaded', { slot, newGame });
      return true;
    },

    end(opts = {}) {
      if (session.running) {
        const all = ctx.ents.all().slice();
        for (const e of all) {
          if (!ctx.ents.get(e.id)) continue;
          const actor = e.kind === 'player' || e.kind === 'enemy' || e.kind === 'boss' || e.kind === 'npc';
          ctx.ents.destroy(e.id);
          if (actor) ctx.bus.emit('actor:removed', { entId: e.id, kind: e.kind, defId: e.defId });
        }
        ctx.ents.flush();
        ctx.bus.flush();
        ctx.player = null;
        session.running = false;
        ctx.bus.emit('game:ended', {});
      }
      if (opts.toTitle !== false && !ctx.flags.test && ctx.ui) ctx.ui.open('title');
    },
  };
  return session;
}

/**
 * Apply `flags.spawn` to the store's player position (3.1 step 3). A landmark or POI id resolves through the
 * world service; unknown ids are logged and ignored.
 * @param {any} ctx @param {any} s store state
 */
function applySpawnFlag(ctx, s) {
  const sp = ctx.flags.spawn;
  if (!sp) return;
  let x = sp.x;
  let z = sp.z;
  if (sp.landmark) {
    const w = ctx.world;
    const p = w.landmark(sp.landmark) || w.pois().find((q) => q.id === sp.landmark) || null;
    if (!p) {
      ctx.log.warn('session', 'spawn flag: unknown landmark or POI', sp.landmark);
      return;
    }
    x = p.x;
    z = p.z;
  }
  s.player.x = x;
  s.player.z = z;
  s.player.y = 0;
}
