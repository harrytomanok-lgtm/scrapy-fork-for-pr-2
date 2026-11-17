/**
 * Engine-wide constants of the runtime core (ARCHITECTURE 1, 3.2, 3.4, 3.5, 4.8).
 * Pure module: no three, no DOM.
 * @module core/constants
 */

/** Fixed simulation rate in Hz. */
export const SIM_HZ = 60;
/** Fixed simulation step in seconds. */
export const SIM_DT = 1 / 60;
/** At most this many sim steps run per animation frame; the excess is dropped. */
export const MAX_STEPS = 4;
/** Real frame time is clamped to this many seconds before it feeds the accumulator. */
export const MAX_FRAME_DT = 0.1;
/** Milliseconds per sim tick used to convert hit-stop durations into ticks (3.2). */
export const TICK_MS = 16.667;

/** World seed used by `rng.world` unless the `worldseed` flag overrides it. */
export const WORLD_SEED = 7168;
/** Side of the world square in metres. */
export const WORLD_SIZE = 7168;
/** Half the side of the world square in metres. */
export const WORLD_HALF = 3584;

/** Spatial hash cell size in metres (3.5). */
export const SPATIAL_CELL = 32;

/**
 * Entity hard caps (3.5). Creating beyond a cap returns null and logs once.
 * `actors` covers the kinds player, enemy, boss and npc together.
 */
export const ENT_CAPS = Object.freeze({ actors: 64, projectile: 256, pickup: 64, object: 128 });

/** Entity kinds in a fixed order. */
export const ENT_KINDS = Object.freeze(['player', 'enemy', 'boss', 'npc', 'projectile', 'pickup', 'object']);

/** Sim phases in run order (3.4). */
export const SIM_PHASES = Object.freeze(['input', 'script', 'intent', 'combat', 'move', 'post', 'cleanup']);
/** Sim phases skipped entirely while `time.frozen` (hit-stop). */
export const GAMEPLAY_PHASES = Object.freeze(['script', 'intent', 'combat', 'move', 'post']);
/** Frame phases in run order (3.4). */
export const FRAME_PHASES = Object.freeze(['pre', 'world', 'anim', 'vfx', 'camera', 'audio', 'ui', 'render', 'debug']);

/** Known pause reasons (3.2). Other strings are accepted, these are the ones the game uses. */
export const PAUSE_REASONS = Object.freeze(['menu', 'dialogue', 'cine', 'hidden', 'debug']);

/** A system or listener that throws this many times ... */
export const FAULT_MAX_THROWS = 3;
/** ... within this many ticks is disabled (3.4, 3.6). */
export const FAULT_WINDOW_TICKS = 60;

/** Replaceable service slots (3.3). */
export const SERVICE_SLOTS = Object.freeze(['world', 'env', 'render', 'vfx', 'actors', 'move', 'cam', 'combat', 'ai', 'rpg', 'quests', 'ui', 'audio']);

/** Keyboard look speed of the arrow keys in degrees per second (4.8, ART_UX 6.4). */
export const KEY_LOOK_DEG_PER_S = 120;
/** Mouse look in degrees per pixel of movement, before the camera applies `settings.camSens`. */
export const MOUSE_DEG_PER_PX = 0.15;
/** Gamepad right-stick look at full deflection, degrees per second, before `settings.camSens`. */
export const PAD_LOOK_DEG_PER_S = 180;
/** Gamepad radial dead zone (ART_UX 6.5). */
export const PAD_DEAD_ZONE = 0.18;
