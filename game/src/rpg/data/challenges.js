/**
 * After the ending: boss rematches from any Ringstone and the challenge trials (a timed fight, a wave survival, a
 * flight course), each with bronze, silver and gold. Pure data.
 * @module rpg/data/challenges
 */

/** The five rematches: par time (s) for gold and silver (bronze is any win); levels above the player's. */
export const REMATCH = Object.freeze({
  levelAbove: 2,
  levelCap: 40,
  bosses: Object.freeze({
    durn: { gold: 45, silver: 70 },
    bramblehorn: { gold: 70, silver: 100 },
    gorrumaw: { gold: 80, silver: 115 },
    iskra: { gold: 85, silver: 125 },
    vorrhal: { gold: 150, silver: 210 },
  }),
  /** Shells for each medal, first time only. */
  rewards: Object.freeze({ bronze: 300, silver: 600, gold: 1200 }),
});

/**
 * The trials, fought on Sela's Ledge (the training plateau of the first minutes) and flown around the Spire.
 * `waves`: groups in order (the next comes when the last is down). Medal times in seconds.
 */
export const TRIALS = Object.freeze({
  trial_gauntlet: { kind: 'fight', at: { x: -1650, z: 1835 }, waves: ['camp_choir_large'], levelAbove: 1, medals: { gold: 40, silver: 65, bronze: 110 } },
  trial_waves: { kind: 'fight', at: { x: -1650, z: 1835 }, waves: ['camp_beasts', 'camp_choir_small', 'camp_coast', 'camp_choir_large'], levelAbove: 0,
    medals: { gold: 110, silver: 160, bronze: 240 } },
  trial_sky: { kind: 'race', course: 'spire_circuit' },
});
export const TRIAL_REWARDS = Object.freeze({ bronze: 150, silver: 350, gold: 700 });
/** A trial fight is lost when the player strays this far from its centre (m). */
export const TRIAL_LEASH = 140;
/** Seconds a trial waits for a wave that fails to spawn before it ends (not counted as cleared). */
export const TRIAL_SPAWN_WAIT = 5;

/** The Spire Circuit: twelve gates on a ring around the Wellspring Spire, rising and dipping (alt above ground). */
export function spireCircuit() {
  const gates = [];
  for (let i = 0; i < 12; i++) {
    const a = Math.PI / 2 - (i + 1) * ((Math.PI * 2) / 12);
    const r = i % 2 === 0 ? 470 : 540;
    gates.push({ x: Math.round(Math.cos(a) * r), z: Math.round(Math.sin(a) * r), alt: 50 + (i % 3) * 35 });
  }
  return { id: 'spire_circuit', start: { x: 0, z: 560 }, gates, medals: { bronze: 70, silver: 52, gold: 42 }, goldReward: 'stormcaller_wraps' };
}

/** The Ringstones (their landmark ids; the POI id is 'ringstone_' + id), in map order for the travel menu. */
export const RINGSTONES = Object.freeze(['sparkstead', 'haven_aster', 'saltglass_arches', 'tide_beacon', 'talias_camp', 'copperwatch', 'ridgerest',
  'still_wind', 'spire_approach']);
