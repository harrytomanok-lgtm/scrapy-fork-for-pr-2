/**
 * Pure helpers of the world activities: race medals and gates, the Siphon core cycle.
 * @module rpg/logic/activity
 */

/**
 * The medal for a finish time (GDD 3.4): the best medal whose time limit is met.
 * @param {number} seconds @param {{ bronze:number, silver:number, gold:number }} medals
 * @returns {'none'|'bronze'|'silver'|'gold'}
 */
export function medalFor(seconds, medals) {
  if (seconds <= medals.gold) return 'gold';
  if (seconds <= medals.silver) return 'silver';
  if (seconds <= medals.bronze) return 'bronze';
  return 'none';
}

/**
 * A ring gate is passed when the point is within `radius` of its centre.
 * @param {{x:number,y:number,z:number}} g @param {number} x @param {number} y @param {number} z @param {number} radius
 */
export function gatePassed(g, x, y, z, radius) {
  const dx = x - g.x;
  const dy = y - g.y;
  const dz = z - g.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/**
 * The Siphon core is open for `openSeconds` at the end of every `cycleSeconds` window (closed first, so the
 * player sees the shell before the opening).
 * @param {number} t seconds since the cycle started @param {number} cycleSeconds @param {number} openSeconds
 */
export function siphonOpen(t, cycleSeconds, openSeconds) {
  const k = t % cycleSeconds;
  return k >= cycleSeconds - openSeconds;
}
