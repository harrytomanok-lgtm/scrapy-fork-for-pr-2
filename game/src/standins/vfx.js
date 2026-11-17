/**
 * Stand-in `ctx.vfx` (ARCHITECTURE 4.4, 8.0): `burst` emits up to 200 pooled additive particles (one instanced
 * draw call), `attach` keeps emitting at an entity socket, `beam` is a stretched cylinder, `shockwave` a scaling
 * ring or sphere, `aura` a transparent sphere; decals, trails and afterimages are no-ops that return valid
 * handles. Projectiles are drawn as small glowing spheres, and a few automatic effects of 4.4 (hit sparks,
 * deaths, craters, landings, sonic boom, level-up) are wired to their events. Replaced by the gfx package.
 * @module standins/vfx
 */

import { InstancedMesh, OctahedronGeometry, CylinderGeometry, TorusGeometry, SphereGeometry, Mesh, Color, Vector3, Quaternion } from 'three';
import { PALETTE } from '../core/palette.js';
import { TMP } from '../core/math.js';

const OWNER = 'standin:vfx';
const MAX_PARTICLES = 200;
const MAX_EMITTERS = 32;
const MAX_BEAMS = 8;
const MAX_WAVES = 12;
const MAX_AURAS = 16;
const MAX_PROJECTILES = 64;

/** Recipe look: [count, speed m/s, life s, size m, colour, gravity m/s^2]. Unlisted ids use `default`. */
const RECIPES = {
  default: [10, 6, 0.4, 0.18, PALETTE.ora, 0],
  hit_light: [6, 9, 0.18, 0.16, PALETTE.oraCore, 0],
  hit_heavy: [12, 12, 0.26, 0.22, PALETTE.oraCore, 0],
  hit_finisher: [16, 14, 0.3, 0.24, PALETTE.oraCore, 0],
  bolt_hit: [8, 7, 0.2, 0.16, PALETTE.ora, 0],
  muzzle: [3, 4, 0.08, 0.14, PALETTE.oraCore, 0],
  nova: [24, 18, 0.35, 0.3, PALETTE.ora, 0],
  explosion_s: [16, 9, 0.5, 0.35, PALETTE.ember, -4],
  explosion_m: [24, 12, 0.6, 0.45, PALETTE.ember, -4],
  explosion_l: [36, 16, 0.8, 0.6, PALETTE.ember, -4],
  crater: [24, 10, 0.7, 0.4, PALETTE.scorchRim, 12],
  slam: [16, 8, 0.5, 0.35, PALETTE.paper, 10],
  death_choir: [18, 3, 0.8, 0.22, PALETTE.paper, -3],
  death_beast: [18, 3, 0.8, 0.22, PALETTE.hostile, -3],
  xp_orb: [6, 5, 0.9, 0.16, PALETTE.ora, -2],
  level_up: [30, 4, 1.0, 0.25, PALETTE.ora, -9],
  flicker_out: [10, 5, 0.25, 0.18, PALETTE.ora, 0],
  flicker_in: [10, 5, 0.25, 0.18, PALETTE.ora, 0],
  sonic_ring: [20, 20, 0.25, 0.25, PALETTE.oraCore, 0],
  boost_trail: [2, 1, 0.3, 0.14, PALETTE.ora, 0],
  aura: [2, 1.5, 0.6, 0.16, PALETTE.ora, -3],
  tele_white: [6, 2, 0.4, 0.2, PALETTE.telegraph.white, 0],
  tele_red: [6, 2, 0.4, 0.2, PALETTE.telegraph.red, 0],
  tele_violet: [6, 2, 0.4, 0.2, PALETTE.telegraph.violet, 0],
  siphon_break: [36, 14, 1.0, 0.5, PALETTE.ora, 0],
  pickup: [4, 2, 0.5, 0.14, PALETTE.rarity.common, -2],
  spray: [8, 5, 0.4, 0.2, PALETTE.ocean.foam, 10],
  step_dust: [3, 1.5, 0.35, 0.14, PALETTE.path, 0],
  land_ring: [12, 6, 0.35, 0.2, PALETTE.paper, 0],
  transform_burst: [36, 16, 0.6, 0.3, PALETTE.ember, 0],
  guard_block: [5, 5, 0.18, 0.16, PALETTE.oraCore, 0],
  perfect: [16, 10, 0.3, 0.2, PALETTE.oraCore, 0],
};

/**
 * Create the stand-in vfx service.
 * @param {any} ctx
 */
function createVfx(ctx) {
  // ------------------------------------------------------------ particles
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const pz = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const vz = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  const col = new Float32Array(MAX_PARTICLES * 3);
  let live = 0;
  let cursor = 0;
  const colTmp = new Color();
  /** @type {any} */
  let particles = null;
  let built = false;

  // ------------------------------------------------------------ pooled meshes
  /** @type {any[]} */
  const beams = [];
  /** @type {any[]} */
  const waves = [];
  /** @type {any[]} */
  const auras = [];
  /** @type {any[]} */
  const projectiles = [];
  /** @type {any[]} */
  const emitters = [];
  let nextHandle = 1;
  let lastReal = -1;
  const up = new Vector3(0, 1, 0);
  const qTmp = new Quaternion();

  function build() {
    const render = ctx.render;
    if (built || !render || !render.layers) return;
    built = true;
    const layer = render.layers.vfx;
    particles = new InstancedMesh(new OctahedronGeometry(1, 0), render.materials.unlit({ color: 0xffffff, additive: true }), MAX_PARTICLES);
    particles.count = 0;
    particles.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) particles.setColorAt(i, colTmp.setHex(PALETTE.ora));
    layer.add(particles);

    const beamGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < MAX_BEAMS; i++) beams.push(makeBeam(beamGeo, layer));
    const ringGeo = new TorusGeometry(1, 0.06, 4, 32);
    ringGeo.rotateX(Math.PI / 2);
    const sphereGeo = new SphereGeometry(1, 16, 10);
    for (let i = 0; i < MAX_WAVES; i++) {
      const mat = render.materials.unlit({ color: PALETTE.ora, additive: true });
      const ring = new Mesh(ringGeo, mat);
      const sphere = new Mesh(sphereGeo, mat);
      ring.visible = false;
      sphere.visible = false;
      layer.add(ring);
      layer.add(sphere);
      waves.push({ ring, sphere, mat, t: 0, seconds: 0, radius: 0, sphereMode: false, active: false });
    }
    for (let i = 0; i < MAX_AURAS; i++) auras.push(makeAura(sphereGeo, layer));
    const projGeo = new SphereGeometry(0.3, 10, 8);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const mesh = new Mesh(projGeo, render.materials.unlit({ color: PALETTE.ora, additive: true }));
      mesh.visible = false;
      layer.add(mesh);
      projectiles.push({ entId: 0, mesh });
    }
    for (let i = 0; i < MAX_EMITTERS; i++) emitters.push({ id: 0, recipe: 'default', entId: 0, socket: 'chest', acc: 0, fade: 0, dying: false, color: -1 });
  }

  /** @param {any} geo @param {any} layer */
  function makeBeam(geo, layer) {
    const mat = ctx.render.materials.unlit({ color: PALETTE.ora, additive: true });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    layer.add(mesh);
    const b = {
      mesh, mat, active: false, fade: 0, fadeT: 0, intensity: 1,
      handle: {
        set(ax, ay, az, bx, by, bz, radius, intensity) {
          if (!b.active) return;
          const d = TMP.v1.set(bx - ax, by - ay, bz - az);
          const len = d.length();
          if (len < 1e-4) return;
          d.multiplyScalar(1 / len);
          qTmp.setFromUnitVectors(up, d);
          mesh.quaternion.copy(qTmp);
          mesh.position.set(ax, ay, az);
          mesh.scale.set(radius, len, radius);
          b.intensity = intensity;
          mat.uniforms.uOpacity.value = intensity;
          mesh.visible = true;
        },
        end(fadeSeconds = 0.18) {
          if (!b.active) return;
          b.fade = Math.max(0.01, fadeSeconds);
          b.fadeT = b.fade;
        },
      },
    };
    return b;
  }

  /** @param {any} geo @param {any} layer */
  function makeAura(geo, layer) {
    const mat = ctx.render.materials.unlit({ color: PALETTE.ora, additive: true });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    layer.add(mesh);
    const a = {
      mesh, mat, entId: 0, intensity: 0,
      handle: {
        set(intensity, color, style) {
          a.intensity = Math.max(0, Math.min(1, intensity));
          const c = color !== undefined && color !== null ? color : style === 'enemy' ? PALETTE.hostile : style === 'ember' ? PALETTE.ember
            : style === 'tempest' ? PALETTE.tempest : style === 'zenith' ? PALETTE.zenith : PALETTE.ora;
          mat.uniforms.uColor.value.setHex(c);
        },
        dispose() {
          a.entId = 0;
          a.intensity = 0;
          mesh.visible = false;
        },
      },
    };
    return a;
  }

  /** Emit one particle. */
  function emit(x, y, z, dx, dy, dz, speed, lifeS, sz, color, g) {
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    if (life[i] <= 0) live++;
    const rng = ctx.rng.fx;
    let rx = rng.next() * 2 - 1;
    let ry = rng.next() * 2 - 1;
    let rz = rng.next() * 2 - 1;
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const s = speed * (0.5 + rng.next() * 0.7);
    px[i] = x; py[i] = y; pz[i] = z;
    vx[i] = (rx + dx) * s; vy[i] = (ry + dy) * s; vz[i] = (rz + dz) * s;
    maxLife[i] = lifeS * (0.7 + rng.next() * 0.6);
    life[i] = maxLife[i];
    size[i] = sz;
    grav[i] = g;
    colTmp.setHex(color);
    col[i * 3] = colTmp.r; col[i * 3 + 1] = colTmp.g; col[i * 3 + 2] = colTmp.b;
  }

  /** @param {string} id @returns {any[]} */
  function recipe(id) {
    return RECIPES[id] || RECIPES.default;
  }

  /** @param {number} entId @param {number} color @returns {any} */
  function projectileFor(entId, color) {
    for (let i = 0; i < projectiles.length; i++) {
      if (projectiles[i].entId === 0) {
        const p = projectiles[i];
        p.entId = entId;
        p.mesh.material.uniforms.uColor.value.setHex(color);
        return p;
      }
    }
    return null;
  }

  const vfx = {
    /**
     * @param {string} recipeId @param {number} x @param {number} y @param {number} z
     * @param {{ dirX?:number, dirY?:number, dirZ?:number, color?:number, scale?:number, count?:number }} [opts]
     */
    burst(recipeId, x, y, z, opts) {
      build();
      if (!particles) return;
      const r = recipe(recipeId);
      const sc = opts && opts.scale !== undefined ? opts.scale : 1;
      const n = Math.min(60, opts && opts.count !== undefined ? opts.count : Math.round(r[0] * Math.max(0.5, sc)));
      const color = opts && opts.color !== undefined ? opts.color : r[4];
      const dx = opts && opts.dirX ? opts.dirX : 0;
      const dy = opts && opts.dirY ? opts.dirY : 0;
      const dz = opts && opts.dirZ ? opts.dirZ : 0;
      for (let k = 0; k < n; k++) emit(x, y, z, dx, dy, dz, r[1] * sc, r[2], r[3] * sc, color, r[5]);
    },

    /** @param {string} recipeId @param {number} entId @param {string} [socket] @param {{ color?:number }} [opts] @returns {number} */
    attach(recipeId, entId, socket = 'chest', opts) {
      build();
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i];
        if (e.id !== 0) continue;
        e.id = nextHandle++;
        e.recipe = recipeId;
        e.entId = entId;
        e.socket = socket;
        e.acc = 0;
        e.dying = false;
        e.fade = 0;
        e.color = opts && opts.color !== undefined ? opts.color : -1;
        return e.id;
      }
      return nextHandle++;
    },

    /** @param {number} handle @param {number} [fadeSeconds] */
    detach(handle, fadeSeconds = 0.2) {
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i];
        if (e.id === handle && !e.dying) {
          e.dying = true;
          e.fade = Math.max(0, fadeSeconds);
        }
      }
    },

    /** @param {{ color?:number, radius?:number, ownerId?:number }} [opts] */
    beam(opts) {
      build();
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        if (b.active) continue;
        b.active = true;
        b.fade = 0;
        b.fadeT = 0;
        b.mat.uniforms.uColor.value.setHex(opts && opts.color !== undefined ? opts.color : PALETTE.ora);
        return b.handle;
      }
      return NULL_BEAM;
    },

    /** @param {number} x @param {number} y @param {number} z @param {{ radius?:number, seconds?:number, color?:number, ground?:boolean, sphere?:boolean }} [opts] */
    shockwave(x, y, z, opts) {
      build();
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        if (w.active) continue;
        w.active = true;
        w.t = 0;
        w.seconds = opts && opts.seconds ? opts.seconds : 0.28;
        w.radius = opts && opts.radius ? opts.radius : 6;
        w.sphereMode = !!(opts && opts.sphere);
        w.mat.uniforms.uColor.value.setHex(opts && opts.color !== undefined ? opts.color : PALETTE.ora);
        const m = w.sphereMode ? w.sphere : w.ring;
        m.position.set(x, y + (w.sphereMode ? 0 : 0.2), z);
        m.scale.setScalar(0.01);
        m.visible = true;
        return;
      }
    },

    /** @param {number} entId */
    aura(entId) {
      build();
      for (let i = 0; i < auras.length; i++) {
        const a = auras[i];
        if (a.entId !== 0) continue;
        a.entId = entId;
        a.intensity = 0;
        a.mat.uniforms.uColor.value.setHex(PALETTE.ora);
        return a.handle;
      }
      return NULL_AURA;
    },

    /** No-op decal; returns a handle. @returns {number} */
    decal() {
      return nextHandle++;
    },
    setDecalFill() {},
    removeDecal() {},
    afterimage() {},
    /** No-op trail; returns a handle that `detach` accepts. @returns {number} */
    trail() {
      return nextHandle++;
    },

    /** @returns {number} live particles */
    count() {
      return live;
    },

    /** Remove every pooled mesh. */
    dispose() {
      const layer = ctx.render && ctx.render.layers ? ctx.render.layers.vfx : null;
      if (!layer || !built) return;
      const meshes = [particles];
      for (const b of beams) meshes.push(b.mesh);
      for (const w of waves) meshes.push(w.ring, w.sphere);
      for (const a of auras) meshes.push(a.mesh);
      for (const p of projectiles) meshes.push(p.mesh);
      for (const m of meshes) {
        layer.remove(m);
        m.material.dispose();
      }
    },
  };

  const NULL_BEAM = { set() {}, end() {} };
  const NULL_AURA = { set() {}, dispose() {} };

  const updateSystem = {
    id: 'standin.vfx.update',
    phase: 'vfx',
    owner: OWNER,
    /**
     * Integrate on real frame time; a frame pass run with dt 0 after stepped ticks (tests) uses the sim time
     * that passed instead, so effects still advance.
     * @param {any} c @param {number} frameDt @param {number} alpha
     */
    frame(c, frameDt, alpha) {
      const real = c.time.real;
      const simDt = lastReal < 0 ? 0 : real - lastReal;
      lastReal = real;
      const dt = Math.min(0.25, frameDt > 0 ? frameDt : simDt);
      if (!built) return;
      const p = TMP.v2;
      const actors = c.actors;
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i];
        if (e.id === 0) continue;
        const ent = c.ents.get(e.entId);
        if (!ent || !ent.alive || (e.dying && (e.fade -= dt) <= 0)) {
          e.id = 0;
          continue;
        }
        const r = recipe(e.recipe);
        e.acc += dt * r[0] * 4;
        if (actors) actors.socket(ent, e.socket, p); else p.copy(ent.pos);
        while (e.acc >= 1) {
          e.acc -= 1;
          emit(p.x, p.y, p.z, 0, 0.3, 0, r[1], r[2], r[3], e.color >= 0 ? e.color : r[4], r[5]);
        }
      }
      const m = TMP.m1;
      let n = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          live--;
          continue;
        }
        vy[i] -= grav[i] * dt;
        const drag = 1 - Math.min(1, 2.5 * dt);
        vx[i] *= drag; vy[i] *= drag; vz[i] *= drag;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        const s = size[i] * Math.min(1, (life[i] / maxLife[i]) * 1.6);
        m.makeScale(s, s, s);
        m.setPosition(px[i], py[i], pz[i]);
        particles.setMatrixAt(n, m);
        particles.setColorAt(n, colTmp.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]));
        n++;
      }
      particles.count = n;
      particles.instanceMatrix.needsUpdate = true;
      if (particles.instanceColor) particles.instanceColor.needsUpdate = true;

      for (let i = 0; i < beams.length; i++) {
        const b = beams[i];
        if (!b.active || b.fade <= 0) continue;
        b.fadeT -= dt;
        b.mat.uniforms.uOpacity.value = b.intensity * Math.max(0, b.fadeT / b.fade);
        if (b.fadeT <= 0) {
          b.active = false;
          b.mesh.visible = false;
        }
      }
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        if (!w.active) continue;
        w.t += dt;
        const k = Math.min(1, w.t / w.seconds);
        const mesh = w.sphereMode ? w.sphere : w.ring;
        mesh.scale.setScalar(Math.max(0.01, w.radius * (1 - (1 - k) * (1 - k))));
        w.mat.uniforms.uOpacity.value = 1 - k;
        if (k >= 1) {
          w.active = false;
          mesh.visible = false;
        }
      }
      for (let i = 0; i < auras.length; i++) {
        const a = auras[i];
        if (a.entId === 0) continue;
        const ent = c.ents.get(a.entId);
        if (!ent || !ent.alive || a.intensity <= 0.01) {
          a.mesh.visible = false;
          if (!ent) a.entId = 0;
          continue;
        }
        c.ents.renderPos(ent, alpha, p);
        a.mesh.position.set(p.x, p.y + ent.height * 0.5, p.z);
        a.mesh.scale.set(ent.radius * 2.2, ent.height * 0.75, ent.radius * 2.2);
        a.mat.uniforms.uOpacity.value = 0.25 * a.intensity;
        a.mesh.visible = true;
      }
      for (let i = 0; i < projectiles.length; i++) {
        const pr = projectiles[i];
        if (pr.entId === 0) continue;
        const ent = c.ents.get(pr.entId);
        if (!ent || !ent.alive) {
          pr.entId = 0;
          pr.mesh.visible = false;
          continue;
        }
        c.ents.renderPos(ent, alpha, p);
        pr.mesh.position.copy(p);
        pr.mesh.visible = true;
      }
    },
  };

  /** Scratch options of the automatic effects (no allocation per event). */
  const o = { dirX: 0, dirY: 0, dirZ: 0, scale: 1, color: PALETTE.ora, radius: 6, seconds: 0.28, sphere: false, ground: true };
  /** @param {number} dx @param {number} dy @param {number} dz @param {number} scale */
  function burstOpts(dx, dy, dz, scale) {
    o.dirX = dx; o.dirY = dy; o.dirZ = dz; o.scale = scale; o.color = undefined;
    return o;
  }
  /** @param {number} radius @param {number} seconds @param {number} color @param {boolean} sphere */
  function waveOpts(radius, seconds, color, sphere) {
    o.radius = radius; o.seconds = seconds; o.color = color; o.sphere = sphere; o.ground = !sphere;
    return o;
  }

  /** Automatic effects (4.4). */
  const auto = {
    /** @param {any} e */
    hit(e) {
      const cls = e.class;
      vfx.burst(cls === 'heavyHit' || cls === 'finisher' ? 'hit_heavy' : e.blocked ? 'guard_block' : 'hit_light', e.x, e.y, e.z, burstOpts(e.dirX * 0.5, 0, e.dirZ * 0.5, 1));
    },
    /** @param {any} e */
    projectileSpawned(e) {
      build();
      if (!built) return;
      const p = projectileFor(e.entId, typeof e.color === 'number' ? e.color : PALETTE.ora);
      if (p) p.mesh.visible = false;
    },
    /** @param {any} e */
    projectileRemoved(e) {
      for (let i = 0; i < projectiles.length; i++) {
        if (projectiles[i].entId === e.entId) {
          projectiles[i].entId = 0;
          projectiles[i].mesh.visible = false;
        }
      }
      if (e.hit) vfx.burst('bolt_hit', e.x, e.y, e.z);
    },
    /** @param {any} e */
    died(e) {
      if (e.kind === 'enemy' || e.kind === 'boss') vfx.burst(e.defId && e.defId.indexOf('choir') === 0 ? 'death_choir' : 'death_beast', e.x, e.y + 0.9, e.z);
    },
    /** @param {any} e */
    crater(e) {
      vfx.burst('crater', e.x, e.y + 0.5, e.z, burstOpts(0, 0.8, 0, Math.max(0.6, e.radius / 8)));
      vfx.shockwave(e.x, e.y, e.z, waveOpts(e.radius * 1.4, 0.4, PALETTE.paper, false));
    },
    /** @param {any} e */
    landed(e) {
      if (e.speed >= 14) vfx.shockwave(e.x, e.y, e.z, waveOpts(4, 0.3, PALETTE.paper, false));
    },
    /** @param {any} e */
    slam(e) {
      vfx.burst('slam', e.x, e.y + 0.5, e.z, burstOpts(0, 0.6, 0, 1));
    },
    /** @param {any} e */
    boost(e) {
      if (e.stage !== 2) return;
      const ent = ctx.ents.get(e.entId);
      if (ent) vfx.shockwave(ent.pos.x, ent.pos.y + 1, ent.pos.z, waveOpts(8, 0.22, PALETTE.oraCore, true));
    },
    levelUp() {
      const p = ctx.player;
      if (p) vfx.burst('level_up', p.pos.x, p.pos.y + 1, p.pos.z, burstOpts(0, 1, 0, 1));
    },
    /** @param {any} e */
    flicker(e) {
      vfx.burst('flicker_out', e.fromX, e.fromY + 1, e.fromZ);
      vfx.burst('flicker_in', e.toX, e.toY + 1, e.toZ);
    },
  };

  return { vfx, updateSystem, auto, build };
}

/**
 * Install the stand-in vfx service under the owner 'standin:vfx'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { vfx, updateSystem, auto, build } = createVfx(ctx);
  ctx.provide('vfx', vfx, OWNER);
  ctx.systems.add(updateSystem);
  const bus = ctx.bus;
  bus.on('combat:hit', auto.hit, OWNER);
  bus.on('projectile:spawned', auto.projectileSpawned, OWNER);
  bus.on('projectile:removed', auto.projectileRemoved, OWNER);
  bus.on('actor:died', auto.died, OWNER);
  bus.on('world:crater', auto.crater, OWNER);
  bus.on('actor:landed', auto.landed, OWNER);
  bus.on('actor:slam', auto.slam, OWNER);
  bus.on('move:boost', auto.boost, OWNER);
  bus.on('rpg:levelUp', auto.levelUp, OWNER);
  bus.on('combat:flicker', auto.flicker, OWNER);
  ctx.onBoot(() => {
    if (ctx.vfx === vfx) build();
  });
}
