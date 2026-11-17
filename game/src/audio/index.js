/**
 * Audio package root (ARCHITECTURE 2.3, 4.2, 8.2): provides `ctx.audio`, replacing the stand-in. All sound is
 * synthesised with WebAudio, no files: pre-rendered one-shots and instrument samples, four live loops plus an
 * ambience bed, event-driven SFX and the adaptive generative music.
 * @module audio
 */

import { createEngine } from './engine.js';
import { createMusic } from './music.js';
import { installWiring } from './wiring.js';

/** Stingers that carry a sound effect of their own besides the musical phrase. */
const STINGER_SFX = Object.freeze({ levelUp: 'level_up', questComplete: 'quest_complete', discover: 'discover' });
const STINGERS = new Set(['transform', 'levelUp', 'questComplete', 'discover', 'death', 'milestone', 'bossIntro', 'victory']);

/**
 * Build the `ctx.audio` service.
 * @param {any} ctx
 */
export function createAudio(ctx) {
  const engine = createEngine(ctx);
  const music = createMusic(ctx, engine);
  const stingerOpts = { vol: 1, pitch: 1 };

  const audio = {
    /** @returns {boolean} the context exists and is unlocked */
    get ready() {
      return engine.ready;
    },

    /** Create and resume the AudioContext; call from a user gesture. Safe to call repeatedly. */
    unlock() {
      engine.unlock();
    },

    /**
     * One-shot; positional when `x` is given.
     * @param {string} id @param {{ x?:number, y?:number, z?:number, vol?:number, pitch?:number }} [opts] @returns {number}
     */
    play(id, opts) {
      return engine.play(id, opts);
    },

    /**
     * Looping voice; follows `entId` when given.
     * @param {string} id @param {{ entId?:number, x?:number, y?:number, z?:number, vol?:number }} [opts] @returns {number}
     */
    loop(id, opts) {
      return engine.loop(id, opts);
    },

    /** @param {number} voiceId @param {number} [fadeSeconds] */
    stop(voiceId, fadeSeconds = 0.1) {
      engine.stop(voiceId, fadeSeconds);
    },

    /** @param {number} voiceId @param {'vol'|'pitch'|'level'} name @param {number} value */
    setParam(voiceId, name, value) {
      engine.setParam(voiceId, name, value);
    },

    /** @param {{ mode?:string, palette?:string, intensity?:number, formId?:string|null, settlement?:boolean }} state */
    setMusic(state) {
      music.set(state);
    },

    /** @param {string} id */
    stinger(id) {
      if (!STINGERS.has(id)) return;
      const sfx = STINGER_SFX[id];
      if (sfx) engine.play(sfx, stingerOpts);
      music.stinger(id);
    },

    /** @param {'master'|'music'|'sfx'} bus @param {number} v */
    setVolume(bus, v) {
      engine.setVolume(bus, v);
    },

    /** Menu filter. @param {boolean} paused */
    setPaused(paused) {
      engine.setPaused(paused);
    },

    /** @returns {number} live voices (one-shots, loops and music notes) */
    voices() {
      return engine.voices() + music.voices();
    },

    /** @returns {number} live AudioNodes owned by the engine */
    nodes() {
      return engine.nodes();
    },

    /** Diagnostics for scenarios and the debug overlay. */
    debug() {
      const ac = engine.ac;
      return {
        state: ac ? ac.state : 'none', ready: engine.ready, pending: engine.pending(), tier: engine.tier,
        voices: engine.voices(), musicVoices: music.voices(), nodes: engine.nodes(), music: music.state(),
      };
    },

    /** Close the AudioContext and remove the gesture listeners. */
    dispose() {
      music.stopAll();
      engine.dispose();
    },
  };

  const wiring = installWiring(ctx, audio, engine, music);

  /** Listener, live loops, wiring levels and the music scheduler in the `audio` frame phase. */
  const system = {
    id: 'audio.run',
    phase: 'audio',
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      if (!engine.ready) return;
      engine.frame(c);
      wiring.frame(c, dt);
      music.frame();
    },
  };
  return { audio, system };
}

export const pkg = {
  id: 'audio',
  /** @param {any} ctx */
  install(ctx) {
    const { audio, system } = createAudio(ctx);
    ctx.provide('audio', audio, 'audio');
    ctx.systems.add(system);
    if (ctx.debug && ctx.debug.register) ctx.debug.register('audio', () => audio.debug());
  },
};
