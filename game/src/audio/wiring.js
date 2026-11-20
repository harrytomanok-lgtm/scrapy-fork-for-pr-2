/**
 * Event-to-sound wiring (ARCHITECTURE 4.2: audio is event-driven). Subscribes to the catalog and plays the ids of
 * ART_UX 9.2: hits by feel class, technique sounds from each technique's `sfx` block on `combat:techPhase`,
 * footsteps by surface, movement, rewards, quests, UI, Forms and bosses; drives the live loops (gather, wind,
 * ambience) and the music state (region palette, Siphon proximity, settlements, combat, bosses, Forms).
 * Payloads are never retained; listeners allocate nothing.
 * @module audio/wiring
 */

import { STEP_SURFACE, HIT_CLASS } from './logic/voices.js';
import { RECIPES } from './logic/recipes.js';
import { IDS } from '../core/ids.js';
import { BALANCE } from '../core/balance.js';

/** Pentatonic steps for the rising xp-orb and gate pings (semitones). */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
/** Distance beyond which footsteps and landings of other actors are skipped (m). */
const FOLEY_RANGE = 30;
/** Corrupted palette within this distance of a standing Siphon (m, ART_UX 9.3). */
const SIPHON_RANGE = BALANCE.siphon.corruptedMusicRadius;
/** Corrupted palette within this distance of a Choir camp (m): the camp and its patrol ring. */
const CAMP_RANGE = 140;
/** The Siphon drone starts within this distance of a standing Siphon and stops beyond SIPHON_LOOP_OFF (m). */
const SIPHON_LOOP_ON = 170;
const SIPHON_LOOP_OFF = 210;
/** Tracked technique sounds per entity. */
const TRACK = 16;

/**
 * @param {any} ctx @param {any} audio the service @param {any} engine @param {any} music
 */
export function installWiring(ctx, audio, engine, music) {
  const bus = ctx.bus;
  const OWNER = 'audio';
  const pos = { x: 0, y: 0, z: 0, vol: 1, pitch: 1 };
  const flat = { vol: 1, pitch: 1 };
  const LOOP_FLAT = { vol: 1 };
  const LOOP_ENT = { entId: 0, vol: 1 };
  /** @param {number} entId */
  const entLoop = (entId) => {
    LOOP_ENT.entId = entId;
    return LOOP_ENT;
  };
  /** @type {Array<{ entId:number, techId:string|null, loop:number, charge:number }>} */
  const track = [];
  for (let i = 0; i < TRACK; i++) track.push({ entId: 0, techId: null, loop: 0, charge: 0 });
  const st = {
    gatherVoice: 0, gatherT: 0, gatherFull: false, windVoice: 0, ambVoice: 0, boss: false,
    orbStep: 0, orbT: -10, healT: -10, beamT: -10, finT: -10, regionPalette: 'warm', checkT: 0, lastPalette: '', lastSettlement: false,
    siphonVoice: 0, siphonId: '', nearSiphon: '', nearSiphonD: Infinity, nearCamp: '', palette: 'warm',
  };
  const LOOP_AT = { x: 0, y: 0, z: 0, vol: 1 };
  /** @type {Map<string, boolean>} camp POI id -> its spawn group is a Choir group (from the region's camp table) */
  const choirCamp = new Map();
  /** @type {Set<string>} Siphons destroyed this session */
  const siphonDown = new Set();

  function isPlayer(entId) {
    const p = ctx.player;
    return !!p && p.id === entId;
  }

  function now() {
    const ac = engine.ac;
    return ac ? ac.currentTime : 0;
  }

  /** Play `id` at an entity (centred when it is the player). */
  function playAt(id, entId, vol, pitch) {
    if (isPlayer(entId)) return playFlat(id, vol, pitch);
    const e = ctx.ents.get(entId);
    if (!e) return 0;
    pos.x = e.pos.x; pos.y = e.pos.y + e.height * 0.5; pos.z = e.pos.z; pos.vol = vol; pos.pitch = pitch;
    return engine.play(id, pos);
  }

  /** @param {string} id @param {number} x @param {number} y @param {number} z @param {number} vol @param {number} pitch */
  function playPos(id, x, y, z, vol, pitch) {
    pos.x = x; pos.y = y; pos.z = z; pos.vol = vol; pos.pitch = pitch;
    return engine.play(id, pos);
  }

  /** @param {string} id @param {number} vol @param {number} pitch */
  function playFlat(id, vol, pitch) {
    flat.vol = vol; flat.pitch = pitch;
    return engine.play(id, flat);
  }

  /** @param {number} entId */
  function nearListener(entId, range) {
    if (isPlayer(entId)) return true;
    const e = ctx.ents.get(entId);
    if (!e) return false;
    const L = engine.listener;
    const dx = e.pos.x - L.x;
    const dz = e.pos.z - L.z;
    return dx * dx + dz * dz < range * range;
  }

  /** @param {number} entId @returns {{ entId:number, techId:string|null, loop:number, charge:number }} */
  function trackOf(entId) {
    let free = null;
    for (let i = 0; i < TRACK; i++) {
      const t = track[i];
      if (t.entId === entId) return t;
      if (!free && t.entId === 0) free = t;
    }
    const t = free || track[0];
    if (t.entId !== 0) clearTrack(t, 0.1);
    t.entId = entId;
    return t;
  }

  /** @param {{ entId:number, techId:string|null, loop:number, charge:number }} t @param {number} fade */
  function clearTrack(t, fade) {
    if (t.loop) engine.stop(t.loop, fade);
    if (t.charge) engine.stop(t.charge, 0.08);
    t.loop = 0; t.charge = 0; t.techId = null; t.entId = 0;
  }

  /** @param {string} techId @returns {any} the technique's sfx block or null */
  function sfxOf(techId) {
    const d = ctx.defs;
    if (!techId || !d || !d.has('technique', techId)) return null;
    const def = d.get('technique', techId);
    return def && def.sfx ? def.sfx : null;
  }

  /** @param {any} id @returns {boolean} */
  function valid(id) {
    return typeof id === 'string' && RECIPES[id] !== undefined;
  }

  const on = {
    /** @param {any} p */
    hit(p) {
      if (p.perfect) return; // combat:perfect plays it
      const vol = p.crit ? 1.15 : 1;
      const pitch = p.crit ? 0.88 : 1;
      if (p.blocked) {
        playPos('guard_block', p.x, p.y, p.z, 1, 1);
        return;
      }
      const s = sfxOf(p.techId);
      let id = s && valid(s.hit) ? s.hit : HIT_CLASS[p.class] || 'hit_light';
      if (p.class === 'beamTick') {
        const t = now();
        if (t - st.beamT < 0.09) return;
        st.beamT = t;
        playPos('hit_light', p.x, p.y, p.z, 0.4, 1.35);
        return;
      }
      if (isPlayer(p.targetId)) {
        playFlat('player_hurt', 1, 1);
        if (id === 'player_hurt') id = p.class === 'hurtHeavy' ? 'hit_heavy' : 'hit_light';
      }
      playPos(id, p.x, p.y, p.z, vol, pitch);
      // the player's finisher lands with a short musical hit (at most one per 1.5 s)
      if (p.class === 'finisher' && isPlayer(p.attackerId)) {
        const t = now();
        if (t - st.finT > 1.5) {
          st.finT = t;
          audio.stinger('finisher');
        }
      }
    },
    /** @param {any} p */
    techPhase(p) {
      const s = sfxOf(p.techId);
      if (!s) return;
      if (p.phase === 'windup') {
        if (valid(s.windup)) {
          const v = playAt(s.windup, p.entId, 1, 1);
          if (s.windup === 'beam_charge' || s.windup === 'ult_rise' || s.windup === 'transform_rise') {
            const t = trackOf(p.entId);
            if (t.charge) engine.stop(t.charge, 0.05);
            t.charge = v;
            t.techId = p.techId;
          }
        }
      } else if (p.phase === 'active') {
        const t = trackOf(p.entId);
        if (t.charge) { engine.stop(t.charge, 0.08); t.charge = 0; }
        if (valid(s.active)) playAt(s.active, p.entId, 1, 1);
        if (s.loop === 'beam_loop' || s.loop === 'siphon_loop') {
          if (t.loop) engine.stop(t.loop, 0.05);
          t.loop = isPlayer(p.entId) ? engine.loop(s.loop, LOOP_FLAT) : engine.loop(s.loop, entLoop(p.entId));
          t.techId = p.techId;
        }
      }
    },
    /** @param {any} p */
    techEnd(p) {
      const t = trackOf(p.entId);
      const s = sfxOf(p.techId);
      const hadLoop = t.loop !== 0;
      clearTrack(t, 0.15);
      if (s && hadLoop && valid(s.end) && s.end !== 'gather_full') playAt(s.end, p.entId, 1, 1);
    },
    /** @param {any} p */
    charge(p) {
      for (let i = 0; i < TRACK; i++) if (track[i].entId === p.entId && track[i].charge) engine.setParam(track[i].charge, 'level', p.level);
    },
    /** @param {any} p */
    gather(p) {
      if (!isPlayer(p.entId)) return;
      if (p.on) {
        if (st.gatherVoice) engine.stop(st.gatherVoice, 0.05);
        st.gatherVoice = engine.loop('gather_loop', LOOP_FLAT);
        st.gatherT = 0;
        st.gatherFull = false;
      } else if (st.gatherVoice) {
        engine.stop(st.gatherVoice, 0.25);
        st.gatherVoice = 0;
      }
    },
    /** @param {any} p */
    guard(p) {
      if (p.on) playAt('guard_on', p.entId, 1, 1);
    },
    /** @param {any} p */
    perfect(p) {
      playAt('perfect', p.entId, 1, 1);
    },
    /** @param {any} p */
    form(p) {
      FORM.formId = p.formId || null;
      music.set(FORM);
      if (p.formId) {
        playAt('transform_burst', p.entId, 1, 1);
        audio.stinger('transform');
      }
    },
    /** @param {any} p */
    burnout(p) {
      playAt('burnout', p.entId, 1, 1);
    },
    /** @param {any} p */
    telegraph(p) {
      const id = p.kind === 'red' ? 'tele_red' : p.kind === 'violet' ? 'tele_violet' : 'tele_white';
      playPos(id, p.x, p.y, p.z, 1, 1);
    },
    /** @param {any} p */
    techStart(p) {
      const e = ctx.ents.get(p.entId);
      if (e && e.kind === 'enemy' && ctx.rng.fx.next() < 0.25) playAt('enemy_growl', p.entId, 0.8, ctx.rng.fx.range(0.9, 1.15));
    },
    /** @param {any} p */
    combatState(p) {
      if (st.boss) return;
      MUSIC.mode = p.inCombat ? 'combat' : 'explore';
      MUSIC.intensity = Math.round(Math.max(0, Math.min(1, p.threat)) * 3);
      music.set(MUSIC);
    },
    /** @param {any} p */
    bossStart(p) {
      st.boss = true;
      MODE.mode = 'boss';
      music.set(MODE);
      audio.stinger('bossIntro');
      playAt('boss_roar', p.entId, 1, 1);
    },
    /** @param {any} p */
    bossPhase(p) {
      music.bossPhase();
      playAt('boss_roar', p.entId, 1, 0.92);
    },
    /** @param {any} p */
    bossEnd(p) {
      st.boss = false;
      if (p.defeated) audio.stinger('victory');
      MODE.mode = 'explore';
      music.set(MODE);
    },
    /** @param {any} p */
    died(p) {
      if (p.kind === 'enemy') playPos('enemy_death', p.x, p.y + 1, p.z, 1, ctx.rng.fx.range(0.92, 1.08));
      else if (p.kind === 'boss') { playPos('explosion_l', p.x, p.y + 2, p.z, 1, 1); playPos('enemy_death', p.x, p.y + 2, p.z, 1, 0.6); }
      else if (p.kind === 'object') playPos('rock_break', p.x, p.y + 1, p.z, 1, 1);
    },
    /** @param {any} p */
    step(p) {
      if (!nearListener(p.entId, FOLEY_RANGE)) return;
      const m = STEP_SURFACE[p.surface] || STEP_SURFACE.grass;
      playAt(m[0], p.entId, isPlayer(p.entId) ? 0.9 : 0.6, m[1]);
    },
    /** @param {any} p */
    landed(p) {
      if (!nearListener(p.entId, FOLEY_RANGE * 2)) return;
      if (p.speed > 18) playAt('land_heavy', p.entId, 1, 1);
      else if (p.speed > 4) playAt('land', p.entId, Math.min(1, p.speed / 12), 1);
    },
    /** @param {any} p */
    slam(p) {
      if (p.speed > 25) playPos('explosion_s', p.x, p.y, p.z, 1, 1);
      playPos('hit_heavy', p.x, p.y, p.z, 1, 0.85);
    },
    /** @param {any} p */
    knocked(p) {
      if (p.hurtle) playAt('whoosh', p.entId, 1, 0.8);
    },
    /** @param {any} p */
    jump(p) {
      if (isPlayer(p.entId)) playFlat('jump', 1, 1);
    },
    /** @param {any} p */
    mode(p) {
      if (!isPlayer(p.entId)) return;
      if (p.mode === 'fly' && p.prev !== 'fly') {
        playFlat('takeoff', 1, 1);
        if (!st.windVoice) st.windVoice = engine.loop('wind_loop', LOOP_FLAT);
      } else if (p.mode !== 'fly' && p.prev === 'fly' && st.windVoice) {
        engine.stop(st.windVoice, 0.6);
        st.windVoice = 0;
      }
      if (p.mode === 'hurtle') playFlat('whoosh', 1, 1);
    },
    /** @param {any} p */
    boost(p) {
      if (p.stage === 1) playAt('boost_start', p.entId, 1, 1);
      else if (p.stage === 2) playAt('sonic_boom', p.entId, 1, 1);
    },
    /** @param {any} p */
    crater(p) {
      playPos('crater', p.x, p.y, p.z, p.radius > 10 ? 1.2 : 1, p.radius > 10 ? 0.85 : 1);
    },
    /** @param {any} p */
    propDestroyed(p) {
      playPos('rock_break', p.x, p.y + 1, p.z, 1, ctx.rng.fx.range(0.9, 1.1));
    },
    /** @param {any} p */
    playerDied() {
      playFlat('player_death', 1, 1);
      audio.stinger('death');
    },
    respawned() {
      playFlat('ringstone', 0.7, 1);
    },
    /** @param {any} p */
    healed(p) {
      if (!isPlayer(p.entId) || p.amount < 5) return;
      const t = now();
      if (t - st.healT < 0.6) return;
      st.healT = t;
      playFlat('heal', 1, 1);
    },
    levelUp() {
      audio.stinger('levelUp');
    },
    /** @param {any} p */
    resonance(p) {
      if (p.milestone) audio.stinger('milestone');
    },
    /** @param {any} p */
    collected(p) {
      if (p.kind === 'xp') {
        const t = now();
        st.orbStep = t - st.orbT < 1.2 ? Math.min(PENTA.length - 1, st.orbStep + 1) : 0;
        st.orbT = t;
        playFlat('xp_orb', 1, Math.pow(2, PENTA[st.orbStep] / 12));
      } else if (p.kind === 'shells') playFlat('shells', 1, 1);
      else playFlat('pickup_item', 1, 1);
    },
    questStarted() { playFlat('quest_start', 1, 1); },
    questStep() { playFlat('quest_step', 1, 1); },
    questCompleted() { audio.stinger('questComplete'); },
    discovered() { audio.stinger('discover'); },
    ringstone() { playFlat('ringstone', 1, 1); },
    shrine() { playFlat('shrine', 1, 1); },
    chest() { playFlat('chest_open', 1, 1); },
    /** @param {any} p */
    siphon(p) {
      if (p.state === 'destroyed') {
        siphonDown.add(p.id);
        playFlat('siphon_break', 1, 1);
        if (st.siphonVoice && st.siphonId === p.id) {
          engine.stop(st.siphonVoice, 1.2);
          st.siphonVoice = 0;
          st.siphonId = '';
        }
        st.checkT = 0;
      } else if (p.state === 'open') playFlat('siphon_core', 1, 1);
    },
    raceStart() { playFlat('race_start', 1, 1); },
    /** @param {any} p */
    raceGate(p) { playFlat('ring_gate', 1, Math.pow(2, PENTA[Math.min(PENTA.length - 1, p.index % PENTA.length)] / 12)); },
    raceEnd() { playFlat('race_end', 1, 1); },
    /** @param {any} p */
    screen(p) {
      if (p.id === 'hud' || p.id === 'loading') return;
      playFlat(p.open ? 'ui_open' : 'ui_close', 1, 1);
    },
    /** @param {any} p */
    focus(p) {
      if (p.id) playFlat('ui_move', 0.7, 1);
    },
    used() { playFlat('ui_confirm', 1, 1); },
    /** @param {any} p */
    toast(p) {
      if (p.kind === 'warn') playFlat('ui_error', 1, 1);
    },
    /** @param {any} p */
    line(p) {
      let h = 0;
      const s = p.speakerId || '';
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 1023;
      playFlat('dialogue_tick', 1, 0.8 + (h % 9) * 0.06);
    },
    /** @param {any} p */
    paused(p) {
      audio.setPaused(p.paused && p.reason !== 'debug');
    },
    /** @param {any} p */
    settings(p) {
      if (p.key === 'volMaster') audio.setVolume('master', p.value);
      else if (p.key === 'volMusic') audio.setVolume('music', p.value);
      else if (p.key === 'volSfx') audio.setVolume('sfx', p.value);
    },
    /** @param {any} p */
    quality(p) {
      engine.setTier(p.tier === 'high' ? 'high' : 'low');
    },
    /** @param {any} p */
    region(p) {
      const d = ctx.defs;
      if (d && d.has('region', p.regionId)) {
        const r = d.get('region', p.regionId);
        if (r && (r.musicKey === 'warm' || r.musicKey === 'cold' || r.musicKey === 'corrupted')) st.regionPalette = r.musicKey;
      }
      st.checkT = 0;
    },
    loaded() {
      siphonDown.clear();
      st.siphonVoice = 0; st.siphonId = ''; st.checkT = 0;
      st.boss = false;
      MODE.mode = 'explore';
      music.set(MODE);
    },
    ended() {
      for (let i = 0; i < TRACK; i++) if (track[i].entId) clearTrack(track[i], 0.2);
      st.gatherVoice = 0; st.windVoice = 0; st.ambVoice = 0; st.siphonVoice = 0; st.siphonId = '';
      engine.stopAll();
      music.stopAll();
    },
  };
  const MUSIC = { mode: 'explore', intensity: 0 };
  const MODE = { mode: 'explore' };
  const FORM = { formId: /** @type {string|null} */ (null) };
  const PLACE = { palette: 'warm', settlement: false };

  bus.on('combat:hit', on.hit, OWNER);
  bus.on('combat:techPhase', on.techPhase, OWNER);
  bus.on('combat:techEnd', on.techEnd, OWNER);
  bus.on('combat:techStart', on.techStart, OWNER);
  bus.on('combat:charge', on.charge, OWNER);
  bus.on('combat:gather', on.gather, OWNER);
  bus.on('combat:guard', on.guard, OWNER);
  bus.on('combat:perfect', on.perfect, OWNER);
  bus.on('combat:form', on.form, OWNER);
  bus.on('combat:burnout', on.burnout, OWNER);
  bus.on('combat:telegraph', on.telegraph, OWNER);
  bus.on('combat:state', on.combatState, OWNER);
  bus.on('boss:start', on.bossStart, OWNER);
  bus.on('boss:phase', on.bossPhase, OWNER);
  bus.on('boss:end', on.bossEnd, OWNER);
  bus.on('actor:died', on.died, OWNER);
  bus.on('actor:step', on.step, OWNER);
  bus.on('actor:landed', on.landed, OWNER);
  bus.on('actor:slam', on.slam, OWNER);
  bus.on('actor:knocked', on.knocked, OWNER);
  bus.on('actor:healed', on.healed, OWNER);
  bus.on('move:jump', on.jump, OWNER);
  bus.on('move:mode', on.mode, OWNER);
  bus.on('move:boost', on.boost, OWNER);
  bus.on('world:crater', on.crater, OWNER);
  bus.on('world:propDestroyed', on.propDestroyed, OWNER);
  bus.on('world:regionEnter', on.region, OWNER);
  bus.on('world:poiDiscovered', on.discovered, OWNER);
  bus.on('player:died', on.playerDied, OWNER);
  bus.on('player:respawned', on.respawned, OWNER);
  bus.on('rpg:levelUp', on.levelUp, OWNER);
  bus.on('rpg:resonance', on.resonance, OWNER);
  bus.on('pickup:collected', on.collected, OWNER);
  bus.on('quest:started', on.questStarted, OWNER);
  bus.on('quest:step', on.questStep, OWNER);
  bus.on('quest:completed', on.questCompleted, OWNER);
  bus.on('ringstone:activated', on.ringstone, OWNER);
  bus.on('shrine:claimed', on.shrine, OWNER);
  bus.on('chest:opened', on.chest, OWNER);
  bus.on('siphon:state', on.siphon, OWNER);
  bus.on('race:start', on.raceStart, OWNER);
  bus.on('race:gate', on.raceGate, OWNER);
  bus.on('race:end', on.raceEnd, OWNER);
  bus.on('ui:screen', on.screen, OWNER);
  bus.on('ui:toast', on.toast, OWNER);
  bus.on('interact:focus', on.focus, OWNER);
  bus.on('interact:used', on.used, OWNER);
  bus.on('dialogue:line', on.line, OWNER);
  bus.on('game:paused', on.paused, OWNER);
  bus.on('settings:changed', on.settings, OWNER);
  bus.on('quality:changed', on.quality, OWNER);
  bus.on('game:loaded', on.loaded, OWNER);
  bus.on('game:ended', on.ended, OWNER);

  /** A Siphon is standing unless it was silenced this session or in the saved journey. @param {string} id */
  function standing(id) {
    if (siphonDown.has(id)) return false;
    const w = ctx.store && ctx.store.state ? ctx.store.state.world : null;
    return !(w && w.siphons && w.siphons.indexOf(id) >= 0);
  }

  /** Camp POIs whose region spawn table (5.9 camps) gives them a Choir group (camp_choir_*). @param {any} poi */
  function isChoirCamp(poi) {
    let v = choirCamp.get(poi.id);
    if (v !== undefined) return v;
    v = false;
    const d = ctx.defs;
    const table = d && poi.regionId && d.has('spawnTable', poi.regionId) ? d.get('spawnTable', poi.regionId) : null;
    const tier = poi.data && typeof poi.data.tier === 'number' ? poi.data.tier : 1;
    const camps = table && Array.isArray(table.camps) ? table.camps : null;
    if (camps) {
      // Any Choir group in the rows of the camp's tier (the first row when no row has that tier).
      let rows = 0;
      for (let i = 0; i < camps.length; i++) {
        if (camps[i].tier !== tier) continue;
        rows++;
        if (typeof camps[i].group === 'string' && camps[i].group.indexOf('camp_choir') === 0) v = true;
      }
      if (!rows && camps.length) v = typeof camps[0].group === 'string' && camps[0].group.indexOf('camp_choir') === 0;
    }
    choirCamp.set(poi.id, v);
    return v;
  }

  /**
   * Place state, 1 Hz: the nearest standing Siphon (drone loop and corrupted music within 300 m), Choir camps
   * (corrupted music), region palette and settlements. Runs without an AudioContext too, so tests can read it.
   */
  function checkPlace() {
    const p = ctx.player;
    if (!p) return;
    let palette = st.regionPalette;
    const w = ctx.world;
    let near = null;
    let nearD2 = Infinity;
    if (w && w.pois) {
      const list = w.pois('siphon');
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!standing(s.id)) continue;
        const dx = s.x - p.pos.x;
        const dz = s.z - p.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearD2) { nearD2 = d2; near = s; }
      }
      if (nearD2 < SIPHON_RANGE * SIPHON_RANGE) palette = 'corrupted';
      let camp = '';
      const camps = w.pois('camp');
      for (let i = 0; i < camps.length; i++) {
        const c = camps[i];
        const dx = c.x - p.pos.x;
        const dz = c.z - p.pos.z;
        if (dx * dx + dz * dz < CAMP_RANGE * CAMP_RANGE && isChoirCamp(c)) { palette = 'corrupted'; camp = c.id; break; }
      }
      st.nearCamp = camp;
    }
    st.nearSiphon = near ? near.id : '';
    st.nearSiphonD = near ? Math.sqrt(nearD2) : Infinity;
    st.palette = palette;
    if (!engine.ready) return;
    // The Siphon drone: positional at the spire, started near a standing Siphon, stopped when far or silenced.
    if (st.siphonVoice && (!near || near.id !== st.siphonId || nearD2 > SIPHON_LOOP_OFF * SIPHON_LOOP_OFF)) {
      engine.stop(st.siphonVoice, 0.8);
      st.siphonVoice = 0;
      st.siphonId = '';
    }
    if (!st.siphonVoice && near && nearD2 < SIPHON_LOOP_ON * SIPHON_LOOP_ON) {
      LOOP_AT.x = near.x; LOOP_AT.y = near.y + 12; LOOP_AT.z = near.z;
      st.siphonVoice = engine.loop('siphon_loop', LOOP_AT);
      st.siphonId = st.siphonVoice ? near.id : '';
    }
    let inTown = false;
    const env = ctx.env;
    if (env && env.settlement) {
      const ids = IDS.settlement;
      for (let i = 0; i < ids.length && !inTown; i++) {
        const s = env.settlement(ids[i]);
        if (!s) continue;
        const dx = s.x - p.pos.x;
        const dz = s.z - p.pos.z;
        if (dx * dx + dz * dz < s.radius * s.radius) inTown = true;
      }
    }
    if (palette !== st.lastPalette || inTown !== st.lastSettlement) {
      st.lastPalette = palette;
      st.lastSettlement = inTown;
      PLACE.palette = palette;
      PLACE.settlement = inTown;
      music.set(PLACE);
    }
  }

  return {
    /** Place state for tests and the debug command. */
    place() {
      return { palette: st.palette, nearSiphon: st.nearSiphon, nearSiphonD: st.nearSiphonD, nearCamp: st.nearCamp, siphonLoop: st.siphonVoice !== 0, siphonId: st.siphonId };
    },
    /** Place check without an AudioContext (noaudio, before unlock): 1 Hz. @param {number} dt */
    idle(dt) {
      st.checkT -= dt;
      if (st.checkT <= 0) {
        st.checkT = 1;
        checkPlace();
      }
    },
    /** Frame: loop levels and the 1 Hz place check. @param {any} c @param {number} dt */
    frame(c, dt) {
      if (!engine.ready) return;
      const p = c.player;
      if (st.gatherVoice) {
        st.gatherT += dt;
        engine.setParam(st.gatherVoice, 'level', Math.min(1, st.gatherT / 2.5));
        const s = p && p.stats;
        if (s && !st.gatherFull && s.ora >= s.oraMax - 0.5) {
          st.gatherFull = true;
          playFlat('gather_full', 1, 1);
        }
      }
      if (st.windVoice && p && p.move) engine.setParam(st.windVoice, 'level', Math.min(1, p.move.speed / 60));
      if (p && !st.ambVoice) st.ambVoice = engine.loop('ambience', LOOP_FLAT);
      st.checkT -= dt;
      if (st.checkT <= 0) {
        st.checkT = 1;
        checkPlace();
        if (st.ambVoice && p) {
          const w = c.world;
          const ground = w && w.groundAt ? w.groundAt(p.pos.x, p.pos.z) : 0;
          const alt = Math.max(0, p.pos.y - (Number.isFinite(ground) ? ground : 0));
          engine.setParam(st.ambVoice, 'level', Math.min(1, 0.3 + alt / 220));
        }
      }
    },
  };
}
