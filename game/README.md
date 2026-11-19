# KETHRA: Veins of Light

An original open-world 3D action RPG for the browser: Three.js on WebGL2, mobile-first (the main target is an
Android phone), in Hebrew and English. Everything lives in this `game/` folder. The design documents are in `docs/`:
`GDD.md` (what the game is), `ART_UX.md` (look, feel, sound) and `ARCHITECTURE.md` (the engineering contract;
section 11 lists where the real code differs from the text above it).

## Requirements

- Node 22.
- `npm install` (dependencies are pinned: `three` 0.170.0, `esbuild` 0.24.2).
- Headless tests use Playwright 1.63.0 from the machine's global install (`/opt/node-tools/node_modules/playwright`,
  browsers in `/opt/pw-browsers`). It is not a project dependency, and the project never installs or downloads it.

## Structure

```
game/
  src/
    main.js            entry: flags, error traps, #app, theme, loading layer, then boot
    core/              foundation, final shared code (loop, time, systems, context, events, store, save, defs,
                       entities, spatial, rng, math, pool, i18n, input, actions, balance, formulas, feel, fx,
                       palette, ids, theme, dom, errors, debug, bench, bootclock)
    game/              boot.js (boot sequence and loading layer), game.js (installs and runtime glue),
                       session.js (journey start and end), registry.gen.js (generated, gitignored)
    standins/          stand-in services behind the final APIs; with every package present only residual.js
                       (the music definitions no package registers) is bundled and installed
    render/ vfx/       gfx package: renderer, tiers, toon materials, outlines, post; particles, beams, decals
    world/             world package: baked height grid (blob Worker), terrain, water, vegetation, POIs
    env/ audio/        env package: clock, sky, settlements, props; WebAudio SFX and music
    actors/            actors package: character meshes and procedural animation
    control/           control package: movement, camera, touch, gamepad, pointer
    combat/            combat package: techniques, damage, Forms, targeting, projectiles
    ai/                ai package: enemies, spawning, bosses
    rpg/               rpg package: progression, inventory, shops, loot, quests, dialogue, interactables
    ui/                ui package: HUD and every screen
  tools/               build, server, registry generator, lints, harness (lib/), smoke and scenario runners,
                       scenarios/<id>.mjs; out/ (gitignored) holds shots/ and logs/
  tests/<id>/          Node unit tests (core/ is the foundation's)
  dist/                build output (gitignored)
```

Each feature package registers itself through `src/<dir>/index.js` (`export const pkg = { id, install(ctx) }`).
`tools/gen-registry.mjs` discovers them in the fixed order render, vfx, world, env, audio, actors, control, combat,
ai, rpg, ui and writes `src/game/registry.gen.js` with the package list and the stand-ins still needed (a stand-in
whose slot a package provides is neither imported nor bundled). Packages reach each other only through
`ctx.<slot>`, `ctx.defs` and the event bus (`src/core/events.js` is the catalog).

### Boot

`main.js` -> `game/boot.js`: context, settings and language; stand-ins then packages; `render.init`; `world.bake`
(a blob Worker at 4 m, or a time-sliced 8 m main-thread bake when Workers are blocked); the `onBoot` hooks;
`render.compile` (every shader program linked behind the loading screen); `defs.validate`; then the title screen
(or, in test mode, a fresh journey). The HTML shell already contains the loading splash (`theme.splashMarkup`), so a
loading ring is painted before the script is even downloaded; the script adopts it and shows the title and the
progress of every stage, yielding a frame between blocking stages so the bar moves. `__GAME__.bootTimes()` returns
the time of each stage in ms since navigation:
`script, modules, loading, context, installs, render, world, hooks, compile, validate, title|session, firstFrame`.

Measured on the build machine (low tier, 400x800, SwiftShader, no throttling): splash painted at about 0.1 s,
title at 3.3-3.6 s (world bake about 2.3-2.8 s of it, `render.compile` 0.3-0.6 s, boot hooks about 0.2 s).

## Build and run

| Command | What it does |
|---------|--------------|
| `npm run build` | Generates the package registry, bundles `src/main.js` into `dist/game.js` (minified) and writes `dist/index.html`, `dist/artifact.html` (an HTML fragment) and `dist/artifact-inline.html` (the fragment with the bundle inlined). Fails above 1.6 MB, warns above 1.2 MB. `node tools/build.mjs --sizes` prints the bundle bytes per source folder. |
| `npm run serve` | Serves `dist/` at <http://127.0.0.1:5173/> (`PORT` overrides). |
| `npm run dev` | Unminified build with source maps, rebuilds on every change in `src/`, and serves `dist/`. |
| `npm run gen` | Only regenerates `src/game/registry.gen.js`. |

Open `http://127.0.0.1:5173/index.html` after `npm run build && npm run serve`.

The published page runs inside a sandboxed iframe on a phone. The game works there without storage (it falls back to
memory and warns that progress is kept for the session only), without pointer lock, fullscreen, vibration or blob
Workers, and with audio unlocked by the first tap. The only external reference is the Google Fonts stylesheet
(Rubik and Secular One); the game looks right with the fallback font stacks when it cannot load.

## Test

| Command | What it does |
|---------|--------------|
| `npm test` | Node unit tests (`tests/**/*.test.mjs`). |
| `npm run lint` | `lint-strings` (both languages, `t()` keys, no UI literals, no Hebrew imperatives), `check-ip` (originality blocklist) and `check-imports` (the import rule of ARCHITECTURE 2.2). |
| `npm run smoke` | The foundation scenarios (`tools/scenarios/foundation.mjs`) in headless Chromium (SwiftShader). |
| `npm run scenarios [id] [--only name]` | Every scenario file in `tools/scenarios/`, or one suite, or one scenario. |
| `npm run check` | lint, unit tests, build and smoke: the gate for every merge. |

Scenario suites (`node tools/scenarios.mjs <id>`): `foundation` (the smoke list, including the sandboxed-iframe and
phone-platform checks), `world`, `env`, `audio`, `gfx`, `actors`, `control`, `combat`, `ai`, `rpg`, `ui` and `perf`
(budgets: draw calls, triangles, programs). Run one browser job at a time: SwiftShader is slow and a second job
makes the first one time out. Screenshots go to `tools/out/shots/<name>.png` and one log per scenario to
`tools/out/logs/<name>.log`. Each scenario fails when `__GAME__.errors` or the console collected an error, when the
page makes a network request other than Google Fonts, or when it opens `alert`, `confirm` or `prompt`.

Writing a scenario: export `scenarios: [{ name, width?, height?, query?, touch?, run({ page, game, shot, assert,
harness }) }]`. The page opens `index.html?test=1&quality=low&res=0.5&noaudio=1&seed=123&lang=en&<query>`.
In test mode the sim advances only through `__GAME__.step(n)` (step in chunks and render once per chunk, never a
frame per step) and real device input is ignored; a scenario that drives the touch UI with real pointer events uses
`query: 'autoplay=1'` and `touch: true`.

## Debug API (`window.__GAME__`)

| Group | Members |
|-------|---------|
| State | `version`, `flags`, `ready` (promise), `isReady()`, `errors` (array), `ctx`, `bootTimes()` |
| Time | `step(n)`, `render()`, `screenshotReady()`, `tick()`, `simTime()`, `pause()`, `resume()`, `setTimeScale(s)` |
| World | `heightAt(x, z)`, `regionAt(x, z)`, `teleport(x, z, opts)`, `goto(landmarkId)`, `setHour(h)`, `crater(...)`, `landmarks()`, `pois(type)` |
| Player | `player()`, `grantXp(n)`, `setLevel(n)`, `allocate(...)`, `heal()`, `god(on)`, `setOra(v)`, `setSurge(v)`, `give(itemId, n)`, `equip(uid)`, `shells(n)`, `unlockTech(id)`, `setSlot(...)`, `unlockForm(id)`, `setForm(id)`, `unlockAll()` |
| Actors | `spawn(defId, opts)`, `startBoss(id)`, `kill(id)`, `killAll()`, `actors(kind)`, `damage(...)`, `ai(on)`, `ambient(on)` |
| Input | `press(action)`, `hold(action, ticks)`, `move(x, y)`, `look(dx, dy)`, `clearInput()`, `use()`, `lock()`, `setCamera(...)` |
| Quests and UI | `startQuest(id)`, `completeStep(id)`, `questState(id)`, `setFlag(k, v)`, `open(screen)`, `closeAll()`, `top()`, `setLang(l)`, `setDevice(d)`, `setTier(t)` |
| Save | `save()`, `load()`, `state()`, `exportCode()`, `importCode(code)` |
| Diagnostics | `stats()` (fps, draw calls, triangles, programs, actors, audio), `bench(opts)`, `events(types)` (test mode recorder, last 500), `cmd.<name>` (package commands) |

## URL flags

| Flag | Meaning |
|------|---------|
| `test=1` | Test mode: no title screen, no autosave, memory-only storage, the sim advances only through `__GAME__.step(n)`, tutorial off, deterministic seeds |
| `autoplay=1` | With `test=1`: the sim runs in real time |
| `quality=low` or `high` | Force the quality tier |
| `res=<0.3-1>` | Fixed render scale (no dynamic resolution) |
| `seed=<int>` | Seed of the gameplay and effects random streams |
| `worldseed=<int>` | World seed (default 7168) |
| `lang=he` or `en` | Language (default: the saved setting, else Hebrew) |
| `grid=4` or `8` | Height grid cell size |
| `spawn=x,z` or `spawn=<landmarkId>` | Start position |
| `hour=<0-24>` | Start hour, clock frozen |
| `tutorial=0` or `1` | Skip or force the first quest (default 1, 0 in test mode) |
| `nosave=1` | Memory-only storage |
| `noaudio=1` | No AudioContext |
| `debug=1` | Debug overlay (frame and sim time, draw calls, position) |
| `fps=1` | FPS counter |
| `bench=1` | Run the scripted benchmark after boot and show its result panel (storage is memory-only) |

## Controls

Keyboard and mouse:

| Action | Input |
|--------|-------|
| Move | W A S D |
| Camera | Mouse (pointer lock on the first click, when the page allows it); without pointer lock: arrow keys, or drag with the right or middle button |
| Jump, take off (double tap), ascend (hold) | Space |
| Descend | C |
| Flicker Step (press), sprint or boost (hold) | Shift |
| Attack, Breaker (hold) | Left mouse button |
| Ora Bolt | Right mouse button |
| Guard / Gather | Q / F |
| Technique 1, 2 / Ultimate / Form | 1, 2 / R / T |
| Lock-on, switch target | Tab, mouse wheel |
| Interact / Quick item / Next item | E / H / X |
| Map, Quests, Inventory, Techniques, Character | M, J, I, K, U |
| Pause | Esc or P (losing pointer lock during play also pauses) |

Gamepad (standard mapping): left stick move, right stick camera, A jump, B Flicker and boost (hold), X attack
(hold: Breaker), Y Ora Bolt, RB guard, LB gather, RT descend, LT + X / Y / A / B for Technique 1, Technique 2, Form,
Ultimate, R3 lock-on, D-pad up interact, down quick item, right next item, left map, View map, Menu pause.

Touch: a floating stick on the left half, camera drag on the right half, and the action buttons on the right
(Attack, Bolt, Jump, Dash and the contextual ones). Touch controls are never mirrored; a left-handed layout setting
swaps the sides.

## Checking phones

`npm run android` (tools/android-check.mjs) runs the game the way a phone does, as far as a machine without a phone can: Android device profiles, a sandboxed iframe, real multi-touch through the browser, rotation, background and return, a slowed CPU and a bare WebGL2 context. It is not a real device: the GPU is software, so frame rates mean nothing there. For a real phone, play for a minute and open Settings > Graphics: the device report shows the frame rate, the GPU and the resolution the game runs at.
