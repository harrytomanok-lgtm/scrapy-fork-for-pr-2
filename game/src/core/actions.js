/**
 * The action layer vocabulary (ARCHITECTURE 4.8, GDD 5.1) and the device bindings of the foundation
 * sources (ART_UX 6.4 keyboard and mouse, 6.5 basic gamepad). Pure module: data only.
 * @module core/actions
 */

/** Every action id. */
export const ACTIONS = Object.freeze(['attack', 'bolt', 'dash', 'guard', 'jump', 'descend', 'gather', 'tech1', 'tech2', 'ultimate', 'form', 'formNext',
  'lock', 'lockNext', 'lockPrev', 'interact', 'item', 'itemNext', 'map', 'pause', 'menuQuests', 'menuInventory', 'menuTechniques', 'menuCharacter', 'skip',
  'uiConfirm', 'uiBack', 'uiUp', 'uiDown', 'uiLeft', 'uiRight', 'uiTabNext', 'uiTabPrev']);

/** Axis names: moveX right and moveY forward in -1..1; lookX right and lookY up in degrees accumulated per tick. */
export const AXES = Object.freeze(['moveX', 'moveY', 'lookX', 'lookY']);

/** Input contexts. In 'ui' and 'cine' gameplay actions read as up and axes as 0; {@link ALWAYS_ACTIONS} always work. */
export const CONTEXTS = Object.freeze(['game', 'ui', 'cine']);

/** Actions that work in every context: the ui* actions, pause and skip. */
export const ALWAYS_ACTIONS = Object.freeze(ACTIONS.filter((a) => a.startsWith('ui') || a === 'pause' || a === 'skip'));

/** Action id -> index into ACTIONS. */
export const ACTION_INDEX = Object.freeze(Object.fromEntries(ACTIONS.map((a, i) => [a, i])));

/** Axis name -> index into AXES. */
export const AXIS_INDEX = Object.freeze(Object.fromEntries(AXES.map((a, i) => [a, i])));

/**
 * Keyboard bindings: `KeyboardEvent.code` -> actions. Ctrl is never bound.
 * Movement keys (WASD) and look keys (arrows) also feed the axes; see {@link KBM_MOVE_KEYS} and {@link KBM_LOOK_KEYS}.
 * Bindings beyond ART_UX 6.4: X = itemNext, G = formNext, Enter = skip, Q / E = uiTabPrev / uiTabNext.
 */
export const KBM_KEYS = Object.freeze({
  Space: ['jump'],
  KeyC: ['descend'],
  ShiftLeft: ['dash'], ShiftRight: ['dash'],
  KeyQ: ['guard', 'uiTabPrev'],
  KeyF: ['gather'],
  Digit1: ['tech1'], Digit2: ['tech2'],
  KeyR: ['ultimate'],
  KeyT: ['form'],
  KeyG: ['formNext'],
  Tab: ['lock'],
  KeyE: ['interact', 'uiTabNext'],
  KeyH: ['item'],
  KeyX: ['itemNext'],
  KeyM: ['map'],
  KeyJ: ['menuQuests'], KeyI: ['menuInventory'], KeyK: ['menuTechniques'], KeyU: ['menuCharacter'],
  Escape: ['pause', 'uiBack'], KeyP: ['pause'],
  Enter: ['uiConfirm', 'skip'], NumpadEnter: ['uiConfirm', 'skip'],
  Backspace: ['uiBack'],
  ArrowUp: ['uiUp'], ArrowDown: ['uiDown'], ArrowLeft: ['uiLeft'], ArrowRight: ['uiRight'],
  KeyW: ['uiUp'], KeyS: ['uiDown'], KeyA: ['uiLeft'], KeyD: ['uiRight'],
});

/** Movement keys: code -> [axis index 0 = moveX | 1 = moveY, sign]. */
export const KBM_MOVE_KEYS = Object.freeze({ KeyW: [1, 1], KeyS: [1, -1], KeyD: [0, 1], KeyA: [0, -1] });

/** Look keys: code -> [axis 2 = lookX | 3 = lookY, sign] at KEY_LOOK_DEG_PER_S. */
export const KBM_LOOK_KEYS = Object.freeze({ ArrowRight: [2, 1], ArrowLeft: [2, -1], ArrowUp: [3, 1], ArrowDown: [3, -1] });

/** Mouse buttons (`MouseEvent.button`) -> action: 0 left = attack, 2 right = bolt. */
export const KBM_MOUSE = Object.freeze({ 0: 'attack', 2: 'bolt' });

/** Mouse wheel: scrolling down (deltaY > 0) = lockNext, up = lockPrev. */
export const KBM_WHEEL = Object.freeze({ down: 'lockNext', up: 'lockPrev' });

/** Standard-mapping gamepad button indices. */
export const PAD = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });

/**
 * Basic pad bindings (ART_UX 6.5): [button, action, modifier] where modifier is
 * 0 = only without LT, 1 = only with LT held, 2 = either. UI navigation uses the same buttons.
 * @type {ReadonlyArray<readonly [number, string, 0|1|2]>}
 */
export const PAD_BINDINGS = Object.freeze([
  [PAD.A, 'jump', 0], [PAD.B, 'dash', 0], [PAD.X, 'attack', 0], [PAD.Y, 'bolt', 0],
  [PAD.X, 'tech1', 1], [PAD.Y, 'tech2', 1], [PAD.A, 'form', 1], [PAD.B, 'ultimate', 1],
  [PAD.RB, 'guard', 2], [PAD.LB, 'gather', 2], [PAD.RT, 'descend', 2], [PAD.R3, 'lock', 2],
  [PAD.UP, 'interact', 2], [PAD.DOWN, 'item', 2], [PAD.RIGHT, 'itemNext', 2], [PAD.LEFT, 'map', 2],
  [PAD.VIEW, 'map', 2], [PAD.MENU, 'pause', 2], [PAD.MENU, 'skip', 2], [PAD.A, 'skip', 2],
  [PAD.A, 'uiConfirm', 2], [PAD.B, 'uiBack', 2],
  [PAD.UP, 'uiUp', 2], [PAD.DOWN, 'uiDown', 2], [PAD.LEFT, 'uiLeft', 2], [PAD.RIGHT, 'uiRight', 2],
  [PAD.LB, 'uiTabPrev', 2], [PAD.RB, 'uiTabNext', 2],
]);

/** Glyph labels for keyboard and mouse prompts ('' = unbound). */
export const KBM_GLYPHS = Object.freeze({
  attack: 'LMB', bolt: 'RMB', dash: 'Shift', guard: 'Q', jump: 'Space', descend: 'C', gather: 'F', tech1: '1', tech2: '2',
  ultimate: 'R', form: 'T', formNext: 'G', lock: 'Tab', lockNext: 'Wheel', lockPrev: 'Wheel', interact: 'E', item: 'H', itemNext: 'X',
  map: 'M', pause: 'Esc', menuQuests: 'J', menuInventory: 'I', menuTechniques: 'K', menuCharacter: 'U', skip: 'Enter',
  uiConfirm: 'Enter', uiBack: 'Esc', uiUp: '↑', uiDown: '↓', uiLeft: '←', uiRight: '→', uiTabNext: 'E', uiTabPrev: 'Q',
  move: 'WASD', look: 'Mouse',
});

/** Glyph labels for gamepad prompts ('' = unbound). */
export const PAD_GLYPHS = Object.freeze({
  attack: 'X', bolt: 'Y', dash: 'B', guard: 'RB', jump: 'A', descend: 'RT', gather: 'LB', tech1: 'LT+X', tech2: 'LT+Y',
  ultimate: 'LT+B', form: 'LT+A', formNext: '', lock: 'R3', lockNext: 'R', lockPrev: 'R', interact: 'D↑', item: 'D↓', itemNext: 'D→',
  map: 'View', pause: 'Menu', menuQuests: '', menuInventory: '', menuTechniques: '', menuCharacter: '', skip: 'A',
  uiConfirm: 'A', uiBack: 'B', uiUp: 'D↑', uiDown: 'D↓', uiLeft: 'D←', uiRight: 'D→', uiTabNext: 'RB', uiTabPrev: 'LB',
  move: 'L', look: 'R',
});
