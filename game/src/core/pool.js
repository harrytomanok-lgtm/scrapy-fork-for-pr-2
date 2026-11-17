/**
 * Generic object pool (ARCHITECTURE 3.9, 7.2 rule 3).
 * @module core/pool
 */

/**
 * @template T
 * @typedef {object} Pool
 * @property {() => T} get        Take an object (from the free list, or a new one from the factory).
 * @property {(obj:T) => void} release   Reset the object and return it to the free list. Do not release twice.
 * @property {number} size        Number of free objects ready to be taken.
 * @property {number} created     Number of objects the factory has created so far.
 */

/**
 * Create a pool.
 * @template T
 * @param {() => T} factory Creates a fresh object.
 * @param {((obj:T) => void)|null} reset Called on release so pooled objects hold no stale references.
 * @param {number} [initialSize=0] Objects created up front.
 * @returns {Pool<T>}
 */
export function createPool(factory, reset, initialSize = 0) {
  /** @type {T[]} */
  const free = [];
  let created = 0;
  for (let i = 0; i < initialSize; i++) {
    free.push(factory());
    created++;
  }
  return {
    get() {
      if (free.length > 0) return /** @type {T} */ (free.pop());
      created++;
      return factory();
    },
    release(obj) {
      if (reset) reset(obj);
      free.push(obj);
    },
    get size() {
      return free.length;
    },
    get created() {
      return created;
    },
  };
}
