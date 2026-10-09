// The map: SVG nodes in three fixed columns, edges between them, red flashes and highlights.
import { KINDS, KIND_LABELS, formatDuration } from './format.js';

const SVG = 'http://www.w3.org/2000/svg';
const COLUMN_X = [0.15, 0.5, 0.85];
const TOP = 64;
const ROW_GAP = 84;
const RADIUS = 20;
const ERROR_MS = 2000;
const FLASH_MS = 300;
export const IDLE_MS = 60_000;

/** @type {Record<string, string>} */
const NODE_GLYPH = { browser: '◫', outside: '↘', service: '▣', db: '⛁', queue: '≡', llm: '✦', external: '◍' };

/**
 * @typedef {object} MapNode
 * @property {string} id
 * @property {string} name
 * @property {string} kind
 * @property {number} column
 * @property {number} row
 * @property {number} lastSeen
 */

/**
 * @typedef {object} MapEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 */

/**
 * @param {HTMLElement} container the scrollable map area
 * @param {HTMLElement} legendHost where the legend goes
 * @param {{onNode: (id: string) => void, onEdge: (id: string) => void}} hooks
 */
export function createMap(container, legendHost, hooks) {
  const stage = document.createElement('div');
  stage.className = 'map-stage';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'map-svg');
  svg.innerHTML =
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M 0 1 L 9 5 L 0 9 z" fill="currentColor"/></marker></defs>';
  const edgeLayer = document.createElementNS(SVG, 'g');
  const nodeLayer = document.createElementNS(SVG, 'g');
  svg.append(edgeLayer, nodeLayer);
  const canvas = document.createElement('canvas');
  canvas.className = 'map-canvas';
  stage.append(svg, canvas);
  container.append(stage);
  renderLegend(legendHost);

  /** @type {Map<string, {node: MapNode, el: SVGGElement, x: number, y: number}>} */
  const nodes = new Map();
  /** @type {Map<string, {edge: MapEdge, el: SVGGElement}>} */
  const edges = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} attribute|element id -> pending reset */
  const timers = new Map();
  let width = 0;
  let height = 0;
  let highlighted = '';

  function measure() {
    const w = Math.max(container.clientWidth, 560);
    const rows = Math.max(0, ...[...nodes.values()].map((n) => n.node.row));
    const h = Math.max(container.clientHeight, TOP + rows * ROW_GAP + 80);
    const changed = w !== width || h !== height;
    width = w;
    height = h;
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    return changed;
  }

  /** @param {MapNode} n */
  function position(n) {
    return { x: Math.round(COLUMN_X[n.column] * width), y: TOP + n.row * ROW_GAP };
  }

  function layout() {
    measure();
    for (const entry of nodes.values()) {
      const { x, y } = position(entry.node);
      entry.x = x;
      entry.y = y;
      entry.el.setAttribute('transform', `translate(${x},${y})`);
    }
    for (const e of edges.values()) placeEdge(e);
  }

  /** @param {{edge: MapEdge, el: SVGGElement}} e */
  function placeEdge(e) {
    const a = nodes.get(e.edge.source);
    const b = nodes.get(e.edge.target);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const x1 = a.x + ux * (RADIUS + 3);
    const y1 = a.y + uy * (RADIUS + 3);
    const x2 = b.x - ux * (RADIUS + 5);
    const y2 = b.y - uy * (RADIUS + 5);
    for (const line of e.el.querySelectorAll('line')) {
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
    }
    const label = /** @type {SVGTextElement} */ (e.el.querySelector('.edge-label'));
    label.setAttribute('x', String((x1 + x2) / 2));
    label.setAttribute('y', String((y1 + y2) / 2 - 7));
  }

  /**
   * @param {Element} el
   * @param {string} attr
   * @param {number} ms
   */
  function pulseAttr(el, attr, ms) {
    el.setAttribute(attr, 'true');
    const key = `${attr}|${el.getAttribute('data-node-id') ?? el.getAttribute('data-edge-id')}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        el.setAttribute(attr, 'false');
      }, ms),
    );
  }

  return {
    canvas,
    get size() {
      return { nodes: nodes.size, edges: edges.size };
    },
    get area() {
      return { width, height };
    },
    /** @param {MapNode} node */
    addNode(node) {
      if (nodes.has(node.id)) return;
      const el = /** @type {SVGGElement} */ (document.createElementNS(SVG, 'g'));
      el.setAttribute('class', 'node');
      el.dataset.testid = 'node';
      el.dataset.nodeId = node.id;
      el.dataset.kind = node.kind;
      el.dataset.column = String(node.column);
      el.dataset.row = String(node.row);
      el.dataset.error = 'false';
      el.dataset.idle = 'false';
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${node.name} (${node.kind}): show its calls`);
      el.innerHTML =
        `<circle class="node-hit" r="${RADIUS + 6}"></circle>` +
        `<circle class="node-ring" r="${RADIUS}"></circle>` +
        `<text class="node-glyph" text-anchor="middle" dy="0.35em" aria-hidden="true"></text>` +
        `<text class="node-label" data-testid="node-label" text-anchor="middle" y="${RADIUS + 17}"></text>` +
        `<g class="node-badge" transform="translate(${RADIUS - 2},${-RADIUS + 2})"><rect x="-2" y="-9" rx="9" height="18"></rect>` +
        `<text class="node-count" data-testid="node-count" x="7" dy="0.35em" text-anchor="middle">0</text></g>`;
      /** @type {SVGTextElement} */ (el.querySelector('.node-glyph')).textContent = NODE_GLYPH[node.kind] ?? '•';
      /** @type {SVGTextElement} */ (el.querySelector('.node-label')).textContent = node.name;
      el.addEventListener('click', () => hooks.onNode(node.id));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          hooks.onNode(node.id);
        }
      });
      nodeLayer.append(el);
      const entry = { node, el, x: 0, y: 0 };
      nodes.set(node.id, entry);
      if (measure()) layout();
      else {
        const { x, y } = position(node);
        entry.x = x;
        entry.y = y;
        el.setAttribute('transform', `translate(${x},${y})`);
      }
    },
    /** @param {MapEdge} edge */
    addEdge(edge) {
      if (edges.has(edge.id)) return;
      const el = /** @type {SVGGElement} */ (document.createElementNS(SVG, 'g'));
      el.setAttribute('class', 'edge');
      el.dataset.testid = 'edge';
      el.dataset.edgeId = edge.id;
      el.dataset.error = 'false';
      el.dataset.highlighted = String(edge.id === highlighted);
      el.dataset.flash = 'false';
      el.innerHTML =
        '<line class="edge-hit"></line><line class="edge-line" marker-end="url(#arrow)"></line>' +
        '<text class="edge-label" data-testid="edge-label" text-anchor="middle"></text>';
      el.addEventListener('click', () => hooks.onEdge(edge.id));
      edgeLayer.append(el);
      const entry = { edge, el };
      edges.set(edge.id, entry);
      placeEdge(entry);
    },
    /** @param {string} id */
    removeEdge(id) {
      edges.get(id)?.el.remove();
      edges.delete(id);
    },
    /** @param {string} id */
    removeNode(id) {
      nodes.get(id)?.el.remove();
      nodes.delete(id);
      for (const [eid, e] of edges) {
        if (e.edge.source === id || e.edge.target === id) {
          e.el.remove();
          edges.delete(eid);
        }
      }
    },
    reset() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      nodes.clear();
      edges.clear();
      nodeLayer.replaceChildren();
      edgeLayer.replaceChildren();
      highlighted = '';
      measure();
    },
    layout,
    /**
     * Where an edge runs, in canvas pixels.
     * @param {string} edgeId
     */
    edgeEnds(edgeId) {
      const e = edges.get(edgeId);
      if (!e) return null;
      const a = nodes.get(e.edge.source);
      const b = nodes.get(e.edge.target);
      if (!a || !b) return null;
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    },
    /** @param {string} id */
    nodeCenter(id) {
      const n = nodes.get(id);
      return n ? { x: n.x, y: n.y } : null;
    },
    /**
     * A failed call: its edge and callee turn red for 2 seconds.
     * @param {string} edgeId
     * @param {string} nodeId
     */
    flashError(edgeId, nodeId) {
      const e = edges.get(edgeId);
      if (e) pulseAttr(e.el, 'data-error', ERROR_MS);
      const n = nodes.get(nodeId);
      if (n) pulseAttr(n.el, 'data-error', ERROR_MS);
    },
    /**
     * The reduced-motion stand-in for a particle.
     * @param {string} edgeId
     */
    flashEdge(edgeId) {
      const e = edges.get(edgeId);
      if (e) pulseAttr(e.el, 'data-flash', FLASH_MS);
    },
    /** @param {string} edgeId '' for none */
    highlight(edgeId) {
      highlighted = edgeId;
      for (const [id, e] of edges) e.el.dataset.highlighted = String(id === edgeId);
    },
    /**
     * @param {{nodes: Record<string, {count: number, lastSeen: number}>, edges: Record<string, {count: number, medianMs: number|null}>}} counts
     * @param {number} now
     */
    setCounts(counts, now) {
      for (const [id, n] of nodes) {
        const c = counts.nodes[id];
        if (!c) continue;
        /** @type {SVGTextElement} */ (n.el.querySelector('.node-count')).textContent = String(c.count);
        n.el.classList.toggle('has-count', c.count > 0);
        n.node.lastSeen = c.lastSeen;
      }
      for (const [id, e] of edges) {
        const c = counts.edges[id];
        if (!c) continue;
        const label = /** @type {SVGTextElement} */ (e.el.querySelector('.edge-label'));
        label.textContent = c.count > 0 && c.medianMs !== null ? `${c.count} · ${formatDuration(c.medianMs)}` : '';
      }
      this.markIdle(now);
    },
    /** @param {number} now */
    markIdle(now) {
      for (const n of nodes.values()) n.el.dataset.idle = String(now - n.node.lastSeen > IDLE_MS);
    },
    /**
     * @param {string} id
     * @param {number} now
     */
    touch(id, now) {
      const n = nodes.get(id);
      if (!n) return;
      n.node.lastSeen = now;
      n.el.dataset.idle = 'false';
    },
  };
}

/** @param {HTMLElement} host */
function renderLegend(host) {
  host.dataset.testid = 'legend';
  host.setAttribute('aria-label', 'Particle colours');
  host.innerHTML = KINDS.map(
    (k) => `<span class="legend-item kind" data-testid="legend-item" data-kind="${k}">${KIND_LABELS[k]}</span>`,
  ).join('');
}
