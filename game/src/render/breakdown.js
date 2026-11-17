/**
 * Debug command `__GAME__.cmd.drawBreakdown(opts?)`: re-renders the current frame once with a counting hook on
 * `renderer.renderBufferDirect` and returns the draw calls and triangles grouped by layer and object name
 * (the nearest named ancestor). Debug only: it allocates freely and is never called from a step or frame path.
 * @module render/breakdown
 */

/**
 * @param {any} ctx
 * @param {() => any} getRender  the render service
 */
export function registerBreakdown(ctx, getRender) {
  /**
   * @param {any} obj
   * @param {Map<any, string>} layerOf
   * @returns {{ layer:string, name:string }}
   */
  function label(obj, layerOf) {
    let name = '';
    let o = obj;
    let layer = 'scene';
    while (o) {
      if (!name && o.name) name = o.name;
      const l = layerOf.get(o);
      if (l) {
        layer = l;
        break;
      }
      o = o.parent;
    }
    if (!name) name = obj.type + (obj.material && obj.material.name ? ':' + obj.material.name : '');
    return { layer, name };
  }

  /**
   * @param {{ by?:'name'|'layer', top?:number }} [opts]
   * @returns {{ drawCalls:number, triangles:number, groups:{ key:string, calls:number, triangles:number }[], layers:Record<string, number> }}
   */
  function drawBreakdown(opts = {}) {
    const three = ctx.three || {};
    const renderer = three.renderer;
    const scene = three.scene;
    const camera = three.camera;
    const render = getRender();
    if (!renderer || !scene || !camera || !render) return { drawCalls: 0, triangles: 0, groups: [], layers: {} };
    /** @type {Map<any, string>} */
    const layerOf = new Map();
    for (const k of Object.keys(render.layers)) layerOf.set(render.layers[k], k);
    /** @type {Map<string, { key:string, calls:number, triangles:number }>} */
    const groups = new Map();
    /** @type {Record<string, number>} */
    const layers = {};
    const orig = renderer.renderBufferDirect;
    let calls = 0;
    let tris = 0;
    renderer.renderBufferDirect = function (cam, sc, geometry, material, object, group) {
      const before = renderer.info.render.triangles;
      const callsBefore = renderer.info.render.calls;
      orig.call(renderer, cam, sc, geometry, material, object, group);
      const dc = renderer.info.render.calls - callsBefore;
      const dt = renderer.info.render.triangles - before;
      if (dc <= 0) return;
      const l = label(object, layerOf);
      const key = opts.by === 'layer' ? l.layer : l.layer + '/' + l.name;
      let g = groups.get(key);
      if (!g) {
        g = { key, calls: 0, triangles: 0 };
        groups.set(key, g);
      }
      g.calls += dc;
      g.triangles += dt;
      layers[l.layer] = (layers[l.layer] || 0) + dc;
      calls += dc;
      tris += dt;
    };
    try {
      renderer.info.reset();
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    } finally {
      renderer.renderBufferDirect = orig;
    }
    const list = Array.from(groups.values()).sort((a, b) => b.calls - a.calls || b.triangles - a.triangles);
    const top = typeof opts.top === 'number' ? opts.top : list.length;
    return { drawCalls: calls, triangles: tris, groups: list.slice(0, top), layers };
  }

  ctx.debug.register('drawBreakdown', drawBreakdown);
}
