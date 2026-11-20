/**
 * The reward-cadence model's numbers (rpg/logic/cadence.js, tools/reward-cadence.mjs): how long a player takes for
 * each kind of thing on the main path, and the order in which a typical first journey takes the content. Pure data.
 *
 * Timings are a careful player's, not a speedrunner's: the MQ1 beats are the times measured by play-first-ten
 * (sim time plus reading and the trips its teleports skip) doubled; travel adds a detour factor for the ambient
 * fights and sightseeing on the way; fights use the per-kill and boss-fight lengths of the balance pass.
 * @module rpg/data/cadence
 */

export const CADENCE = Object.freeze({
  /** The cadence rule: no stretch of play longer than this without something new (s), checked over `horizon` (s). */
  gapLimit: 180,
  horizon: 3600,
  /** Travel: walking speed before flight, flight cruise with some boosting (m/s); per-leg overhead (s); detour factor. */
  walk: 8,
  fly: 42,
  legOverhead: 6,
  detour: 1.2,
  /** The player turns aside for a glowing chest or shrine this close to the way (m), and spends these seconds on it. */
  sideReach: 90,
  chestSeconds: 10,
  shrineSeconds: 8,
  /** Talk: a base plus seconds per line (typing at 45 cps and reading). */
  talkBase: 4,
  talkPerLine: 3.2,
  /** Seconds per enemy killed, by tier. */
  perKill: Object.freeze({ grunt: 9, heavy: 20, elite: 24 }),
  /** Boss fights (s): the middle of the balance pass's bands. */
  boss: Object.freeze({ durn: 60, bramblehorn: 92, gorrumaw: 108, iskra: 115, vorrhal: 180 }),
  /** A Siphon: two guard waves and the core cycle (s). */
  siphonSeconds: 80,
  interactSeconds: 4,
  techUseSeconds: 12,
  raceExtra: 15,
  campBase: 10,
  /** MQ1's scripted beats (s), from play-first-ten doubled. s8 is the flight to the Ringstone, modelled as travel. */
  mq1: Object.freeze({ s1: 14, s2: 10, s3: 22, s4: 26, s5: 42, s6: 16, s7: 55 }),
  /** Ambient kills per minute of travel (BALANCE.route bands A, B, C) are applied by the model from the route. */
  /**
   * The order of a typical first journey (GDD 2, 8.2 and the BALANCE.route bands): the opening, the side quests
   * around Sparkstead, a few camps on the way, then MQ4 and MQ3 (the recommended levels), MQ5, MQ6, MQ7.
   * Entries: a quest id, or { camp: regionId } for the nearest camp of that region not yet cleared.
   */
  plan: Object.freeze([
    'mq1', 'mq2', 'sq1', 'sq2', { camp: 'meadows' }, 'sq3', { camp: 'meadows' }, { camp: 'coast' }, 'mq4', { camp: 'coast' },
    { camp: 'thornwood' }, 'mq3', { camp: 'thornwood' }, { camp: 'rustdune' }, 'sq4', 'mq5', { camp: 'rustdune' }, { camp: 'frostspine' },
    'mq6', 'mq7',
  ]),
  /** Reward kinds that count as "something new" for the gap rule. */
  newKinds: Object.freeze(['level', 'technique', 'form', 'gear', 'chest', 'region', 'boss', 'quest', 'shrine', 'ringstone', 'shard', 'title']),
});
