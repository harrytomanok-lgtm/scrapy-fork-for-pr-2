# KETHRA: Veins of Light. Architecture (binding engineering contract)

Version 2. Companion documents: `GDD.md` (what the game is) and `ART_UX.md` (how it looks, feels and sounds). This document says how the code is organised and how packages talk to each other. If a detail here conflicts with the other two documents about gameplay numbers, the GDD wins; about module boundaries, names and signatures, this document wins.

Scope: everything lives in `game/`. Nothing outside `game/` is read, modified or depended on.

**How to read this as a package engineer**: read sections 1-3 fully, then in section 4 the APIs you implement and the ones you consume, the schemas you own in section 5, sections 6-7, and your package card in section 8. Every service you consume already exists as a working stand-in behind the final API, so your package runs and is testable on its own.

---

## 1. Decisions at a glance

| Topic | Decision |
|-------|----------|
| Engine | three **0.170.0** (exact pin), WebGL2 only, `WebGLRenderer`, named imports only (`import { Vector3 } from 'three'`) |
| Bundler | esbuild **0.24.2** (exact pin), one ESM bundle `dist/game.js`, target `es2020` |
| Test browser | playwright **1.63.0**, used from the machine's global install (`/opt/node-tools/node_modules/playwright`, browsers in `/opt/pw-browsers`). It is NOT a dependency in `package.json` and is never installed or downloaded by the project; `tools/lib/harness.mjs` resolves it with `import('playwright')` and falls back to the global path |
| Language | Plain JavaScript ES modules, JSDoc types, no TypeScript, no framework |
| Simulation | Fixed 60 Hz step, at most 4 steps per frame, render interpolation of positions; hit-stop and slow motion are part of the deterministic sim clock |
| Entities | Plain objects with stable shape in a registry; uniform-grid spatial hash (32 m cells) |
| World | 7168 m square, island radius about 3100 m, one baked Float32 height grid at 4 m (8 m on low-memory devices) as the single source of truth, baked in a blob Worker. If the Worker cannot start (some embedding pages block `blob:` workers), a time-sliced main-thread bake at 8 m is used instead |
| Terrain | 256 m chunks, 3 LODs plus one far mesh of the whole island, skirts against cracks, per-vertex baked colour, crater = grid edit and chunk rebuild |
| Physics | No engine. Kinematic controller against `world.groundAt` plus static colliders (sphere, capsule, box, disc); projectiles are swept spheres |
| Characters | One merged rigid-skinned mesh per character (one draw call plus optional outline), procedural clips and locomotion |
| Combat timing | Technique timelines live in **data and run in the sim** (combat package). Animation is visual only and never drives hits |
| Shading | Custom toon `ShaderMaterial` family sharing global lighting uniforms; inverted-hull outlines; no tone mapping (colours are authored display-referred, emissive may exceed 1 for bloom). Material features are uniforms, never `#define` permutations: at most 24 programs on low, all linked behind the loading screen |
| Quality tiers | **low** (phones) and **high** (desktop) in P0. `medium` is P1 and is not built or verified |
| UI | DOM and CSS overlay, screen stack, logical properties, Hebrew default (RTL), `dir` set on `#app` |
| Audio | WebAudio only, no files. One-shot SFX and instrument notes are pre-rendered into buffers with an `OfflineAudioContext`; only four loops are synthesised live |
| State | One JSON store for everything persistent; versioned saves in localStorage with an in-memory fallback and a portable journey code (text export and import) |
| Packages | 1 foundation + 9 feature packages with exclusive directories; services are reached only through `ctx.<slot>`; content only through `ctx.defs`; self-registration through generated discovery (no shared file is edited after the foundation) |
| Coordinates | Metres. +x east, +y up, +z south. Origin = the Spire. `object.rotation.y = yaw`; models are built facing local +Z; forward = `(sin(yaw), 0, cos(yaw))` (yaw 0 faces south, yaw pi faces north) |

---

## 2. Folder tree, ownership, tooling

### 2.1 Tree (owner in brackets; a directory belongs to exactly one package)
```
game/
  package.json  .gitignore  README.md                [foundation]
  docs/  GDD.md  ART_UX.md  ARCHITECTURE.md           [lead]
  src/
    main.js                                           [foundation] entry: flags, error trap, boot
    core/                                             [foundation] FINAL shared code, importable by every package
      constants.js  flags.js  log.js  errors.js  dom.js  theme.js
      loop.js  time.js  systems.js  context.js  events.js  store.js  save.js  defs.js
      ents.js  spatial.js  rng.js  math.js  pool.js
      i18n.js  strings.js  input.js  actions.js
      balance.js  formulas.js  feel.js  fx.js  palette.js  ids.js  debug.js  bench.js
    game/                                             [foundation]
      boot.js  game.js  session.js
      registry.gen.js                                 generated by tools/gen-registry.mjs, gitignored
    standins/                                         [foundation] minimal working services behind the final APIs
      world.js  env.js  render.js  vfx.js  actors.js  move.js  cam.js  combat.js  ai.js
      rpg.js  quests.js  ui.js  audio.js  content.js
    world/                                            [world]
    env/  audio/                                      [env]
    render/  vfx/                                     [gfx]
    actors/                                           [actors]
    control/                                          [control]
    combat/                                           [combat]
    ai/                                               [ai]
    rpg/                                              [rpg]
    ui/                                               [ui]
  tools/
    build.mjs  serve.mjs  gen-registry.mjs  smoke.mjs  scenarios.mjs
    lint-strings.mjs  check-ip.mjs  check-imports.mjs  lib/harness.mjs   [foundation]
    scenarios/foundation.mjs                          [foundation]
    scenarios/<package id>.mjs                        [that package]
    out/                                              gitignored: shots/, logs/
  tests/
    core/*.test.mjs                                   [foundation]
    <package id>/*.test.mjs                           [that package]
  dist/                                               gitignored: index.html, artifact.html, artifact-inline.html, game.js
```
Package ids and their source directories: `world` -> `src/world`; `env` -> `src/env`, `src/audio`; `gfx` -> `src/render`, `src/vfx`; `actors` -> `src/actors`; `control` -> `src/control`; `combat` -> `src/combat`; `ai` -> `src/ai`; `rpg` -> `src/rpg`; `ui` -> `src/ui`.

### 2.2 Import rule (enforced by `tools/check-imports.mjs`)
A file may import only: files in its own package's directories, `src/core/**`, and `three`. Nothing imports from `src/standins/**` or `src/game/**` except `src/main.js` and `src/game/**`. Files under any `logic/` or `data/` subdirectory, and `src/core/{balance,formulas,feel,rng,math,store,events,defs,palette,ids,actions,i18n}.js`, must not import `three` or touch `window`/`document` at module scope, so Node tests can load them.

### 2.3 Self-registration (no shared edits after the foundation)
Each package directory that is a service root contains `index.js` exporting a manifest:
```js
// src/<dir>/index.js
export const pkg = {
  id: 'world',                       // directory name
  /** @param {Ctx} ctx */
  install(ctx) {                     // called once at boot, before the world bake
    ctx.i18n.addStrings(strings);    // optional: { he:{...}, en:{...} }
    ctx.defs.register('landmark', LANDMARKS);          // optional content
    ctx.provide('world', createWorld(ctx), 'world');   // replaces the stand-in service
    ctx.systems.add({ id:'world.stream', phase:'post', step(ctx, dt) {...}, frame(ctx, dt, alpha) {...} });
    ctx.debug.register('flushBuilds', () => ctx.world.flushBuilds());   // optional extra debug commands
  },
};
```
`tools/gen-registry.mjs` (run by build, smoke and scenarios) looks for `src/<dir>/index.js` in this fixed order and writes `src/game/registry.gen.js`, which imports the manifests that exist:
`render, vfx, world, env, audio, actors, control, combat, ai, rpg, ui`.
`game.js` first installs every stand-in, then calls `pkg.install(ctx)` in that order. A directory without `index.js` is skipped and its stand-in stays active. Result: adding a package never edits a foundation file, and any subset of packages produces a bootable game.

### 2.4 package.json (foundation; no package may add dependencies)
```json
{
  "name": "kethra", "version": "0.1.0", "private": true, "type": "module",
  "dependencies": { "three": "0.170.0" },
  "devDependencies": { "esbuild": "0.24.2" },
  "scripts": {
    "gen": "node tools/gen-registry.mjs",
    "build": "node tools/build.mjs",
    "dev": "node tools/build.mjs --dev --watch --serve",
    "serve": "node tools/serve.mjs",
    "test": "node --test \"tests/**/*.test.mjs\"",
    "lint": "node tools/lint-strings.mjs && node tools/check-ip.mjs && node tools/check-imports.mjs",
    "smoke": "node tools/smoke.mjs",
    "scenarios": "node tools/scenarios.mjs",
    "check": "npm run lint && npm test && npm run build && npm run smoke"
  }
}
```

### 2.5 Tools
| Tool | Behaviour |
|------|-----------|
| `build.mjs` | Runs gen-registry. Bundles `src/world/worker.js` if it exists as IIFE text and injects it as the string `__WORLD_WORKER_SRC__` (empty string otherwise) for `new Worker(URL.createObjectURL(new Blob([src])))`. Bundles `src/main.js` (`format: 'esm'`, `target: 'es2020'`, minify unless `--dev`, `define: { __DEV__, __VERSION__, __WORLD_WORKER_SRC__ }`). Emits `dist/index.html` (full document: doctype, viewport meta with `viewport-fit=cover`, the Google Fonts link, inline base CSS, `<div id="app">`, `<script type="module" src="./game.js">`), `dist/artifact.html` (fragment: starts with `<title>` and `<style>`, then the fonts `<link>`, `<div id="app">`, the same script tag; no doctype, html, head or body tags) and `dist/artifact-inline.html` (the fragment with the bundle inlined). Fails if `game.js` exceeds 1.6 MB minified; warns above 1.2 MB. The Google Fonts stylesheet link is the only external reference in any output, and the page must look right with the fallback font stacks when it fails to load |
| `serve.mjs` | `node:http` static server for `dist/` on port 5173 (`PORT` overrides), correct MIME types, no dependencies |
| `gen-registry.mjs` | Section 2.3 |
| `lib/harness.mjs` | `launch({ width, height, query })` builds if needed, starts the server on a free port, launches Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-webgl`, opens `index.html?test=1&quality=low&res=0.5&noaudio=1&seed=123&lang=en&<query>`, waits for `window.__GAME__.isReady()` (timeout 180 s), collects console errors. Returns `{ page, game(fn, ...args), shot(name), errors(), close() }`; `game` evaluates `fn(window.__GAME__, ...args)`; `shot` renders one frame, awaits `screenshotReady()` and writes `tools/out/shots/<name>.png`. Playwright is resolved with `import('playwright')`, falling back to the global install |
| `smoke.mjs` | Foundation scenario list: boot, step 120, move, attack and kill a spawned enemy, XP gained, save and load round trip, language switch, both orientations; asserts `__GAME__.errors` is empty |
| `scenarios.mjs [packageId] [--only name]` | Loads `tools/scenarios/*.mjs` (each exports `scenarios: [{ name, width?, height?, query?, run({ page, game, shot, assert }) }]`), runs them one browser at a time, prints pass or fail, exit code 1 on failure |
| `lint-strings.mjs` | Every key exists in both `he` and `en`; every literal `t('key')` in `src/` exists; no Hebrew or user-facing English literals inside `src/ui` or `src/control` outside `strings.js` files; Hebrew UI strings must not start with a bare imperative (ART_UX 7.1): the tool keeps a list of imperative verb forms and exempts dialogue keys (`<questId>.lNN`, `*.idle.*`, `*.bark.*`) |
| `check-ip.mjs` | Fails on a blocklist of existing-franchise names and terms (kept inside the tool) found anywhere in `src/`. A second list holds the terms retired from earlier drafts of this design (GDD 1.6); it is matched as whole words inside string tables and content names only, never against code identifiers |
| `check-imports.mjs` | Section 2.2 |

### 2.6 URL flags (`src/core/flags.js`, read once into `ctx.flags`)
| Flag | Meaning |
|------|---------|
| `test=1` | Test mode: no title screen, no autosave, storage is memory-only, sim advances only through `__GAME__.step(n)` (unless `autoplay=1`), `preserveDrawingBuffer`, tutorial off, deterministic seeds, `Date.now` never read by the sim |
| `autoplay=1` | With `test=1`: run the sim in real time |
| `quality=low\|high` | Force the tier (otherwise saved setting, otherwise auto-detect) |
| `res=<0.3-1>` | Fixed render scale, disables dynamic resolution |
| `seed=<int>` | Seed for `rng.sim` and `rng.fx` (the world seed is the constant `WORLD_SEED = 7168` unless `worldseed=<int>`) |
| `lang=he\|en` | Language (default `he`) |
| `grid=4\|8` | Height grid cell size (default 4; 8 when `navigator.deviceMemory <= 2` or when the bake Worker cannot start) |
| `spawn=x,z` or `spawn=<landmarkId>` | Start position |
| `hour=<0-24>` | Start hour and freeze the clock |
| `tutorial=0\|1` | Skip or force MQ1 (default 1 in normal mode, 0 in test mode) |
| `nosave=1`, `noaudio=1`, `debug=1`, `fps=1` | Memory-only storage; no AudioContext; debug overlay; FPS counter |
| `bench=1` | After boot, run the scripted benchmark of 7.3 and show its result panel |

---

## 3. Runtime core (foundation, final)

### 3.1 Boot sequence (`src/game/boot.js`)
1. `main.js`: parse flags, install error traps, find or create `#app`, apply base CSS and theme tokens, show the DOM loading layer.
2. Create `ctx` (3.3), load settings from storage, set language.
3. Install stand-ins, then discovered packages (2.3). After this no service slot changes.
4. `await ctx.render.init()` (creates renderer, scene, camera), then `await ctx.world.bake(onProgress)`; then `await` every `ctx.onBoot(fn)` hook in registration order (env builds settlements, actors prebuild geometry, vfx builds pools); then `await ctx.render.compile()`.
5. `ctx.defs.validate()` (dev and test: throws on dangling ids). It passes on every partial build, because the foundation registers a stand-in definition for every id of `IDS` (3.8).
6. Normal mode: `ui.open('title')`. Test mode: `session.start({ slot: 1, newGame: true })` immediately (storage is memory-only in test mode, so nothing is persisted).
7. Emit `game:ready`, resolve `__GAME__.ready`, start the loop.
Progress is reported with `game:boot { phase, progress }`.
Loading and fatal layers: the foundation's DOM loading layer and fatal layer are fallbacks. When the ui package opens its `loading` screen it emits `ui:screen { id:'loading', open:true }` and the foundation hides its own loading layer on that event. A fatal error before the ui package is installed (or if `ui.open` itself throws) uses the foundation's fatal layer; otherwise the foundation calls `ui.open('fatal', { message })`.

`src/game/session.js` (final): `session.start({ slot, newGame, preset, gender, difficulty })` runs exactly this sequence: (1) load the slot, or create a fresh state, and `store.reset(state)`; (2) `i18n.setGender(state.player.gender)`; (3) on a new game emit `game:newGame { slot }`: no entity exists yet, so listeners may only write the store (rpg applies the `tutorial=0` shortcut here, 4.11); then apply `flags.spawn` if given; (4) create the player entity (`ents.create('player')`), `rpg.attachPlayer(ent)`, `actors.create(ent, state.player.preset)`, `combat.initActor(ent)`, `move.initActor(ent, { canFly: state.player.canFly })`, `move.teleport(ent, x, y, z, yaw)` from `state.player`, `cam.setTarget(ent.id)`, set `ctx.player`; (5) run the `save.onAfterLoad` hooks; (6) emit `player:spawned`, then `game:loaded`. `session.end()` destroys all entities, emits `game:ended` and returns to the title.

### 3.2 Loop and time (`loop.js`, `time.js`)
```js
export const SIM_HZ = 60, SIM_DT = 1 / 60, MAX_STEPS = 4;

// ctx.time
time.tick        // integer: number of sim steps run
time.now         // seconds of gameplay time (advances by SIM_DT * time.scale, not during hit-stop)
time.real        // seconds of unscaled sim time (tick * SIM_DT)
time.scale       // current gameplay time scale (1 normally)
time.frozen      // true while hit-stop ticks remain
time.paused      // true while any pause reason is active
time.hitStop(ms)                  // freezes gameplay phases for round(ms / 16.667) ticks; calls do not stack, the longer wins
time.slowMo(scale, seconds)       // gameplay dt *= scale for `seconds` of unscaled sim time; the lowest active scale wins
time.pause(reason) / time.resume(reason)   // reasons are strings ('menu', 'dialogue', 'cine', 'hidden', 'debug'); paused while the set is non-empty

// ctx.loop
loop.start(); loop.stop();
loop.stepSim(n)   // run n sim steps synchronously (tests); ignores pause reason 'debug'
loop.renderNow()  // run one frame pass with dt = 0
```
Per animation frame: `acc += min(realDt, 0.1)`; while `acc >= SIM_DT` and fewer than `MAX_STEPS` steps: run one sim step (excess is dropped). Then one frame pass with `alpha = acc / SIM_DT`. While paused no sim steps run; the frame pass still runs. In test mode without `autoplay` the accumulator is not fed. The sim never reads a wall clock.

### 3.3 Context and services (`context.js`)
One object passed to everything. Packages never import each other; they use these slots.
```js
/** @typedef {object} Ctx */
ctx = {
  // foundation, final (never replaced)
  flags, log, time, loop, bus, store, save, defs, ents, spatial, rng, systems, i18n, input, fx, debug, dom, session,
  player,                    // Entity | null, set by session
  three: { renderer, scene, camera },   // filled by render.init()
  // replaceable services: stand-in first, then the owning package
  world, env, render, vfx, actors, move, cam, combat, ai, rpg, quests, ui, audio,
  provide(slot, impl, ownerId),   // replace a service: disposes the previous impl (impl.dispose?.()), then removes the systems and the bus listeners owned by 'standin:<slot>'
                                  // (systems.removeOwner and bus.offOwner). Stand-ins register everything under that owner string.
  onBoot(fn),                     // async hook run after the world bake (3.1 step 4)
};
```
**Never cache a service.** No package may keep a `ctx.<slot>` reference in a module variable, closure or object field at install time: installs run in a fixed order, so such a reference can point at a disposed stand-in. Read `ctx.<slot>` at call time (`ctx.actors.play(...)`, never `const actors = ctx.actors` at module or install scope).

| Slot | Stand-in owner | Final owner | Purpose |
|------|----------------|-------------|---------|
| `world` | foundation | world | Height grid, queries, colliders, craters, terrain, water, vegetation, POI data |
| `env` | foundation | env | Clock, sun and sky, settlements, prop visuals |
| `audio` | foundation | env | SFX and music |
| `render` | foundation | gfx | Renderer, tiers, materials, outlines, screen-space effects |
| `vfx` | foundation | gfx | Particles, beams, auras, decals |
| `actors` | foundation | actors | Character meshes and animation |
| `move`, `cam` | foundation | control | Kinematics for all actors; camera |
| `combat` | foundation | combat | Techniques, damage, Forms, targeting |
| `ai` | foundation | ai | Enemies, spawning, bosses |
| `rpg`, `quests` | foundation | rpg | Progression, inventory, shops, loot; quests, dialogue, interactables |
| `ui` | foundation | ui | HUD and screens |

### 3.4 Systems and update order (`systems.js`)
```js
/** @typedef {{ id:string, phase:string, order?:number, step?:(ctx:Ctx, dt:number)=>void, frame?:(ctx:Ctx, dt:number, alpha:number)=>void, owner?:string }} System */
ctx.systems.add(system)       // owner defaults to the installing package id
ctx.systems.remove(id)
ctx.systems.removeOwner(owner)
```
A system may have `step` (sim), `frame` (render), or both; `phase` names the sim phase for `step` and the frame phase for `frame` separately if given as `{ step:'combat', frame:'vfx' }`. Within a phase, order is by `order` (default 0) then registration order. A system that throws is logged; in dev and test the error is recorded in `__GAME__.errors`; after 3 throws in 60 ticks the system is disabled.

**Sim phases, in order** (`dt` passed to `step` = `SIM_DT * time.scale`; "gameplay" phases are skipped entirely while `time.frozen`):
| # | Phase | Gameplay | Runs here (system id, owner) |
|---|-------|----------|------------------------------|
| 1 | `input` | no | `core.input` sample devices and injected input into the per-tick action state (foundation) |
| 2 | `script` | yes | `quests.run` quest scripts, timers, interact focus, quick item (rpg); `env.clock` (env) |
| 3 | `intent` | yes | `control.player` input axes -> `player.intent` (control), order 0; `combat.player` input actions -> `combat.act` (combat), order 10; `ai.brains` (ai), order 20 |
| 4 | `combat` | yes | `combat.run` technique timelines, hit resolution, projectiles, statuses, regen (combat) |
| 5 | `move` | yes | `move.run` kinematics, knockback, collisions for every entity with `ent.move` (control) |
| 6 | `post` | yes | `core.spatial` rehash moved entities (foundation), order -100; `world.stream` (world); `ai.spawner` (ai); `rpg.pickups` (rpg) |
| 7 | `cleanup` | no | `core.cleanup`: deferred `ents.destroy`, flush `bus.post` queue, clear per-tick input edges (foundation) |

**Frame phases, in order** (`dt` = real seconds since the last frame, clamped to 0.1; `alpha` = interpolation factor):
| # | Phase | Runs here |
|---|-------|-----------|
| 1 | `pre` | `core.inputPoll` (calls `poll` on every registered input source, 4.8), device-change detection |
| 2 | `world` | terrain LOD and build budget (world); sun, sky and fog uniforms (env) |
| 3 | `anim` | pose evaluation for visible actors (actors) |
| 4 | `vfx` | particle integration, beams, auras (gfx) |
| 5 | `camera` | camera rig (control) |
| 6 | `audio` | listener, music scheduler (env) |
| 7 | `ui` | HUD bindings (ui) |
| 8 | `render` | draw (gfx) |
| 9 | `debug` | overlay (foundation) |

Rendered position of an entity = `lerp(ent.prev, ent.pos, alpha)`; the foundation system `core.prev` (phase `input`, order -100) copies `pos` into `prev` at the start of each sim step. Visual systems must use `ents.renderPos(ent, alpha, out)`.

### 3.5 Entities and spatial queries (`ents.js`, `spatial.js`)
```js
/**
 * @typedef {object} Entity     Stable shape: every field exists from creation (null when unused).
 * @property {number} id        Unique, never reused within a session
 * @property {'player'|'enemy'|'boss'|'npc'|'projectile'|'pickup'|'object'} kind
 * @property {string} defId     Definition id (enemy id, npc id, object kind...)
 * @property {boolean} alive    False from the tick it is destroyed or killed
 * @property {0|1|2} team       0 neutral, 1 player side, 2 hostile
 * @property {Vector3} pos      Feet position (for flyers: body bottom)
 * @property {Vector3} prev     Position at the previous tick
 * @property {Vector3} vel
 * @property {number} yaw
 * @property {number} radius    Capsule radius
 * @property {number} height    Capsule height
 * @property {number} level
 * @property {Intent|null} intent     Desired movement, written by control (player) or ai, read by move
 * @property {MoveState|null} move    Owned by the move service
 * @property {ActorStats|null} stats  Shared read. Writers: rpg for the player (every field except hp and ora); ai for the enemies and bosses it spawns;
 *                                    rpg for kind 'object' (Siphons, breakable quest objects); combat for hp, ora and poise of every entity
 * @property {CombatState|null} combat  Owned by combat
 * @property {object|null} brain      Private to ai
 * @property {object|null} visual     Private to actors
 * @property {object|null} data       Private to the creator (projectile data, pickup data, object state)
 * @property {string|null} questTag   Set by the creator (ai.spawn opts.questTag, ObjectDef.targetTag); copied into actor:died so quests can count tagged kills and hits
 * @property {number} tags            Bit mask, see TAG. Written by the creator. Quest scripts (rpg) may also set and clear SCRIPTED and INVULNERABLE on any entity:
 *                                    ai brains idle while SCRIPTED is set, and combat.damage ignores INVULNERABLE targets
 * @property {string|null} nameKey    i18n key of the display name
 */
ents.create(kind, init?) -> Entity          // init: partial fields; emits nothing (the creator emits actor:spawned)
ents.destroy(id)                             // deferred to the cleanup phase; sets alive = false immediately
ents.get(id) -> Entity | null
ents.list(kind) -> Entity[]                  // live array, do not mutate or retain across ticks
ents.count(kind) -> number
ents.renderPos(ent, alpha, out /*Vector3*/) -> Vector3
export const TAG = { GROUNDED_ONLY:1, FLYER:2, BOSS:4, ELITE:8, QUEST:16, NO_LOCK:32, INVULNERABLE:64, SCRIPTED:128, DESTRUCTIBLE:256 };
export const KIND_MASK = { player:1, enemy:2, boss:4, npc:8, projectile:16, pickup:32, object:64, ACTORS:1|2|4|8, HOSTILE_TARGETS:2|4|64 };

// spatial: uniform 2D hash on x,z with 32 m cells; y is filtered by the caller-supplied range
spatial.query(x, z, r, out /*Entity[]*/, kindMask) -> number           // count; out is filled from index 0 and truncated
spatial.querySphere(x, y, z, r, out, kindMask) -> number
spatial.querySegment(ax, ay, az, bx, by, bz, r, out, kindMask) -> number   // capsule sweep against entity capsules, unordered
spatial.nearest(x, y, z, r, kindMask, filterFn?) -> Entity | null
```
Hard caps (creation beyond the cap returns null and logs once): 64 actors (player, enemies, bosses, NPCs), 256 projectiles, 64 pickups, 128 objects.

```js
/** @typedef {{ mx:number, mz:number, up:number, jump:boolean, sprint:boolean, flyToggle:boolean, faceYaw:number|null }} Intent
 *  mx, mz: desired world-space horizontal direction, length 0..1. up: -1..1 (flight). sprint: sprint on the ground, boost in flight. */
/** @typedef {{ mode:'ground'|'air'|'fly'|'swim'|'hurtle'|'scripted', grounded:boolean, groundY:number, boost:0|1|2,
 *              canFly:boolean, boostAllowed:boolean, speedMult:number, lockT:number, noTurnT:number, gravityScale:number, hurtleDamage:number, hurtleSourceId:number,
 *              airT:number, speed:number }} MoveState    boost: 0 none, 1 boost, 2 sonic. speed: current speed in m/s (read by animation and VFX) */
/** @typedef {{ hp:number, hpMax:number, ora:number, oraMax:number, meleeRating:number, oraRating:number, defense:number,
 *              critChance:number, poise:number, poiseMax:number, resonance:number,
 *              runSpeed:number, flySpeed:number, boostSpeed:number, cdr:number,
 *              dmgMult:number, defMult:number, speedMult:number }} ActorStats */
/** @typedef {{ state:'idle'|'windup'|'active'|'recover'|'guard'|'gather'|'stagger'|'down'|'transform'|'dead'|'scripted',
 *              techId:string|null, techT:number, targetId:number, formId:string|null, surge:number,
 *              guarding:boolean, gathering:boolean, invulnT:number, staggerT:number, burnoutT:number,
 *              comboIndex:number, inCombatT:number, charge:number, cooldowns:Object<string,number> }} CombatState */
```

### 3.6 Event bus (`events.js`)
```js
bus.on(type, fn, owner?) -> unsubscribe     // fn(payload)
bus.off(type, fn); bus.offOwner(owner)
bus.emit(type, payload)                      // synchronous
bus.post(type, payload)                      // delivered in the cleanup phase of the current tick (use when emitting during iteration)
```
Rules: every event type must be in `EVENTS` (emitting an unknown type throws in dev and test). Payloads of high-frequency events (`actor:damaged`, `combat:hit`, `projectile:*`, `fx:impact`) are pooled: **listeners must not retain payload objects**. Positions in payloads are plain numbers `x, y, z`. Listeners must not throw; they are wrapped like systems.

**Complete catalog** (E = emitter, L = main listeners; "all" = any package may listen)

Lifecycle and settings
| Event | Payload | E | L |
|-------|---------|---|---|
| `game:boot` | `{ phase:string, progress:number }` | foundation, world | ui |
| `game:ready` | `{}` | foundation | all |
| `game:paused` | `{ paused:boolean, reason:string }` | foundation (time) | env (audio), ui |
| `game:newGame` | `{ slot:number }` | foundation (session) | rpg |
| `game:loaded` | `{ slot:number, newGame:boolean }` | foundation (session) | all (rebuild runtime state from the store) |
| `game:ended` | `{}` | foundation (session) | all (drop runtime state) |
| `settings:changed` | `{ key:string, value:any }` | ui, foundation | all |
| `lang:changed` | `{ lang:'he'\|'en', dir:'rtl'\|'ltr' }` | foundation (i18n) | ui, control |
| `quality:changed` | `{ tier:'low'\|'high' }` | gfx | world, env, gfx, actors |
| `input:device` | `{ device:'kbm'\|'touch'\|'pad' }` | foundation (input) | ui, control |
| `error` | `{ message:string, fatal:boolean }` | foundation | ui |

World and environment
| Event | Payload | E | L |
|-------|---------|---|---|
| `world:baked` | `{ seed:number, ms:number }` | world | env, rpg, ai |
| `world:crater` | `{ x, y, z, radius:number, depth:number, deformed:boolean, sourceId:number }` | world | gfx (decal, dust), env (audio), rpg (stat) |
| `world:propDestroyed` | `{ key:number, kind:string, x, y, z, sourceId:number }` | world | gfx, env (audio), rpg (small Shell drop) |
| `world:regionEnter` | `{ regionId:string, prevRegionId:string\|null, first:boolean }` | world (player only) | ui (banner), env (music), ai, rpg |
| `world:poiDiscovered` | `{ poiId:string, type:string, x, z }` | rpg | ui, env (audio) |
| `world:edge` | `{ factor:number }` (0..1, on change of 0.1 or more) | control | ui (toast once), gfx |
| `env:hour` | `{ hour:number, phase:'dawn'\|'day'\|'golden'\|'dusk'\|'night' }` (each integer hour and each phase change) | env | env (audio), ai, rpg |
| `camp:cleared` | `{ campId:string, regionId:string, day:number }` | ai | rpg (unlock the camp chest, bonus XP), ui (toast), env (audio) |

Actors and movement
| Event | Payload | E | L |
|-------|---------|---|---|
| `actor:spawned` | `{ entId, kind, defId }` | ai, rpg (NPCs), foundation (player) | actors, ui, gfx |
| `actor:removed` | `{ entId, kind, defId }` | whoever calls `ents.destroy` for an actor | actors, gfx, combat, ui |
| `actor:damaged` | `{ targetId, sourceId, amount:number, crit:boolean, blocked:boolean, perfect:boolean, techId:string\|null, kind:'melee'\|'ora'\|'true', x, y, z, hpAfter:number }` | combat | ui (numbers, bars), ai, actors (flinch), env (audio) |
| `actor:healed` | `{ entId, amount:number }` | combat | ui, gfx |
| `actor:died` | `{ entId, sourceId, kind, defId, level:number, questTag:string\|null, x, y, z }` | combat | rpg (XP, loot, quests), ai, actors, gfx, env (audio), ui |
| `actor:staggered` | `{ entId, seconds:number, broken:boolean }` | combat | actors, ai, ui ("Break!"), gfx |
| `actor:knocked` | `{ entId, sourceId, speed:number, hurtle:boolean }` | control (move.knock) | actors, gfx (trail) |
| `actor:slam` | `{ entId, sourceId, x, y, z, speed:number, surface:'terrain'\|'prop', damage:number }` | control (move) | combat (applies the damage and Surge, calls `world.crater` and `world.damageProps`), gfx, env (audio) |
| `actor:landed` | `{ entId, speed:number, x, y, z }` | control | gfx, env (audio), actors |
| `actor:step` | `{ entId, surface:'grass'\|'stone'\|'snow'\|'sand'\|'water' }` (frame phase, cosmetic) | actors | env (audio), gfx |
| `move:mode` | `{ entId, mode:string, prev:string }` | control | actors, gfx, env (audio), combat |
| `move:jump` | `{ entId }` | control | env (audio), actors |
| `move:boost` | `{ entId, stage:0\|1\|2 }` | control | gfx, env (audio), foundation (fx) |

Combat
| Event | Payload | E | L |
|-------|---------|---|---|
| `combat:techStart` | `{ entId, techId, targetId }` | combat | actors, gfx, env (audio), rpg (quest `useTechnique`), ai |
| `combat:techPhase` | `{ entId, techId, phase:'windup'\|'active'\|'recover' }` | combat | gfx, env (audio) |
| `combat:techEnd` | `{ entId, techId, cancelled:boolean }` | combat | gfx, env (audio), ai |
| `combat:hit` | `{ attackerId, targetId, techId, class:string (feel class id), amount:number, x, y, z, dirX, dirZ, blocked:boolean, perfect:boolean, crit:boolean }` | combat | gfx (sparks), env (audio), rpg (quest target tags), ui (combo), foundation (fx) |
| `combat:telegraph` | `{ entId, kind:'white'\|'red'\|'violet', seconds:number, shape:'self'\|'ring'\|'line'\|'cone'\|'circle', radius:number, x, y, z, dirX, dirZ }` | combat | gfx, ui (edge arcs, hints), env (audio) |
| `combat:charge` | `{ entId, techId, level:number }` (0..1, 10 Hz) | combat | gfx, ui, env (audio) |
| `combat:gather` | `{ entId, on:boolean }` | combat | gfx (aura), env (audio), actors, rpg (resonance gatherMult) |
| `combat:guard` | `{ entId, on:boolean }` | combat | gfx, actors, env (audio) |
| `combat:perfect` | `{ entId, kind:'guard'\|'flicker', attackerId }` | combat | ui ("Perfect!"), gfx, env (audio) |
| `combat:flicker` | `{ entId, fromX, fromY, fromZ, toX, toY, toZ }` | combat | gfx (afterimage), env (audio), actors |
| `combat:form` | `{ entId, formId:string\|null, prevFormId:string\|null, first:boolean }` | combat | actors (look), gfx (aura), env (music key), ui, rpg (stats) |
| `combat:burnout` | `{ entId }` | combat | ui, env (audio), gfx |
| `combat:lock` | `{ entId, targetId:number }` (0 = released) | combat | control (cam), ui |
| `combat:surge` | `{ value:number, full:boolean }` (player only, on change of 1 or more) | combat | ui |
| `combat:state` | `{ inCombat:boolean, threat:number }` (on change; threat 0..1) | combat | env (music), ui (HUD fade), foundation (autosave), rpg |
| `combat:combo` | `{ count:number }` | combat | ui |
| `projectile:spawned` | `{ entId, fxId:string, ownerId, color:number }` | combat | gfx |
| `projectile:removed` | `{ entId, fxId:string, hit:boolean, x, y, z }` | combat | gfx, env (audio) |
| `boss:start` | `{ bossId, entId }` | ai | ui (boss bar), control (cam intro), env (music), rpg (consumable snapshot) |
| `boss:phase` | `{ bossId, entId, phase:number }` | ai | ui, env (music), gfx |
| `boss:end` | `{ bossId, defeated:boolean }` | ai | rpg (quests, rewards), ui, env (music), foundation (autosave) |

Player, RPG, quests
| Event | Payload | E | L |
|-------|---------|---|---|
| `player:spawned` | `{ entId }` | foundation (session) | all |
| `player:died` | `{ x, y, z, bossId:string\|null }` | combat | ui (death screen), rpg, ai, env (music) |
| `player:respawned` | `{ ringstoneId:string\|null, retry:boolean }` | rpg | ai (reset enemies; restart a pending boss), control, ui |
| `rpg:xp` | `{ amount:number, total:number, source:string }` | rpg | ui |
| `rpg:levelUp` | `{ level:number, statPoints:number, tp:number }` | rpg | ui, gfx, env (audio), foundation (fx, autosave) |
| `rpg:stats` | `{}` (derived stats recomputed) | rpg | ui, combat |
| `rpg:resonance` | `{ value:number, prev:number, milestone:number\|null }` | rpg | ui |
| `rpg:shells` | `{ amount:number, total:number }` | rpg | ui, env (audio) |
| `rpg:item` | `{ itemId, uid:number, delta:number, count:number }` | rpg | ui, quests |
| `rpg:equip` | `{ slot:string, uid:number\|null, itemId:string\|null }` | rpg | ui, actors (palette) |
| `rpg:itemUsed` | `{ itemId }` | rpg | ui, gfx, env (audio) |
| `rpg:techLearned` | `{ nodeId:string, techId:string\|null, rank:number }` | rpg | ui, combat |
| `rpg:formUnlocked` | `{ formId }` | rpg | ui, combat |
| `rpg:loadout` | `{}` | rpg | ui, combat |
| `pickup:spawned` | `{ entId, kind:'shells'\|'item'\|'xp', itemId:string\|null, rarity:string\|null }` | rpg | gfx |
| `pickup:collected` | `{ kind, itemId:string\|null, amount:number }` | rpg | ui, env (audio), gfx |
| `quest:started` | `{ questId }` | rpg | ui, env (audio) |
| `quest:step` | `{ questId, stepId:string, index:number }` (a new step became active) | rpg | ui, env (audio), foundation (autosave) |
| `quest:progress` | `{ questId, stepId, count:number, need:number }` | rpg | ui |
| `quest:completed` | `{ questId }` | rpg | ui, env (audio), ai |
| `quest:tracked` | `{ questId:string\|null }` | rpg | ui |
| `dialogue:start` | `{ dialogueId, npcId:string\|null }` | rpg | ui, control (cam) |
| `dialogue:line` | `{ dialogueId, nodeId, speakerId:string, textKey:string, choices:Array<{ textKey:string }> }` | rpg | ui, actors (talk) |
| `dialogue:end` | `{ dialogueId, npcId:string\|null }` | rpg | ui, control |
| `interact:focus` | `{ id:string\|null, kind:string\|null, promptKey:string\|null }` (on change) | rpg | ui (pill) |
| `interact:used` | `{ id, kind }` | rpg | ui, env (audio), gfx |
| `ringstone:activated` | `{ id, first:boolean }` | rpg | gfx, env (audio), ui, foundation (autosave) |
| `shrine:claimed` | `{ id }` | rpg | gfx, env (audio), ui |
| `chest:opened` | `{ id }` | rpg | gfx, env (audio) |
| `siphon:state` | `{ id, state:'closed'\|'open'\|'destroyed', regionId }` | rpg | env (prop visual, audio), gfx, ai |
| `race:start` | `{ courseId }` | rpg | ui (timer), env (audio) |
| `race:gate` | `{ courseId, index:number, total:number }` | rpg | ui, env (audio), gfx |
| `race:end` | `{ courseId, seconds:number, medal:'none'\|'bronze'\|'silver'\|'gold', finished:boolean }` | rpg | ui, env (audio) |
| `tutorial:prompt` | `{ action:string\|null, textKey:string\|null }` (action: any ACTION id, or `'move'` or `'look'` for the stick and camera zones; null clears) | rpg | ui |

UI, feel, save, cinematics
| Event | Payload | E | L |
|-------|---------|---|---|
| `ui:screen` | `{ id:string, open:boolean }` | ui | foundation (pause, input context), env (audio) |
| `ui:toast` | `{ key:string, args:object\|null, kind:'info'\|'good'\|'warn' }` | all | ui |
| `ui:banner` | `{ kind:'level'\|'quest'\|'region'\|'resonance'\|'break'\|'perfect'\|'form'\|'boss', key:string, args:object\|null }` | all | ui |
| `fx:impact` | `{ classId:string, x, y, z, scale:number }` | foundation (fx) | gfx (flash), env (duck music) |
| `save:written` | `{ slot:number, ok:boolean, memoryOnly:boolean }` | foundation (save) | ui (icon, toast) |
| `cine:start` | `{ id:string, skippable:boolean }` | control (cam) | ui (letterbox, hide HUD), combat, ai |
| `cine:end` | `{ id:string, skipped:boolean }` | control (cam) | ui, rpg |

Order within one hit, all in the same tick: combat emits `actor:damaged` first, then `combat:hit`, then `actor:staggered` and `actor:died` if they apply. Listeners may rely on this order. `actor:died` is emitted for every damageable entity, including kind `object` (Siphons, the training post): listeners must check `kind`.
Adding an event requires a change to `EVENTS` by the foundation owner; feature packages must work with this catalog.

### 3.7 Store and save (`store.js`, `save.js`)
All persistent state is plain JSON in `ctx.store.state`. Runtime objects (entities, timers, meshes) are never stored; packages rebuild them on `game:loaded`.
```js
store.state                         // the object below
store.get(path)                     // 'player.level'
store.set(path, value)              // marks dirty
store.reset(state)                  // replace everything (load / new game)
store.snapshot() -> object          // deep clone
```
```js
/** Save schema version 1 (SAVE_VERSION = 1) */
state = {
  v: 1,
  meta: { slot: 1, createdAt: 0, savedAt: 0, playSeconds: 0, appVersion: '0.1.0' },   // timestamps are written by save.js only
  player: {
    preset: 'hero_a', gender: 'm', difficulty: 'warrior',
    level: 1, xp: 0, statPoints: 0, tp: 0, autoStyle: 'balanced',   // 'balanced' | 'brawler' | 'blaster' | 'manual'
    base: { mgt: 5, spr: 5, vit: 5, swf: 5 },
    hp: 196, ora: 125, surge: 0, awakened: false, canFly: false,   // canFly: flight unlocked (MQ1 `tut_fly`, or the tutorial=0 shortcut)
    x: -1650, y: 0, z: 1860, yaw: 0,
    respawn: 'ringstone_sparkstead',               // POI id of the last touched Ringstone
    forms: [],                                     // unlocked form ids
    selectedForm: null,
    nodes: [],                                     // learned technique-tree node ids
    techs: ['strike_string','breaker','ora_bolt','guard','flicker_step','pursuit'],   // unlocked technique ids
    slots: [null, null], ultimate: null,
  },
  inv: {
    shells: 0, nextUid: 1,
    items: [],                                     // [{ uid, itemId, level, count }]
    equip: { wraps: null, garb: null, charm1: null, charm2: null },   // uid or null
    quick: 'sunfruit',
  },
  quests: {
    active: {},                                    // { [questId]: { step: 0, counts: { [stepId]: n } } }
    done: [], tracked: null,
    flags: {},                                     // free-form booleans and numbers: tutorial prompts seen, npc states
  },
  world: {
    hour: 7, day: 1,
    discovered: [],                                // poi and landmark ids
    regionsSeen: [], ringstones: [], shrines: [], chests: [], siphons: [],   // ids done
    races: {},                                     // { [courseId]: { best: seconds, medal } }
    bosses: [],                                    // defeated boss ids
    camps: {},                                     // { [campId]: dayCleared }
  },
  stats: { kills: 0, deaths: 0, maxCombo: 0, metresFlown: 0, craters: 0, propsSmashed: 0 },
};
```
Settings are stored separately (shared by all journeys):
```js
settings = { lang:'he', quality:'auto' /* 'auto' | 'low' | 'high' */, volMaster:0.8, volMusic:0.7, volSfx:0.9, camSens:1, invertY:false, leftHanded:false,
             pitchFlight:false /* camera-pitch flight on keyboard and gamepad; touch always uses it */,
             vibration:true, shake:1, reducedMotion:false, photosensitive:false, textScale:1, damageNumbers:true, shortTransform:false }
```
```js
// ctx.save (final)
save.slots() -> Array<{ slot:1|2|3, exists:boolean, level:number, playSeconds:number, savedAt:number, regionId:string }>   // the P0 UI uses slot 1 only; choosing among slots is P1
save.write(reason?) -> boolean          // serialises store.snapshot() into the current slot; emits save:written
save.load(slot) -> object | null        // parsed and migrated state, or null
save.erase(slot)
save.request(reason)                    // autosave request: written at the end of the tick if allowed (not in combat, not in a cinematic, not in test mode)
save.settings                           // live settings object
save.setSetting(key, value)             // persists and emits settings:changed
save.memoryOnly                         // true when localStorage is unavailable; the ui shows a permanent HUD warning while it is true
save.exportCode() -> Promise<string>    // journey code of the current store: 'K1.' + base64url(deflate-raw(JSON)) when CompressionStream exists, else 'K0.' + base64url(JSON)
save.importCode(text) -> Promise<{ ok:boolean, reasonKey:string|null }>   // accepts K0 and K1, trims whitespace, parses, migrates, validates the shape, writes slot 1; never throws
save.migrate(state) -> state            // runs MIGRATIONS[v] in order up to SAVE_VERSION; a newer version than supported returns null and is never overwritten
```
Storage keys: `kethra.v1.slot.<n>`, `kethra.v1.settings`, `kethra.v1.last`. Every access is inside try/catch; on failure an in-memory `Map` is used and `memoryOnly` becomes true. Autosave triggers (foundation listens): `ringstone:activated`, `quest:step`, `rpg:levelUp`, `boss:end`, and every 120 s while `combat:state.inCombat` is false. Before writing, save.js copies the player position (snapped to the last Ringstone on load) and calls `save.onBeforeSave` hooks. Size budget: under 32 KB.
Hooks: `save.onBeforeSave(fn(state))`, `save.onAfterLoad(fn(state))` for packages that must sync runtime values into or out of the store (env: hour and day; rpg: hp, ora and surge, see 4.11). The journey code never triggers a download and never requires the clipboard: the ui shows it in a selectable text box.

### 3.8 Definition registry (`defs.js`)
Content is plain data registered by the owning package in `install`. Other packages read it by id only.
```js
defs.register(kind, list)        // list: array of objects with unique `id`; re-registering an id replaces it (how packages override stand-in content)
defs.get(kind, id) -> object     // throws in dev/test if missing
defs.find(kind, id) -> object | null
defs.all(kind) -> object[]
defs.validate()                  // checks cross-references listed in each schema (section 5)
```
| Kind | Owner | Schema |
|------|-------|--------|
| `technique` (player), `form`, `techNode` | combat | 5.1, 5.2 |
| `technique` (enemy and boss moves), `enemy`, `boss`, `group`, `spawnTable` | ai | 5.1, 5.3, 5.4, 5.9 |
| `item`, `shop`, `lootTable`, `quest`, `npc`, `dialogue`, `object`, `course` | rpg | 5.5-5.7, 5.10 |
| `region`, `landmark`, `poi` | world | 5.8 |
| `actorSpec`, `clip` | actors | 5.11 |
| `settlement`, `music` | env | 4.2, ART_UX 9.3 |
**The id catalog** (`src/core/ids.js`, foundation, final, pure). Every id that one package's data or code may reference across a package boundary is listed here once. It exists before any feature package is written, so nobody has to guess a neighbour's ids.
```js
export const IDS = {
  enemy:      ['ember_wisp','tusk_boar','bramble_boar','choir_acolyte','choir_caster','scuttlecrab','rust_golem','frost_harrier','choir_vanguard',
               'durn','bramblehorn','gorrumaw','iskra','vorrhal'],                 // the last five are the boss enemies (tier 'boss')
  boss:       ['durn','bramblehorn','gorrumaw','iskra','vorrhal'],
  group:      ['mq2_raid','durn_adds','mq4_wave','mq7_gate','vorrhal_adds','siphon_wave_1','siphon_wave_2','camp_choir_small','camp_choir_large','camp_beasts'],
  spawnTable: ['meadows','coast','thornwood','rustdune','frostspine'],
  technique:  ['strike_string','breaker','meteor_heel','pursuit','ora_bolt','flare_barrage','dawn_lance','nova_ring','ringfall','guard','flicker_step','boost','gather',
               'wisp_spit','wisp_dive','boar_gore','boar_charge','acolyte_string','acolyte_rush','caster_volley','caster_tether','crab_pinch','crab_slam',
               'golem_hammer','golem_stomp','golem_boulder','harrier_dive','harrier_gust','vanguard_string','vanguard_lance','vanguard_smash'],
                                                                                   // boss moves stay private to ai (prefixes durn_, bh_, gm_, ik_, vh_)
  form:       ['ember','tempest','zenith'],
  item:       ['training_wraps','racers_wraps','bramble_wraps','saltglass_wraps','copper_knuckles','stormcaller_wraps','apprentice_garb','meadow_garb','tidewoven_garb',
               'dunewalker_garb','frostweave_garb','lantern_mantle','sunfruit_charm','wind_charm','ember_charm','tide_charm','golem_core_charm','frost_charm',
               'stillwind_charm','wyrmhide_charm','sunfruit','ora_draught','rust_core'],
  shop:       ['dov_stall','aster_market','talia_herbs','yael_outpost','ridgerest_provisions'],
  lootTable:  ['grunt','heavy','elite','boss','chest_t1','chest_t2','chest_t3'],
  npc:        ['sela','kerrin','dov','mira','ilan','rina','gal','eli','bren','talia','yael','oren','noa'],
  quest:      ['mq1','mq2','mq3','mq4','mq5','mq6','mq7','sq1','sq2','sq3','sq4'],
  object:     ['training_post','siphon_1','siphon_2','siphon_3','siphon_4','siphon_5','saltglass_pillar','bell_1','bell_2','bell_3',
               'lost_bell_1','lost_bell_2','lost_bell_3','fallen_blade_1','fallen_blade_2','fallen_blade_3','tether_1','tether_2','tether_3','tether_4','tether_5'],
  course:     ['windmill_run'],
  actorSpec:  ['hero_a','hero_b','npc_sela','npc_kerrin','npc_dov','npc_mira','npc_bren','npc_yael','npc_noa','npc_talia','npc_eli','npc_oren','npc_ilan','npc_rina','npc_gal',
               'npc_villager_1','npc_villager_2','npc_villager_3','npc_villager_4','npc_villager_5','npc_villager_6',
               'ember_wisp','tusk_boar','bramble_boar','choir_acolyte','choir_caster','scuttlecrab','rust_golem','frost_harrier','choir_vanguard',
               'durn','bramblehorn','gorrumaw','iskra','vorrhal'],
  region:     ['meadows','coast','thornwood','rustdune','frostspine','stormwell','spire'],
  landmark:   ['sparkstead','selas_ledge','haven_aster','windmill_run','saltglass_arches','tide_beacon','talias_camp','bramble_hollow','copperwatch','burrow_pit',
               'ridgerest','still_wind','paleglass_summit','stormwell_eye','spire_approach','dim_court','wellspring_spire','shattered_crown',
               'siphon_1','siphon_2','siphon_3','siphon_4','siphon_5'],
  settlement: ['sparkstead','haven_aster','copperwatch','ridgerest','still_wind','talias_camp','tide_beacon','selas_ledge','spire_approach'],
  music:      ['warm','cold','corrupted','combat','boss'],
  prop:       [ /* the prop kinds of 4.2 */ ],
  clip:       [ /* the standard clip ids of 4.5 */ ],
  vfx:        [ /* every recipe id of ART_UX 3.2 */ ],
  sfx:        [ /* every audio id of ART_UX 9.2 */ ],
  feel:       [ /* the class ids of ART_UX section 4 */ ],
  modKey:     [ /* the closed key list of rpg.mods(), 4.11 */ ],
};
```
Rules for ids:
- **Stand-in definitions for every id.** For every defs kind above, the foundation registers a minimal valid definition for **each** id of `IDS` (not only the ones its own smoke test plays). Stand-in enemies and bosses reference stand-in techniques that carry a white telegraph; stand-in groups have one member; every `actorSpec` id is an alias of one generic humanoid or creature spec, and `hero_a` and `hero_b` carry `forms: { ember: {}, tempest: {}, zenith: {} }`; stand-in quests have one `script` step; landmarks, regions and settlements have their GDD positions. Therefore `defs.validate()` passes at boot for any subset of feature packages, in every build round.
- **Playable stand-in content** (more than an id, used by the smoke test): techniques `strike_string`, `breaker`, `ora_bolt`, `flicker_step`, `guard`, `nova_ring`; form `ember`; enemies `ember_wisp`, `tusk_boar`, `choir_acolyte`; items `sunfruit`, `training_wraps`; quest `mq1` (two steps); npc `sela`; the Ringstone of Sparkstead.
- **Owning packages re-register** their ids with the real definitions (re-registering replaces). A package may add private ids of its own kinds (boss moves, dialogue ids, extra clips), but must define every id of `IDS` for the kinds it owns; a Node test in each package asserts this.
- **Node tests never import another package's data.** A test that checks references to a foreign kind (technique `fx`, `sfx` and clip ids; quest references to enemies, bosses, groups, NPC specs; item `mods` keys) validates them against `IDS`. A foundation test asserts that the lists in `IDS` equal the ids of ART_UX 3.2, 9.2 and section 4 and of the GDD tables.

### 3.9 RNG, math, pools, errors, DOM
```js
// rng.js: mulberry32 streams
rng.sim   // gameplay randomness (crits, AI choices, loot). Seeded from flags.seed or the save's createdAt
rng.fx    // visuals only; never influences the sim
rng.world // fixed by WORLD_SEED; used only during the bake
stream.next() -> [0,1)   stream.range(a, b)   stream.int(a, b) /*inclusive*/   stream.pick(array)   stream.chance(p)   stream.fork(label) -> stream
hash2(ix, iz, seed) -> uint32     // stateless hash for per-cell determinism
```
`Math.random` is forbidden in `src/` (lint) except inside `rng.js`.
```js
// math.js: allocation-free helpers and scratch objects
clamp, lerp, invLerp, smoothstep, damp(current, target, lambda, dt), angleDelta(a, b), wrapAngle(a), approach(v, target, maxDelta)
TMP.v1..v8 (Vector3), TMP.q1..q2 (Quaternion), TMP.m1 (Matrix4)      // never hold across function calls
// pool.js
createPool(factory, reset, initialSize) -> { get(), release(obj), size }
// dom.js
dom.root                         // #app
dom.layer(name) -> HTMLElement   // creates on first use; fixed z-order: 'canvas' < 'touch' < 'hud' < 'screens' < 'overlay' < 'fatal'
dom.addStyle(id, cssText)        // idempotent <style data-id>
dom.safeStorage                  // { get(key), set(key, value), remove(key) } with try/catch and memory fallback
// theme.js injects the CSS custom properties of ART_UX 7.1 and the font stacks on #app
// errors.js: window.onerror, unhandledrejection, webglcontextlost / restored (pause, then render.restore()), fatal screen
// log.js: log.info / warn / error(tag, ...args); errors are recorded in __GAME__.errors
```

---

## 4. Service APIs

Conventions: all signatures are exact export or method names. Positions are passed as separate numbers unless an `out` object is named. Colours are numeric hex (`0x7ff2e0`). Functions with an `out` parameter fill and return it and allocate nothing. Ids named `entId` are entity ids; `0` means "none". Every method must tolerate unknown or dead entity ids (no throw, return false or 0). Each stand-in implements every method listed here (possibly as a simple version or a no-op that returns a valid value).

### 4.1 `ctx.world` (package: world)
```js
// constants
world.size = 7168; world.half = 3584; world.cell /* 4 or 8 */; world.seaLevel = 0;
world.islandRadius = 3100; world.edgeStart = 3300; world.edgeHard = 3450; world.ceiling = 1500;

world.bake(onProgress /* (progress:0..1) => void */) -> Promise<void>        // builds the grid and layers; emits world:baked

// surface queries (O(1), allocation-free, valid for any x,z: outside the square they clamp)
world.heightAt(x, z) -> number                 // bilinear terrain height
world.normalAt(x, z, out /*Vector3*/) -> Vector3
world.slopeAt(x, z) -> number                  // 0 flat .. 1 vertical
world.groundAt(x, y, z) -> number              // highest walkable surface at or below y + 1.0: terrain or the top of a PLATFORM collider. Use this for standing and landing.
world.waterDepthAt(x, z) -> number             // max(0, seaLevel - heightAt)
world.surfaceAt(x, z) -> 'grass'|'stone'|'snow'|'sand'|'water'
world.regionAt(x, z) -> string                 // region id (GDD 3.2)
world.regionLevel(x, z) -> number              // enemy level for this point
world.edgeFactor(x, z) -> number               // 0 inside edgeStart .. 1 at edgeHard

// rays and sweeps against terrain and SOLID colliders
/** @typedef {{ hit:boolean, t:number, x:number, y:number, z:number, nx:number, ny:number, nz:number,
 *              kind:'terrain'|'collider'|null, colliderId:number, propKey:number }} Hit      t = 0..1 along the segment */
world.raycast(ox, oy, oz, dx, dy, dz, maxDist, out /*Hit*/) -> boolean
world.sweepSphere(ax, ay, az, bx, by, bz, radius, out /*Hit*/) -> boolean
world.lineOfSight(ax, ay, az, bx, by, bz) -> boolean        // terrain only, 8 m steps

// static colliders (64 m grid)
/** @typedef {{ id:number, shape:'sphere'|'capsule'|'box'|'disc', x:number, y:number, z:number, r:number, h:number,
 *              hx:number, hz:number, yaw:number, flags:number, propKey:number }} Collider
 *  sphere: centre (x,y,z), radius r. capsule: vertical, base at y, radius r, height h. box: centre x,z, base y, half extents hx,hz, height h, rotated by yaw.
 *  disc: vertical cylinder, base y, radius r, height h. */
export const COLLIDER = { SOLID: 1, PLATFORM: 2, DESTRUCTIBLE: 4, NO_CAMERA: 8 };
world.queryColliders(x, z, r, out /*Collider[]*/) -> number
world.addCollider(def /* Collider without id */) -> number
world.removeCollider(id) -> void

// destruction
world.crater(x, z, radius, depth, sourceId = 0) -> void     // radius < 6: no grid edit (deformed:false). Depth is clamped to 0.3 * radius. Always emits world:crater
world.damageProps(x, y, z, radius, damage, sourceId = 0) -> number   // destructible props (rocks, pillars, trees) touching the sphere; returns the number destroyed; emits world:propDestroyed

// data
world.regions -> RegionDef[]                    // also registered as defs kind 'region'
world.landmark(id) -> LandmarkDef | null        // y resolved after the bake
world.pois(type /* optional */) -> Poi[]        // authored and seeded minor POIs, y resolved: { id, type, x, y, z, regionId, data }
                                                // types: 'ringstone' | 'shrine' | 'camp' | 'chest' | 'siphon' | 'race' | 'crownChest'
world.findSpot(x, z, radius, out /*{x,y,z}*/, opts /* { maxSlope = 0.5, clearance = 1.5 } */) -> boolean   // nearest dry, walkable, collider-free ground spot within radius

// streaming and rendering support
world.setFocus(x, y, z) -> void                 // streaming and LOD centre = the camera position; cam calls it every frame. All LOD and prop distances are 3D distances from it
world.flushBuilds() -> void                     // build all chunks needed for the current focus now (tests, teleports, cinematics)
world.mapCanvas(size /* 256 | 512 */) -> HTMLCanvasElement    // parchment map, cached per size; whole world square, north up
world.toMap(x, z, out /*{u,v}*/) -> out         // world -> 0..1 map coordinates
```
Internals owned by the package (not an interface, but binding decisions): baked layers `height` Float32 (N x N, N = size / cell + 1), and at 8 m: `tint` RGB8 (final ground colour), `region` Uint8, `flags` Uint8 (path, settlement, noSpawn, water). Worldgen is pure (`src/world/gen/**`), runs in the blob Worker (`src/world/worker.js`) and in Node tests, and yields for a time-sliced main-thread fallback. Vegetation and rock scatter is generated per chunk on activation from `hash2` (deterministic), excluded by `flags`; props are instanced meshes refilled when the focus crosses a 128 m cell; their colliders enter the collider grid on activation. A destroyed prop is hidden (zero-scale matrix) and its collider removed until `game:loaded`. Chunk geometry: position Float32 x3, normal Int8 x4 (normalised), colour Uint8 x4 (normalised), one shared index buffer per LOD, 8 m skirts. The water plane, the far island mesh and the Veilstorm wall are part of this package. Further binding decisions: (1) if the Worker cannot be created or fails, the main-thread fallback always bakes at 8 m (0.8 M samples) so the loading time stays bounded; (2) water depth comes from the grid: after the bake the package uploads one 512 x 512 single-channel texture of `seaLevel - height` for the whole square, the water shader samples it by world x,z (ART_UX 1.8), and `crater` updates the affected texels with `texSubImage2D`; there is no depth pre-pass and no extra render target on any tier; (3) terrain LOD and scatter distances are measured in 3D from the focus, so a camera at 800 m altitude draws only far LODs; (4) the scatter hash also bakes a canopy tint and value pattern into the vertex colours of the far island mesh and of LOD2, so forests read from the air after the tree instances have faded; (5) tree and rock instances are capped per tier (7.1), nearest first; (6) regions with `content: false` (the Stormwell in P0) get terrain, palette and generic scatter but no POIs.

### 4.2 `ctx.env` and `ctx.audio` (package: env)
```js
// clock and sun
env.hour -> number                    // 0..24, mirrors store.state.world.hour
env.day -> number
env.phase -> 'dawn'|'day'|'golden'|'dusk'|'night'
env.isNight -> boolean
env.setHour(h) -> void
env.setClockScale(s) -> void          // 1 = one game day per 24 real minutes; 0 freezes (used by flags.hour and cinematics)
env.sunDir -> Vector3                 // unit vector toward the light (sun or moon), read-only
// The env frame system writes render.globals (sun, ambient, shadow tint, fog, wind) from ART_UX 1.4 and the region palette at the camera.

// prop visuals for gameplay objects (the logic lives in rpg; env only draws and adds the collider)
/** @typedef {{ id:number, kind:string, object:Object3D, setState(state:string):void, setGlow(v:number):void,
 *              setVisible(b:boolean):void, dispose():void }} PropHandle */
env.spawnProp(kind, x, y, z, opts /* { yaw = 0, scale = 1, state?, color? } */) -> PropHandle
```
| Prop kind | States | Collider |
|-----------|--------|----------|
| `ringstone` | `idle`, `active` | capsule r 0.8 |
| `shrine` | `ready`, `claimed` | none |
| `chest` | `locked`, `closed`, `open` | box |
| `siphon` | `closed`, `open`, `destroyed` | capsule r 4, h 40 |
| `ringGate` | `idle`, `next`, `passed` | none |
| `trainingPost` | `idle`, `broken` | capsule r 0.4 |
| `bell`, `fallenBlade`, `saltPillar`, `crate` | `idle`, `used` (`saltPillar`, `crate`: `broken`) | capsule or box |
| `lightPillar` | `on`, `off` (colour from `opts.color`) | none |
| `campfire`, `tent`, `signpost` | `idle` | small box |
```js
// settlements (built on ctx.onBoot from defs kind 'settlement' at the landmark positions of GDD 3.3)
/** @typedef {{ id:string, x:number, z:number, radius:number, spots:Array<{ id:string, x:number, y:number, z:number, yaw:number }> }} SettlementInfo */
env.settlement(id) -> SettlementInfo | null      // ids = landmark ids: 'sparkstead', 'haven_aster', 'copperwatch', 'ridgerest', 'still_wind', 'talias_camp', 'tide_beacon', 'selas_ledge', 'spire_approach'
env.spot(settlementId, spotId, out /*{x,y,z,yaw}*/) -> boolean   // named NPC standing spots; every settlement has at least 'ringstone', 'a', 'b', 'c'; shops add 'stall'
```
```js
// ctx.audio
audio.unlock() -> void                           // call from a user gesture; safe to call repeatedly
audio.ready -> boolean
audio.play(id, opts /* { x?, y?, z?, vol = 1, pitch = 1 } */) -> number        // voice id, 0 if dropped or not ready; positional when x is given
audio.loop(id, opts /* { entId?, x?, y?, z?, vol = 1 } */) -> number
audio.stop(voiceId, fadeSeconds = 0.1) -> void
audio.setParam(voiceId, name /* 'vol' | 'pitch' | 'level' */, value) -> void     // 'level' drives recipe-specific sweeps (gather, wind, charge)
audio.setMusic(state /* { mode?: 'explore'|'combat'|'boss'|'silent', palette?: 'warm'|'cold'|'corrupted', intensity?: 0..3, formId?: string|null, settlement?: boolean } */) -> void
audio.stinger(id /* 'transform'|'levelUp'|'questComplete'|'discover'|'death'|'milestone'|'bossIntro'|'victory' */) -> void
audio.setVolume(bus /* 'master'|'music'|'sfx' */, v) -> void
audio.setPaused(paused) -> void                  // menu filter
audio.voices() -> number
audio.nodes() -> number                          // live AudioNodes owned by the engine (diagnostics and the barrage budget test)
```
Audio is **event-driven**: the env package subscribes to the catalog (3.6) and plays the ids of ART_UX 9.2. Other packages call `audio.play` only for UI sounds (`ui_*`, `dialogue_tick`) and sounds with no event. Technique sounds come from the technique definition's `sfx` block on `combat:techPhase`. Music state follows `world:regionEnter` (palette = `RegionDef.musicKey`), `siphon:state` and the player's distance to standing Siphons and camps (`corrupted`), `env:hour`, `combat:state`, `boss:*`, `combat:form`.
Binding audio decisions: (1) every one-shot recipe is pre-rendered into `AudioBuffer`s with an `OfflineAudioContext` (2 detune variants on low, 3 on high) in time-sliced batches that start at boot and continue behind the title screen; `audio.play` uses one pooled voice (`AudioBufferSourceNode -> gain -> panner`); a sound whose buffer is not ready is skipped; (2) live synthesis exists only for `wind_loop`, `gather_loop`, `beam_loop` and `siphon_loop`; (3) music instruments are pre-rendered sample buffers played with `playbackRate`; (4) at most 120 live nodes during a 10 s Flare Barrage; (5) footsteps: `actor:step` surface `grass` -> `step_grass`, `stone` -> `step_stone`, `snow` -> `step_snow`, `water` -> `step_water`, `sand` -> `step_grass` at pitch 0.7; (6) with `noaudio=1` nothing is rendered.

### 4.3 `ctx.render` (package: gfx)
```js
render.init() -> Promise<void>                   // creates WebGLRenderer, scene, camera (ctx.three), layers, globals; picks the tier
render.compile() -> Promise<void>                // links every program of the current tier behind the loading screen (KHR_parallel_shader_compile when available, polled so the
                                                 // loading ring keeps moving). After it resolves no new program may appear during play; stats().programs must stay constant
render.restore() -> void                         // after WebGL context restore
render.resize() -> void                          // also called on orientation change
render.tier -> 'low'|'high'
render.setTier(tier) -> void                     // emits quality:changed
render.caps -> object                            // the row of the tier table in 7.1
render.scale -> number                           // current dynamic resolution scale
render.layers -> { sky:Group, world:Group, props:Group, actors:Group, vfx:Group }     // add objects to the matching group
render.globals -> { uTime, uSunDir, uSunColor, uAmbSky, uAmbGround, uShadowTint, uFogColor, uFogDensity, uFogHeight, uRimColor, uCamPos, uWind }
                                                 // shared uniform objects ({ value }); custom shaders reference these same objects
render.glsl -> { common:string, lighting:string, fog:string }
                                                 // GLSL chunks: vec3 toonLight(vec3 base, vec3 n, vec3 viewDir); vec3 applyFog(vec3 color, vec3 worldPos);

// materials: every call returns a new ShaderMaterial instance that shares a cached program
/** @typedef {{ color?:number, vertexColors?:boolean, palette?:boolean, glossy?:boolean, emissive?:number, emissiveIntensity?:number,
 *              wind?:boolean, instanced?:boolean, transparent?:boolean, doubleSide?:boolean, fogScale?:number }} ToonOpts */
// ToonOpts never select a different program. vertexColors, palette, glossy, emissive, wind and fogScale are uniforms of ONE toon shader (branching on uniforms);
// transparent and doubleSide are render state. The only program variants are the geometry kinds: static, skinned, instanced.
render.materials.toon(opts) -> ShaderMaterial
render.materials.toonSkinned(opts) -> ShaderMaterial
   // with palette:true the mesh needs a float vertex attribute `paletteIndex` (0..15) and the material exposes
   // uniforms.uPalette.value (Color[16]), uniforms.uEmissive.value (Float32Array(16)), uniforms.uRimColor.value (Color),
   // uniforms.uRimStrength.value, uniforms.uDissolve.value (0..1), uniforms.uFlash.value (0..1 white flash), uniforms.uGhost.value (0..1 alpha)
render.materials.unlit(opts /* { color, additive?:boolean, map?:Texture, depthWrite?:boolean, transparent?:boolean, fog?:boolean } */) -> ShaderMaterial

render.outline.add(mesh, opts /* { widthPx = 2, color? } */) -> void     // adds an inverted-hull pass for this (skinned) mesh; shown or hidden per tier and distance
render.outline.remove(mesh) -> void
render.blob.add(entId, radius) -> void           // blob shadow that follows the entity at world.groundAt
render.blob.remove(entId) -> void
render.light.claim(priority) -> { set(x, y, z, color, intensity, radius):void, release():void } | null    // pooled point light (0, 1 or 2 by tier)

// screen-space feel (all honour the Reduced Motion and Photosensitivity settings)
render.flash(color, alpha, seconds) -> void      // goes through the flash budget of ART_UX 3.1 in every mode: over-budget requests are dropped, alpha is clamped
render.speedLines(amount /* 0..1 */) -> void
render.vignette(color, amount /* 0..1 */, seconds) -> void
render.desaturate(amount /* 0..1 */, seconds) -> void

// projection helpers
render.project(x, y, z, out /* { x, y, visible, depth } */) -> out        // world -> CSS pixels relative to #app
render.screenRay(cssX, cssY, out /* { ox, oy, oz, dx, dy, dz } */) -> out

render.stats() -> { fps, frameMs, simMs, drawCalls, triangles, geometries, textures, programs, scale, tier, particles }
```
Scene conventions: `rotation.y = yaw` (models face local +Z); every mesh sets `frustumCulled` sensibly and `matrixAutoUpdate = false` for static objects; no `scene.add` outside `render.layers`. Low draws straight to the canvas, created with `antialias: true` (4x MSAA is nearly free on tile-based phone GPUs and the ink outlines need it at pixel ratio 1); flash, vignette and speed lines on low are one extra full-screen quad only while active. Resizing the drawing buffer stalls and can flicker in Android webviews, so dynamic resolution on low changes the buffer size rarely: steps of 0.1, at most one change every 3 s, with hysteresis (7.1), and never during a cinematic. High renders to a target at the dynamic scale (no canvas resize) and composites (bloom, vignette, grain, speed lines, flash, FXAA). If the round-3 benchmark still shows resize stalls on the reference phone, low switches to a fixed buffer with a scaled viewport and one upscale blit; `render.scale` and every API stay the same.

### 4.4 `ctx.vfx` (package: gfx)
```js
vfx.burst(recipeId, x, y, z, opts /* { dirX?, dirY?, dirZ?, color?, scale = 1, count? } */) -> void
vfx.attach(recipeId, entId, socket = 'chest', opts) -> number        // continuous emitter following an entity socket; returns a handle
vfx.detach(handle, fadeSeconds = 0.2) -> void
vfx.beam(opts /* { color, radius, ownerId? } */) -> { set(ax, ay, az, bx, by, bz, radius, intensity):void, end(fadeSeconds = 0.18):void }
vfx.shockwave(x, y, z, opts /* { radius, seconds = 0.28, color, ground = true, sphere = false } */) -> void
vfx.aura(entId) -> { set(intensity /* 0..1 */, color, style /* 'base'|'ember'|'tempest'|'zenith'|'enemy' */):void, dispose():void }
vfx.decal(kind /* 'scorch'|'crack'|'ring'|'shape' */, x, z, radius, opts /* { color?, seconds?, shape?: 'circle'|'line'|'cone', dirX?, dirZ?, length?, fill?: 0..1 } */) -> number
vfx.setDecalFill(id, fill) -> void               // telegraph shapes filling up
vfx.removeDecal(id) -> void
vfx.afterimage(entId, seconds = 0.3, color) -> void
vfx.trail(entId, socket, opts /* { color, width = 0.3, seconds = 0.25 } */) -> number     // detach with vfx.detach
vfx.count() -> number                            // live particles
```
Recipe ids are the ones in ART_UX 3.2. **Automatic effects** (the gfx package subscribes; nobody calls these): hit sparks on `combat:hit`; projectile visuals on `projectile:*` (reads `ent.pos` each frame); telegraph rings, icons and ground shapes on `combat:telegraph`; afterimage and ring on `combat:flicker`; death dissolve particles and XP orbs on `actor:died` of kind `enemy` or `boss` (objects such as Siphons get `siphon_break` or debris from their own events); hurtle trail on `actor:knocked`; slam dust on `actor:slam`; scorch, rubble and dust on `world:crater`; debris on `world:propDestroyed`; level-up pillar on `rpg:levelUp`; boost trail and sonic ring on `move:boost`; landing ring on `actor:landed`; pickup beams on `pickup:spawned`; flashes on `fx:impact`. The combat package calls `vfx` directly only for things it must control over time: beams, auras, charge emitters (`vfx.attach`), shockwaves of its own techniques, and the ultimate.

### 4.5 `ctx.actors` (package: actors)
```js
actors.create(ent, specId, opts /* { formKey?, palette? } */) -> void      // builds or reuses geometry, adds the mesh to render.layers.actors, sets ent.visual, ent.radius, ent.height
actors.destroy(ent) -> void
actors.bounds(specId) -> { radius:number, height:number }
actors.play(ent, clipId, opts /* { speed = 1, loop = false, layer = 'full' | 'upper', blend = 0.08, hold = false } */) -> void
actors.stop(ent, layer = 'full', blend = 0.12) -> void
actors.clipSeconds(specId, clipId) -> number
actors.setForm(ent, formKey /* null | 'ember' | 'tempest' | 'zenith' */) -> void      // palette, emissive seams, added parts (mantle, vanes, blades)
actors.setPalette(ent, overrides /* { [slotName]: number } | null */) -> void         // gear recolour (Garb, Wraps)
actors.setExpression(ent, name /* 'neutral'|'angry'|'shout'|'hurt'|'happy'|'ko' */) -> void
actors.lookAt(ent, x, y, z) -> void ; actors.clearLook(ent) -> void
actors.flinch(ent, dirX, dirZ, strength /* 0..1 */) -> void
actors.socket(ent, name /* 'handR'|'handL'|'chest'|'head'|'feet'|'back' */, out /*Vector3*/) -> Vector3     // world position this frame; falls back to pos + offset
actors.setVisible(ent, visible) -> void
actors.setGhost(ent, alpha /* 1 = solid */) -> void
actors.dissolve(ent, seconds, color) -> void                                           // death
actors.flash(ent, seconds = 0.06) -> void                                              // white hit flash
actors.snapshot(ent) -> Mesh | null                                                    // frozen-pose clone for afterimages (pooled by vfx: call release via vfx)
actors.rimGlow(ent, color, strength) -> void                                           // Gather and Form rim
```
The animator needs **no per-tick calls for locomotion**: in its `anim` frame system it reads `ent.move` (`mode`, `grounded`, `boost`, `speed`), `ent.vel`, `ent.yaw` and `ent.combat.state` (`guard`, `gather`, `stagger`, `down`, `dead`) and blends the matching cycles. Combat calls `actors.play` for technique clips; when a clip ends, locomotion resumes.

**Standard clip ids** (every humanoid spec implements all; creature specs implement those marked *): `idle`*, `walk`*, `run`*, `sprint`, `jump`, `fall`*, `land`, `fly_hover`*, `fly_cruise`*, `fly_boost`, `swim`, `hurtle`*, `stagger`*, `down`*, `getup`*, `death`*, `guard`, `gather`, `transform`, `flicker`, `attack1`..`attack6`, `heavy_charge`, `heavy`, `heavy_air`, `cast` (one-hand bolt), `cast_loop`, `beam_charge`, `beam_loop`, `beam_end`, `burst` (Nova), `ult_rise`, `ult_dive`, `talk`, `interact`, `victory`, `taunt`; creature and boss clips: `bite`*, `charge_windup`*, `charge`*, `slam`*, `ranged`*, `roar`*, plus boss-specific ids named in their technique data. A missing clip falls back to `attack1`, then `idle`, and logs once.
Cosmetic animation events (`actor:step`) are emitted in the frame phase only. Hits never come from animation.

### 4.6 `ctx.move` (package: control)
Kinematics for **every** actor (player, enemies, NPCs). The `move.run` system integrates each entity that has `ent.move`, reading `ent.intent` and `ent.stats` speeds.
```js
move.initActor(ent, opts /* { canFly = false, mode = 'ground' } */) -> void     // creates ent.move and ent.intent
move.teleport(ent, x, y, z, yaw /* optional */) -> void                         // also resets prev; calls world.flushBuilds for the player
move.setMode(ent, mode /* 'ground' | 'fly' | 'scripted' */) -> void
move.knock(ent, vx, vy, vz, opts /* { hurtle = false, stun = 0.3, gravityScale = 1, sourceId = 0, slamDamage = 0 } */) -> void    // emits actor:knocked
move.impulse(ent, vx, vy, vz) -> void                                           // additive velocity (lunges, recoil)
move.dashTo(ent, x, y, z, seconds) -> void                                      // scripted straight move ignoring intent; stops at terrain and solids
move.lock(ent, seconds, opts /* { noTurn = false, slow = 0 } */) -> void         // slow: 0 = rooted .. 1 = full speed
move.face(ent, yaw, immediate = false) -> void
move.altitude(ent) -> number                                                     // metres above world.groundAt
move.setCanFly(ent, on) -> void                                                  // flight unlock (rpg: MQ1 `tut_fly`); session passes the stored value to initActor
move.setBoostAllowed(ent, on) -> void                                            // combat turns boost off when Ora cannot pay for it or during Burnout; boost then drops to cruise
```
Rules implemented here (values from GDD 4.3 and 5.4): ground acceleration 40 m/s^2, gravity 28 m/s^2, jump speed 11 m/s, walkable slope up to 0.4 (steeper slides), ground snap 0.6 m; second jump press in the air = flight if `canFly`; flight has no gravity, damping 6 per s, vertical from `intent.up`; boost stages from `intent.sprint` (stage 2 after 2 s; emits `move:boost`); auto-land when descending within 1.2 m of the ground; swim mode when feet are more than 1.2 m under sea level; ceiling and Veilstorm push-back (`world:edge`); actor-actor soft separation; capsule versus static colliders with 3 push-out iterations; hurtle: ballistic with spin until speed drops under 6 m/s or impact; impact at 14 m/s or more emits `actor:slam` (carrying `slamDamage`), otherwise the entity goes `down`. Speeds come from `ent.stats.runSpeed / flySpeed / boostSpeed` x `ent.stats.speedMult` x `ent.move.speedMult`. Boost stages need `ent.move.boostAllowed`. The Ora cost of boost is charged by combat (it reads `ent.move.boost`), and combat calls `move.setBoostAllowed`.
Player intent (the `control.player` system): `intent.sprint = input.down('dash') && input.heldTime('dash') >= 0.2`, or the touch boost latch (a second `dash` press within 0.3 s latches sprint until the stick returns to neutral or `dash` is pressed again). The press itself belongs to combat (Flicker Step, 4.9); control never consumes it. **Camera-pitch flight**: when the player is in `fly` mode and pitch flight is active (`input.device === 'touch'`, or `settings.pitchFlight`), the stick's forward amount is applied along the camera's forward vector including pitch: `intent.up = sin(cam.pitch) * moveY` plus the `jump` and `descend` buttons, clamped to -1..1, and the horizontal part is scaled by `cos(cam.pitch)`. With pitch flight off, `intent.up` comes from `jump` and `descend` only.

### 4.7 `ctx.cam` (package: control)
```js
cam.setTarget(entId) -> void
cam.mode -> 'explore'|'flight'|'boost'|'lock'|'combat'|'dialogue'|'cinematic'      // 'combat' = group combat without a hard lock (ART_UX section 5)
cam.yaw -> number ; cam.pitch -> number
cam.forward(out /*Vector3*/) -> Vector3          // horizontal unit vector the camera looks along (for camera-relative input)
cam.right(out) -> Vector3
cam.setOrbit(yaw, pitch, dist /* optional */) -> void
cam.setLock(targetId /* 0 = none */) -> void     // normally driven by combat:lock
cam.shake(trauma) -> void
cam.fovKick(deg, seconds, hold = false) -> void  // hold: stays until fovKick(0, s)
cam.punch(dx, dy, dz, amount) -> void
/** @typedef {{ seconds:number, from?:{x,y,z}, to?:{x,y,z}, lookAt?:{x,y,z}|{ entId:number, socket?:string },
 *              orbit?:{ entId:number, dist:number, height:number, yawFrom:number, yawTo:number }, fov?:number, ease?:'linear'|'inOut'|'out' }} Shot */
cam.play(id, shots /*Shot[]*/, opts /* { skippable = true, freeze = false } */) -> Promise<{ skipped:boolean }>    // emits cine:start / cine:end; freeze pauses gameplay (time.pause('cine')). Shots advance on frame time, so they also run while the sim is paused (title flyover)
cam.skip() -> void
cam.busy -> boolean
cam.dialogue(speakerEntId, listenerEntId) -> void ; cam.endDialogue() -> void      // entity ids; rpg resolves npc ids to entities before calling
```
The camera frame system implements ART_UX section 5 (modes, portrait framing, auto-recentre, collision, camera-pitch flight) and calls `world.setFocus` with the camera position. The control package also owns the **touch controls** (DOM in `dom.layer('touch')`, layouts of ART_UX 6.2-6.3: stick zone, camera zone, action arc, Gather and Item on the left, Descend in the flight sub-layout, Tech 1 and 2, Form, Ultimate; there is no Lock button) and the full gamepad source; it registers them with `input.registerSource('touch', ...)` and `input.registerSource('pad', ...)` (4.8). Every touch control element carries `data-action`: an ACTION id for buttons, `"move"` for the stick zone and `"look"` for the camera drag zone, so the ui package can place tutorial highlights over it with `getBoundingClientRect` and layout tests can read every rectangle. The touch layer applies the gesture hygiene of ART_UX 6.1 (no selection, callout, tap highlight or context menu; non-passive `touchstart` with `preventDefault`). The Item button shows the icon and count of `rpg.quickItem`. The interact pill, the target frame (its swipe calls `combat.cycleTarget`, its tap `combat.setTarget(0)`), and the Pause and Map buttons are HUD elements owned by the ui package (they call `input.setButton`).

### 4.8 `ctx.input` (foundation, final)
```js
export const ACTIONS = ['attack','bolt','dash','guard','jump','descend','gather','tech1','tech2','ultimate','form','formNext',
  'lock','lockNext','lockPrev','interact','item','itemNext','map','pause','menuQuests','menuInventory','menuTechniques','menuCharacter','skip',
  'uiConfirm','uiBack','uiUp','uiDown','uiLeft','uiRight','uiTabNext','uiTabPrev'];
export const AXES = ['moveX','moveY','lookX','lookY'];     // moveX right, moveY forward, -1..1; look in degrees accumulated per tick

input.down(action) -> boolean
input.pressed(action) -> boolean        // true for exactly one sim tick
input.released(action) -> boolean
input.heldTime(action) -> number        // seconds
input.consume(action) -> void           // clears pressed for the rest of the tick
input.onPress(fn /* (action:string) => void */) -> unsubscribe
                                        // frame-rate press notification (phase `pre`), delivered even while the sim is paused: menus, dialogue advance, pause, skip.
                                        // Sim code must use pressed(); UI code must use onPress().
input.axis(name) -> number
input.device -> 'kbm'|'touch'|'pad'     // last used; emits input:device on change
input.context -> 'game'|'ui'|'cine'     // in 'ui' and 'cine' gameplay actions read as up; ui*, pause and skip always work
input.setContext(context) -> void

// device sources
input.registerSource(id /* 'kbm' | 'pad' | 'touch' */, source /* { poll?(input, dt):void, dispose?():void } */) -> void
                                        // one source per id: registering an id that exists disposes the previous source first. core.inputPoll calls poll() on each source
input.setButton(action, isDown, source) -> void
input.setAxis(name, value, source) -> void
input.addLook(dxDeg, dyDeg) -> void
input.requestPointerLock() -> void      // optional, failure is silent
input.rumble(strong, weak, ms) -> void ; input.vibrate(pattern) -> void      // honour settings.vibration. rumble is a no-op in P0. vibrate is feature-detected once and is
                                                                             // disabled for the session (no further calls, no logging) after the first rejection or throw
input.glyph(action) -> { device:string, label:string, icon:string|null }     // for prompts ("Space", "A", touch button id); accepts every ACTION id and 'move' | 'look'

// deterministic injection (debug API and tests)
input.inject.press(action, ticks = 1) ; input.inject.hold(action, on) ; input.inject.move(x, y) ; input.inject.look(dx, dy) ; input.inject.clear()
```
The foundation ships and registers two sources: `'kbm'` (bindings of ART_UX 6.4, including arrow-key look at 120 deg per s, which is the camera when pointer lock is refused) and a basic standard-mapping `'pad'` (6.5), plus the UI navigation mapping. The control package replaces `'pad'` with the full mapping and adds `'touch'` through `registerSource`, so no input is ever delivered twice; the stand-in touch layer is registered as `'touch'` by the stand-in `cam` and is replaced the same way. `uiConfirm` / `uiBack` are also produced by Enter / Esc and pad A / B. Platform rules (the game runs inside sandboxed embedded pages): `navigator.getGamepads` is called inside try/catch, and if it throws the pad source turns itself off and pad glyphs are never shown; pointer lock is optional, and on `pointerlockchange` to unlocked during play the foundation presses `pause` (Chrome consumes the first Esc to release the lock); fullscreen is never required. In test mode without `autoplay`, real devices are ignored. Injected presses reach `onPress` listeners at the next frame pass (`__GAME__.step` and `__GAME__.render` both run one), so scenarios can drive menus while the sim is paused.

### 4.9 `ctx.combat` (package: combat)
```js
combat.initActor(ent) -> void                    // creates ent.combat from ent.stats and its definition; call after stats are set. For the player, surge starts from store.player.surge
combat.act(ent, action, opts) -> boolean         // high-level request used by the player driver and by AI
   // action: 'attack' | 'heavyStart' | 'heavyRelease' | 'bolt' | 'guardOn' | 'guardOff' | 'flicker' | 'gatherOn' | 'gatherOff'
   //         | 'tech1' | 'tech2' | 'techRelease' | 'ultimate' | 'form' | 'revert'
   // opts: { dirX?, dirZ?, targetId? }
combat.useTechnique(ent, techId, opts /* { targetId?, charge?: 0..1, dirX?, dirZ?, x?, y?, z? } */) -> boolean      // direct cast (AI, scripts, debug); checks cost, cooldown and state unless opts.force
combat.canUse(ent, techId) -> boolean
combat.cooldown(ent, techId) -> number           // seconds remaining
combat.cancel(ent) -> void
/** @typedef {{ sourceId:number, targetId:number, techId?:string, power:number, kind?:'melee'|'ora'|'true', rating?:number,
 *              poise?:number, knock?:{ kind:'none'|'push'|'launch'|'smash'|'spike'|'radial', speed?:number, up?:number },
 *              dirX?:number, dirZ?:number, x?:number, y?:number, z?:number, unblockable?:boolean, canCrit?:boolean, feel?:string }} DamageRequest */
/** @typedef {{ applied:boolean, amount:number, crit:boolean, blocked:boolean, perfect:boolean, killed:boolean, staggered:boolean }} DamageResult */
combat.damage(request, out /* optional DamageResult */) -> DamageResult        // the only way HP is reduced; handles guard, invulnerability, poise, knock, events
combat.heal(ent, amount) -> void
combat.addOra(ent, amount) -> void ; combat.addSurge(ent, amount) -> void
combat.setInvulnerable(ent, seconds) -> void
combat.stagger(ent, seconds) -> void
combat.kill(ent, sourceId = 0) -> void
combat.revive(ent, hpFraction = 1) -> void       // player respawn
combat.setForm(ent, formId /* null = base */, opts /* { instant = false, free = false, scripted = false } */) -> boolean
combat.telegraph(ent, kind, seconds, opts /* { shape = 'self', radius = 0, x?, y?, z?, dirX?, dirZ? } */) -> void
// targeting (player)
combat.target() -> number                        // hard-lock target id or 0
combat.softTarget() -> number                    // current soft-lock target id or 0
combat.setTarget(entId /* 0 = release */) -> void
combat.cycleTarget(dir /* +1 | -1 */) -> void
combat.pickAtScreen(cssX, cssY) -> number        // tap-to-lock; returns the entity id or 0
// state
combat.inCombat -> boolean ; combat.threat -> number /* 0..1 */
combat.registerScript(id, fn /* (ctx, ent, tech, state) => void, called every tick of the technique */) -> void     // bespoke techniques and boss moves
combat.setEnabled(ent, enabled) -> void          // scripted sequences disable actions
```
Rules: the `combat.player` system maps input to `combat.act` (attack tap and hold, bolt hold auto-fire, guard, `dash` **pressed** -> `flicker` at once, gather, tech buttons with hold-to-charge, ultimate, form, lock). The `dash` hold belongs to control (sprint and boost, 4.6): combat never reads the hold and control never consumes the press. The `combat.run` system advances technique timelines from **technique data** (5.1), resolves hit shapes with `spatial` queries, moves projectiles (entities of kind `projectile`, swept with `world.sweepSphere` and `spatial.querySegment`), applies regen, drains, cooldowns, Burnout, Surge decay, poise refill, boost Ora cost, and computes `inCombat` (true while any hostile targets the player or within 6 s of a hit).
Ora rules: passive regen comes from `formulas.oraRegen` and is 0 while `ent.move.boost > 0`, while a Form is active and during Burnout. Boost costs 6 Ora per s and Sonic 10 per s (x `1 + boostCostPct`). When the pool cannot pay, or during Burnout, combat calls `move.setBoostAllowed(ent, false)`, and turns it on again once Ora is 10 or more.
World versus entity hits: for a projectile step or a hit shape, an entity hit wins over a world hit when `t_entity <= t_world + 0.05`, so Siphons, the training post and other damageable entities that also have a SOLID collider are damaged instead of stopping the shot. A world hit on a collider flagged `COLLIDER.DESTRUCTIBLE` calls `world.damageProps(x, y, z, radius, damage, sourceId)`; any other world hit just ends the projectile.
Form multipliers are **not** applied by combat: `ent.stats.dmgMult / defMult / speedMult` already contain them, because rpg recomputes the stats on `combat:form`. `setForm` handles cost, drain, timings, Burnout and events only. Damage numbers use `formulas.damage`. For one hit combat emits `actor:damaged`, then `combat:hit` with the same `amount` (3.6). On `actor:slam` combat applies the slam damage, +4 Surge, calls `world.damageProps` and `world.crater`. On a kill it emits `actor:died` carrying the entity's `questTag` (rpg awards XP and loot for enemies and bosses and completes `destroy` steps for objects; ai removes the bodies it spawned). Player death emits `player:died`. Feel is automatic through events (4.15). Enemy techniques run through the same engine: AI calls `combat.useTechnique(ent, techId, { targetId })`.

### 4.10 `ctx.ai` (package: ai)
```js
ai.spawn(enemyId, x, y, z, opts /* { level?, hostile = true, passive = false, campId?, questTag?, leash = 80, aggro = false, variant?, hpMult? } */) -> Entity | null
   // creates the entity (ent.questTag = opts.questTag), stats via formulas.enemyStats, actors.create, move.initActor, combat.initActor, brain; emits actor:spawned.
   // passive: the brain idles and never acquires a target (line-ups, screenshots, tests)
ai.spawnGroup(groupId, x, z, opts /* { level?, questTag?, radius = 8, aggro = false } */) -> number[]      // defs kind 'group'
ai.despawn(entId) -> void
ai.startBoss(bossId, opts /* { skipIntro = false } */) -> Entity | null          // spawns at the arena, plays the intro shot, emits boss:start; records the boss as pending
ai.resetBoss() -> void                                                            // despawns the boss and its adds; the boss stays pending (see the rules)
ai.boss -> Entity | null
ai.setEnabled(enabled) -> void                    // freezes all brains (cinematics, dialogue)
ai.setAmbient(enabled) -> void                    // ambient region and camp spawning on or off (tutorial, tests)
ai.aggro(entId, targetId) -> void
ai.clear(x, z, radius) -> void                    // remove non-quest enemies in an area (settlement safety, cutscenes)
ai.population() -> { alive:number, engaged:number }
ai.debugState(entId) -> { brain:string, state:string, targetId:number, hasToken:boolean } | null
ai.registerBrain(id, factory /* (ctx, ent, params) => { think(dt):void } */) -> void
```
Rules: brains think at 10 Hz staggered by id and write `ent.intent` every tick; attacks go through `combat.useTechnique`; the attack-token director enforces GDD 6.7 by difficulty; the spawner keeps region populations from defs `spawnTable` in a ring 90-160 m around the player (outside settlements, respecting tier caps, never in a region without a spawn table), populates camps from `world.pois('camp')`, despawns beyond 260 m when not engaged, and resets enemies on `player:respawned`. Ground enemies that disengage from a hovering player (GDD 6.6) return to their post and are restored to full HP through `combat.heal`.
Bodies: ai removes a body 1.5 s after `actor:died` **only** for entities of kind `enemy` or `boss` that ai itself spawned. It never touches entities of kind `object` or `npc`.
Camps: when the last enemy of a camp dies, ai writes `store.world.camps[campId] = env.day` and emits `camp:cleared { campId, regionId, day }`. It does not repopulate a camp while `env.day - dayCleared < 1`. The camp chest and the bonus XP belong to rpg.
Bosses are enemies with a phase script (5.4); HP uses `formulas.enemyStats(def, level, difficulty, { hpMult, poise })` with `BossDef.hpMult` (x `1 + hpPerSiphonStanding * standing` for Vorrhal). Phase `onEnter` actions are run with `quests.runActions`. **Pending boss**: `startBoss` records the boss id as pending. `resetBoss` (the player left the arena radius + 60 m, or died) despawns it but keeps it pending. While a boss is pending and not spawned, ai calls `startBoss(id, { skipIntro: true })` again when the player re-enters the arena radius, and on `player:respawned { retry: true }`. Pending clears on `boss:end { defeated: true }` and on `game:ended`. Quest steps therefore start a boss only once.

### 4.11 `ctx.rpg` (package: rpg)
```js
rpg.attachPlayer(ent) -> void                    // binds the store's player state to the entity: fills ent.stats, ent.level; keeps them in sync
// progression
rpg.level -> number ; rpg.xp -> number ; rpg.xpToNext() -> number
rpg.grantXp(amount, source = 'debug') -> void    // handles multi-level-ups; emits rpg:xp, rpg:levelUp
rpg.setLevel(level) -> void                      // debug: sets level and grants the matching points
rpg.statPoints -> number ; rpg.base() -> { mgt, spr, vit, swf }
rpg.allocate(stat, n = 1) -> boolean ; rpg.autoAllocate(style /* 'brawler'|'blaster'|'balanced' */) -> void
rpg.stats() -> ActorStats                        // derived, including gear and Form; cached, recomputed on change
rpg.resonance() -> number
rpg.awaken() -> void                             // the MQ1 Ora Awakening
rpg.difficulty -> 'story'|'warrior'|'master' ; rpg.setDifficulty(id) -> void
// techniques and forms
rpg.tp -> number ; rpg.addTp(n) -> void
rpg.hasTech(techId) -> boolean ; rpg.unlockTech(techId) -> void
rpg.rank(techId) -> number                       // 0 = not unlocked, 1..n
rpg.nodes() -> Array<{ id, branch, techId, rank, tp, state:'locked'|'available'|'owned', reasonKey:string|null }>
rpg.learn(nodeId) -> boolean
rpg.slots() -> { slots:[string|null, string|null], ultimate:string|null }
rpg.setSlot(index /* 0 | 1 | 'ultimate' */, techId /* or null */) -> boolean
rpg.forms() -> string[] ; rpg.unlockForm(formId) -> void ; rpg.selectedForm -> string|null ; rpg.selectForm(formId) -> void
rpg.mods() -> object                             // aggregated modifiers of passives, gear and the active Form, read by combat and formulas. CLOSED key set (IDS.modKey):
   // { meleePct, oraPct /* Ora damage */, poisePct, surgePct, gatherPct, oraRegenPct, boostCostPct, boostSpeedPct, healPct, resPct, critAdd, hpPct,
   //   oraPoolPct /* max Ora */, flickerCostMult, secondBreath, perfectStaggerMult, gatherDmgTakenMult, siphonRegenMult }
   // Item `mods`, tech-node `passive` blocks, FormDef and formulas use only these keys (unit-tested against IDS.modKey). Unlisted keys are rejected by defs.validate.
// currency and items
rpg.shells -> number ; rpg.addShells(n, source) -> void ; rpg.spendShells(n) -> boolean
rpg.addItem(itemId, count = 1, opts /* { level? } */) -> number      // returns the uid (stackables share one uid); respects carry caps (returns 0 if nothing was added)
rpg.removeItem(itemId, count = 1) -> boolean ; rpg.count(itemId) -> number
rpg.items() -> Array<{ uid, itemId, level, count, equipped:boolean }>
rpg.itemStats(uid) -> object                     // scaled effects for display and comparison
rpg.equip(uid) -> boolean ; rpg.unequip(slot /* 'wraps'|'garb'|'charm1'|'charm2' */) -> boolean ; rpg.equipped() -> { wraps, garb, charm1, charm2 }   // uids or null
rpg.useItem(itemId) -> boolean ; rpg.quickItem -> string ; rpg.cycleQuickItem() -> void
// shops and loot
rpg.shop(shopId) -> Array<{ index, itemId, level, price, canAfford:boolean }>
rpg.buy(shopId, index, count = 1) -> { ok:boolean, reasonKey:string|null }
rpg.sell(uid, count = 1) -> { ok:boolean, shells:number }
rpg.dropLoot(tableId, level, x, y, z) -> void    // rolls with rng.sim and spawns pickup entities
rpg.giveLoot(tableId, level) -> Array<{ kind, itemId, count }>     // straight into the inventory (chests, quest rewards)
// flags and respawn
rpg.flag(key) -> any ; rpg.setFlag(key, value) -> void
rpg.respawn(opts /* { retry = false } */) -> void               // revive at the Ringstone or the boss retry point; emits player:respawned
```
Rules: pure logic lives in `src/rpg/logic/**` (no three, no DOM; functions take state and defs and return results) and is unit-tested in Node; the service wraps it around `ctx.store`. On `combat:form`, `combat:gather`, `rpg:equip`, level changes: recompute stats and Resonance (emit `rpg:stats`, `rpg:resonance`). The `rpg.pickups` system moves pickups toward the player within 6 m and collects them.
Ownership of the player's numbers: rpg writes every `ActorStats` field of the player **except `hp` and `ora`**, which only combat writes, and rpg never touches `ent.combat`. A recompute keeps the current hp and ora (clamped to the new maxima by `combat.heal(ent, 0)` and `combat.addOra(ent, 0)`). Form multipliers enter the stats in exactly one place, `formulas.derivePlayerStats(base, level, mods, form)` -> `dmgMult / defMult / speedMult`. The level-up restore calls `combat.heal(ent, hpMax)` and `combat.addOra(ent, oraMax)`. rpg registers `save.onBeforeSave` to copy `ent.stats.hp`, `ent.stats.ora` and `ent.combat.surge` into `store.player`, and restores hp and ora in `attachPlayer` and `save.onAfterLoad` (surge is read by `combat.initActor`).
Deaths: on `actor:died` with a player-side source and kind `enemy` or `boss`: XP by `formulas.enemyXp`, `dropLoot`, kill counters, `kill` steps (by `defId`, or by `questTag` for steps with `tag`). For kind `object`, `actor:died` whose `defId` is an ObjectDef id completes `destroy` steps and gives no XP or loot. On `camp:cleared`: the camp chest goes from `locked` to `closed` and the bonus XP of GDD 4.1 is granted; destroying a Siphon grants its bonus XP.
Level-up: applies the points by `store.player.autoStyle` unless it is `'manual'`, emits `rpg:levelUp`, never opens a screen.
New game shortcut: on `game:newGame`, if `flags.tutorial` is 0 (always in test mode), rpg writes the store as if MQ1 were finished, without its XP: `quests.done` gets `'mq1'`, `player.techs` gets `'gather'`, `player.awakened = true`, `player.canFly = true`, `player.respawn = 'ringstone_sparkstead'`, `player.x / z` = the Sparkstead Ringstone (`world.pois('ringstone')`), `world.ringstones` gets it, and `mq2` becomes active. The journey then starts at level 1 with 0 XP. During a normal MQ1 the `tut_fly` script sets `store.player.canFly = true` and calls `move.setCanFly(ent, true)`.
Boss retry: on `boss:start` rpg snapshots the consumable counts; `rpg.respawn({ retry: true })` restores them, revives the player at the arena's retry point and emits `player:respawned { retry: true }` (ai then restarts the pending boss).

### 4.12 `ctx.quests` (package: rpg): quests, dialogue, interactables, world activities
```js
// quests
quests.start(questId) -> boolean
quests.state(questId) -> 'locked'|'available'|'active'|'done'
quests.active() -> Array<{ questId, stepIndex, stepId, objectiveKey, objectiveArgs, count, need }>
quests.tracked -> string|null ; quests.track(questId) -> void
quests.markers() -> Array<{ questId, x, y, z, kind:'main'|'side'|'giver' }>      // for the compass and map
quests.completeStep(questId) -> void             // debug and scripts: force the current step
quests.registerScript(scriptId, fn /* (ctx, api) => void */) -> void
   // api: { done(), setObjective(key, args), onTick(fn(dt)), onEvent(type, fn), prompt(action, textKey), clearPrompt(), wait(seconds) -> Promise, spawnProp(...), cleanup(fn) }
quests.runActions(actions /* Action[] */) -> void     // the declarative ops of 5.6
quests.siphonsSilenced() -> number
// dialogue
quests.talk(dialogueId, opts /* { npcId? } */) -> Promise<void>      // opens the dialogue; resolves when it ends
quests.advance(choiceIndex /* optional */) -> void                    // called by the UI
quests.dialogueOpen -> boolean
// interactables
/** @typedef {{ id:string, kind:string, x:number, y:number, z:number, radius?:number, promptKey:string, enabled?:boolean,
 *              onUse:(ctx:Ctx)=>void }} Interactable */
quests.addInteractable(def) -> void ; quests.removeInteractable(id) -> void ; quests.setInteractable(id, enabled) -> void
quests.focus -> string|null                      // id of the nearest enabled interactable in range (default radius 3 m; 6 m in flight)
quests.use() -> boolean                          // use the focused interactable (bound to the `interact` action by the quests.run system)
// world activities owned by this package (built on game:loaded from world.pois and defs)
quests.raceStart(courseId) -> boolean ; quests.raceAbort() -> void
quests.objects() -> Array<{ id, kind, x, y, z, state }>      // quest objects, Ringstones, shrines, chests, Siphons
```
Rules: NPCs are entities of kind `npc` placed at `env.spot(...)` positions from defs `npc`, with `actors.create`; an NPC entity exists only while the player is within 300 m of its home (the package creates and destroys them, keeping the actor cap free for enemies); talking to one runs its current dialogue (chosen by quest state); for dialogue framing rpg passes entity ids to `cam.dialogue`. Ringstones, shrines, chests, Siphons, ring gates and quest objects are created from `world.pois` and defs `object`, drawn with `env.spawnProp`, and persisted through the store lists. Siphons and breakable quest objects are entities of kind `object` that rpg creates and owns: rpg fills `ent.stats` (hp from `hpMult`), sets `ent.questTag = ObjectDef.targetTag`, calls `combat.initActor`, and destroys the entity itself after its `actor:died`. A closed Siphon core is `ent.stats.defMult = 10` (it takes 10% damage) and an open core is `defMult = 1`; rpg flips it on the 8 s cycle and emits `siphon:state`. Discovery (`world:poiDiscovered`) fires within 60 m of a POI or landmark. The `quests.run` system also maps `input.pressed('interact')` -> `quests.use()`, `input.pressed('item')` -> `rpg.useItem(rpg.quickItem)` and `input.pressed('itemNext')` -> `rpg.cycleQuickItem()`. The tutorial (MQ1) and the finale are quest scripts. The finale script `finale_tethers` is started by the `onEnter` action of Vorrhal's third phase: it sets `TAG.SCRIPTED | TAG.INVULNERABLE` on the boss, drains the player's Ora, creates one `tether_n` object per silenced Siphon (an interactable anchor with a `lightPillar` prop and a `vfx.beam` ribbon to the carrier), completes a tether when the carrier comes within 25 m of the Spire base, refills Ora on each, and after the last one calls `combat.setForm(player, 'zenith', { scripted: true })`, clears the boss tags and lets the fight end.

### 4.13 `ctx.ui` (package: ui)
```js
ui.open(screenId, params) -> void                // screen ids: ART_UX 7.2. Opening any screen except 'hud' pauses (time.pause('menu')) and sets input context 'ui'. Nothing opens a screen
                                                 // on its own during play except death, dialogue, shop and the first map reveal: a level-up is a banner, never a screen
ui.close(screenId /* optional: top */) -> void
ui.closeAll() -> void
ui.top() -> string                               // 'hud' when no menu is open
ui.isOpen(screenId) -> boolean
ui.toast(key, args, kind = 'info') -> void       // same as emitting ui:toast
ui.banner(kind, key, args) -> void
ui.confirm(key, args) -> Promise<boolean>        // in-UI modal
ui.setHudVisible(visible) -> void
ui.letterbox(on) -> void
ui.fade(alpha, seconds) -> Promise<void>         // full-screen ink fade (teleports, respawn)
ui.registerScreen(id, factory /* (ctx) => { el:HTMLElement, onOpen(params), onClose(), onLang?(), onInput?(action) } */) -> void
```
The HUD is **event-driven and polled**: bars, Resonance, target frame, compass and tracker read `ctx.player.stats`, `ctx.rpg`, `ctx.combat`, `ctx.quests` in the `ui` frame phase (text at most 15 Hz, bars by `transform: scaleX`) and react to the catalog (damage numbers on `actor:damaged`, banners, toasts, prompts on `tutorial:prompt`, the interact pill on `interact:focus`, boss bar on `boss:*`, death screen on `player:died`, dialogue on `dialogue:*`, loading on `game:boot`, the level-up banner and medallion badge on `rpg:levelUp`, the camp toast on `camp:cleared`). World-anchored elements use `render.project`. Menu actions call `ctx.rpg`, `ctx.quests`, `ctx.save`, `ctx.session`. Because menus pause the sim, all UI input comes from `input.onPress` and DOM pointer events, never from `input.pressed`.
Further ui duties: the `title` screen's `onOpen` calls `cam.play('title', shots, { skippable: false })` in a loop over Haven Aster's kite tower with `env.setHour(17.5)` and the clock frozen, and stops it on close; the `savecode` screen wraps `save.exportCode` and `save.importCode`; while `save.memoryOnly` is true the HUD shows the session-only warning icon; the target frame handles swipe (`combat.cycleTarget`) and tap (`combat.setTarget(0)`) on touch; toasts, banners, compass and target frame use physical centring in both languages (ART_UX 6.6).

### 4.14 `ctx.i18n` (foundation, final)
```js
i18n.t(key, args) -> string                      // '{name}' parameters; '{g:masc/fem}' picks by the player's form of address; '{p:n/one/many}' picks by args.n
i18n.lang -> 'he'|'en' ; i18n.dir -> 'rtl'|'ltr'
i18n.setLang(lang) -> void                       // sets dir and lang on #app, emits lang:changed
i18n.setGender(g /* 'm' | 'f' */) -> void
i18n.addStrings(tables /* { he:{...}, en:{...} } */) -> void
i18n.has(key) -> boolean
i18n.num(n) -> string                            // 1,240 (Western digits, wrap in <bdi> in RTL text)
```
Key convention: `<package>.<area>.<name>` for UI text; content names `item.<id>.name`, `item.<id>.desc`, `tech.<id>.name`, `tech.<id>.desc`, `form.<id>.name`, `enemy.<id>.name`, `boss.<id>.name`, `boss.<id>.title`, `npc.<id>.name`, `region.<id>.name`, `landmark.<id>.name`, `quest.<id>.title`, `quest.<id>.<stepId>` (objective), dialogue lines `<questId>.lNN` as in the GDD. A missing key renders as `[key]` and is recorded once. Each package keeps its strings in `src/<dir>/strings.js` (may be split into several files it owns) and registers them in `install`.

### 4.15 Feel service `ctx.fx` (foundation, final)
```js
fx.impact(classId, x, y, z, scale = 1) -> void   // applies one row of FEEL (ART_UX section 4): time.hitStop, cam.shake, cam.fovKick, time.slowMo, input.vibrate / rumble; emits fx:impact
export const FEEL = { lightHit: { hitStop, shake, fov, fovSeconds, slowScale, slowSeconds, vibrate, rumble:[strong, weak, ms] }, ... }   // src/core/feel.js
```
`fx` subscribes to events so that **packages never call it for standard cases**: `combat:hit` when the attacker or the target is the player (class from the payload; when the target is the player the class is `hurtHeavy` if `amount >= 0.15 * player.stats.hpMax`, else `hurtLight`), `combat:perfect`, `combat:flicker` (player), `move:boost` (stage 1 `boostStart`, stage 2 `sonicBoom`), `actor:slam`, `combat:form` (`transform`), `boss:end` (`bossDeath`), `rpg:levelUp`, `actor:landed` (player, speed over 20), `world:crater` (radius 10 or more: `craterBig`). Shake and FOV are scaled by `settings.shake` and Reduced Motion. The slow motion of `levelUp` is skipped while `combat.inCombat` is true, so a level gained mid-fight never changes the fight's timing.

### 4.16 `ctx.debug` (foundation, final)
`debug.register(name, fn)` adds `__GAME__.cmd[name]`. The fixed surface of `window.__GAME__` is in section 6.

### 4.17 Formulas and balance (`src/core/formulas.js`, `src/core/balance.js`; foundation, final, pure)
```js
export const BALANCE            // every constant of GDD sections 4-7 and 10 (level cap, curve coefficients, costs, windows, difficulty table, drop weights), plus
                                // BALANCE.tech (power, cost, cooldown and rank numbers of GDD 5.3: technique data reads them from here, no number is typed twice)
                                // and BALANCE.route (the XP route of GDD 4.1)
xpToNext(level) -> number
derivePlayerStats(base /* {mgt,spr,vit,swf} */, level, mods /* rpg.mods() shape */, form /* FormDef | null */) -> ActorStats
resonance(base, level, mods, formResMult, gatherMult, awakened) -> number
enemyStats(enemyDef, level, difficulty, opts /* { hpMult?, poise? } */) -> ActorStats   // hp, ratings (meleeRating = oraRating = ATK), defense, poise, resonance. opts override enemyDef.mult.hp and poise (bosses)
oraRegen(spr, mods, state /* { inCombat, inSiphonZone, boosting, inForm, burnout } */) -> number   // GDD 4.3; 0 while boosting, in a Form or in Burnout
bonusXp(kind /* 'siphon' | 'camp' | 'campRefill' */, level) -> number
simulateRoute(route /* BALANCE.route, GDD 4.1 */) -> Array<{ minute:number, level:number }>   // pure pacing simulation used by the balance test
enemyXp(enemyDef, level, playerLevel) -> number
enemyShells(enemyDef, level, difficulty) -> number
damage(power, rating, targetDefense, attackerDmgMult, targetDefMult, critMult, roll /* 0.95..1.05 */, difficultyMult) -> number
chargeMult(heldSeconds, minSeconds, maxSeconds, maxMult) -> number
itemValue(base, itemLevel) -> number ; itemPrice(rarity, itemLevel) -> number ; consumablePrice(itemId, playerLevel) -> number
regionLevel(band /* [min,max] */, t /* 0..1 */) -> number
```
Unit tests in `tests/core/` assert the GDD targets (level curve values, grunt time-to-kill, hits-to-die, Resonance examples). `tests/core/balance.test.mjs` additionally asserts, from `BALANCE` data alone: sustained power per second Strike String > Ora Bolt at equal rank; the Ultimate's centre power > the full output of every slot technique at its top P0 rank; for every level 1-40 and both allocation extremes, boost and every Form are a net Ora drain; the pacing targets of GDD 4.1 through `simulateRoute` (L10 at 40-50 min, L20 at 110-130 min, L25 or more when MQ7 starts); every key used by `BALANCE` modifiers is in `IDS.modKey`.

---

## 5. Data schemas (plain data modules registered through `ctx.defs`)

All definitions are frozen plain objects with a unique string `id`. Names are i18n keys by convention (4.14), so most schemas carry no text. One complete example per schema follows; `defs.validate()` checks every id reference marked "ref".

### 5.1 Technique (`technique`) and technique-tree node (`techNode`): combat owns player techniques, ai owns enemy and boss techniques
```js
/**
 * @typedef {object} TechniqueDef
 * @property {string} id
 * @property {'player'|'enemy'} user
 * @property {'core'|'slot'|'ultimate'|'enemy'} slot
 * @property {'fist'|'flare'|'spirit'} [branch]
 * @property {string} icon                      icon id for the UI
 * @property {'melee'|'ora'} rating
 * @property {{ ora:number, surge:number }} cost
 * @property {number} cooldown                  seconds before Swiftness reduction
 * @property {null|{ min:number, max:number, maxMult:number, oraPerSec:number, moveSlow:number }} charge   hold before `active`; release fires
 * @property {{ windup:number, active:number, recover:number, cancelFrom:number }} timeline   seconds; cancelFrom = seconds into `recover` after which another action may start (-1 = never)
 * @property {{ windup?:string, active?:string, recover?:string, speed?:number }} anim        clip ids (4.5)
 * @property {null|{ kind:'white'|'red'|'violet', shape:'self'|'ring'|'line'|'cone'|'circle', radius?:number, atTarget?:boolean }} telegraph   shown during windup
 * @property {{ lock:'none'|'slow'|'root', turn:boolean, air:boolean, ground:boolean }} move
 * @property {null|{ kind:'lunge'|'toTarget'|'behindTarget'|'charge'|'leap'|'rise'|'dive', t:number, seconds:number, dist?:number, speed?:number }} motion   t relative to windup start
 * @property {HitDef[]} hits                    timed from the start of `active`
 * @property {ProjectileDef[]} projectiles
 * @property {null|{ range:number, radius:number, tick:number, power:number, poise:number, knock:Knock, feel:string }} beam   sustained for `timeline.active`
 * @property {null|Array<{ timeline:object, anim:object, hits:HitDef[], motion?:object }>} chain   combo steps (Strike String): pressing the action again in the cancel window plays the next step
 * @property {null|{ radius:number, depth:number, at:'self'|'impact' }} crater
 * @property {boolean} invulnerable             during windup and active
 * @property {null|string} script               id registered with combat.registerScript
 * @property {{ color:number|'ora', windup?:string, active?:string, hit?:string }} fx      vfx recipe ids; 'ora' = the caster's current Ora colour
 * @property {{ windup?:string, active?:string, loop?:string, end?:string, hit?:string }} sfx   audio ids
 * @property {Array<{ mods?:Object<string, number> }>} ranks   index 0 = rank 1; mods are path overrides ('beam.radius') or the multipliers `powerMult`, `costMult`, `radiusMult`
 * @property {{ start?:boolean, level?:number, quest?:string }} unlock
 * @property {{ minRange:number, maxRange:number, weight:number, cooldown:number }} [ai]   enemy techniques only
 */
/** @typedef {{ kind:'none'|'push'|'launch'|'smash'|'spike'|'radial', speed?:number, up?:number }} Knock */
/** @typedef {{ t:number, every?:number, until?:number, shape:'sphere'|'cone'|'ring', f:number, u:number, radius:number, angle?:number,
 *              power:number, poise:number, knock:Knock, feel:string, maxTargets?:number, unblockable?:boolean }} HitDef     f, u: offset forward and up in metres */
/** @typedef {{ t:number, count:number, every?:number, until?:number, spreadDeg:number, speed:number, radius:number, life:number, homing:number,
 *              gravity:number, pierce:number, power:number, poise:number, knock:Knock, feel:string, fxId:string, socket:string,
 *              aoe?:{ radius:number, power:number } }} ProjectileDef */

// In the real data the numbers of GDD 5.3 are read from BALANCE.tech (4.17); they are written out here for readability.
export const DAWN_LANCE = {
  id: 'dawn_lance', user: 'player', slot: 'slot', branch: 'flare', icon: 'beam', rating: 'ora',
  cost: { ora: 30, surge: 0 }, cooldown: 8,
  charge: { min: 0.5, max: 2.0, maxMult: 2.5, oraPerSec: 15, moveSlow: 0.2 },
  timeline: { windup: 0.15, active: 1.6, recover: 0.4, cancelFrom: 0.2 },
  anim: { windup: 'beam_charge', active: 'beam_loop', recover: 'beam_end' },
  telegraph: null,
  move: { lock: 'slow', turn: true, air: true, ground: true },
  motion: null, hits: [], projectiles: [],
  beam: { range: 60, radius: 1.2, tick: 0.1, power: 0.16, poise: 6, knock: { kind: 'push', speed: 8 }, feel: 'beamTick' },
  chain: null, crater: null, invulnerable: false, script: null,
  fx: { color: 'ora', windup: 'beam_charge', hit: 'beam_hit' },
  sfx: { windup: 'beam_charge', loop: 'beam_loop', end: 'beam_end' },
  ranks: [ {}, { mods: { 'beam.radius': 1.8 } }, { mods: { powerMult: 1.3 } } ],
  unlock: { quest: 'mq4' },
};

/** @typedef {{ id:string, branch:'fist'|'flare'|'spirit', order:number, tp:number, techId?:string, rank?:number,
 *              passive?:Object<string, number>, requires?:{ tech?:string, node?:string, level?:number } }} TechNodeDef
 *  A node is either a technique rank (techId + rank) or a passive (keys of rpg.mods()). techId ref: technique. */
export const NODE_DAWN_LANCE_R2 = { id: 'dawn_lance_r2', branch: 'flare', order: 7, tp: 2, techId: 'dawn_lance', rank: 2, requires: { tech: 'dawn_lance' } };
export const NODE_IRON_FISTS_1 = { id: 'iron_fists_1', branch: 'fist', order: 5, tp: 1, passive: { meleePct: 0.06 } };
```

### 5.2 Form (`form`): combat
```js
/** @typedef {{ id:string, order:number, cost:number, drain:number, hpDrainPct:number,
 *   mult:{ dmg:number, def:number, speed:number, res:number, surge:number }, flickerCostMult:number,
 *   color:number, coreColor:number, auraStyle:'ember'|'tempest'|'zenith', formKey:string,
 *   transform:{ seconds:number, shortSeconds:number, shockRadius:number }, musicShift:number, unlock:{ quest?:string, scripted?:boolean } }} FormDef */
export const EMBER = {
  id: 'ember', order: 1, cost: 40, drain: 3, hpDrainPct: 0,
  mult: { dmg: 1.25, def: 1.10, speed: 1.10, res: 1.5, surge: 1 }, flickerCostMult: 1,
  color: 0xffb070, coreColor: 0xfff1dc, auraStyle: 'ember', formKey: 'ember',      // formKey ref: the `forms` block of the hero actor spec. Never red or coral (ART_UX 1.2 rule 3)
  transform: { seconds: 1.2, shortSeconds: 0.5, shockRadius: 8 }, musicShift: 0, unlock: { quest: 'mq2' },
};
```

Who applies what: `mult.dmg`, `mult.def`, `mult.speed` and `mult.res` are applied only by `formulas.derivePlayerStats` and `formulas.resonance` (called by rpg); `mult.surge` and `flickerCostMult` reach combat through `rpg.mods()` (`surgePct`, `flickerCostMult`). combat itself applies `cost`, `drain`, `hpDrainPct` and the `transform` timings, and nothing else of a FormDef.

### 5.3 Enemy (`enemy`): ai
```js
/** @typedef {{ id:string, specId:string, tier:'grunt'|'heavy'|'elite'|'boss', movement:'ground'|'fly'|'hover',
 *   levels:[number, number], mult:{ hp:number, atk:number, def:number, xp:number, shells:number }, poise:number,
 *   brain:'melee'|'charger'|'ranged'|'diver'|'boss', params:object, techs:string[], lootTable:string, regions:string[],
 *   tags:string[], frontGuard?:{ angleDeg:number, damageMult:number }, variantOf?:string, palette?:object, oraColor:number }} EnemyDef
 *  specId ref: actorSpec. techs ref: technique. lootTable ref: lootTable. regions ref: region. */
export const CHOIR_ACOLYTE = {
  id: 'choir_acolyte', specId: 'choir_acolyte', tier: 'grunt', movement: 'ground',
  levels: [2, 32], mult: { hp: 1.0, atk: 1.0, def: 1.0, xp: 1.0, shells: 1.2 }, poise: 25,
  brain: 'melee',
  params: { sight: 45, leash: 80, preferRange: [1.5, 3], strafe: 0.4, guardChance: 0.3, fleeHp: 0, jumpAtFlyer: true },
  techs: ['acolyte_string', 'acolyte_rush'],
  lootTable: 'grunt', regions: ['meadows', 'thornwood', 'rustdune', 'frostspine'], tags: ['choir'], oraColor: 0x7b3cff,
};
```

### 5.4 Boss (`boss`): ai
```js
/** @typedef {{ id:string, enemyId:string, level:number, hpMult:number, poise:number,
 *   arena:{ landmarkId:string, radius:number, retry:{ dx:number, dz:number } },
 *   phases:Array<{ hpBelow:number, techs:Array<{ id:string, weight:number }>, speedMult?:number, defMult?:number, onEnter?:Action[] }>,
 *   intro:{ seconds:number, lineKey?:string }, hpPerSiphonStanding?:number,
 *   rewards:{ shells:number }, fleeAtZero?:boolean }} BossDef
 *  enemyId ref: enemy (tier 'boss', brain 'boss'). landmarkId ref: landmark. techs ref: technique. */
export const BRAMBLEHORN = {
  id: 'bramblehorn', enemyId: 'bramblehorn', level: 12, hpMult: 14, poise: 200,
  arena: { landmarkId: 'bramble_hollow', radius: 90, retry: { dx: 0, dz: 100 } },
  phases: [
    { hpBelow: 1.0, techs: [{ id: 'bh_horn_charge', weight: 3 }, { id: 'bh_antler_sweep', weight: 2 }] },
    { hpBelow: 0.5, techs: [{ id: 'bh_root_lines', weight: 3 }, { id: 'bh_wall_leap', weight: 2 }, { id: 'bh_horn_charge', weight: 2 }],
      speedMult: 1.15, onEnter: [{ op: 'banner', kind: 'boss', key: 'boss.bramblehorn.phase2' }] },
  ],
  intro: { seconds: 3, lineKey: null },
  rewards: { shells: 1000 },                      // plus XP through the enemy def (xpMult 6) and a `boss` loot roll; techniques, Forms, gear and TP come from the quest
};
```

### 5.5 Item (`item`): rpg
```js
/** @typedef {{ id:string, type:'gear'|'consumable'|'quest', slot?:'wraps'|'garb'|'charm', rarity?:'common'|'fine'|'rare',
 *   stats?:{ mgt?:number, spr?:number, vit?:number, swf?:number, def?:number },      // scaled by item level
 *   mods?:Object<string, number>,                                                    // keys of rpg.mods(); not scaled
 *   palette?:Object<string, number>,                                                 // actor palette overrides when equipped
 *   effect?:{ kind:'heal'|'ora', pct:number, seconds?:number }, cap?:number, basePrice?:number, pricePerLevel?:number,
 *   drops:boolean, icon:string }} ItemDef */
export const COPPER_KNUCKLES = {
  id: 'copper_knuckles', type: 'gear', slot: 'wraps', rarity: 'rare',
  stats: { mgt: 6 }, mods: { poisePct: 0.10 }, palette: { wraps: 0xb5533a }, drops: true, icon: 'wraps',
};
export const SUNFRUIT = { id: 'sunfruit', type: 'consumable', effect: { kind: 'heal', pct: 0.30, seconds: 1 }, cap: 5, basePrice: 30, pricePerLevel: 2, drops: true, icon: 'fruit' };
```

### 5.6 Quest (`quest`) and actions: rpg
```js
/** @typedef {{ id:string, kind:'main'|'side', order:number, giver?:string /* npc id */,
 *   prereq:{ quests?:string[], level?:number, siphons?:number }, autoStart?:boolean,
 *   steps:Step[], rewards:Action[] }} QuestDef */
/** @typedef {{ id:string, type:'talk'|'goto'|'kill'|'defeat'|'collect'|'deliver'|'interact'|'destroy'|'useTechnique'|'reach'|'race'|'script',
 *   npc?:string, dialogue?:string, x?:number, z?:number, radius?:number, minAlt?:number, landmark?:string,
 *   enemy?:string, tag?:string, region?:string, count?:number, boss?:string, item?:string, objects?:string[], object?:string,
 *   tech?:string, targetTag?:string, level?:number, flag?:string, course?:string, medal?:'bronze'|'silver'|'gold', script?:string,
 *   marker?:{ x:number, z:number }|{ npc:string }|{ landmark:string }|{ object:string }, onStart?:Action[], onComplete?:Action[] }} Step
 *  The objective text key is `quest.<questId>.<stepId>` with args { count, need }. */
/** @typedef {object} Action   one of:
 *  { op:'giveItem', item, count?, level? } | { op:'giveXp', amount } | { op:'giveShells', amount } | { op:'giveTp', amount }
 *  | { op:'unlockTech', tech, slot?:0|1|'ultimate' } | { op:'unlockForm', form } | { op:'setFlag', key, value } | { op:'startQuest', quest }
 *  | { op:'spawnGroup', group, x, z, questTag?, aggro? } | { op:'startBoss', boss } | { op:'setHour', hour } | { op:'toast', key, kind? }
 *  | { op:'banner', kind, key } | { op:'teleport', x, z, landmark? } | { op:'heal' } | { op:'setRespawn', ringstone }
 *  | { op:'moveNpc', npc, settlement, spot } | { op:'openScreen', screen, params? } | { op:'script', script } | { op:'awaken' } */

export const MQ2 = {
  id: 'mq2', kind: 'main', order: 2, prereq: { quests: ['mq1'] }, autoStart: true,
  steps: [
    { id: 's1', type: 'talk', npc: 'dov', dialogue: 'mq2_dov', marker: { npc: 'dov' }, onComplete: [{ op: 'giveItem', item: 'sunfruit', count: 3 }] },
    { id: 's2', type: 'talk', npc: 'mira', dialogue: 'mq2_mira', marker: { npc: 'mira' }, onComplete: [{ op: 'giveItem', item: 'training_wraps', level: 1 }] },
    { id: 's3', type: 'kill', tag: 'mq2_raid', count: 4, marker: { landmark: 'sparkstead' },
      onStart: [{ op: 'spawnGroup', group: 'mq2_raid', x: -1410, z: 1560, questTag: 'mq2_raid', aggro: true }] },
    { id: 's4', type: 'defeat', boss: 'durn', onStart: [{ op: 'startBoss', boss: 'durn' }] },
    { id: 's5', type: 'talk', npc: 'kerrin', dialogue: 'mq2_kerrin', marker: { npc: 'kerrin' } },
    { id: 's6', type: 'goto', landmark: 'siphon_1', radius: 70, marker: { landmark: 'siphon_1' } },
    { id: 's7', type: 'destroy', object: 'siphon_1', marker: { landmark: 'siphon_1' } },
    { id: 's8', type: 'talk', npc: 'sela', dialogue: 'mq2_sela', marker: { npc: 'sela' } },
  ],
  rewards: [
    { op: 'giveXp', amount: 300 }, { op: 'giveShells', amount: 150 }, { op: 'giveTp', amount: 1 },
    { op: 'unlockForm', form: 'ember' }, { op: 'unlockTech', tech: 'nova_ring', slot: 0 },
    { op: 'startQuest', quest: 'mq3' }, { op: 'startQuest', quest: 'mq4' }, { op: 'startQuest', quest: 'mq5' }, { op: 'startQuest', quest: 'mq6' },
    { op: 'openScreen', screen: 'map' },
  ],
};
```

### 5.7 NPC (`npc`), dialogue (`dialogue`), object (`object`), race course (`course`): rpg
```js
/** @typedef {{ id:string, specId:string, home:{ settlement:string, spot:string } | { x:number, z:number, yaw:number },
 *   shop?:string, idleDialogue:string, face?:'neutral'|'happy'|'angry', voicePitch:number }} NpcDef      specId ref: actorSpec; shop ref: shop */
export const DOV = { id: 'dov', specId: 'npc_dov', home: { settlement: 'sparkstead', spot: 'stall' }, shop: 'dov_stall', idleDialogue: 'dov_idle', voicePitch: 420 };

/** @typedef {{ id:string, start:string, nodes:Object<string, { speaker:string /* npc id | 'tavi' | 'system' */, text:string /* i18n key */,
 *   face?:string, next?:string|null, choices?:Array<{ text:string, next:string|null, actions?:Action[], if?:{ flag?:string, quest?:string, state?:string } }>,
 *   actions?:Action[] }> }} DialogueDef       next: null ends the dialogue */
export const DOV_IDLE = {
  id: 'dov_idle', start: 'n1',
  nodes: {
    n1: { speaker: 'dov', text: 'dov.idle.greet', choices: [
      { text: 'dov.idle.shop', next: null, actions: [{ op: 'openScreen', screen: 'shop', params: { shopId: 'dov_stall' } }] },
      { text: 'dov.idle.bye', next: null } ] },
  },
};

/** @typedef {{ id:string, prop:string /* env prop kind */, x:number, z:number, yOffset?:number, yaw?:number,
 *   hpMult?:number /* x HP(regionLevel): makes it a damageable entity */, promptKey?:string, targetTag?:string /* copied to ent.questTag */, quest?:string /* only present while this quest is active */ }} ObjectDef */
export const TRAINING_POST = { id: 'training_post', prop: 'trainingPost', x: -1645, z: 1852, hpMult: 0.5, targetTag: 'post', quest: 'mq1' };

/** @typedef {{ id:string, start:{ x:number, z:number }, gates:Array<{ x:number, z:number, alt:number /* metres above ground */ }>,
 *   medals:{ bronze:number, silver:number, gold:number } /* seconds */, goldReward?:string /* item id */ }} CourseDef */
export const WINDMILL_RUN = { id: 'windmill_run', start: { x: -1200, z: 1250 },
  gates: [ { x: -1160, z: 1210, alt: 20 }, { x: -1080, z: 1150, alt: 35 } /* ... 14 gates */ ],
  medals: { bronze: 75, silver: 55, gold: 42 }, goldReward: 'ember_charm' };
```

### 5.8 Region (`region`), landmark (`landmark`), POI: world
```js
/** @typedef {{ id:string, cx:number, cz:number, radius?:number /* only 'spire' */, levels:[number, number], biome:string /* palette key */,
 *   height:{ base:number, amp:number, ridge:number, terrace:number }, snowLine?:number, chestTable:string, musicKey:'warm'|'cold' /* music palette */,
 *   content:boolean /* false = terrain, palette and scatter only: no POIs, camps or spawns (the Stormwell in P0) */ }} RegionDef */
export const MEADOWS = { id: 'meadows', cx: -1300, cz: 1400, levels: [1, 6], biome: 'meadows',
  height: { base: 30, amp: 45, ridge: 0.15, terrace: 0 }, chestTable: 'chest_t1', musicKey: 'warm', content: true };

/** @typedef {{ id:string, x:number, z:number, y?:number /* resolved after the bake */, type:'settlement'|'arena'|'siphon'|'landmark'|'training'|'spire',
 *   stamp:null|{ kind:'flatten'|'basin'|'plateau'|'spire'|'arch', radius:number, height?:number, falloff?:number },
 *   beacon?:number /* colour of a light pillar */, tag:'P0'|'P1' }} LandmarkDef */
export const SPARKSTEAD = { id: 'sparkstead', x: -1430, z: 1580, type: 'settlement', stamp: { kind: 'flatten', radius: 110, falloff: 60 }, tag: 'P0' };

/** @typedef {{ id:string, type:'ringstone'|'shrine'|'camp'|'chest'|'siphon'|'race'|'crownChest', x:number, y:number, z:number, regionId:string, data:object }} Poi
 *  data: camp { tier:1|2|3, level:number }, chest { table:string }, siphon { landmarkId:string }, race { courseId:string }, ringstone { landmarkId:string } */
export const POI_EXAMPLE = { id: 'camp_meadows_3', type: 'camp', x: -820, y: 41.5, z: 1930, regionId: 'meadows', data: { tier: 1, level: 4 } };
```
POI ids are stable for a given world seed: authored ones use the GDD ids (`ringstone_sparkstead`, `shrine_01`..`shrine_10`, `siphon_1`..`siphon_5`), seeded ones are `<type>_<region>_<n>`.

### 5.9 Group (`group`) and spawn table (`spawnTable`): ai
```js
/** @typedef {{ id:string, members:Array<{ enemy:string, count:number, levelOffset?:number }> }} GroupDef */
export const MQ2_RAID = { id: 'mq2_raid', members: [{ enemy: 'choir_acolyte', count: 3 }, { enemy: 'choir_caster', count: 1 }] };

/** @typedef {{ id:string /* region id */, density:number /* target hostiles within 300 m */, night?:number /* density multiplier */,
 *   entries:Array<{ enemy:string, weight:number, group:[number, number], minLevel?:number, maxLevel?:number }>,
 *   camps:Array<{ tier:1|2|3, group:string }> }} SpawnTableDef */
export const SPAWN_MEADOWS = { id: 'meadows', density: 5,
  entries: [ { enemy: 'ember_wisp', weight: 4, group: [3, 5] }, { enemy: 'tusk_boar', weight: 3, group: [1, 2] }, { enemy: 'choir_acolyte', weight: 2, group: [2, 3] } ],
  camps: [ { tier: 1, group: 'camp_choir_small' } ] };
```

### 5.10 Shop (`shop`) and loot table (`lootTable`): rpg
```js
/** @typedef {{ id:string, level:number, priceMult?:number, stock:string[] /* item ids */ }} ShopDef */
export const DOV_STALL = { id: 'dov_stall', level: 3, stock: ['sunfruit', 'ora_draught', 'apprentice_garb', 'meadow_garb', 'sunfruit_charm'] };

/** @typedef {{ id:string, shells:{ chance:number, mult:number } | { min:number, max:number }, consumable:number /* chance */,
 *   gear:{ chance:number, weights:{ common:number, fine:number, rare:number } } }} LootTableDef */
export const LOOT_GRUNT = { id: 'grunt', shells: { chance: 1, mult: 1 }, consumable: 0.08, gear: { chance: 0.03, weights: { common: 70, fine: 27, rare: 3 } } };
```

### 5.11 Actor spec (`actorSpec`) and clip (`clip`): actors
```js
/** @typedef {{ id:string, rig:'humanoid'|'quadruped'|'flyer'|'blob'|'giant', scale:number,
 *   build:{ height:number, shoulder:number, bulk:number, head:number },
 *   palette:Object<string, number>,                 // slot name -> colour; at most 16 slots; slot names used by gear: 'coat', 'coatLining', 'wraps', 'sash'
 *   emissive?:Object<string, number>,               // slot name -> intensity
 *   parts:Array<{ bone:string, shape:'sphere'|'capsule'|'box'|'cone'|'cylinder'|'torus'|'lathe'|'tuft'|'blade',
 *                 size:number[], pos?:number[], rot?:number[], slot:string, lod1?:boolean, glossy?:boolean }>,
 *   chains?:Array<{ bones:string[], stiffness:number, damping:number }>,             // spring bones (sash, tail, ribbons)
 *   forms?:Object<string, { palette?:object, emissive?:object, partsAdd?:object[], scale?:number }>,
 *   clips?:Object<string, string>,                  // standard clip id -> clip def id override
 *   radius:number, outline:boolean, face:boolean }} ActorSpec */
export const SPEC_CHOIR_ACOLYTE = {
  id: 'choir_acolyte', rig: 'humanoid', scale: 1.0, build: { height: 1.8, shoulder: 0.46, bulk: 0.55, head: 1.0 },
  palette: { robe: 0x8a8590, under: 0x2b2730, veil: 0x1b1626, glass: 0x7b3cff, iron: 0x4a4650 }, emissive: { glass: 1.5 },
  parts: [
    { bone: 'head', shape: 'sphere', size: [0.22, 0.25, 0.23], slot: 'veil' },
    { bone: 'head', shape: 'cone', size: [0.30, 0.34], pos: [0, 0.10, -0.03], slot: 'robe' },                 // hood
    { bone: 'chest', shape: 'box', size: [0.46, 0.34, 0.26], slot: 'robe' },
    { bone: 'chest', shape: 'capsule', size: [0.05, 0.12], pos: [0, 0.02, 0.15], slot: 'glass', glossy: true },   // siphon vial
    { bone: 'hips', shape: 'cone', size: [0.34, 0.80], pos: [0, -0.35, 0], slot: 'robe' },                    // skirt
    { bone: 'armL', shape: 'capsule', size: [0.07, 0.26], slot: 'robe' }, { bone: 'foreL', shape: 'capsule', size: [0.06, 0.24], slot: 'under' },
    { bone: 'armR', shape: 'capsule', size: [0.07, 0.26], slot: 'robe' }, { bone: 'foreR', shape: 'capsule', size: [0.06, 0.24], slot: 'under' },
    { bone: 'handR', shape: 'cylinder', size: [0.03, 0.60], pos: [0, 0, 0.25], slot: 'iron', lod1: false },   // baton
    { bone: 'shinL', shape: 'capsule', size: [0.07, 0.36], slot: 'under' }, { bone: 'shinR', shape: 'capsule', size: [0.07, 0.36], slot: 'under' },
  ],
  radius: 0.45, outline: true, face: false,
};

/** @typedef {{ id:string, rig:string, seconds:number, loop:boolean, layer:'full'|'upper',
 *   keys:Array<{ t:number, pose:string /* pose id in the package's pose library */, ease?:'linear'|'in'|'out'|'inOut'|'back' }>,
 *   root?:Array<[number, number]> /* [t, forward metres]: visual lean only, never moves the entity */ }} ClipDef */
export const CLIP_ATTACK1 = { id: 'humanoid.attack1', rig: 'humanoid', seconds: 0.28, loop: false, layer: 'full',
  keys: [ { t: 0, pose: 'guard' }, { t: 0.06, pose: 'jab_wind', ease: 'out' }, { t: 0.12, pose: 'jab_hit', ease: 'back' }, { t: 0.28, pose: 'guard', ease: 'inOut' } ] };
```
Humanoid bones (fixed names, at most 28): `root, hips, spine, chest, neck, head, browL, browR, jaw, shoulderL, armL, foreL, handL, shoulderR, armR, foreR, handR, thighL, shinL, footL, thighR, shinR, footR, tail1, sash1, sash2, sash3, extra1`. Required spec ids: `hero_a`, `hero_b`, `npc_sela`, `npc_kerrin`, `npc_dov`, `npc_mira`, `npc_bren`, `npc_yael`, `npc_noa`, `npc_talia`, `npc_eli`, `npc_oren`, `npc_ilan`, `npc_rina`, `npc_gal` (the villager rig plus one prop part each: herb basket, ledger, pack frame, flour sack, shepherd's crook, kite on the back), `npc_villager_1`..`npc_villager_6`, `ember_wisp`, `tusk_boar`, `bramble_boar`, `choir_acolyte`, `choir_caster`, `scuttlecrab`, `rust_golem`, `frost_harrier`, `choir_vanguard`, `durn`, `bramblehorn`, `gorrumaw`, `iskra`, `vorrhal`. This list equals `IDS.actorSpec`. The hero specs' `forms` block has exactly the keys `ember`, `tempest`, `zenith` and follows ART_UX 2.3 (seams, ribbon, vanes, blades; hair, skin and body colours never change). The `beam_charge` and `beam_loop` clips are the one-arm ring pose of Dawn Lance (GDD 5.4), never a two-hand cupped pose.

### 5.12 Palette (`src/core/palette.js`, foundation, final)
```js
export const PALETTE = {
  ink: 0x1b1626, paper: 0xf3ebdd, hostile: 0x7b3cff, ora: 0x7ff2e0, oraCore: 0xffffff,
  ember: 0xffb070, tempest: 0x8fa8ff, zenith: 0xf4f1ff, kerrin: 0x6cff9a,
  telegraph: { white: 0xffffff, red: 0xff3b3b, violet: 0xb06cff },
  rarity: { common: 0xf3ebdd, fine: 0x7fd18b, rare: 0x5fb6ff },
  ocean: { deep: 0x1c4e6e, shallow: 0x3fa3a8, foam: 0xf4f1e6 },
  path: 0xc2a178, snow: 0xf4f7fa, scorch: 0x2e2530, scorchRim: 0xff9a4a, corruption: 0x3a3344,
  biome: { meadows: { ground: 0x9dbf5a, shade: 0x4e7a4a, cliff: 0xc9a77c, foliage: 0x6fa347, accent: 0xe8c547, fog: 0xbfd8e6 }, /* coast, thornwood, rustdune, frostspine, stormwell, spire: ART_UX 1.3 */ },
  day: [ /* five keys of ART_UX 1.4: { hour, sun, intensity, ambSky, ambGround, fogTint, shadowTint } */ ],
  structure: { clay: 0xede3d0, terracotta: 0xb4644a, copper: 0x5e9e8a, curtain: 0x1f5c63, lantern: 0xffb65c, ringstone: 0x7fe3d4 },
};
```

### 5.13 Settlement (`settlement`): env
```js
/** @typedef {{ id:string /* landmark id */, style:'village'|'town'|'outpost'|'mountain'|'monastery'|'camp'|'beacon'|'ledge',
 *   buildings:Array<{ kind:'house_s'|'house_m'|'house_l'|'windmill'|'well'|'kiteTower'|'stall'|'jetty'|'mast'|'cloister'|'tent'|'kitePole'|'lantern'|'beacon',
 *                     dx:number, dz:number, yaw:number }>,
 *   spots:Array<{ id:string, dx:number, dz:number, yaw:number }>, banner:[number, number] }} SettlementDef */
export const SETTLE_SPARKSTEAD = { id: 'sparkstead', style: 'village', banner: [0xe8c547, 0xc8463a],
  buildings: [ { kind: 'well', dx: 20, dz: -20, yaw: 0 }, { kind: 'windmill', dx: -60, dz: 30, yaw: 0.6 }, { kind: 'house_m', dx: 10, dz: 25, yaw: 3.1 },
               { kind: 'stall', dx: 28, dz: 4, yaw: 1.6 }, { kind: 'kitePole', dx: 0, dz: -45, yaw: 0 } /* ... 8 houses in total */ ],
  spots: [ { id: 'ringstone', dx: 0, dz: 0, yaw: 0 }, { id: 'stall', dx: 26, dz: 4, yaw: -1.6 }, { id: 'forge', dx: -22, dz: 12, yaw: 1.2 },
           { id: 'well', dx: 16, dz: -18, yaw: 2.4 }, { id: 'a', dx: 6, dz: 14, yaw: 0 }, { id: 'b', dx: -10, dz: -8, yaw: 1 }, { id: 'c', dx: 30, dz: -30, yaw: 4 } ] };
```

---

## 6. Debug and test API (`window.__GAME__`, foundation, final)

Present in every build. It calls only service APIs, so it works with stand-ins and with final packages.
```js
__GAME__ = {
  version: string, flags: object,
  ready: Promise<void>,                 // resolves after the bake, session start (test mode) and the first rendered frame
  isReady(): boolean,
  errors: string[],                     // every caught error, console.error and failed assertion; tests assert it is empty
  ctx: Ctx,                             // escape hatch for package scenarios

  // time
  step(n = 1): void,                    // n sim ticks synchronously, then one render
  render(): void,
  screenshotReady(): Promise<void>,     // resolves two animation frames after a render
  tick(): number, simTime(): number,
  pause(): void, resume(): void, setTimeScale(s: number): void,

  // world and environment
  heightAt(x, z): number, regionAt(x, z): string,
  teleport(x, z, opts?: { y?: number, alt?: number, fly?: boolean, yaw?: number }): void,     // alt = metres above ground; flushes chunk builds
  goto(landmarkId: string, opts?: { alt?: number }): void,
  setHour(h: number): void,
  crater(x, z, radius, depth?): void,
  landmarks(): Array<{ id, x, y, z }>, pois(type?: string): Poi[],

  // player
  player(): { id, x, y, z, yaw, hp, hpMax, ora, oraMax, surge, level, xp, resonance, formId, mode, state, targetId, shells },
  grantXp(n), setLevel(l), allocate(stat, n), heal(), god(on: boolean), setOra(n), setSurge(n),
  give(itemId, count?, level?), equip(itemId), shells(n),
  unlockTech(techId), setSlot(index, techId), unlockForm(formId), setForm(formId | null), unlockAll(),

  // actors
  spawn(enemyId, opts?: { x?, z?, dist?: number, alt?: number, level?: number, aggro?: boolean, passive?: boolean }): number,   // default: 8 m in front of the player; passive -> ai.spawn opts.passive
  startBoss(bossId): number, kill(entId), killAll(), actors(): Array<{ id, kind, defId, x, y, z, hp, hpMax, state, level, questTag }>,
  damage(entId, amount, opts?: { kind?: 'true'|'melee'|'ora', sourceId?: number }): object,   // amount > 1: absolute HP; amount <= 1: fraction of hpMax. Goes through combat.damage
                                                                                               // (default kind 'true', source = the player) and returns its DamageResult. Drives boss phases
  ai(on: boolean), ambient(on: boolean),

  // input and actions
  press(action, ticks = 1), hold(action, on), move(x, y), look(dxDeg, dyDeg), clearInput(),
  use(techId, opts?: { targetId?, charge? }): boolean, lock(entId | 0),
  setCamera(opts: { yaw?, pitch?, dist? }),

  // quests, ui, save
  startQuest(id), completeStep(id), questState(id): string, setFlag(k, v),
  open(screenId, params?), closeAll(), top(): string, setLang(lang), setDevice(device: 'kbm'|'touch'|'pad'), setTier(tier),
  save(), load(slot), state(): object,           // store snapshot
  exportCode(): Promise<string>, importCode(text): Promise<{ ok, reasonKey }>,

  // diagnostics
  stats(): { fps, frameMs, simMs, drawCalls, triangles, geometries, textures, programs, scale, tier, particles, actors, projectiles, voices, audioNodes },
  bench(): Promise<object>,                      // runs the benchmark script of 7.3 and resolves with its report (also started by ?bench=1)
  events(types?: string[]): Array<{ tick, type, payload }>,      // ring buffer of the last 500 events (payload copied), test mode only
  cmd: Object<string, Function>,                 // package commands added with ctx.debug.register
}
```
Determinism in test mode: fixed seeds, no wall clock in the sim, `step(n)` runs exactly n ticks, chunk builds are flushed on teleport, ambient spawning is off until `ambient(true)`, the tutorial is off, and the `tutorial=0` shortcut of 4.11 applies: the player starts at the Sparkstead Ringstone at level 1 with 0 XP, `awakened = true`, flight and Gather unlocked, MQ1 done and MQ2 active. Nothing pauses the sim on its own: a level-up is a banner, not a screen, so XP-granting scenarios never stall. `step(n)` runs ticks only while no pause reason other than `'debug'` is set; a scenario that opens a screen with `open(...)` must close it (or drive it with ui actions) before stepping, and `step` records an error in `__GAME__.errors` if it is called while a menu pause is active, so a stalled scenario fails loudly.
Screenshots under SwiftShader: viewports 640 x 360 (landscape) and 400 x 800 (portrait), `quality=low&res=0.5`. Expect 3-15 fps; scenarios must drive time with `step(n)` and never wait on real time.

---

## 7. Performance budgets and coding conventions

### 7.1 Quality tiers (`render.caps`)
| Setting | low (phone default) | high (desktop) |
|---------|---------------------|----------------|
| Target fps | 30 | 60 |
| Max device pixel ratio | 1.0 | 2.0 |
| Dynamic resolution | scale 0.6-1.0, steps of 0.1, at most one change per 3 s (canvas resize) | scale 0.8-1.0, steps of 0.05 on the render target (no resize) |
| Draw calls per frame | <= 120 | <= 350 |
| Triangles per frame | <= 250k | <= 1.2M |
| Terrain LOD0 / LOD1 / LOD2 range (3D distance from the camera) | 256 / 512 / 1152 m | 512 / 1024 / 1792 m |
| Chunk builds per frame | 1 | 3 |
| Trees / rocks / grass radius (3D distance from the camera) | 400 / 300 / 0 m | 900 / 700 / 70 m |
| Tree / rock instances drawn at once (nearest first) | 1,200 (40 triangles each) / 600 | 4,000 / 2,000 |
| Shader programs (constant after warm-up) | <= 24 | <= 32 |
| Canvas antialias | on (MSAA, direct to canvas) | on |
| SFX variants pre-rendered | 2 | 3 |
| Vegetation draw calls | 12 | 30 |
| Shadows | blob only | 2048, 90 m, near trees |
| Bloom and post | none; direct to canvas; glow sprites | quarter-res bloom 4 levels, vignette, grain, FXAA |
| Outlines | player, target, 6 nearest | characters 100 m, props 40 m |
| Cloud layers / water waves | 1 / flat | 2 / vertex waves |
| Live particles | 800 | 3,500 |
| Point lights | 0 | 2 |
| Active enemies / fully animated actors | 12 / 8 | 24 / 20 |
| Projectiles | 96 | 256 |
| Audio voices / reverb | 24 / delay | 32 / convolver |

Far content on every tier: the far island mesh (one draw call, about 33k triangles, vertex colours with the baked canopy tint and pattern of 4.1), the ocean, the Spire and the light pillars; camera far plane 9000 m.
Typical low-tier frame: terrain 26 + far mesh 1 + water 1 + sky 1 + Veilstorm 1 + vegetation 12 + settlement 6 + props 6 + actors 12 x up to 2 + blob shadows 1 + VFX 8 + projectiles 1 = about 90 draw calls. Low-tier triangle split: terrain <= 110k, far mesh 33k, trees <= 48k, rocks and props <= 20k, characters <= 20k, everything else <= 19k. The same budgets hold from the air: the `world-vista` scenarios assert draw calls <= 120 and triangles <= 250k at 60, 400 and 800 m altitude over a forest.

Other budgets: sim step <= 3 ms and frame JavaScript (without the sim) <= 10 ms on a mid-range phone; JS heap <= 160 MB; textures and render targets <= 48 MB on low; height grid 12.9 MB (3.2 MB with `grid=8`); bundle <= 1.6 MB minified; boot to title <= 8 s on the phone (Worker bake <= 4 s; the 8 m fallback bake <= 6 s); at most 120 live audio nodes. Shader programs: see the table. On low they are: toon x 3 geometry kinds, terrain, far mesh, water, sky, Veilstorm, unlit, 3 particle materials, outline x 2, aura, beam, decal, blob shadow, glow sprite, screen quad = 21. A program takes 50-300 ms to link on phone GPUs, so every one of them is linked in `render.compile()` and none may appear later.
Tier choice: `?quality` > saved setting > auto. Auto: touch devices use low; desktops start on high and drop to low by measurement. Dynamic resolution on low: every 3 s, if the average fps of that window is under target - 3 lower the scale by 0.1, if it is above target + 8 raise it by 0.1; never two changes within 3 s, never during a cinematic and not in the first 5 s after a teleport. On high: every 0.5 s in steps of 0.05 on the render target. At the minimum scale for 6 s on high: drop to low (once per session, with a toast).

### 7.2 Coding conventions (binding)
1. **No allocations in `step` or `frame` paths**: no `new`, no array or object literals, no closures, no `map / filter / forEach`, no spread, no string building per tick. Use `TMP` scratch objects, pools and preallocated `out` parameters. Typed arrays for particles and instance data.
2. **No per-frame closures or bound functions**; systems are objects with methods created once.
3. **Pooling**: projectiles, particles, decals, damage numbers, DOM toasts, debris, afterimages, audio voices.
4. **Entity shape is stable**: never add properties to entities, `ent.move`, `ent.stats` or `ent.combat` after creation; private state goes in `ent.brain`, `ent.visual` or `ent.data`.
5. **Determinism**: gameplay randomness only from `rng.sim`; no `Date.now`, `performance.now` or `Math.random` in sim code; iteration over entities is in id order.
6. **Services only**: never import another package; never reach into another package's private entity fields; content by id through `ctx.defs`.
7. **Events**: only catalog types; do not retain payloads; use `bus.post` when emitting inside an iteration over entities.
8. **Errors**: validate at boundaries, tolerate dead entity ids, never throw from listeners or systems in production paths; log once per distinct problem with `log.warn(tag, ...)`.
9. **DOM**: UI text only through `i18n.t`; logical CSS properties; class names prefixed by package (`ui-`, `ctl-`); no layout thrash in the frame phase (write `transform` and `opacity` only; batch text updates at 15 Hz or less); every edge-pinned element uses safe-area insets; `touch-action: none` and the rest of the gesture hygiene of ART_UX 6.1 on the game layers.
10. **Storage and platform**: `localStorage` only through `dom.safeStorage`; no `alert`, `confirm`, `prompt` or downloads; no network requests other than the single Google Fonts stylesheet and the font files it loads, and the game must render correctly if they fail; audio only after a gesture; pointer lock, fullscreen, vibration, the Gamepad API, the clipboard, `CompressionStream` and blob Workers are optional, wrapped in try/catch, and each has a working fallback; the page sizes with `height: 100%`.
11. **Shaders**: `precision highp float` with a `mediump`-safe design, no screen-space derivatives, no dynamic loops, at most 8 texture units, features as uniforms and never as `#define` permutations, no program created after `render.compile()`, all materials through `render.materials` or built with `render.glsl` chunks and `render.globals`.
12. **Naming**: files `camelCase.js`; ids and event names as in this document; constants `UPPER_SNAKE`; i18n keys lower dotted; system ids `<package>.<name>`.
13. **Disposal**: everything a package creates on `game:loaded` is destroyed on `game:ended`; GPU resources are disposed with their owner.
14. **Tests**: pure logic in `logic/` or `gen/` subdirectories with Node tests; every package ships scenarios that assert on `__GAME__` state and take screenshots. Cross-package ids are checked against `IDS` (3.8), never by importing another package.
15. **No cached services**: read `ctx.<slot>` at call time (3.3). Register systems and listeners with the package id as owner so they can be removed together.

### 7.3 Reference device and benchmark (the gate for "30 fps on a mid-range phone")
SwiftShader in CI can only check counts (draw calls, triangles, programs, particles, audio nodes). Frame time, fill rate and garbage collection are measured on hardware.
- **Reference device class**: a 2020-2022 mid-range Android phone with an Adreno 618-619 or Mali-G57 GPU and 4-6 GB RAM, running the game in Chrome or in an Android app webview, low tier.
- **`?bench=1`** (`src/core/bench.js`, foundation; real-time loop, only service APIs and input injection): after boot it starts a fresh journey with the `tutorial=0` shortcut and plays a fixed script: (1) 60 s of flight over Meadows and Thornwood, boosting to Sonic with Gather stops, at 60, 400 and 800 m altitude; (2) a 40 s fight at a Meadows camp against 12 spawned enemies using the Strike String, Flare Barrage, Ember Form, Nova Ring and Ringfall; (3) 20 s inside Sparkstead. It records every frame's duration and then shows a result panel as selectable text (also returned by `__GAME__.bench()`): p50 and p95 frame time per segment, the number of frames over 50 ms (the proxy for GC pauses and late shader links), the minimum and final dynamic-resolution scale, and the peaks of draw calls, triangles, particles, programs and audio nodes.
- **Exit criteria of the round-3 integration pass** on the reference device class: p95 frame time <= 40 ms and p50 <= 33 ms in every segment; fewer than 5 frames over 50 ms per minute after the first 10 s; program count constant after warm-up; the scale is not pinned at its minimum for more than 10 s.
- In CI the same script runs under SwiftShader with `step`-driven time, and only the count budgets and the absence of errors are asserted. The device run is done by the lead or by the player (the published build accepts `?bench=1` and the panel text can be copied out). If no reference-class device is available, the integration report must say "not verified on hardware" rather than assume a pass.

---

## 8. Work packages

Rules for every package: own only the listed paths; consume other packages only through `ctx` slots, `ctx.defs` and events; register through `index.js` (2.3); keep `npm run check` green; put every user-visible string in both languages; add no dependencies. Definition of Done always includes: (a) `npm run lint`, `npm test` and `npm run build` pass; (b) `npm run scenarios <id>` passes with `__GAME__.errors` empty; (c) screenshots written to `tools/out/shots/<id>-*.png` have been looked at by the engineer in both a 640 x 360 and, where UI is involved, a 400 x 800 viewport; (d) the low-tier budgets of 7.1 hold in the package's scenarios (`__GAME__.stats()` assertions).

### 8.0 `foundation`: skeleton, shared code, stand-ins
**Owns**: `game/package.json`, `game/.gitignore`, `game/README.md`, `game/src/main.js`, `game/src/core/**`, `game/src/game/**`, `game/src/standins/**`, `game/tools/*.mjs`, `game/tools/lib/**`, `game/tools/scenarios/foundation.mjs`, `game/tests/core/**`.
**Responsibilities**: everything in sections 2, 3, 4.8, 4.14-4.17, 5.12 and 6 as final code; build, serve, harness, smoke, scenario runner, lints; base CSS (including the gesture hygiene of ART_UX 6.1 on the `canvas`, `touch` and `hud` layers and the cancelled `contextmenu`), theme tokens, the fallback loading and fatal layers (3.1); session start and end; autosave policy; the journey code (`save.exportCode / importCode`); the id catalog `ids.js` (3.8); the input source registry with the `kbm` and basic `pad` sources; the flash-safe feel service; the benchmark runner `bench.js` (7.3); the event recorder; and a **minimal working stand-in for every replaceable slot**:
| Stand-in | Minimum behaviour behind the final API |
|----------|----------------------------------------|
| `world` | Analytic noise island in the full 7168 m square (no baked grid needed: `heightAt` evaluates 3 octaves directly), one 4 km plane mesh displaced near the player and rebuilt on teleport, flat palette colours by `regionAt`, water plane, authored landmark list with resolved y, `pois()` from the GDD lists (camps and chests on a seeded ring), `crater` lowers an in-memory list of bowls applied in `heightAt`, colliders in a simple array, raycast and sweep by marching |
| `env` | Clock that advances `store.state.world.hour`, a sun direction and the five-key palette written to `render.globals`, sky = clear colour, `spawnProp` = coloured primitive per kind with states as colour changes, settlements = one box per building, spots on a circle |
| `audio` | AudioContext unlock, five recipes (`hit_light`, `bolt_fire`, `ui_confirm`, `level_up`, `explosion_s`), every other id is a quiet blip; `setMusic` stores state |
| `render` | Renderer, scene, camera, layers, globals, a basic three-band toon shader for `toon` and `toonSkinned` (palette supported), `unlit`, tier table, fixed scale, `project`, `screenRay`, `stats`; outline, blob, light, flash and others are no-ops |
| `vfx` | `burst` = up to 200 pooled point sprites; `beam` = a stretched cylinder; `shockwave` = a scaling ring; aura = a transparent sphere; decals and afterimages are no-ops; projectile visuals as small spheres |
| `actors` | Capsule body with a sphere head and two arm boxes coloured from the spec palette (uses the spec's `build` and `radius`), bobbing idle, lean by velocity, `play` = a short squash, `socket` = offsets, `clipSeconds` = 0.3 |
| `move`, `cam` | Ground walk, jump, gravity, simple flight with boost stages, `knock` as ballistic motion that emits `actor:slam` when a hurtling entity reaches the ground at 14 m/s or more, `dashTo`, `impulse`, `lock`; terrain-only collision. Orbit follow camera with drag and auto-recentre, `shake`, `fovKick`, `play` (linear shot interpolation), lock framing by looking at the midpoint. Also a minimal touch source in `dom.layer('touch')` (floating stick plus Attack, Bolt, Jump, Dash buttons with `data-action`), disposed with the stand-in `cam`, so a phone can play the skeleton |
| `combat` | Generic technique runner good enough for `strike_string` (single hit), `breaker`, `ora_bolt` (projectile), `nova_ring`, `flicker_step`, `guard`, Gather and `setForm`; `damage` with the real formula, poise and death events; soft target = nearest hostile |
| `ai` | `spawn` with real stats, one brain (approach, attack with the first technique every 2 s), body removal, `startBoss` = spawn with boss events; no ambient spawning |
| `rpg`, `quests` | Level, XP, allocation, stats through `formulas`, Resonance, Shells, items add / remove / equip / use, technique unlock and slots, forms; quests with `talk`, `goto`, `kill` steps and actions `giveItem`, `giveXp`; dialogue as a linear list; interactables with focus; Ringstone at Sparkstead; one NPC; the `tutorial=0` shortcut on `game:newGame` and the hp / ora / surge save hooks of 4.11; quick-item input |
| `ui` | Loading bar, title with Continue / New Journey / language, HUD with HP, Ora, Surge, level, Resonance, target bar, toasts, interact prompt, a plain pause menu with stats, a dialogue box, death panel, Pause button, a level-up banner (never a screen) |
| content | A stand-in definition for **every** id of `IDS` in every defs kind, and the playable subset, exactly as specified in 3.8 |
**Definition of Done**: `npm run check` passes from a clean checkout; `dist/index.html`, `dist/artifact.html` and `dist/artifact-inline.html` exist and the bundle is under the size gate; unit tests cover loop and time (hit-stop, slow-mo, pause), event bus (unknown type throws, post order), store and save (round trip, migration, memory fallback when storage throws), defs validation, spatial queries, rng determinism, i18n (parameters, gender, plural, missing key), input (pressed for one tick, contexts, injection), formulas (all GDD targets); smoke scenario: boot under SwiftShader, `step(120)`, walk, take off, fire bolts, spawn `tusk_boar` and kill it, XP rises, level-up at the right XP, save and load equality, switch language to Hebrew (root `dir` is `rtl`), open and close the pause menu, portrait and landscape screenshots `foundation-*.png`; a second run with identical inputs yields an identical `state()` hash (determinism); removing any feature directory still boots (registry test); with zero feature packages `defs.validate()` passes and a test proves that every id of `IDS` has a stand-in definition in its kind; journey-code round trip (export, import into a fresh store, deep equality; both `K0` and `K1`; a damaged or newer-version code is rejected without throwing); `input.registerSource` with an existing id disposes the old source and a press is delivered once; `tests/core/balance.test.mjs` (4.17) passes; the benchmark script completes under SwiftShader with `step`-driven time and returns a report.

### 8.1 `world`: terrain, ocean, vegetation, colliders, craters, world data
**Owns**: `game/src/world/**`, `game/tools/scenarios/world.mjs`, `game/tests/world/**`.
**Responsibilities**: worldgen (island mask, seven regions by warped Voronoi, per-region height recipes, landmark stamps, paths, tint and flags layers) in a blob Worker with progress, and a time-sliced main-thread fallback at 8 m when the Worker is unavailable; the height grid and every query of 4.1; chunked LOD terrain with skirts, per-vertex colour and the terrain shader (built from `render.glsl`); far island mesh; ocean plane with toon water; Veilstorm wall; per-chunk seeded scatter of trees, rocks, pillars, reeds, crystals and grass as instanced meshes with wind, with tier radii; static collider grid; destructible rocks, pillars and trees (`damageProps`); craters (grid edit, chunk rebuild budget, colour scorch); the Wellspring Spire and Shattered Crown meshes and colliders; region, landmark and POI data (authored lists of the GDD plus seeded camps, chests and crown chests obeying the 500 m rule); region-enter events; parchment map canvas; the baked water-depth texture and its crater updates; canopy tint and pattern on the far mesh and LOD2; 3D LOD and scatter distances with instance caps; the Stormwell as a `content: false` region (terrain, palette, generic scatter, no POIs).
**Implements**: `ctx.world` (4.1); defs `region`, `landmark`; events `world:baked`, `world:crater`, `world:propDestroyed`, `world:regionEnter`.
**Consumes**: `render.layers`, `render.globals`, `render.glsl`, `render.materials`, `render.caps`, `quality:changed`.
**Depends on**: foundation.
**Definition of Done**: Node tests: bake determinism (hash of an 8 m bake for the default seed is stable across two runs), `heightAt` continuity across cell and chunk borders, coastline radius between 2700 and 3400 m in 64 directions, every flatten stamp has slope under 0.1 inside its radius, `regionAt` returns the right id at each region centre and `spire` at the origin, every land sample of the six content regions on a 250 m lattice lies within 500 m of a POI or landmark, the Stormwell has no POIs, the water-depth texture equals `waterDepthAt` at 20 sample points, tree and rock instance counts never exceed the tier caps, POI ids stable, `crater` lowers the grid only for radius >= 6 and restores nothing else, `sweepSphere` and `raycast` against terrain and a test collider, `findSpot` never returns water or steep ground. Scenarios: `world-regions` (teleport above each region centre at hour 10, screenshot each, assert draw calls <= 120 and triangles <= 250k), `world-vista-60`, `world-vista-400` and `world-vista-800` (over Thornwood at those altitudes looking at the Spire: screenshots, draw calls <= 120, triangles <= 250k, and the mean colour of the forest area differs from the meadow area, which proves the canopy tint), `world-worker-fallback` (Worker creation forced to fail: the game boots on an 8 m grid), `world-water` (shore screenshot with the foam band; a crater below sea level becomes water), `world-coast-edge` (ocean, Veilstorm), `world-crater` (crater radius 12: `heightAt` dropped by at least 2 m, screenshot), `world-props` (damage a rock: `world:propDestroyed` recorded, collider gone), `world-map` (map canvas has non-uniform pixels), bake time printed (target under 4 s on the phone, under 20 s in SwiftShader CI).

### 8.2 `env`: sky, day and night, settlements, gameplay props, audio
**Owns**: `game/src/env/**`, `game/src/audio/**`, `game/tools/scenarios/env.mjs`, `game/tests/env/**`.
**Responsibilities**: clock and five-key lighting written to `render.globals` (sun, moon, ambient, shadow tint, fog by region and time, wind); sky dome with painted clouds, sun, moon, stars and the Seam; structure kit and the nine settlements of 4.2 (among them the Tide Beacon lighthouse) placed at their landmarks on resolved ground (buildings merged per material, colliders, kite poles, lanterns that light at dusk, NPC spots); all prop kinds of 4.2 with states; light pillars; audio engine (graph, buses, unlock, offline pre-rendering of every one-shot and instrument sample, pooled buffer voices and stealing, the four live loops, spatialisation), every SFX recipe of ART_UX 9.2, the event-to-sound wiring including the step-surface mapping, the generative music system with three exploration palettes, combat and boss intensity, day density and stingers.
**Implements**: `ctx.env`, `ctx.audio` (4.2); defs `settlement`, `music`; event `env:hour`.
**Consumes**: `world` queries and `addCollider`, `render.layers / materials / globals / caps`, the event catalog (listen only), `save.settings` volumes.
**Depends on**: foundation (works on the stand-in terrain; positions always come from `world.landmark` and `world.groundAt`, never hard-coded heights).
**Definition of Done**: Node tests: day-key interpolation (hour 12 returns the Day key exactly; continuity at 24 -> 0), clock advance (24 real minutes per day at 60 Hz ticks), settlement spot resolution, music pattern generator determinism for a seed (same note list twice), voice-limit and stealing logic with a mock context, every id of `IDS.sfx` has a recipe, the step mapping covers all five surfaces, every id of `IDS.settlement` and `IDS.prop` is defined. Scenarios: `env-day-cycle` (screenshots at hours 6, 12, 18, 21, 0 from one spot), `env-sparkstead` and `env-haven-aster` (settlement screenshots; assert draw calls), `env-props` (spawn every prop kind in a row, cycle states, screenshot), `env-audio` (with audio enabled in the harness: unlock, trigger `combat:hit` and `rpg:levelUp` events, assert `audio.voices() > 0` and no errors; `setMusic` to combat and back), `env-audio-barrage` (audio enabled: a scripted 10 s Flare Barrage with hits and XP orbs keeps `audio.nodes()` at or under 120 and creates no oscillator for a one-shot).

### 8.3 `gfx`: renderer, materials, post, VFX
**Owns**: `game/src/render/**`, `game/src/vfx/**`, `game/tools/scenarios/gfx.mjs`, `game/tests/gfx/**`.
**Responsibilities**: renderer setup, tier detection and switching, dynamic resolution, resize and orientation handling, context loss restore, program warm-up; the toon material family and GLSL chunks (three bands, rim, shadow tint, fog with sun tint, wind, palette, dissolve, flash, ghost), unlit and additive materials; inverted-hull outlines with tier rules; blob shadows; shadow map on high; pooled point lights; post chain on high (bloom, vignette, grain, speed lines, flash, desaturate, FXAA) and the single-quad fallback on low with the MSAA canvas; the uniform-driven program set (at most 24 on low) and its parallel warm-up; the flash budget; `project` and `screenRay`; stats. VFX: instanced particle system with the three materials and canvas atlas, recipe table for every id of ART_UX 3.2, beams, trails, shockwaves, auras (four styles), decals conformed to terrain, afterimages, projectile visuals, telegraph visuals, XP orbs, pickup beams, glow-sprite fallback for bloom, all automatic effects of 4.4.
**Implements**: `ctx.render` (4.3), `ctx.vfx` (4.4); event `quality:changed`.
**Consumes**: `world.groundAt / heightAt` (decals, blobs), `actors.socket / snapshot`, entity positions, `save.settings`, the event catalog (listen only).
**Depends on**: foundation.
**Definition of Done**: Node tests: tier table completeness, dynamic-resolution controller (step response to a synthetic fps series), particle pool bookkeeping (emit, expire, cap, cull order), recipe table has every id of `IDS.vfx`, the flash-budget limiter (count and alpha in both modes). Scenarios: `gfx-materials` (a row of test meshes: toon, palette, glossy, emissive, outline at hours 12 and 0), `gfx-vfx-gallery` (trigger every recipe id on a grid, screenshot; assert particles <= 800 on low), `gfx-beam-aura` (beam between two points, four aura styles on stand-in actors), `gfx-telegraphs` (white, red, violet with ground shapes), `gfx-crater-decal`, `gfx-tiers` (low and high screenshots of the same view; program count <= 24 on low and <= 32 on high; then a 60 s scripted mix of every material option, recipe, Form, telegraph and screen effect, during which `stats().programs` must not grow after `render.compile()`; draw calls within budget), `gfx-flash-settings` (ten flash requests in one second: at most 3 are shown with alpha <= 0.4; photosensitivity mode: at most 2 with alpha <= 0.25), resize from 640 x 360 to 400 x 800 without errors.

### 8.4 `actors`: character construction and animation
**Owns**: `game/src/actors/**`, `game/tools/scenarios/actors.mjs`, `game/tests/actors/**`.
**Responsibilities**: the builder (parts -> one merged rigid-skinned geometry with `paletteIndex`, LOD1, geometry cache), rigs (humanoid, quadruped, flyer, blob, giant), spring-bone chains, geometric faces and expressions, palette and Form switching (seams, mantle, vanes, blades), outline and blob registration, the animator (pose library, procedural locomotion cycles blended from `ent.move` and `ent.vel`, clip playback with layers and blending, look-at, flinch, hit flash, dissolve, ghost), animation LOD and culling by tier, sockets, snapshots; every actor spec and clip listed in 4.5 and 5.11 following ART_UX section 2.
**Implements**: `ctx.actors` (4.5); defs `actorSpec`, `clip`; event `actor:step`.
**Consumes**: `render.materials.toonSkinned`, `render.outline`, `render.blob`, `render.layers.actors`, `render.caps`; listens to `combat:form`, `rpg:equip`, `actor:damaged`, `actor:staggered`, `actor:died`, `dialogue:line`.
**Depends on**: foundation.
**Definition of Done**: Node tests: every id of `IDS.actorSpec` exists, validates (bones exist for its rig, at most 16 palette slots, at most 28 bones) and stays inside its triangle budget (count computed from part shapes); every standard clip id resolves for each rig that must have it; clip sampling is continuous at loop points; pose blending of identical poses is the identity. Scenarios: `actors-lineup` (all specs in a row, front three-quarter, screenshot at 640 x 360 and a close-up of Tavi), `actors-forms` (Tavi in base, Ember, Tempest, Zenith: hair and body palette slots are identical in all four, only seams, sash, mantle parts and irises change), `actors-clips` (play each standard clip on `hero_a`, screenshot mid-clip for attack1, heavy, beam_loop, gather, fly_boost, guard), `actors-locomotion` (inject movement and flight with the stand-in mover; assert no NaN in bone matrices via a debug command), `actors-crowd` (12 acolytes at 30 m: draw calls <= 30 for them, frame JS time reported), one actor = one draw call plus at most one outline.

### 8.5 `control`: movement, camera, touch and gamepad
**Owns**: `game/src/control/**`, `game/tools/scenarios/control.mjs`, `game/tests/control/**`.
**Responsibilities**: the kinematic mover for all actors (4.6): ground, slopes, jump, air, flight, boost and sonic stage, swim, hurtle and slam detection, knock, dash, locks, separation, static collider resolution, ceiling and Veilstorm; the player intent system (camera-relative stick, jump and take-off, descend, sprint and boost from a `dash` hold of 0.2 s or more, the touch boost latch, camera-pitch flight, auto-land); the camera rig with every mode of ART_UX section 5, portrait and landscape framing, auto-recentre, lock framing, collision, shake, FOV kicks, punch, cinematic shots, dialogue framing; touch controls for both orientations (floating stick, action arc, Gather and Item on the left, the flight sub-layout, contextual buttons, camera drag, tap-to-lock forwarding to `combat.pickAtScreen`, left-handed option, safe areas, gesture hygiene, `data-action` on every control including `move` and `look`), registered as input source `touch`; the full gamepad mapping registered as source `pad` (rumble is P1); pointer-lock handling.
**Implements**: `ctx.move` (4.6), `ctx.cam` (4.7); input sources through `ctx.input`; events `actor:knocked`, `actor:slam`, `actor:landed`, `move:*`, `world:edge`, `cine:*`.
**Consumes**: `world` queries and colliders, `input`, `ents`, `spatial`, `render.project / screenRay`, `combat.target / pickAtScreen` and `combat:lock`, `rpg` state for contextual buttons (`rpg.forms()`, `rpg.slots()`, `rpg.hasTech('gather')`, `rpg.quickItem`, `rpg.count`), `combat:surge`, `i18n`, `save.settings`, `dom`.
**Depends on**: foundation.
**Definition of Done**: Node tests (mover logic in `src/control/logic/**` against a mock world): walk speed converges to `runSpeed`, jump apex matches gravity and jump speed, slopes above the limit slide, flight hover holds altitude, boost reaches stage 2 after 2 s and emits `move:boost`, a hurtling body hitting the ground at 20 m/s emits `actor:slam` and at 8 m/s does not, capsule push-out from sphere, capsule and box colliders, edge push-back, camera spring math, touch layout hit-testing for both orientations (no overlapping targets, all >= 48 px with gaps >= 8 px, inside safe areas at 844 x 390, 400 x 860 and 360 x 640, at most ten targets on the right side), player intent (a `dash` press shorter than 0.2 s never sets `sprint`; a hold sets it after 0.2 s; a double press latches it until the stick is neutral; with pitch flight, camera pitch maps to `intent.up`), `setBoostAllowed(false)` drops boost to cruise. Scenarios: `control-walk-fly` (walk, double jump, fly 300 m, boost to sonic, land; asserts on `player().mode` and position), `control-camera-modes` (screenshots: explore, flight, boost, lock on a spawned enemy, portrait framing), `control-touch-flight` (device touch, both orientations: using only synthetic stick input, one double tap on Dash and one camera drag, the player climbs 200 m while `ent.move.boost` is 2), `control-touch-landscape` and `control-touch-portrait` (device set to touch; screenshots; synthetic pointer events move the stick and press Attack; the player moves and an attack starts), `control-knock` (knock a spawned enemy into a hillside: slam event), `control-edge` (fly into the Veilstorm: turned back), `control-cinematic` (a three-shot path completes and is skippable).

### 8.6 `combat`: techniques, damage, Forms, targeting
**Owns**: `game/src/combat/**`, `game/tools/scenarios/combat.mjs`, `game/tests/combat/**`.
**Responsibilities**: the technique engine driven by data (timelines, chains, charge, motion, hit shapes, projectiles, beams, scripts, cancels, cooldowns, costs); damage application (guard, perfect guard, invulnerability, poise and stagger, crits, knock classes, kill and death events); the player action driver (GDD 5.1 and 5.4: Strike String with lunge, Breaker with launch and smash, Meteor Heel, Pursuit, Bolt auto-fire, Flare Barrage, Dawn Lance, Nova Ring, Ringfall script, Guard, Flicker Step on the `dash` press and perfect Flicker, Gather, boost cost and boost permission, regen suspension); world-versus-entity hit precedence; Forms (transform sequence, drains, Burnout, multipliers, scripted Zenith); Surge; soft and hard lock, cycling, tap picking; slam handling (damage, Surge, craters, prop damage); `inCombat` and threat; telegraph emission; player techniques, forms and tech nodes data with their strings.
**Implements**: `ctx.combat` (4.9); defs `technique` (player), `form`, `techNode`; all `combat:*`, `projectile:*`, `actor:damaged / healed / died / staggered`, `player:died` events.
**Consumes**: `formulas`, `input`, `move` (knock, impulse, dashTo, lock, face), `actors` (play, socket, setExpression, rimGlow), `vfx` (beam, aura, attach, shockwave), `world` (sweepSphere, crater, damageProps, groundAt), `rpg` (rank, mods, slots, forms, stats), `cam.play` for the ultimate and transform shots, `spatial`, `time`.
**Depends on**: foundation.
**Definition of Done**: Node tests (logic in `src/combat/logic/**`): damage pipeline cases (guard x0.2, perfect guard 0 and stagger, red ignores guard, invulnerable, crit multiplier, difficulty), poise break and refill timing, charge scaling, rank mod application for every P0 rank, cooldown reduction cap, Surge gains and decay, Form drain to Burnout and lockouts, technique data validation (every clip, fx and sfx id is in `IDS`; timelines positive; numbers equal `BALANCE.tech`), event order (`actor:damaged` before `combat:hit`, equal `amount`), Form multipliers applied exactly once (a hit in Ember is the base hit x 1.25), regen is 0 while boosting and in a Form, an entity standing inside a SOLID collider is hit by a bolt, one `dash` press fires one Flicker, Strike String time-to-kill target against `formulas.enemyStats` at levels 1, 10, 20, 30. Scenarios: `combat-string-launch` (kill a boar with the string; Breaker launches an acolyte: its y rises above 6 m; Pursuit follows; Meteor Heel produces `actor:slam` and a `world:crater`), `combat-smash-rock` (smash an enemy into a rock: prop destroyed, slam damage applied), `combat-bolt-beam` (bolts hit and cost Ora; charged Dawn Lance deals about 2.5x the uncharged total), `combat-nova-ultimate` (Nova knocks 4 enemies radially; Ringfall at full Surge leaves a deformed crater and kills level-equal grunts), `combat-guard-flicker` (scripted enemy attack: guard reduces, perfect guard staggers, Flicker avoids, perfect Flicker triggers slow motion), `combat-forms` (Ember: Resonance x1.5, Ora drains, Burnout at 0; Tempest and scripted Zenith), `combat-lock` (lock, cycle, break at distance), `combat-death` (player dies: `player:died`; `rpg.respawn` restores). Screenshots for each.

### 8.7 `ai`: enemies, spawning, bosses
**Owns**: `game/src/ai/**`, `game/tools/scenarios/ai.mjs`, `game/tests/ai/**`.
**Responsibilities**: brains (`melee`, `charger`, `ranged`, `diver`, `boss`) with perception, leash, strafing, flanking, ground-versus-flyer rules, flee and regroup; steering on the ground and in the air writing `ent.intent`; the attack-token director by difficulty; region ambient spawning, camps with clear detection (`camp:cleared`, `store.world.camps`) and the one-day refill rule, despawn, tier caps, settlement safety, Siphon-silenced regions, disengage-and-heal against a hovering player; enemy and boss technique data (all attacks of GDD 7.2 and 7.3 with telegraphs), enemy, boss, group and spawn-table data with strings; boss controller (arena, intro, phases, summons, reset, the pending-boss restart on re-entry and retry, flee); the five P0 bosses including scripted moves registered with `combat.registerScript`.
**Implements**: `ctx.ai` (4.10); defs `technique` (enemy), `enemy`, `boss`, `group`, `spawnTable`; events `actor:spawned / removed` (enemies), `boss:*`, `camp:cleared`.
**Consumes**: `combat` (useTechnique, canUse, telegraph, initActor, registerScript, damage for scripted hazards), `move` (initActor, intent, face, teleport), `actors.create`, `world` (regionAt, regionLevel, findSpot, lineOfSight, pois('camp'), landmark, groundAt), `env.isNight`, `env.day`, `store` (`world.camps`), `rpg.difficulty`, `quests.siphonsSilenced`, `quests.runActions` (phase `onEnter`), `combat.heal`, `cam.play` (boss intro), `spatial`, `formulas.enemyStats`, `rng.sim`.
**Depends on**: foundation, combat, control, world, actors (final versions wanted for verification).
**Definition of Done**: Node tests (logic in `src/ai/logic/**`): token director never exceeds the difficulty limits in a simulated crowd, spawn-table selection respects weights and level bands, level by region, brain state machines (melee: idle -> approach -> attack -> recover; ranged keeps its range band; diver cycle), boss phase selection by HP thresholds, every enemy and boss def validates and every technique id it lists exists with a telegraph, every id of `IDS` for the kinds ai owns is defined, body removal ignores entities ai did not spawn, the pending-boss state machine (start, reset, re-enter, retry, defeat). Scenarios: `ai-roster` (spawn each of the nine enemies passive in a row, screenshot), `ai-fight-<enemy>` for each brain type (enemy engages the idle player: a telegraph event precedes each attack and the player takes damage; on god mode for 20 s no more than the token limit attack at once), `ai-ground-vs-flyer` (player hovers 15 m up: ground enemies throw or disengage), `ai-ambient` (ambient on, fly 600 m through Meadows: population between 1 and the tier cap, none inside Sparkstead), `ai-camp` (clear a camp: `camp:cleared` recorded, `store.world.camps` set, no refill until a day has passed), `ai-boss-<id>` for the five bosses (start, intro event, drive HP down with `__GAME__.damage`: every phase event fires, the fight ends with `boss:end { defeated: true }`, screenshot per phase), `ai-boss-reset` (leave the arena: the boss despawns; re-enter: it restarts without the intro; `rpg.respawn({ retry: true })`: it restarts).

### 8.8 `rpg`: progression, items, quests, dialogue, world activities, content
**Owns**: `game/src/rpg/**`, `game/tools/scenarios/rpg.mjs`, `game/tests/rpg/**`.
**Responsibilities**: the progression service around the store (XP, levels, allocation, derived stats and Resonance with gear, passives and Forms, difficulty); technique nodes, ranks, slots; inventory, equipment, consumables, quick item; shops; loot rolls, pickups; flags; respawn with the boss-retry consumable refund; the `tutorial=0` shortcut; the hp / ora / surge save hooks; level-up without pause and the allocation styles; quick-item input. Quests engine (all P0 step types, parallel quests, tracking, markers, rewards, actions), dialogue runner, interactables and focus, NPC entities; Ringstones (save request, respawn point), shrines, chests, camp chests and bonus XP on `camp:cleared`, Siphon Spires (HP, core cycle, regen penalty zone, silencing), ring races, quest objects, discovery; all content data and bilingual strings: items, shops, loot tables, NPCs, dialogues (MQ1 and MQ2 lines exactly as in the GDD, the rest written in the same tone), quests MQ1-MQ7 and SQ1-SQ4, courses, objects; quest scripts for the tutorial (GDD section 2), the Ora Awakening, and the finale (the tether-carrying script `finale_tethers`, Zenith, ending).
**Implements**: `ctx.rpg` (4.11), `ctx.quests` (4.12); defs `item`, `shop`, `lootTable`, `quest`, `npc`, `dialogue`, `object`, `course`; all `rpg:*`, `pickup:*`, `quest:*`, `dialogue:*`, `interact:*`, `ringstone:*`, `shrine:*`, `chest:*`, `siphon:*`, `race:*`, `tutorial:prompt`, `player:respawned`, `world:poiDiscovered` events.
**Consumes**: `formulas`, `store`, `save.request`, `world` (pois, landmark, groundAt, regionAt), `env` (spawnProp, spot, setHour), `actors.create`, `move` (initActor, teleport), `combat` (initActor for objects, revive, setForm, setEnabled, heal, addOra), `move.setCanFly`, `ai` (spawnGroup, startBoss, setAmbient, clear), `vfx.beam` (tethers), `cam` (play, dialogue), events `camp:cleared`, `boss:start`, `ui` (open, fade, banner), `input` (interact), `i18n`.
**Depends on**: foundation.
**Definition of Done**: Node tests (logic in `src/rpg/logic/**`): multi-level-up XP grant, allocation and auto styles, stats with gear and passives equal hand-computed values, Resonance examples of GDD 4.4, TP accounting (55 available, 55 spendable), every modifier key of items, nodes and Forms is in `IDS.modKey`, a stat recompute never changes hp or ora, the boss-retry consumable refund, tagged kills counted through `questTag`, a `destroy` step completes on an object's `actor:died` and gives no XP, bonus XP for camps and Siphons, node prerequisites, inventory stacking and caps, equip swaps, item level scaling and prices, buy and sell, loot roll distribution over 10,000 seeded rolls within 2% of the table, quest engine for every step type with synthetic events, MQ7 unlock rule (four of five Siphons), dialogue traversal with choices and conditions, save round trip of a mid-game state, content validation (every id referenced by quests, shops, loot, NPCs and dialogues exists in the package's own data or in `IDS`; every id of `IDS` for the kinds rpg owns is defined; every string key exists in both languages; MQ1 and MQ2 lines match the GDD keys). Scenarios: `rpg-level-gear` (grant XP to level 5, allocate, equip Training Wraps: stats and Resonance change as computed), `rpg-shop` (buy Sunfruit from Dov: Shells drop, count rises; use it: HP rises), `rpg-ringstone-shrine-chest` (interact with each: store lists updated, events fired), `rpg-siphon` (damage outside the open window is reduced; destroy: `siphon:state destroyed`), `rpg-race` (fly the Windmill Run gates by teleporting through them: `race:end` with a medal), `rpg-mq1` (with `tutorial=1`: drive the tutorial script to completion with injected input and debug helpers; the flags, awakening and rewards are set), `rpg-mq2` (complete every step with debug kills; Ember Form and Nova Ring unlocked; four quests started), `rpg-main-path` (complete MQ3-MQ7 through `completeStep` and boss debug kills: ending script runs, credits flag set), `rpg-save-load` (save mid-quest, reload: identical quest state, hp, ora and surge), `rpg-newgame-shortcut` (a test-mode start matches section 6 exactly), `rpg-finale` (spawn a boss, then run `quests.runActions([{ op: 'script', script: 'finale_tethers' }])`: the boss is tagged scripted and invulnerable, one tether per silenced Siphon appears; carry each to the Spire: Ora refills, Zenith is set after the last and the tags are cleared). The trigger from Vorrhal's third phase is covered by `ai-boss-vorrhal` and by the integration pass.

### 8.9 `ui`: HUD, screens, onboarding
**Owns**: `game/src/ui/**`, `game/tools/scenarios/ui.mjs`, `game/tests/ui/**`.
**Responsibilities**: the UI identity of ART_UX section 7 as CSS on the theme tokens; screen manager with pause and input-context handling, focus navigation for keyboard and gamepad, tab bar; every P0 screen of ART_UX 7.2 (`loading`, `title`, `newgame`, `pause`, `character`, `techniques`, `inventory`, `quests`, `map`, `shop`, `dialogue`, `savecode`, `settings`, `controls`, `death`, `ending`, `fatal`); the title flyover; the HUD of ART_UX 6.6 for landscape, portrait and desktop (bars, medallion with Surge ring, Resonance with digit roll, XP line, compass with POI pips and quest diamond, target frame and boss bar, quest tracker, damage numbers pool, toasts, banners, off-screen attack arcs, interact pill, quick-item chip for keyboard and gamepad, Pause and Map buttons, save icon, the session-only warning, the level-up banner and medallion badge, target-frame swipe and tap, physical centring of compass, target frame, toasts and banners, HUD auto-fade, letterbox, fades); tutorial prompts with device glyphs and ghost highlights over the touch controls; hints; settings and accessibility options wired to `save.setSetting`; in-house SVG icon set; all UI strings in both languages; RTL correctness.
**Implements**: `ctx.ui` (4.13); events `ui:screen`, `settings:changed`.
**Consumes**: `rpg`, `quests`, `combat` (target, softTarget, cooldown, inCombat), `save`, `session`, `i18n`, `input` (ui actions, glyphs, context), `render.project`, `world.mapCanvas / toMap / pois / landmark`, `env.hour / setHour`, `cam.play` (title flyover), `combat.cycleTarget / setTarget`, `save.exportCode / importCode / memoryOnly`, `audio.play` (UI sounds), `defs` (names, icons), `dom`, the event catalog.
**Depends on**: foundation, rpg, combat, control (final versions wanted for verification).
**Definition of Done**: Node tests (logic in `src/ui/logic/**`): compass bearing and pip placement, digit-roll steps, damage-number pool reuse, focus-navigation graph for each screen has no dead ends, number formatting, every screen factory declares both-language strings. Scenarios (each at 640 x 360 and 400 x 800, in `lang=he` and `lang=en`): `ui-hud` (after damage and Ora use, with a locked target, a tracked quest and two toasts at once: screenshot; element boxes inside the safe area; **no two HUD rectangles intersect and none intersects a `data-action` rectangle**, also at 844 x 390 and 360 x 640), `ui-screens` (open each screen by id with representative state: screenshot; no horizontal overflow: `scrollWidth <= clientWidth` on the root; `dir` correct), `ui-flow-newgame` (title -> New Journey -> preset, address, difficulty -> game HUD visible), `ui-levelup` (grant XP: banner and badge appear, `top()` stays `hud` and the sim keeps stepping; with the Manual style the Character screen spends the points), `ui-savecode` (copy a code, start a new journey, restore the code: `state()` equals the original; with storage forced to fail the session-only warning is visible), `ui-inventory-equip` and `ui-techniques-learn` and `ui-shop-buy` (drive with injected ui actions and with synthetic taps; state changes verified through `__GAME__.state()`), `ui-dialogue` (line typing completes on confirm, choices work), `ui-map` (map shows the player arrow and discovered icons), `ui-death` (kill the player: death panel, Rise works), `ui-settings` (switch language at runtime: all visible text changes, no `[key]` placeholders anywhere in the DOM; text size 130% does not overflow), `ui-prompts` (emit `tutorial:prompt` for each action on each device: the right glyph shows), `ui-boss-bar`.

---

## 9. Build order

| Round | Packages (run concurrently) | Why |
|-------|-----------------------------|-----|
| 0 | `foundation` | Everything else builds on its final core and stand-ins |
| 1 | `world`, `env`, `gfx`, `actors`, `control`, `combat`, `rpg` | Each depends only on the foundation contract; stand-ins cover their cross-dependencies |
| 2 | `ai`, `ui` | `ai` verifies against the real combat, movement, world and characters; `ui` against the real RPG state, combat events and touch controls |
| 3 | Integration pass by the lead (no new package; fixes go to the owning package's files) | Run every scenario suite on the full build; scripted playthrough of the first ten minutes with `tutorial=1` on a touch viewport; main-path run MQ1-MQ7; low-tier budget audit in each region and in a 12-enemy fight; both languages; determinism run; artifact fragment check (no network requests other than the Google Fonts stylesheet and its font files, correct rendering when they are blocked, `height: 100%`, the storage failure path with the journey code, refused pointer lock, blocked Worker); the `?bench=1` run on the reference phone against the exit criteria of 7.3; balance tuning in `balance.js` |

Merge order inside a round does not matter (exclusive directories, generated registry). After each merge, `npm run check` must pass on the combined tree. Every round-1 package boots alone on top of the foundation: its data may reference any id of `IDS`, and `defs.validate()` passes because the foundation holds a stand-in definition for each of them (3.8).

---

## 10. Traceability: every P0 feature has an owner and an API

| GDD P0 feature | Package | API or data |
|----------------|---------|-------------|
| Seamless island, six content regions plus Stormwell terrain, landmarks, world edge, the island from the air | world | `ctx.world` 4.1, defs `region`, `landmark` |
| Day and night, sky, settlements, props | env | `ctx.env` 4.2, defs `settlement` |
| Art direction, tiers, performance, VFX bible | gfx | `ctx.render` 4.3, `ctx.vfx` 4.4, 7.1 |
| Characters, Forms' looks, animation | actors | `ctx.actors` 4.5, defs `actorSpec`, `clip` |
| Walking, flight, boost, sonic boost, swim, hurtle, slams | control | `ctx.move` 4.6, events `move:*`, `actor:slam` |
| Auto-camera, lock framing, cinematics | control | `ctx.cam` 4.7 |
| Touch (portrait, landscape), keyboard and mouse, gamepad | control + foundation | touch DOM and gamepad in control through `input.registerSource`, `ctx.input` 4.8 |
| Camera-pitch flight, boost latch, dash threshold | control | player intent rules of 4.6, ART_UX section 5 |
| Strike String, Breaker, Meteor Heel, Pursuit, Ora Bolt, Flare Barrage, Dawn Lance, Nova Ring, Ringfall, Guard, Flicker Step, Gather | combat | `ctx.combat` 4.9, defs `technique` 5.1 |
| Forms (Ember, Tempest, scripted Zenith), Burnout, Surge | combat | `combat.setForm`, defs `form` 5.2, `combat:form`, `combat:surge` |
| Soft and hard lock, telegraphs, poise, stagger, guard rules | combat | `combat.target / setTarget / cycleTarget / pickAtScreen / telegraph / damage` |
| Craters and destructible scenery | combat + world | `world.crater`, `world.damageProps`, `actor:slam` handling |
| Nine enemy definitions, token limits, ambient spawns, camps and camp clears | ai (+ rpg for the chest and bonus XP) | `ctx.ai` 4.10, defs `enemy`, `group`, `spawnTable`, `camp:cleared` |
| Five bosses with phases, reset and retry | ai (+ rpg for the retry refund) | `ai.startBoss`, the pending-boss rule of 4.10, defs `boss` 5.4, `boss:*` |
| Finale: carrying the tethers, Zenith | rpg (script `finale_tethers`) + ai (Vorrhal's phases) | `quests.registerScript`, `quests.runActions`, `combat.setForm` |
| Levels, XP, four stats, derived values, Resonance, level-up without pause, allocation styles | rpg + foundation (+ ui for the banner and badge) | `ctx.rpg` 4.11, `formulas` 4.17, `rpg:levelUp` |
| XP budget and damage balance asserts | foundation | `tests/core/balance.test.mjs`, `BALANCE.route`, `BALANCE.tech` |
| Technique Points, ranks, passives, loadout | rpg + combat | `rpg.nodes / learn / setSlot`, defs `techNode` |
| Items, equipment, consumables, shops, loot, Shells | rpg | `ctx.rpg` 4.11, defs `item`, `shop`, `lootTable` |
| Quick item | rpg (logic and input) + control (touch Item button) + ui (chip on keyboard and gamepad) | `rpg.useItem`, `rpg.quickItem`, actions `item`, `itemNext` |
| Quests MQ1-MQ7, SQ1-SQ4, dialogue, NPCs | rpg | `ctx.quests` 4.12, defs `quest`, `npc`, `dialogue` |
| First ten minutes, Ora Awakening, finale | rpg (scripts) + ui (prompts) | `quests.registerScript`, `tutorial:prompt`, `rpg.awaken` |
| Ringstones, shrines, chests, Siphons, ring races, discovery | rpg | `ctx.quests` 4.12, defs `object`, `course`, `world.pois` |
| Death, respawn, boss retry, difficulty | combat + rpg + ai + ui | `player:died`, `rpg.respawn`, `ai.resetBoss`, `rpg.setDifficulty`, screen `death` |
| One save slot, autosave, settings, memory fallback, journey code | foundation (+ ui for the `savecode` screen and the warning) | `ctx.save` 3.7 |
| HUD, all screens, title flyover, onboarding prompts, accessibility, flash budget | ui (+ gfx for the flash limiter) | `ctx.ui` 4.13, `render.flash` |
| Hebrew and English, RTL, gendered address | foundation + every package | `ctx.i18n` 4.14, per-package `strings.js` |
| Game feel (hit-stop, shake, FOV, slow motion, vibration) | foundation | `ctx.fx` 4.15, `FEEL` |
| SFX and adaptive music | env | `ctx.audio` 4.2 |
| Debug API, URL flags, headless tests, artifact build | foundation | section 6, 2.5, 2.6 |
| Id catalog and stand-in definitions for every id | foundation | `IDS` 3.8 |
| Performance gate on hardware | foundation (runner) + lead (device run) | `?bench=1`, 7.3 |

---

## 11. Amendments from the foundation build (binding; where this section differs from sections 1-10, this section wins)

The foundation is built and `npm run check` passes (lint, 268 unit tests, build, 13 smoke scenarios). The items below are the places where the real code differs from, or adds to, the text above. Read the ones for the services you use. When in doubt, the code in `src/core/**` is the truth: read the module.

### Core runtime (loop, time, systems, context, events, entities, spatial, rng, math, pool, input)

- 2.2 vs 3.9: math.js is on the must-not-import-three list, but 3.9 puts TMP (Vector3, Quaternion, Matrix4) in math.js. math.js does not import three; instead it exports TMP with null slots plus initTmp(three). ents.js imports three and calls initTmp when it loads, so TMP is filled in every context. Pure logic code must not use TMP.
- 3.4: a system with both step and frame whose phase is a plain string, like the 2.3 example `{ id:'world.stream', phase:'post', step, frame }`, cannot place both callbacks because sim and frame phase names never overlap. Rule chosen: if the string names a sim phase, the frame callback runs in the frame phase 'world'; if it names a frame phase, the step callback runs in the sim phase 'post'. The object form `{ step, frame }` sets both explicitly. Missing ids, duplicate ids, unknown phases and systems with no callback throw.
- 3.3/3.4: 'owner defaults to the installing package id' has no mechanism in the contract. Added ctx.owner and ctx.installAs(owner, fn); systems.add and bus.on default to ctx.owner, and systems fall back to 'core'. Also added ctx.runBootHooks() (await the onBoot hooks), ctx.providers (slot to owner), ctx.dev, and createContext(opts). provide removes 'standin:<slot>' systems and listeners only when a previous impl exists, and throws on an unknown slot.
- 3.3: createContext builds only the runtime services I own. store, save, defs, i18n, fx, debug, session, log, dom and flags are passed in or assigned once by boot.
- 3.5: spatial rebuilds the whole grid every tick in core.spatial instead of rehashing only moved entities. The behaviour is the same or better: queries also widen their search and test current positions, so movement within the tick and entities created since the rehash are found. Query results are sorted by id for determinism (querySegment is in id order, not sorted along the segment). Dead entities (alive false) never match. query matches on horizontal distance <= r + ent.radius.
- 3.5: ents.count(kind) and ents.list(kind) include entities destroyed this tick until cleanup (callers check alive), and caps count the same way. Entity objects are pooled and reused, though ids never are, so code must hold ids, not Entity references, across ticks. Unknown init fields are ignored with a one-time warning.
- 3.6: in strict mode the bus also warns once per type when a payload is missing a catalog field. Listeners that throw are disabled after 3 throws in 60 ticks, which is how 'wrapped like systems' was read. Added bus.flush, bus.onAny (for the event recorder) and bus.listenerCount. A flush delivers at most 10000 posted events.
- 3.2: added time.setBaseScale, isPaused, pausedExcept, reasons, beginStep and endStep, and loop.frame, running, alpha and stats. Frame passes use alpha = 1 when the accumulator is not fed (test mode without autoplay), so renders show the current tick, not the previous one.
- 4.8: added input.setDevice, input.padAvailable, the internal sample, endTick and poll methods, and an optional source argument on addLook (so test mode can ignore real devices). setAxis on lookX or lookY is treated as a delta in degrees, like addLook. Sign conventions: lookX positive turns right, lookY positive looks up. camSens and invertY are not applied by input; the camera must apply them. onPress receives every action in every context; context filtering applies only to down, pressed and heldTime (released is not filtered, so switching to 'ui' reports a released edge for held gameplay actions). Look values are not cleared in cleanup; they hold until the next sample.
- ART_UX 6.4 and 6.5 leave some actions unbound. Keyboard additions: G formNext, X itemNext, Enter (and numpad Enter) skip and uiConfirm, Esc pause and uiBack, Backspace uiBack, Q and E uiTabPrev and uiTabNext, WASD and arrows ui navigation, wheel lockNext and lockPrev. Pad additions: Menu and A also produce skip, LB and RB also uiTabPrev and uiTabNext.

### Core data and state (store, save, defs, ids, i18n, balance, formulas, feel, palette)

- GDD 4.1 / ARCH 4.17 (route): with the GDD's band xpMult values (0.85, 1.2) simulateRoute puts level 10 at minute 38 and level 20 at minute 105, outside the 40-50 and 110-130 targets. Following the GDD tuning rule (tune xpMult, keep the curve and the route), BALANCE.route band A xpMult is 0.70 and band B 1.10, giving level 10 at 44 min, level 20 at 116 min and level 30 when MQ7 starts. The route also needs a discovery XP value: I assumed a mean of 15 per discovery (about one landmark at 30 for every three minor POIs at 10).
- GDD 7.1 target 'a grunt dies to 1-2 Strike Strings': with Balanced allocation and Strike String rank 1 it holds only up to level 20 (2.3 strings at level 25, 3.6 at level 40). The test defines the typical build as rank 1 below level 20, rank 2 from level 20, and rank 3 plus Iron Fists I-III from level 30; with that it holds at every level 1-40 for both damage rolls. No balance numbers were changed. 'Survives 9-18 grunt hits' holds at every level using BALANCE.enemyScale.referenceHitPower = 1.0, the mean of the P0 grunt attack powers (0.98, asserted).
- ARCH 4.17 derivePlayerStats(base, level, mods, form): the signature has no gear-defense input, so gear defense is passed as base.def (GDD 4.3 gearDef). I also added an optional fifth argument extra = { awakened, gatherMult } (default awakened, no Gather) so stats.resonance can be exact.
- ARCH 4.17 enemyXp(enemyDef, level, playerLevel): added an optional fourth argument difficulty (default 'warrior') to apply the Master x1.2 XP of GDD 6.9. enemyShells already takes difficulty.
- ARCH 4.15 FEEL row shape: each row carries two extra fields, fovHold (boolean; held kicks for boostStart, sonicBoom and beamTick) and fovSettle (degrees; Sonic Boost peaks at +14 and settles to +10). FOV kicks the table gives no duration for use 0.25 s; the ultimate uses 0.6 s ('back over 600 ms'). vibrate is milliseconds or a pattern array; 0 means none.
- ARCH 3.7 ctx.save surface: implemented as createSave(options) with injected store, storage, bus, log, now, getPlayer, ringstonePos, regionAt, memoryOnly, autosave and compression. Extra members: runAfterLoad(state?) (session step 5 must call it), tick(dt) (must be called in the cleanup phase; this is where 'written at the end of the tick' happens), lastSlot(), dispose(), and pending. A slot holding a newer-version save is never overwritten, including by importCode, which returns reasonKey 'core.save.slotNewer'. Reason keys use the core.save.* namespace.
- ARCH 3.7 migration: SAVE_VERSION 1 is the first schema, so MIGRATIONS is empty. Migration from an older version is tested with an injected 1->2->3 table through migrateState(state, migrations, version). migrateState also fills fields missing from older shapes with defaults and rejects values without the core sections (meta, player, inv, quests, world).
- ARCH 5.7 DialogueDef speaker (npc id | 'tavi' | 'system'): defs.validate also accepts boss ids, enemy ids and 'villager', because GDD 8.5 lines are spoken by Captain Durn, an Acolyte and a Villager.
- ARCH 3.8/4.5: defs.validate checks technique anim clip ids against IDS.clip only for user 'player' techniques. 4.5 allows boss-specific clip ids in enemy and boss technique data.
- Values not stated in the GDD that I chose: - Enemies: locomotion run 7 m/s and fly 16 m/s (overridable per def through params.runSpeed and params.flySpeed), Ora 100, critChance 0. - Enemy attack windups inside the 0.5-1.2 s band. - Choir Vanguard string powers: 0.6, 0.6, 0.6, 0.9. - Strike String rank 2 sixth hit: poise 10, push 10. - Breaker charge expressed as min 0, max 1.0 s, maxMult 2.0 (1.2 to 2.4). - Talia's Herbs shop level: 10. - Durn's arena: sparkstead, radius 60. - Player poise: 0 (the player is never poise-staggered). - GDD 3.4 race reward numbers and medal times are stored in BALANCE.world.race.

### Stand-ins, tooling, debug API (final state after integration)

- 2.5 lib/harness.mjs: launch() also accepts `touch` (Playwright hasTouch context), and scenarios may set `touch: true`. The returned harness also has `reload()`, and scenario run() receives `harness` as well as { page, game, shot, assert }. These are additions.
- 2.5 lib/harness.mjs: any request to a host other than the page's origin, data:, blob:, about:, fonts.googleapis.com or fonts.gstatic.com is recorded as a '[network]' error, and any alert, confirm or prompt as a '[dialog]' error. External requests are still aborted. This addition enforces 7.2 rule 10.
- 2.5 serve.mjs: responses carry `Access-Control-Allow-Origin: *` so dist/index.html can load its module script inside a sandboxed, opaque-origin iframe. This is an addition.
- 2.5 smoke.mjs and 8.0: the smoke list is 13 scenarios in tools/scenarios/foundation.mjs. Extras beyond the 8.0 list: section 6 API coverage, touch controls, sandboxed iframe, and the in-page defs check.
- 4.8 and 2.6 test mode: real device sources (kbm, pad, touch) are ignored in test mode unless `autoplay=1` (src/core/input.js). So a scenario that drives the touch UI with pointer events must use `query: 'autoplay=1'` and pause with __GAME__.pause() to step deterministically. The document should state this rule.
- 6 __GAME__.bench(opts?): accepts `{ durationScale, panel }`. The report has `mode`, `aborted`, `segments[{ name, frames, ... }]`, `peaks`, `text`. The section 6 signature is bench() with no arguments.
- 3.3 ctx helpers not in the contract: `ctx.installAs(owner, fn)` (runs fn with `ctx.owner` set so that systems and bus listeners default to that owner), `ctx.owner`, `ctx.providers` (slot to ownerId of the current impl), `ctx.dev` (dev or test mode), and `ctx.runBootHooks()` (boot.js internal that runs the onBoot hooks).
- 3.2 ctx.time additions: `isPaused(reason)`, `pausedExcept(reason)`, `reasons()`, `setBaseScale(s)` (backs __GAME__.setTimeScale, clamped 0..4), and loop-internal `beginStep()`/`endStep()`. ctx.loop adds `stats` ({ fps, frameMs, simMs }).
- 3.5/3.7 save and ents additions used by session and debug: `save.runAfterLoad()` (session step 5), `save.write(reason)` (__GAME__.save) and `ents.flush()` (session.end). Feature packages should not rely on these unless the document adds them.
- 4.11 rpg.base(): carried over from the previous engineer. It returns the effective stats (allocation plus gear); the allocation alone is store.player.base.
- 4.12 raceStart/raceAbort: carried over. The stand-in runs no races; raceStart logs and returns false.
- 4.12 and 8.0 Ringstone (changed in this pass): the stand-in prop is drawn at POI + (4 m x, 10 m z), ahead of the player's start facing (+z), and the interactable (radius 4) is centred on the prop. The POI, quests.objects(), respawn and the tutorial=0 start position stay exactly on the POI. This is visual and interaction placement only; final packages should keep the start position from being inside the stone.
- 4.13 dialogue: carried over. Dialogue is a ui screen and pauses with reason 'menu'; the 'dialogue' pause reason is unused.
- 4.13 'loading' screen: carried over. It opens on the first game:boot and closes on game:ready, pausing with 'menu' during boot.
- 4.9 stand-in simplifications: carried over. No knock on TAG.BOSS. Motions leap, rise and dive are no-ops. A perfect flicker is detected when an invulnerable player is hit.
- 3.8 content: carried over. Sela's stand-in home is Sparkstead spot 'a', not her ledge. Stand-in boss phases reuse IDS enemy techniques. Durn has one phase (BALANCE phases [1.0]), so it emits no boss:phase; the API scenario uses bramblehorn to test phases.
- 3.8 IDS: the keys prop, clip, vfx, sfx, feel and modKey are asset or key catalogs with no defs kind. The 'every id has a stand-in definition' test (tests/core/standins.test.mjs and the foundation-defs scenario) covers the other 18 kinds. `dialogue` is a defs kind with no IDS list. The document should say which IDS keys are defs kinds.

### Rules for feature packages added by the lead

- **Install owner**: boot wraps each package install in `ctx.installAs(pkg.id, () => pkg.install(ctx))`, so systems and bus listeners you register default to your package id as owner.
- **Test mode and real devices**: in `test=1` without `autoplay=1`, real device sources (keyboard, mouse, pad, touch) are ignored; scenarios inject input with `__GAME__.press / hold / move / look`. A scenario that must drive real DOM pointer events uses `query: 'autoplay=1'` and `touch: true`.
- **Scenarios**: `node tools/scenarios.mjs <packageId>` runs `tools/scenarios/<packageId>.mjs`; `npm run smoke` runs the foundation list and must stay green with your package installed.
- **Stand-in strings** live in `src/standins/strings.js`; your package registers its own strings with `ctx.i18n.addStrings` and may reuse keys.
- **Start position**: the player must never start inside the Ringstone prop; keep the prop and its interactable a few metres from the POI point.

## 12. Amendments from the feature packages (binding; newer than section 11)

Each package reported where its code differs from, or adds to, the contract above. Read the entries for the services you call. The code is the truth.

### world

- LOD2 is drawn as 512 m super-chunks (2x2 chunks at 16 m, 32x32 cells) instead of 256 m chunks. This keeps the terrain at about 20-30 draw calls inside the low tier's 120. LOD0 and LOD1 are 256 m chunks as specified.
- A crater updates the water-depth texels in the CPU copy and then sets texture.needsUpdate, which re-uploads the whole 512x512 R16F texture (0.5 MB) rather than calling texSubImage2D. three 0.170 has no update-range API for textures.
- Skirts drop max(8 m, the LOD's vertex spacing) instead of exactly 8 m, so coarse LOD2 tiles in mountains do not show cracks.
- RegionDef.height values were retuned and the actual recipes are coded per region id: gorge, dunes and mesas, lagoons and sea stacks, ridged range, terraced plateau. The data shape is unchanged.
- Siphons 2-5 got 30 m flatten stamps. The GDD lists no stamp for them; the stamp seats the Siphon structure and its camp on flat ground.
- Destructible props are rocks and pillars only. Trees get SOLID capsule colliders and are not destructible. Pillars are also PLATFORM.
- Additions: world.info() and world.bakeMode for diagnostics, and the debug commands __GAME__.cmd.flushBuilds and __GAME__.cmd.worldInfo. The world-worker-fallback scenario forces the failure by replacing window.Worker with page.addInitScript and reloading, because there is no flag for it.
- Low-memory devices (navigator.deviceMemory <= 2) bake at 8 m on the main thread unless ?grid=4 is set. The task asks for a Worker bake at 4 m, and 4.1's 8 m path is only the main-thread fallback.

### gfx (render, vfx)

- Bloom extracts only values above 1.0 (soft knee) rather than the ART_UX threshold of 0.85. Non-emissive toon output is capped at 1.0, so only HDR emissive and additive Ora effects glow and lit paper never blooms ('Ora energy is the only thing that glows').
- Every material uses a CustomBlending that matches normal blending instead of NormalBlending. This keeps three from adding an 'opaque' program variant, so toggling `transparent` (ghosting) never links a new program after compile.
- When the tier changes, every scene material is disposed (only its GPU state is dropped; uniforms and textures stay) so the previous tier's programs are released and high stays within 32. Other than on a tier switch or context restore, no program is created after compile.
- Rim light is multiplied by (1 - n.y^2), as the stand-in did, so terrain and other upward-facing surfaces are not washed out. ART_UX 1.7's formula does not have this factor.
- Additions beyond the contract, all harmless: - `render.stats()` also returns `outlines` and `blobs`. - `render.screenFx()`, `vfx.preview()` and `vfx.debugState()` exist for tests. - Decal kinds 'shock' and 'glyph' are used internally. - Internal recipe ids 'debris' and 'trail' exist. - Debug commands `__GAME__.cmd.gfxTestRow`, `gfxGallery`, `gfxBeamAura`, `gfxTelegraphs`, `gfxVfxState` and others are registered.
- Flashes for feel classes (finisher, burst, ultimate, transform, bossDeath, craterBig, perfectGuard, levelUp) come only from `fx:impact`, so a recipe and its feel row never double-flash. Only explosion_l and siphon_break carry their own flash.
- The 'line' telegraph shape takes length = the event's radius and a half-width derived from the entity radius; 'cone' uses a default half-angle of 0.52 rad. The event payload has no width or angle field.

### control (move, cam, touch, gamepad)

- Camera-pitch flight: only the stick's forward component is scaled by cos(pitch); strafing (the stick's x) stays at full speed. 4.6 says the whole horizontal part is scaled; scaling strafe made sideways steering weak at steep pitch.
- The touch boost latch applies only when input.device is 'touch' (ART_UX 6.2 calls it a touch feature). With keyboard or pad, a double press of Dash does not latch.
- Auto-land: the flyer lands when within 1.2 m of the ground and either descending faster than 2 m/s without boost, or with intent.up < -0.5 (Descend held). The literal 'descending' trigger would land on the slight sink at the -6 degree rest pitch and while boosting along the terrain.
- Hurtle impacts below 14 m/s return the body to mode 'ground' with a 0.4 s lock. MoveState has no 'down' mode; the down state belongs to combat, which can react to actor:landed and actor:knocked.
- Camera framing heights are read as measured from the bottom of the screen and applied to the body centre: 55% in landscape, 62% in portrait. Only this reading keeps the player above the portrait control deck, which is the reason ART_UX gives. The stand-in read them from the top.
- Boost lag: the pivot follows on a spring with a 0.12 s time constant, but the lag is capped at 2 m. A literal 0.12 s lag at sonic speed (about 14 m) made the player a speck on screen.
- The touch root also carries the class 'sti-root' and pressed buttons also get 'sti-down', because the foundation smoke (foundation-touch) selects those stand-in class names. The package's own classes use the ctl- prefix.
- ctl-touch layout uses window.innerWidth/innerHeight, not the layer size, because the renderer resizes #app later in the same frame.
- Extra members and ids: move.spin(ent) (hurtle spin for visuals), and the camera system ids control.camLook (sim phase 'input', order 50) and control.camRig (frame phase 'camera'). The run system id is 'move.run' as in the 3.4 table.

### combat

- Commit attribution: common.md asks for 'Co-Authored-By: Claude Fable 5.2'. I used 'Claude Opus 5.5' and the session line from the harness attribution reminder, which takes precedence over script-computed task text.
- TechniqueDef extensions beyond 5.1, all optional: - `chainSteps`: Strike String has 6 authored chain steps, 5 in use at rank 1. The rank 2 mod `chainSteps: 6` adds the spin kick. - HitDef `edgePower`: Ringfall falloff. - HitDef `burn {power, every, seconds}`: Nova Ring rank 3 sets 'hits.0.burn.seconds'. - HitDef `juggle`. - ProjectileDef `count: 0` means disabled: the Flare Barrage rank 2 final bolt sets it to 1.
- Breaker rank 2 'guardBreak' is the path override 'hits.0.unblockable': 1. TechNodeDef rank nodes with a BALANCE mods block also carry it as `passive`: gather_r2 has both techId+rank and passive {gatherDmgTakenMult: 0.75}, so rpg applies it. 5.1 says a node is either a rank or a passive.
- Registered script functions are called as fn(ctx, ent, def, combatState, runtimeRecord). The fifth argument is an addition.
- Who-applies-what (4.9): a hit's feel class comes through combat:hit. Ringfall hits use 'heavyHit' per target, and the script calls fx.impact('ultimate') once at impact, so the 1 s ultimate slow motion is not restarted once per target.
- Perfect Flicker: besides 'a hit lands on the invulnerable player within the window', an enemy hit that fires within the window at the spot where the player started the Flicker also counts. Players dodge out of reach, so the invulnerability rule alone almost never triggers.
- The perfect-Flicker slow motion is left to core fx through combat:perfect; combat does not call time.slowMo itself, unlike the stand-in. On player death combat calls time.slowMo(0.3, BALANCE.death.slowSeconds).
- Juggle gravity (0.3) lasts the whole launch flight, about 3.3 s, which is under the 4 s maximum. Later light hits while airborne re-launch the target with a small upward velocity.
- Bosses are not launched or hurled: every knock on a boss becomes a short push at 25% speed. The stand-in skipped knocks on bosses entirely.
- Surge decay starts 12 s after leaving combat (GDD 5.6), not 12 s after the last gain as in the stand-in.
- Combat writes `store.state.player.surge` on each Surge change, so the save carries it. initActor reads it back.

### audio

- ARCHITECTURE 4.2 binding decision 1 says one-shots are pre-rendered with an OfflineAudioContext. They are rendered instead by plain-JS synthesis (logic/dsp.js) into Float32Arrays that are copied into AudioBuffers. This is deterministic, testable in Node, and the time slicing can be controlled. The rendering is still offline, time-sliced, and starts after unlock. Sample rates are 32 kHz, and 22.05 kHz for long, dark sounds, to cut render cost.
- Live loops: the contract lists four (wind, gather, beam, siphon). Following the task card, a fifth internal loop 'ambience' (an air bed driven by altitude) is added. It is not in IDS.sfx and costs 4 nodes.
- nodes() counts every AudioNode the engine has created and not released, including reusable voice gain and panner nodes and the bus graph (14 on low). The limit is enforced against that count: new voices steal, and music notes or loops are skipped rather than go over 120.
- voices() returns one-shot voices plus live loops plus sounding music notes.
- setVolume also accepts 'ui' (UI bus trim) besides master, music and sfx.
- The audio service has an extra debug() method, also registered as the 'audio' debug command.
- ART_UX's 25 ms timer scheduler is replaced by a 150 ms look-ahead run from the audio frame phase. Notes are created only when they enter the horizon.
- Distance lowpass is not per voice: positional voices beyond 70 m go through one shared far lowpass bus at 2.4 kHz, to stay inside the node budget. distanceCutoff() exists as a function in logic/voices.js but is not used for routing.
- audio.stinger('levelUp' | 'questComplete' | 'discover') also plays the matching SFX (level_up, quest_complete, discover) on top of the musical phrase. The wiring calls the stinger for those events instead of play().
- Footsteps and landings of other actors are skipped beyond 30 m and 60 m.

### rpg and quests

- MQ1 step 8 is a `reach` step on the flag `attuned.ringstone_sparkstead`, not `interact ringstone_sparkstead`. defs.validate checks a step's object against ObjectDefs, and Ringstones are POIs, not ObjectDefs. Using any Ringstone sets that flag.
- The `openScreen` action does nothing in test mode. The stand-in UI has no shop or map screen, and opening one would pause the scenario stepping. It works normally in real play.
- store.world.camps belongs to ai (it holds the day a camp was cleared). Camp chest state and clear counts are therefore kept in quest flags (`camp.<id>.chest` and `camp.<id>.clears`). Other flags: NPC moves are `npc.<id>.home`, and quest objects use `obj.<id>.used` and `obj.<id>.destroyed`.
- Extra members beyond the contract: rpg.setStyle(style); quests.dialogueState(), quests.npcEntity(npcId) and quests.talkTo(npcId). The script api also gets questId, resumed and say(dialogueId), and setObjective takes an optional third questId argument so a free-running script can replace a quest's objective. Debug commands added: rpgTalk, rpgAdvance, rpgDialogue, rpgObjects.
- Boss XP: the x6 multiplier from GDD 4.1 is applied in rpg, but only when the boss's enemy def does not already carry it.
- NPC homes follow GDD 11 rather than the stand-in data: Bren is at the Tide Beacon and Yael at Copperwatch (the stand-in had them swapped). Ilan, Rina and Gal stand at fixed coordinates.
- SQ4: rpg gives a rust_core directly on each Rust Golem kill while SQ4 is active, up to 3. No loot table gives quest items.
- Added steps not in the GDD: MQ4 unlocks Dawn Lance when step 1 completes (so step 2 can use it), and MQ6 unlocks Tempest Form when step 5 completes. MQ7 step 1 moves Sela and Kerrin to the Spire Approach.

### env (clock, lighting, sky, settlements, props)

- Haven Aster has no jetty. The harbour jetty looks for water within 320 m of its listed position and builds it at the shore it finds. Around Haven Aster there is no water within that range, so the jetty is skipped; the Tide Beacon gets its jetty.
- The env service has an extra read-only `info()` (diagnostics) and a `clockScale` getter. The debug command `envInfo` is added for scenarios.
- The ring gate is drawn as a torus of light in the prop's local XY plane, so a racer passes through it along the prop's forward direction (yaw). The stand-in turned it 90 degrees.
- When a trainingPost, saltPillar or crate goes to 'broken', its collider is removed, and it is added back if the state returns.

### actors (characters, animation)

- Per-part `glossy` is accepted in specs but not rendered: the toon material's uGlossy is one uniform per material and the shader cannot be changed from this package, so glass reads through emissive slots instead.
- LOD1 (about 40% triangles) is not built; only the LOD0 geometry exists. Animation LOD (full or every third frame by camera rank) is implemented.
- The Tempest mantle is opaque emissive ribbons, not translucent: one merged mesh has one blend state.
- Gorrumaw's phase-2 plate loss is not modelled: Forms can only add parts.
- Added fields beyond the 5.11 ActorSpec typedef: `hover` (Choir Caster and Vorrhal float) and per-part `seg` (segment count). The ctx.actors object also carries `releaseSnapshot` (used by vfx) and a `debug` member.
- spec.radius is treated as final world metres; it is not multiplied by spec.scale (bosses would otherwise get huge capsules).
- Sockets handR and handL map to the jaw or head on creature rigs.
