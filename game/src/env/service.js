/**
 * `ctx.env` (ARCHITECTURE 4.2): the clock (one game day per 24 real minutes, mirrored in store.state.world.hour and
 * day), the five-key lighting of ART_UX 1.4 written to render.globals (sun or moon, hemisphere ambient, shadow tint,
 * fog by region and time, rim, wind), the sky dome, settlements and gameplay prop visuals.
 * @module env/service
 */

import { Vector3, Color } from 'three';
import { PALETTE } from '../core/palette.js';
import {
  phaseOf, sampleDay, createSample, advanceClock, wrapHour, nightFactor, lanternFactor, fogDensity, sunDirection,
  moonDirection, lightDirection, hexToLinear,
} from './logic/day.js';
import { createSky } from './sky.js';
import { createSettlements } from './settlements.js';
import { createProps } from './props.js';

/** Region fog colours in linear space, by region id. */
const REGION_FOG = Object.fromEntries(Object.keys(PALETTE.biome).map((id) => [id, hexToLinear(PALETTE.biome[id].fog)]));

/**
 * @param {any} ctx
 */
export function createEnv(ctx) {
  let clockScale = 1;
  let lastHourInt = -1;
  let lastPhase = '';
  let fallbackHour = 7;
  let fallbackDay = 1;
  const hourPayload = { hour: 0, phase: /** @type {any} */ ('day') };

  const sunDir = new Vector3(0.4, 0.8, 0.45).normalize();
  const sunTrue = new Vector3();
  const moonTrue = new Vector3();
  const sunTmp = { x: 0, y: 0, z: 0 };
  const moonTmp = { x: 0, y: 0, z: 0 };
  const lightTmp = { x: 0, y: 0, z: 0 };
  const sample = createSample();
  const regionFog = [0, 0, 0];
  const regionFogTarget = [0, 0, 0];
  let snapFog = true;
  const wind = new Vector3(0.8, 0.15, 0.6);
  let windT = 0;

  // sky inputs, written each frame
  const skyIn = {
    zenith: new Color(), horizon: new Color(), sunTrue, moonDir: moonTrue, sunColor: new Color(), ambSky: new Color(),
    shadow: new Color(), night: 0, wind, layers: 1, time: 0,
  };
  const white = new Color(1, 1, 1);
  /**
   * Fog override (env.setFog / clearFog): a scripted weather fog (Iskra's blizzard) eased over the region fog.
   * k eases toward `on` at 1/seconds per second.
   */
  const fogOv = { on: 0, k: 0, rate: 1, density: 0.0055, color: new Color(PALETTE.biome.frostspine.shade), snow: 0, sent: -1 };
  /** @type {any} */
  let sky = null;

  const settlements = createSettlements(ctx);
  const props = createProps(ctx);
  /** @type {any[]} settlement camp fires */
  const fires = [];

  /** @returns {any} store.state.world or null */
  function state() {
    const s = ctx.store && ctx.store.state;
    return s && s.world ? s.world : null;
  }

  /** @param {number} h */
  function computeDirs(h) {
    sunDirection(h, sunTmp);
    sunTrue.set(sunTmp.x, sunTmp.y, sunTmp.z);
    moonDirection(h, moonTmp);
    moonTrue.set(moonTmp.x, moonTmp.y, moonTmp.z);
    lightDirection(h, sunTmp, moonTmp, lightTmp);
    sunDir.set(lightTmp.x, lightTmp.y, lightTmp.z);
  }

  /** Emit env:hour on each integer hour and each phase change. */
  function emitHour() {
    const h = env.hour;
    const hi = Math.floor(h);
    const ph = phaseOf(h);
    if (hi === lastHourInt && ph === lastPhase) return;
    lastHourInt = hi;
    lastPhase = ph;
    hourPayload.hour = hi;
    hourPayload.phase = ph;
    ctx.bus.emit('env:hour', hourPayload);
  }

  /** @param {Color} c @param {number[]} a */
  function setLinear(c, a) {
    c.r = a[0];
    c.g = a[1];
    c.b = a[2];
  }

  /**
   * The lighting pass: day keys at the clock, region fog at the camera, written into render.globals.
   * @param {number} dt real seconds
   */
  function applyLighting(dt) {
    const render = ctx.render;
    if (!render || !render.globals) return;
    const g = render.globals;
    const h = env.hour;
    computeDirs(h);
    const cam = ctx.three && ctx.three.camera;
    const world = ctx.world;
    let fogSrc = REGION_FOG.meadows;
    if (cam && world && typeof world.regionAt === 'function') {
      const id = world.regionAt(cam.position.x, cam.position.z);
      if (REGION_FOG[id]) fogSrc = REGION_FOG[id];
    }
    regionFogTarget[0] = fogSrc[0];
    regionFogTarget[1] = fogSrc[1];
    regionFogTarget[2] = fogSrc[2];
    const k = snapFog ? 1 : 1 - Math.exp(-1.2 * dt);
    snapFog = false;
    for (let i = 0; i < 3; i++) regionFog[i] += (regionFogTarget[i] - regionFog[i]) * k;
    sampleDay(h, regionFog, sample);

    setLinear(g.uSunColor.value, sample.sun);
    g.uSunColor.value.multiplyScalar(sample.intensity);
    setLinear(g.uAmbSky.value, sample.ambSky);
    setLinear(g.uAmbGround.value, sample.ambGround);
    setLinear(g.uShadowTint.value, sample.shadow);
    setLinear(g.uFogColor.value, sample.fog);
    g.uRimColor.value.copy(g.uAmbSky.value).lerp(white, 0.4);
    g.uFogDensity.value = fogDensity(h);
    g.uSunDir.value.copy(sunDir);
    // scripted fog override: thick fog of its own colour, a dimmer flatter sun, the sky closing in
    if (fogOv.k !== fogOv.on) {
      const step = Math.max(0, dt) * fogOv.rate;
      fogOv.k = fogOv.on > fogOv.k ? Math.min(fogOv.on, fogOv.k + step) : Math.max(fogOv.on, fogOv.k - step);
    }
    const fk = fogOv.k * fogOv.k * (3 - 2 * fogOv.k);
    if (fk > 0) {
      g.uFogColor.value.lerp(fogOv.color, fk);
      g.uFogDensity.value += (fogOv.density - g.uFogDensity.value) * fk;
      g.uSunColor.value.multiplyScalar(1 - 0.45 * fk);
      g.uAmbSky.value.lerp(fogOv.color, 0.35 * fk);
      g.uShadowTint.value.lerp(fogOv.color, 0.3 * fk);
    }
    const snowK = fogOv.snow * fk;
    if (Math.abs(snowK - fogOv.sent) > 0.01 && ctx.vfx && typeof ctx.vfx.weather === 'function') {
      ctx.vfx.weather(snowK > 0.01 ? 'snow' : 'none', snowK);
      fogOv.sent = snowK;
    }

    // wind: a slowly turning prevailing direction with gusts; y is the sway amplitude in metres
    windT += dt;
    const ang = 0.6 + Math.sin(windT * 0.031) * 0.35 + Math.sin(windT * 0.0071) * 0.5;
    const gust = 0.13 + 0.05 * Math.max(0, Math.sin(windT * 0.23) * Math.sin(windT * 0.071 + 1.3));
    wind.set(Math.cos(ang), gust, Math.sin(ang));
    g.uWind.value.copy(wind);

    const night = nightFactor(h);
    if (sky && cam) {
      setLinear(skyIn.zenith, sample.zenith);
      if (fk > 0) skyIn.zenith.lerp(g.uFogColor.value, 0.75 * fk);
      skyIn.horizon.copy(g.uFogColor.value);
      skyIn.sunColor.copy(g.uSunColor.value);
      skyIn.ambSky.copy(g.uAmbSky.value);
      skyIn.shadow.copy(g.uShadowTint.value);
      skyIn.night = night;
      skyIn.layers = render.caps && render.caps.cloudLayers ? render.caps.cloudLayers : 1;
      skyIn.time = g.uTime.value;
      sky.update(cam, dt, skyIn);
    }
    const renderer = ctx.three && ctx.three.renderer;
    if (renderer) renderer.setClearColor(g.uFogColor.value, 1);
    settlements.frame(dt, lanternFactor(h), wind, cam);
    props.frame(dt, cam, wind);
  }

  const env = {
    /** @returns {number} 0..24 */
    get hour() {
      const s = state();
      return s && typeof s.hour === 'number' ? s.hour : fallbackHour;
    },
    /** @returns {number} */
    get day() {
      const s = state();
      return s && typeof s.day === 'number' ? s.day : fallbackDay;
    },
    /** @returns {'dawn'|'day'|'golden'|'dusk'|'night'} */
    get phase() {
      return phaseOf(env.hour);
    },
    /** @returns {boolean} */
    get isNight() {
      return phaseOf(env.hour) === 'night';
    },
    /** Unit vector toward the light (sun or moon), read-only. */
    sunDir,

    /** @param {number} h */
    setHour(h) {
      const v = wrapHour(h);
      const s = state();
      if (s) s.hour = v;
      else fallbackHour = v;
      computeDirs(v);
      emitHour();
    },

    /** @param {number} s 1 = one game day per 24 real minutes; 0 freezes */
    setClockScale(s) {
      const n = Number(s);
      clockScale = Number.isFinite(n) && n > 0 ? n : 0;
    },

    /** @returns {number} current clock scale (diagnostics) */
    get clockScale() {
      return clockScale;
    },

    /**
     * Gameplay prop visual (4.2).
     * @param {string} kind @param {number} x @param {number} y @param {number} z
     * @param {{ yaw?:number, scale?:number, state?:string, color?:number }} [opts]
     */
    spawnProp(kind, x, y, z, opts) {
      return props.spawn(kind, x, y, z, opts);
    },

    /** @param {string} id @returns {any} */
    settlement(id) {
      return settlements.info(id);
    },

    /** @param {string} settlementId @param {string} spotId @param {{x:number,y:number,z:number,yaw:number}} out @returns {boolean} */
    spot(settlementId, spotId, out) {
      return settlements.spot(settlementId, spotId, out);
    },

    /**
     * Scripted fog override (an addition for boss weather such as Iskra's phase-2 blizzard): eases a thick fog of
     * `color` (default the Frostspine shade, a blue-grey storm) with `density` (exp2 per metre, default 0.0055: about 150 m of sight) over
     * `seconds` (default 1.5), dims the sun, and with `snow` (0..1, default 0) adds blowing snow through ctx.vfx.
     * The region fog and the day keys keep running underneath; clearFog eases back.
     * @param {{ density?:number, color?:number, seconds?:number, snow?:number }} [o]
     */
    setFog(o = {}) {
      const sec = typeof o.seconds === 'number' && o.seconds > 0 ? o.seconds : 1.5;
      fogOv.density = typeof o.density === 'number' && o.density > 0 ? o.density : 0.0055;
      fogOv.color.setHex(typeof o.color === 'number' ? o.color : PALETTE.biome.frostspine.shade);
      fogOv.snow = typeof o.snow === 'number' ? Math.max(0, Math.min(1, o.snow)) : 0;
      fogOv.rate = 1 / sec;
      fogOv.on = 1;
      if (typeof o.seconds === 'number' && o.seconds <= 0) fogOv.k = 1;
    },

    /** End the fog override, easing back over `seconds` (default 2; 0 = at once). @param {number} [seconds] */
    clearFog(seconds = 2) {
      fogOv.on = 0;
      if (!(seconds > 0)) fogOv.k = 0;
      else fogOv.rate = 1 / seconds;
    },

    /** Diagnostics for scenarios. */
    info() {
      return { settlements: settlements.stats(), props: props.count(), sky: !!sky, clockScale, fog: fogOv.k };
    },

    dispose() {
      fires.length = 0;
      props.dispose();
      settlements.dispose();
      if (sky) sky.dispose();
      sky = null;
    },
  };

  /** Build the sky and the settlements (on boot, before render.compile links the programs). */
  function build() {
    const render = ctx.render;
    if (!render || !render.layers) return;
    if (!sky) {
      sky = createSky();
      render.layers.sky.add(sky.mesh);
    }
    settlements.build();
    props.warm();
    // camp fires at every settlement spot named 'fire'
    const out = { x: 0, y: 0, z: 0, yaw: 0 };
    for (const def of ctx.defs ? ctx.defs.all('settlement') : []) {
      if (settlements.spot(def.id, 'fire', out)) fires.push(props.spawn('campfire', out.x, out.y, out.z, { yaw: out.yaw }));
    }
  }

  const clockSystem = {
    id: 'env.clock',
    phase: { step: 'script', frame: 'world' },
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const s = state();
      if (s && clockScale > 0) advanceClock(s, dt, clockScale);
      emitHour();
    },
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      applyLighting(dt);
    },
  };

  /** Apply `flags.hour` (start hour and frozen clock) when a journey loads. */
  function onLoaded() {
    fogOv.on = 0;
    fogOv.k = 0;
    lastHourInt = -1;
    lastPhase = '';
    const f = ctx.flags || {};
    const fh = Number(f.hour);
    if (f.hour !== undefined && f.hour !== null && f.hour !== '' && Number.isFinite(fh)) {
      env.setHour(fh);
      env.setClockScale(0);
    } else {
      emitHour();
    }
    snapFog = true;
  }

  return { env, clockSystem, onLoaded, build };
}
