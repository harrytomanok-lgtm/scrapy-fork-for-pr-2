/**
 * Stand-in `ctx.audio` (ARCHITECTURE 4.2, 8.0): WebAudio unlocked from a user gesture, five synthesised recipes
 * (`hit_light`, `bolt_fire`, `ui_confirm`, `level_up`, `explosion_s`) rendered once into buffers, every other id
 * a quiet blip, pooled voices with optional positional panning, a soft noise bed for loops, and `setMusic`
 * that only stores the requested state. A few catalog events are wired so the stand-in game is not silent.
 * With `noaudio=1` no AudioContext is ever created. Replaced by the env package.
 * @module standins/audio
 */

import { createStream } from '../core/rng.js';

const OWNER = 'standin:audio';
const MAX_VOICES = 24;
/** Stingers mapped onto the stand-in recipes: [recipe id, pitch]. */
const STINGERS = {
  transform: ['level_up', 0.8], levelUp: ['level_up', 1], questComplete: ['level_up', 1.12], discover: ['ui_confirm', 0.8],
  death: ['explosion_s', 0.6], milestone: ['level_up', 1.25], bossIntro: ['explosion_s', 0.5], victory: ['level_up', 1.2],
};

/**
 * Fill a mono buffer with `fn(t)` for `seconds`.
 * @param {any} ac AudioContext @param {number} seconds @param {(t:number, i:number)=>number} fn
 */
function synth(ac, seconds, fn) {
  const sr = ac.sampleRate;
  const n = Math.max(1, Math.floor(seconds * sr));
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
  const fade = Math.min(n, Math.floor(sr * 0.004));
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  return buf;
}

/** @param {any} ac @returns {Record<string, any>} */
function buildRecipes(ac) {
  const rnd = createStream(0x51ad);
  const noise = () => rnd.next() * 2 - 1;
  const TAU = Math.PI * 2;
  let lp = 0;
  const recipes = {
    hit_light: synth(ac, 0.14, (t) => 0.55 * noise() * Math.exp(-t * 45) + 0.5 * Math.sin(TAU * 170 * t) * Math.exp(-t * 28)),
    bolt_fire: synth(ac, 0.28, (t) => {
      const f = 300 + 700 * Math.exp(-t * 12);
      return 0.45 * Math.sin(TAU * f * t) * Math.exp(-t * 9) + 0.08 * noise() * Math.exp(-t * 20);
    }),
    ui_confirm: synth(ac, 0.16, (t) => 0.3 * Math.sin(TAU * (t < 0.06 ? 660 : 990) * t) * Math.exp(-((t < 0.06 ? t : t - 0.06)) * 25)),
    level_up: synth(ac, 0.95, (t) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const k = Math.min(3, Math.floor(t / 0.15));
      const lt = t - k * 0.15;
      const ph = (notes[k] * t) % 1;
      const tri = 4 * Math.abs(ph - 0.5) - 1;
      return 0.32 * tri * Math.exp(-lt * (k === 3 ? 3 : 9));
    }),
    explosion_s: synth(ac, 0.7, (t) => {
      lp += (noise() - lp) * 0.08;
      return (1.6 * lp + 0.35 * Math.sin(TAU * 58 * t)) * Math.exp(-t * 6);
    }),
    blip: synth(ac, 0.06, (t) => 0.2 * Math.sin(TAU * 880 * t) * Math.exp(-t * 60)),
    bed: synth(ac, 2, () => {
      lp += (noise() - lp) * 0.02;
      return lp * 1.2;
    }),
  };
  return recipes;
}

/**
 * Create the stand-in audio service.
 * @param {any} ctx
 */
function createAudio(ctx) {
  const noaudio = !!(ctx.flags && (ctx.flags.noaudio === true || ctx.flags.noaudio === 1 || ctx.flags.noaudio === '1'));
  /** @type {any} */
  let ac = null;
  /** @type {Record<string, any>} */
  let recipes = {};
  /** @type {any} */
  let master = null;
  /** @type {any} */
  let sfxBus = null;
  /** @type {any} */
  let musicBus = null;
  let nextVoiceId = 1;
  let paused = false;
  const volume = { master: 0.8, music: 0.7, sfx: 0.9 };
  /** @type {{ x?:number, y?:number, z?:number, vol?:number, pitch?:number }} scratch options of the blip */
  const blipOpts = { x: undefined, y: undefined, z: undefined, vol: 1, pitch: undefined };
  const music = { mode: 'explore', palette: 'warm', intensity: 0, formId: /** @type {string|null} */ (null), settlement: false };

  /** @typedef {{ id:number, src:any, gain:any, panner:any, positional:boolean, loop:boolean, entId:number, start:number, baseVol:number }} Voice */
  /** @type {Voice[]} */
  const voices = [];
  for (let i = 0; i < MAX_VOICES; i++) voices.push({ id: 0, src: null, gain: null, panner: null, positional: false, loop: false, entId: 0, start: 0, baseVol: 1 });

  /** @param {Voice} v */
  function release(v) {
    if (v.src) {
      v.src.onended = null;
      try { v.src.stop(); } catch (err) { /* already stopped */ }
      v.src.disconnect();
    }
    v.src = null;
    v.id = 0;
    v.loop = false;
    v.entId = 0;
  }

  /** @returns {Voice} a free voice, stealing the oldest one-shot when all are busy */
  function takeVoice() {
    let oldest = null;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i];
      if (v.id === 0) return v;
      if (!v.loop && (!oldest || v.start < oldest.start)) oldest = v;
    }
    const steal = oldest || voices[0];
    release(steal);
    return steal;
  }

  /** @param {number} id @returns {Voice|null} */
  function findVoice(id) {
    if (!id) return null;
    for (let i = 0; i < MAX_VOICES; i++) if (voices[i].id === id) return voices[i];
    return null;
  }

  function applyVolumes() {
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(volume.master, t, 0.02);
    sfxBus.gain.setTargetAtTime(volume.sfx * (paused ? 0.35 : 1), t, 0.05);
    musicBus.gain.setTargetAtTime(volume.music * (paused ? 0.5 : 1), t, 0.05);
  }

  /**
   * Start a voice on a buffer.
   * @param {any} buffer @param {boolean} loop @param {any} opts
   */
  function start(buffer, loop, opts) {
    const o = opts || {};
    const v = takeVoice();
    if (!v.gain) {
      v.gain = ac.createGain();
      v.panner = ac.createPanner();
      v.panner.distanceModel = 'inverse';
      v.panner.refDistance = 8;
      v.panner.maxDistance = 400;
      v.panner.connect(sfxBus);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = o.pitch !== undefined ? o.pitch : 1;
    const vol = o.vol !== undefined ? o.vol : 1;
    v.baseVol = vol;
    v.gain.gain.cancelScheduledValues(ac.currentTime);
    v.gain.gain.setValueAtTime(vol, ac.currentTime);
    v.gain.disconnect();
    v.positional = o.x !== undefined;
    if (v.positional) {
      setPannerPos(v.panner, o.x, o.y || 0, o.z || 0);
      v.gain.connect(v.panner);
    } else {
      v.gain.connect(sfxBus);
    }
    src.connect(v.gain);
    v.id = nextVoiceId++;
    v.src = src;
    v.loop = loop;
    v.entId = o.entId || 0;
    v.start = ac.currentTime;
    const id = v.id;
    src.onended = () => {
      if (v.id === id) release(v);
    };
    src.start();
    return id;
  }

  /** @param {any} p @param {number} x @param {number} y @param {number} z */
  function setPannerPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  function onGesture() {
    audio.unlock();
  }
  const gestureEvents = ['pointerdown', 'keydown', 'touchend'];
  function listenGestures(on) {
    if (typeof window === 'undefined' || noaudio) return;
    for (const e of gestureEvents) {
      if (on) window.addEventListener(e, onGesture, { capture: true });
      else window.removeEventListener(e, onGesture, { capture: true });
    }
  }

  const audio = {
    ready: false,

    /** Create and resume the AudioContext; call from a user gesture. Safe to call repeatedly. */
    unlock() {
      if (noaudio || typeof window === 'undefined') return;
      if (ac) {
        if (ac.state === 'suspended') ac.resume().catch(() => {});
        return;
      }
      try {
        const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        if (!AC) return;
        ac = new AC();
      } catch (err) {
        ac = null;
        return;
      }
      master = ac.createGain();
      sfxBus = ac.createGain();
      musicBus = ac.createGain();
      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(ac.destination);
      const s = ctx.save && ctx.save.settings;
      if (s) {
        volume.master = typeof s.volMaster === 'number' ? s.volMaster : volume.master;
        volume.music = typeof s.volMusic === 'number' ? s.volMusic : volume.music;
        volume.sfx = typeof s.volSfx === 'number' ? s.volSfx : volume.sfx;
      }
      applyVolumes();
      recipes = buildRecipes(ac);
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      audio.ready = true;
      listenGestures(false);
    },

    /**
     * One-shot; positional when `x` is given.
     * @param {string} id @param {{ x?:number, y?:number, z?:number, vol?:number, pitch?:number }} [opts] @returns {number} voice id, 0 if dropped
     */
    play(id, opts) {
      if (!audio.ready || !ac || ac.state !== 'running') return 0;
      const buf = recipes[id];
      if (buf) return start(buf, false, opts);
      blipOpts.x = opts ? opts.x : undefined;
      blipOpts.y = opts ? opts.y : undefined;
      blipOpts.z = opts ? opts.z : undefined;
      blipOpts.pitch = opts ? opts.pitch : undefined;
      blipOpts.vol = (opts && opts.vol !== undefined ? opts.vol : 1) * 0.5;
      return start(recipes.blip, false, blipOpts);
    },

    /**
     * Looping voice (a soft noise bed in the stand-in); follows `entId` when given.
     * @param {string} id @param {{ entId?:number, x?:number, y?:number, z?:number, vol?:number }} [opts] @returns {number}
     */
    loop(id, opts) {
      if (!audio.ready || !ac) return 0;
      const o = opts || {};
      const e = o.entId ? ctx.ents.get(o.entId) : null;
      return start(recipes.bed, true, {
        x: e ? e.pos.x : o.x, y: e ? e.pos.y : o.y, z: e ? e.pos.z : o.z, entId: o.entId || 0,
        vol: (o.vol !== undefined ? o.vol : 1) * 0.15, pitch: id === 'gather_loop' || id === 'beam_loop' ? 1.6 : 1,
      });
    },

    /** @param {number} voiceId @param {number} [fadeSeconds] */
    stop(voiceId, fadeSeconds = 0.1) {
      const v = findVoice(voiceId);
      if (!v || !ac) return;
      const t = ac.currentTime;
      const f = Math.max(0.005, fadeSeconds);
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + f);
      v.loop = false;
      try { v.src.stop(t + f + 0.01); } catch (err) { release(v); }
    },

    /** @param {number} voiceId @param {'vol'|'pitch'|'level'} name @param {number} value */
    setParam(voiceId, name, value) {
      const v = findVoice(voiceId);
      if (!v || !ac) return;
      const t = ac.currentTime;
      if (name === 'vol') v.gain.gain.setTargetAtTime(v.baseVol * value, t, 0.03);
      else if (name === 'pitch') v.src.playbackRate.setTargetAtTime(value, t, 0.03);
      else if (name === 'level') v.src.playbackRate.setTargetAtTime(0.8 + 0.8 * Math.max(0, Math.min(1, value)), t, 0.05);
    },

    /** Stores the requested music state (no music in the stand-in). @param {object} state */
    setMusic(state) {
      if (state) Object.assign(music, state);
    },

    /** @param {string} id */
    stinger(id) {
      const s = STINGERS[id];
      if (s) audio.play(s[0], { pitch: s[1], vol: 0.8 });
    },

    /** @param {'master'|'music'|'sfx'} bus @param {number} v */
    setVolume(bus, v) {
      if (bus !== 'master' && bus !== 'music' && bus !== 'sfx') return;
      volume[bus] = Math.max(0, Math.min(1, Number(v) || 0));
      applyVolumes();
    },

    /** Menu filter: ducks sound while paused. @param {boolean} p */
    setPaused(p) {
      paused = !!p;
      applyVolumes();
    },

    /** @returns {number} live voices */
    voices() {
      let n = 0;
      for (let i = 0; i < MAX_VOICES; i++) if (voices[i].id !== 0) n++;
      return n;
    },

    /** @returns {number} live AudioNodes owned by the engine */
    nodes() {
      if (!ac) return 0;
      let n = 3;
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = voices[i];
        if (v.gain) n += 2;
        if (v.id !== 0) n++;
      }
      return n;
    },

    /** Close the AudioContext and remove the gesture listeners. */
    dispose() {
      listenGestures(false);
      for (const v of voices) release(v);
      if (ac) ac.close().catch(() => {});
      ac = null;
      audio.ready = false;
    },
  };

  /** Listener at the camera; looping voices follow their entity. */
  const listenerSystem = {
    id: 'standin.audio.listener',
    phase: 'audio',
    owner: OWNER,
    frame(c) {
      if (!ac) return;
      const cam = c.three && c.three.camera;
      const l = ac.listener;
      if (cam) {
        const e = cam.matrixWorld.elements;
        if (l.positionX) {
          l.positionX.value = cam.position.x; l.positionY.value = cam.position.y; l.positionZ.value = cam.position.z;
          l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
          l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
        } else {
          l.setPosition(cam.position.x, cam.position.y, cam.position.z);
          l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
        }
      }
      for (let i = 0; i < MAX_VOICES; i++) {
        const v = voices[i];
        if (v.id === 0 || v.entId === 0 || !v.positional) continue;
        const ent = c.ents.get(v.entId);
        if (ent) setPannerPos(v.panner, ent.pos.x, ent.pos.y, ent.pos.z);
      }
    },
  };

  listenGestures(true);
  return { audio, listenerSystem };
}

/**
 * Install the stand-in audio service under the owner 'standin:audio'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { audio, listenerSystem } = createAudio(ctx);
  ctx.provide('audio', audio, OWNER);
  ctx.systems.add(listenerSystem);
  const bus = ctx.bus;
  const o = { x: 0, y: 0, z: 0, vol: 1, pitch: 1 };
  /** Scratch play options (no allocation per event). */
  const at = (x, y, z, vol, pitch) => {
    o.x = x; o.y = y; o.z = z; o.vol = vol; o.pitch = pitch;
    return o;
  };
  bus.on('combat:hit', (p) => { audio.play('hit_light', at(p.x, p.y, p.z, 1, p.crit ? 0.8 : 1)); }, OWNER);
  bus.on('projectile:spawned', (p) => {
    const e = ctx.ents.get(p.entId);
    if (e) audio.play('bolt_fire', at(e.pos.x, e.pos.y, e.pos.z, 0.7, 1));
  }, OWNER);
  bus.on('rpg:levelUp', () => { audio.play('level_up'); }, OWNER);
  bus.on('world:crater', (p) => { audio.play('explosion_s', at(p.x, p.y, p.z, 1, 1)); }, OWNER);
  bus.on('actor:slam', (p) => { audio.play('explosion_s', at(p.x, p.y, p.z, 0.7, 1.3)); }, OWNER);
  bus.on('game:paused', (p) => { audio.setPaused(p.paused && p.reason !== 'debug'); }, OWNER);
  bus.on('settings:changed', (p) => {
    if (p.key === 'volMaster') audio.setVolume('master', p.value);
    else if (p.key === 'volMusic') audio.setVolume('music', p.value);
    else if (p.key === 'volSfx') audio.setVolume('sfx', p.value);
  }, OWNER);
}
