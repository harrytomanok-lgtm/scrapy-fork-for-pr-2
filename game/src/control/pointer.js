/**
 * Desktop pointer-lock handling (ART_UX 6.4). The foundation's kbm source requests the lock on the first click and
 * presses `pause` when the lock is lost during play. This module tracks whether the lock is held or was refused
 * (embedded pages often refuse it) so the camera can lean on its auto-recentre, and shows a grab cursor while a
 * right or middle drag turns the camera without the lock. Everything is optional and wrapped (7.2 rule 10).
 * @module control/pointer
 */

/**
 * @param {any} ctx
 * @param {{ pointerLocked:boolean, noLock:boolean }} shared mutated
 * @returns {{ dispose:()=>void }}
 */
export function createPointer(ctx, shared) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return { dispose() {} };
  /** @returns {HTMLElement|null} */
  const canvas = () => {
    const three = ctx.three;
    return (three && three.renderer && three.renderer.domElement) || null;
  };
  function onChange() {
    let locked = false;
    try {
      locked = !!document.pointerLockElement;
    } catch (err) {
      locked = false;
    }
    shared.pointerLocked = locked;
    if (locked) shared.noLock = false;
  }
  function onError() {
    shared.pointerLocked = false;
    shared.noLock = true;
  }
  /** @param {MouseEvent} e */
  function onDown(e) {
    if (shared.pointerLocked || (e.button !== 1 && e.button !== 2)) return;
    const c = canvas();
    if (c && e.target === c) c.style.cursor = 'grabbing';
  }
  function onUp() {
    const c = canvas();
    if (c && c.style.cursor === 'grabbing') c.style.cursor = '';
  }
  const list = [
    [document, 'pointerlockchange', onChange],
    [document, 'pointerlockerror', onError],
    [window, 'mousedown', onDown],
    [window, 'mouseup', onUp],
    [window, 'blur', onUp],
  ];
  for (const [t, type, fn] of list) /** @type {any} */ (t).addEventListener(type, fn);
  return {
    dispose() {
      for (const [t, type, fn] of list) /** @type {any} */ (t).removeEventListener(type, fn);
    },
  };
}
