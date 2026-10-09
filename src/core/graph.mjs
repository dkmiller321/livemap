// Nodes, edges, fixed layout slots and the rolling 60-second call windows.
import { columnOf } from './classify.mjs';

export const WINDOW_MS = 60_000;

/**
 * @typedef {object} Node
 * @property {string} id
 * @property {string} name
 * @property {import('./classify.mjs').NodeKind} kind
 * @property {number} column
 * @property {number} row
 * @property {number} firstSeen
 * @property {number} lastSeen
 */

/**
 * @typedef {object} Edge
 * @property {string} id `source>target`
 * @property {string} source
 * @property {string} target
 * @property {number} firstSeen
 * @property {number} lastSeen
 */

/**
 * @typedef {object} Graph
 * @property {Map<string, Node>} nodes
 * @property {Map<string, Edge>} edges
 * @property {number[]} nextRow next free row per column; rows are never reused, so nodes never move
 * @property {Map<string, number[]>} nodeCalls arrival times of calls and pulses per node
 * @property {Map<string, {t: number, d: number}[]>} edgeCalls arrival times and durations per edge
 */

/** @returns {Graph} */
export function createGraph() {
  return { nodes: new Map(), edges: new Map(), nextRow: [0, 0, 0], nodeCalls: new Map(), edgeCalls: new Map() };
}

/** @param {Graph} g */
export function clearGraph(g) {
  g.nodes.clear();
  g.edges.clear();
  g.nextRow = [0, 0, 0];
  g.nodeCalls.clear();
  g.edgeCalls.clear();
}

/**
 * @param {string} source
 * @param {string} target
 */
export function edgeId(source, target) {
  return `${source}>${target}`;
}

/**
 * Adds the node the first time it is seen. Mutates `g`.
 * @param {Graph} g
 * @param {{id: string, kind: import('./classify.mjs').NodeKind}} ref
 * @param {number} now
 * @returns {Node|null} the new node, or null if it already existed
 */
export function ensureNode(g, ref, now) {
  if (g.nodes.has(ref.id)) return null;
  const column = columnOf(ref.kind);
  /** @type {Node} */
  const node = { id: ref.id, name: ref.id, kind: ref.kind, column, row: g.nextRow[column]++, firstSeen: now, lastSeen: now };
  g.nodes.set(node.id, node);
  return node;
}

/**
 * @param {Graph} g
 * @param {string} source
 * @param {string} target
 * @param {number} now
 * @returns {Edge|null} the new edge, or null if it already existed
 */
export function ensureEdge(g, source, target, now) {
  const id = edgeId(source, target);
  if (g.edges.has(id)) return null;
  /** @type {Edge} */
  const edge = { id, source, target, firstSeen: now, lastSeen: now };
  g.edges.set(id, edge);
  return edge;
}

/**
 * Records one drawn call (or pulse when `target` is empty) in the rolling windows.
 * @param {Graph} g
 * @param {string} source
 * @param {string} target
 * @param {number} durationMs
 * @param {number} now
 */
export function recordCall(g, source, target, durationMs, now) {
  const src = g.nodes.get(source);
  if (src) src.lastSeen = now;
  if (!target) {
    push(g.nodeCalls, source, now);
    return;
  }
  const dst = g.nodes.get(target);
  if (dst) dst.lastSeen = now;
  push(g.nodeCalls, target, now);
  const id = edgeId(source, target);
  const edge = g.edges.get(id);
  if (edge) edge.lastSeen = now;
  push(g.edgeCalls, id, { t: now, d: durationMs });
}

/**
 * Replaces node `fromId` by `to` everywhere: edges are re-keyed and windows merged, then the node is removed.
 * Mutates `g`.
 * @param {Graph} g
 * @param {string} fromId
 * @param {{id: string, kind: import('./classify.mjs').NodeKind}} to
 * @param {number} now
 * @returns {{createdNode: Node|null, createdEdges: Edge[], removedEdges: string[]}}
 */
export function mergeNode(g, fromId, to, now) {
  const createdNode = ensureNode(g, to, now);
  /** @type {Edge[]} */
  const createdEdges = [];
  /** @type {string[]} */
  const removedEdges = [];
  for (const edge of [...g.edges.values()]) {
    if (edge.source !== fromId && edge.target !== fromId) continue;
    const source = edge.source === fromId ? to.id : edge.source;
    const target = edge.target === fromId ? to.id : edge.target;
    g.edges.delete(edge.id);
    removedEdges.push(edge.id);
    const calls = g.edgeCalls.get(edge.id) || [];
    g.edgeCalls.delete(edge.id);
    if (source === target) continue;
    const created = ensureEdge(g, source, target, edge.firstSeen);
    const merged = /** @type {Edge} */ (g.edges.get(edgeId(source, target)));
    merged.lastSeen = Math.max(merged.lastSeen, edge.lastSeen);
    if (created) createdEdges.push(created);
    const into = g.edgeCalls.get(merged.id) || [];
    g.edgeCalls.set(merged.id, [...into, ...calls].sort((a, b) => a.t - b.t));
  }
  const fromCalls = g.nodeCalls.get(fromId) || [];
  g.nodeCalls.delete(fromId);
  const intoCalls = g.nodeCalls.get(to.id) || [];
  g.nodeCalls.set(to.id, [...intoCalls, ...fromCalls].sort((a, b) => a - b));
  const old = g.nodes.get(fromId);
  const node = /** @type {Node} */ (g.nodes.get(to.id));
  if (old) node.lastSeen = Math.max(node.lastSeen, old.lastSeen);
  g.nodes.delete(fromId);
  return { createdNode, createdEdges, removedEdges };
}

/**
 * Calls in the last 60 s per node, and count plus median duration per edge (M8).
 * Prunes expired window entries. Mutates `g`.
 * @param {Graph} g
 * @param {number} now
 */
export function counts(g, now) {
  const cutoff = now - WINDOW_MS;
  /** @type {Record<string, {count: number, lastSeen: number}>} */
  const nodes = {};
  for (const node of g.nodes.values()) {
    const calls = prune(g.nodeCalls, node.id, (t) => t, cutoff);
    nodes[node.id] = { count: calls.length, lastSeen: node.lastSeen };
  }
  /** @type {Record<string, {count: number, medianMs: number|null}>} */
  const edges = {};
  for (const edge of g.edges.values()) {
    const calls = prune(g.edgeCalls, edge.id, (c) => c.t, cutoff);
    edges[edge.id] = { count: calls.length, medianMs: median(calls.map((c) => c.d)) };
  }
  return { nodes, edges };
}

/**
 * @param {number[]} values
 * @returns {number|null}
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @template T
 * @param {Map<string, T[]>} map
 * @param {string} key
 * @param {T} value
 */
function push(map, key, value) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
}

/**
 * @template T
 * @param {Map<string, T[]>} map
 * @param {string} key
 * @param {(v: T) => number} timeOf
 * @param {number} cutoff
 * @returns {T[]}
 */
function prune(map, key, timeOf, cutoff) {
  const list = map.get(key);
  if (!list) return [];
  let i = 0;
  while (i < list.length && timeOf(list[i]) < cutoff) i++;
  if (i > 0) list.splice(0, i);
  return list;
}
