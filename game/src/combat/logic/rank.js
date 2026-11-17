/**
 * Technique rank resolution (ARCHITECTURE 5.1 `ranks`): a TechniqueDef plus the mods of ranks 2..rank folded in
 * gives the effective definition the engine runs. Mods are cumulative (rank 3 applies the mods of ranks 2 and 3).
 * Mod keys:
 * - `powerMult`  multiplies the power of every hit, projectile, beam and projectile AoE (chain steps included);
 * - `costMult`   multiplies `cost.ora`;
 * - `radiusMult` multiplies every hit radius, the beam radius and the crater radius;
 * - `chainSteps` the number of chain steps in use (Strike String rank 2 adds the sixth hit);
 * - any other key is a dotted path override (`beam.radius`, `hits.0.poise`, `projectiles.0.count`).
 * Pure: no three, no window. Resolution allocates, so the engine caches the result per technique and rank.
 * @module combat/logic/rank
 */

/**
 * Deep copy of plain data (objects, arrays, numbers, strings, booleans, null).
 * @template T
 * @param {T} v
 * @returns {T}
 */
export function cloneData(v) {
  if (Array.isArray(v)) return /** @type {any} */ (v.map(cloneData));
  if (v && typeof v === 'object') {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of Object.keys(v)) o[k] = cloneData(/** @type {any} */ (v)[k]);
    return /** @type {any} */ (o);
  }
  return v;
}

/**
 * Set a dotted path on an object; missing intermediate objects are created. Array indexes are numeric parts.
 * @param {any} obj @param {string} path @param {number} value
 * @returns {boolean} false when the path cannot be set
 */
export function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] === null || o[k] === undefined) o[k] = {};
    o = o[k];
    if (typeof o !== 'object') return false;
  }
  o[parts[parts.length - 1]] = value;
  return true;
}

/** @param {any} list @param {number} m */
function multPower(list, m) {
  if (!Array.isArray(list)) return;
  for (const h of list) {
    if (!h) continue;
    if (typeof h.power === 'number') h.power *= m;
    if (typeof h.edgePower === 'number') h.edgePower *= m;
    if (h.aoe && typeof h.aoe.power === 'number') h.aoe.power *= m;
    if (h.burn && typeof h.burn.power === 'number') h.burn.power *= m;
  }
}

/** @param {any} list @param {number} m */
function multRadius(list, m) {
  if (!Array.isArray(list)) return;
  for (const h of list) if (h && typeof h.radius === 'number') h.radius *= m;
}

/**
 * Apply one rank's mods to a (cloned) definition in place.
 * @param {any} def @param {Record<string, number>|undefined} mods
 * @returns {any} def
 */
export function applyMods(def, mods) {
  if (!mods) return def;
  for (const key of Object.keys(mods)) {
    const v = mods[key];
    if (key === 'powerMult') {
      multPower(def.hits, v);
      multPower(def.projectiles, v);
      if (def.beam) def.beam.power *= v;
      if (def.chain) for (const s of def.chain) multPower(s.hits, v);
    } else if (key === 'costMult') {
      def.cost.ora *= v;
    } else if (key === 'radiusMult') {
      multRadius(def.hits, v);
      if (def.chain) for (const s of def.chain) multRadius(s.hits, v);
      if (def.beam) def.beam.radius *= v;
      if (def.crater) def.crater.radius *= v;
    } else if (key === 'chainSteps') {
      def.chainSteps = v;
    } else {
      setPath(def, key, v);
    }
  }
  return def;
}

/**
 * The effective definition at `rank` (1-based). Rank 1 (or a def without ranks) returns a clone of the base.
 * The result always carries `chainSteps` (the chain steps in use, 0 without a chain) and `rank`.
 * @param {any} base TechniqueDef
 * @param {number} rank
 * @returns {any}
 */
export function resolveRank(base, rank) {
  const def = cloneData(base);
  if (typeof def.chainSteps !== 'number') def.chainSteps = def.chain ? def.chain.length : 0;
  const ranks = Array.isArray(base.ranks) ? base.ranks : [];
  const top = Math.max(1, Math.min(ranks.length || 1, Math.floor(rank) || 1));
  for (let i = 1; i < top; i++) applyMods(def, ranks[i] && ranks[i].mods);
  if (def.chain) def.chainSteps = Math.max(1, Math.min(def.chain.length, def.chainSteps));
  def.rank = top;
  return def;
}
