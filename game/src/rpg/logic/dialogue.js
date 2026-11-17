/**
 * Dialogue runner (ARCHITECTURE 4.12, 5.7). Pure: walks a DialogueDef node by node; node actions run when the node
 * is shown, choice actions when the choice is taken; choices with an `if` are shown only when it holds.
 * @module rpg/logic/dialogue
 */

/**
 * @typedef {object} DialogueHost
 * @property {(id:string) => any} dialogue                  DialogueDef or null
 * @property {(cond:any) => boolean} cond                   { flag?, quest?, state? }
 * @property {(actions:any[]) => void} run
 * @property {(type:string, payload:object) => void} emit
 * @property {(dialogueId:string, npcId:string|null) => void} [ended]
 */

/**
 * The visible choices of a node.
 * @param {any} node @param {(cond:any)=>boolean} cond
 * @returns {any[]}
 */
export function visibleChoices(node, cond) {
  const out = [];
  if (node && node.choices) for (const c of node.choices) if (!c.if || cond(c.if)) out.push(c);
  return out;
}

/** @param {DialogueHost} host */
export function createDialogueRunner(host) {
  const r = {
    open: false,
    /** @type {any} */
    def: null,
    nodeId: '',
    /** @type {string|null} */
    npcId: null,
    /** Lines shown in this conversation (for tests and the log). */
    shown: 0,

    /**
     * Open a dialogue at its start node. An open dialogue is ended first.
     * @param {string} id @param {string|null} npcId
     * @returns {boolean}
     */
    start(id, npcId) {
      const def = host.dialogue(id);
      if (!def || !def.nodes || !def.nodes[def.start]) return false;
      if (r.open) r.end();
      r.open = true;
      r.def = def;
      r.npcId = npcId || null;
      r.shown = 0;
      host.emit('dialogue:start', { dialogueId: id, npcId: r.npcId });
      show(def.start);
      return true;
    },

    /** The current node, or null. */
    node() {
      return r.open ? r.def.nodes[r.nodeId] || null : null;
    },

    /**
     * Advance: take the visible choice `choiceIndex` (clamped) when the node has choices, else follow `next`.
     * @param {number} [choiceIndex]
     */
    advance(choiceIndex) {
      if (!r.open) return;
      const n = r.def.nodes[r.nodeId];
      if (!n) return r.end();
      let next = n.next === undefined ? null : n.next;
      const ok = visibleChoices(n, host.cond);
      if (ok.length) {
        const c = ok[Math.max(0, Math.min(ok.length - 1, Math.floor(choiceIndex || 0)))];
        if (c.actions) host.run(c.actions);
        next = c.next === undefined ? null : c.next;
      }
      if (!r.open) return;
      if (next && r.def.nodes[next]) show(next);
      else r.end();
    },

    end() {
      if (!r.open) return;
      const id = r.def.id;
      const npcId = r.npcId;
      r.open = false;
      r.def = null;
      r.nodeId = '';
      r.npcId = null;
      host.emit('dialogue:end', { dialogueId: id, npcId });
      if (host.ended) host.ended(id, npcId);
    },
  };

  /** @param {string} nodeId */
  function show(nodeId) {
    const n = r.def.nodes[nodeId];
    r.nodeId = nodeId;
    r.shown++;
    if (n.actions) host.run(n.actions);
    if (!r.open || r.nodeId !== nodeId) return;
    const choices = [];
    for (const c of visibleChoices(n, host.cond)) choices.push({ textKey: c.text });
    host.emit('dialogue:line', { dialogueId: r.def.id, nodeId, speakerId: n.speaker, textKey: n.text, choices });
  }

  return r;
}
