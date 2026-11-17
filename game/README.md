# KETHRA: Veins of Light

An original open-world 3D action RPG for the browser: Three.js on WebGL2, mobile-first, in Hebrew and English.
Everything lives in this `game/` folder. The design documents are in `docs/`:
`GDD.md` (what the game is), `ART_UX.md` (look, feel, sound) and `ARCHITECTURE.md` (the engineering contract).

## Requirements

- Node 22.
- `npm install` (dependencies are pinned: `three` 0.170.0, `esbuild` 0.24.2).
- Headless tests use Playwright 1.63.0 from the machine's global install (`/opt/node-tools/node_modules/playwright`,
  browsers in `/opt/pw-browsers`). It is not a project dependency, and the project never installs or downloads it.

## Build and run

| Command | What it does |
|---------|--------------|
| `npm run build` | Generates the package registry, bundles `src/main.js` into `dist/game.js` (minified) and writes `dist/index.html`, `dist/artifact.html` (an HTML fragment) and `dist/artifact-inline.html` (the fragment with the bundle inlined). Fails above 1.6 MB, warns above 1.2 MB. |
| `npm run serve` | Serves `dist/` at <http://127.0.0.1:5173/> (`PORT` overrides). |
| `npm run dev` | Unminified build with source maps, rebuilds on every change in `src/`, and serves `dist/`. |
| `npm run gen` | Only regenerates `src/game/registry.gen.js`. |

Open `http://127.0.0.1:5173/index.html` after `npm run build && npm run serve`.

The only external reference of the page is the Google Fonts stylesheet (Rubik and Secular One). The game looks right
with the fallback font stacks when it cannot load.

## Test

| Command | What it does |
|---------|--------------|
| `npm test` | Node unit tests (`tests/**/*.test.mjs`). |
| `npm run lint` | `lint-strings` (both languages, `t()` keys, no UI literals, no Hebrew imperatives), `check-ip` (originality blocklist) and `check-imports` (the import rule of ARCHITECTURE 2.2). |
| `npm run smoke` | The foundation scenarios in headless Chromium (SwiftShader). Screenshots go to `tools/out/shots/`. |
| `npm run scenarios [packageId] [--only name]` | Every scenario file in `tools/scenarios/`, or one package's, or one scenario. |
| `npm run check` | lint, unit tests, build and smoke: the gate for every merge. |

Headless WebGL runs on SwiftShader at 3 to 15 fps, so scenarios drive time with `__GAME__.step(n)` and never wait on
real time. `window.__GAME__` (ARCHITECTURE section 6) is the debug and test API; package commands appear under
`__GAME__.cmd`.

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
| Camera | Mouse (pointer lock on the first click); without pointer lock: arrow keys, or drag with the right or middle button |
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

## Layout

`src/core` and `src/game` are the foundation (final shared code and boot); `src/standins` holds a working
stand-in for every replaceable service; each feature package owns its own directories under `src/` and registers
itself through `src/<dir>/index.js` (see ARCHITECTURE 2.1-2.3). `tools/` holds the build, server, harness, scenario
runner and lints.
