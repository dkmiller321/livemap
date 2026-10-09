// Ties buffer, classification, pairing and graph together. Every function takes the state and
// the current time, mutates the state and returns the events to broadcast. No I/O and no timers:
// the caller schedules `expire` for `nextDeadline(state)`.
import { addSpan, childrenOf, clearBuffer, createBuffer, spansInTrace } from './buffer.mjs';
import { addressKey, addressOf, classifyKind, externalNodeId } from './classify.mjs';
import { dbInfo, errorInfo, httpInfo } from './detail.mjs';
import { clearGraph, counts, createGraph, edgeId, ensureEdge, ensureNode, mergeNode, recordCall, unrecordCall } from './graph.mjs';
import { normalizeLlm } from './llm-content.mjs';
import { PAIR_WAIT_MS, decide } from './pair.mjs';

export const FEED_MAX = 500;
const PENDING_LOGS_MAX = 2000;

/**
 * @typedef {import('../otlp/decode.mjs').RawSpan & {
 *   kind: import('./classify.mjs').SpanKind,
 *   state: 'new'|'pending'|'drawn'|'hidden'|'none',
 *   source: string,
 *   target: string,
 *   targetKind: string,
 *   pulse: boolean,
 *   drawnAt: number,
 *   logs: import('../otlp/decode.mjs').LogEvent[],
 * }} Span
 */

/**
 * @typedef {object} Row one feed row: a drawn call or a pulse
 * @property {string} spanId
 * @property {string} traceId
 * @property {string} name
 * @property {string} kind
 * @property {'ok'|'error'} status
 * @property {number} durationMs
 * @property {number} startMs
 * @property {string} source
 * @property {string} target '' for a pulse
 * @property {boolean} pulse
 */

/**
 * @typedef {{type: 'span', data: Row}
 *   | {type: 'node', data: import('./graph.mjs').Node}
 *   | {type: 'edge', data: import('./graph.mjs').Edge}
 *   | {type: 'node-removed', data: {id: string, into: string}}
 *   | {type: 'edge-removed', data: {id: string}}
 *   | {type: 'span-removed', data: {spanId: string}}
 *   | {type: 'trace', data: {traceId: string}}
 *   | {type: 'clear', data: {}}} Event
 */

/**
 * @typedef {object} State
 * @property {import('./buffer.mjs').Buffer<Span>} buffer
 * @property {import('./graph.mjs').Graph} graph
 * @property {Map<string, string>} addresses host:port -> service, learned by pairing
 * @property {Map<string, number>} pending span id -> deadline
 * @property {Row[]} feed newest last, at most FEED_MAX
 * @property {Map<string, import('../otlp/decode.mjs').LogEvent[]>} pendingLogs gen_ai log events whose span has not arrived
 */

/**
 * @param {{maxSpans: number}} opts
 * @returns {State}
 */
export function createState({ maxSpans }) {
  return {
    buffer: createBuffer(maxSpans),
    graph: createGraph(),
    addresses: new Map(),
    pending: new Map(),
    feed: [],
    pendingLogs: new Map(),
  };
}

/**
 * @param {State} state
 * @param {import('../otlp/decode.mjs').RawSpan[]} rawSpans
 * @param {number} now
 * @returns {Event[]}
 */
export function ingestSpans(state, rawSpans, now) {
  /** @type {Event[]} */
  const events = [];
  /** @type {Span[]} */
  const added = [];
  for (const raw of rawSpans) {
    /** @type {Span} */
    const span = { ...raw, kind: classifyKind(raw.attributes), state: 'new', source: '', target: '', targetKind: '', pulse: false, drawnAt: 0, logs: [] };
    const res = addSpan(state.buffer, span);
    if (!res.added) continue;
    for (const old of res.evicted) state.pending.delete(old.spanId);
    const logs = state.pendingLogs.get(span.spanId);
    if (logs) {
      span.logs.push(...logs);
      state.pendingLogs.delete(span.spanId);
    }
    added.push(span);
  }
  const live = added.filter((s) => state.buffer.spans.get(s.spanId) === s);
  for (const span of live) resolve(state, span, now, false, events);
  // A new span may complete the wait of one that arrived earlier.
  for (const span of live) {
    const parent = state.buffer.spans.get(span.parentSpanId);
    if (parent && parent.state === 'pending') resolve(state, parent, now, false, events);
    for (const child of childrenOf(state.buffer, span.spanId)) {
      if (child.state === 'pending') resolve(state, child, now, false, events);
    }
  }
  for (const traceId of new Set(live.map((s) => s.traceId))) events.push({ type: 'trace', data: { traceId } });
  return events;
}

/**
 * Resolves every span whose wait is over.
 * @param {State} state
 * @param {number} now
 * @returns {Event[]}
 */
export function expire(state, now) {
  /** @type {Event[]} */
  const events = [];
  const due = [...state.pending.entries()].filter(([, deadline]) => deadline <= now).map(([id]) => id);
  for (const id of due) {
    const span = state.buffer.spans.get(id);
    if (span && span.state === 'pending') resolve(state, span, now, true, events);
    state.pending.delete(id);
  }
  return events;
}

/**
 * @param {State} state
 * @returns {number|null} when `expire` should next run
 */
export function nextDeadline(state) {
  let next = null;
  for (const deadline of state.pending.values()) if (next === null || deadline < next) next = deadline;
  return next;
}

/**
 * Attaches log records whose event name starts with `gen_ai.` to their span; drops the rest.
 * @param {State} state
 * @param {import('../otlp/decode.mjs').LogEvent[]} logs
 * @returns {Event[]}
 */
export function ingestLogs(state, logs) {
  /** @type {Set<string>} */
  const traces = new Set();
  for (const log of logs) {
    if (!log.eventName.startsWith('gen_ai.') || !log.spanId) continue;
    const span = state.buffer.spans.get(log.spanId);
    if (span) {
      span.logs.push(log);
      traces.add(span.traceId);
      continue;
    }
    const list = state.pendingLogs.get(log.spanId) || [];
    list.push(log);
    state.pendingLogs.set(log.spanId, list);
    while (state.pendingLogs.size > PENDING_LOGS_MAX) {
      state.pendingLogs.delete(/** @type {string} */ (state.pendingLogs.keys().next().value));
    }
  }
  return [...traces].map((traceId) => ({ type: /** @type {const} */ ('trace'), data: { traceId } }));
}

/**
 * Empties the buffer, nodes, edges, address table, pending pairings and feed.
 * @param {State} state
 * @returns {Event[]}
 */
export function clearState(state) {
  clearBuffer(state.buffer);
  clearGraph(state.graph);
  state.addresses.clear();
  state.pending.clear();
  state.feed = [];
  state.pendingLogs.clear();
  return [{ type: 'clear', data: {} }];
}

/**
 * What a page receives on connect.
 * @param {State} state
 * @param {number} now
 */
export function snapshot(state, now) {
  return {
    spans: state.buffer.spans.size,
    nodes: [...state.graph.nodes.values()],
    edges: [...state.graph.edges.values()],
    rows: state.feed,
    counts: counts(state.graph, now),
  };
}

/**
 * @param {State} state
 * @param {number} now
 */
export function currentCounts(state, now) {
  return counts(state.graph, now);
}

/**
 * @param {State} state
 * @returns {number}
 */
export function spanCount(state) {
  return state.buffer.spans.size;
}

/**
 * Everything the detail panel shows for one span.
 * @param {State} state
 * @param {string} spanId
 */
export function spanView(state, spanId) {
  const s = state.buffer.spans.get(spanId);
  if (!s) return null;
  return {
    traceId: s.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    service: s.service,
    name: s.name,
    kind: s.kind,
    otelKind: s.otelKind,
    startMs: s.startMs,
    durationMs: s.durationMs,
    status: s.status,
    statusMessage: s.statusMessage,
    source: s.source,
    target: s.target,
    edgeId: s.state === 'drawn' && s.target ? edgeId(s.source, s.target) : '',
    attributes: s.attributes,
    resource: s.resource,
    events: s.events,
    logs: s.logs,
    llm: s.kind === 'llm' ? normalizeLlm(s) : null,
    http: s.kind === 'http' ? httpInfo(s.attributes) : null,
    db: s.kind === 'db' ? dbInfo(s.attributes) : null,
    error: errorInfo(s),
  };
}

/**
 * Every buffered span in the trace, ordered by start time, with its depth in the parent tree.
 * @param {State} state
 * @param {string} traceId
 */
export function traceView(state, traceId) {
  const spans = spansInTrace(state.buffer, traceId);
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  /** @type {Map<string, number>} */
  const depths = new Map();
  /** @param {Span} s @returns {number} */
  const depthOf = (s) => {
    const known = depths.get(s.spanId);
    if (known !== undefined) return known;
    depths.set(s.spanId, 0); // guards against parent cycles
    const parent = byId.get(s.parentSpanId);
    const d = parent ? depthOf(parent) + 1 : 0;
    depths.set(s.spanId, d);
    return d;
  };
  return spans
    .map((s) => ({
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      service: s.service,
      name: s.name,
      kind: s.kind,
      startMs: s.startMs,
      durationMs: s.durationMs,
      status: s.status,
      depth: depthOf(s),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.depth - b.depth);
}

/**
 * @param {State} state
 * @param {Span} span
 * @param {number} now
 * @param {boolean} final
 * @param {Event[]} events
 */
function resolve(state, span, now, final, events) {
  if (span.state !== 'new' && span.state !== 'pending') return;
  const { buffer } = state;
  const decision = decide(
    span,
    {
      get: (id) => buffer.spans.get(id),
      serverChild: (id) => childrenOf(buffer, id).find((c) => c.kind === 'http' && c.otelKind === 'SERVER'),
      knownAddress: (key) => state.addresses.get(key),
    },
    final,
  );
  switch (decision.type) {
    case 'none':
      settle(state, span, 'none');
      return;
    case 'wait':
      if (span.state === 'new') {
        span.state = 'pending';
        state.pending.set(span.spanId, now + PAIR_WAIT_MS);
      }
      return;
    case 'pulse':
      draw(state, span, decision.node, null, now, events);
      return;
    case 'draw': {
      if (decision.learn) learn(state, decision.learn.key, decision.target, now, events);
      draw(state, span, decision.source, decision.target, now, events);
      // A server span whose wait ran out was drawn from Outside before this client arrived:
      // it is the same call, so take it back. (Drawn first, so the shared callee node stays put.)
      const server = decision.pairedServer ? buffer.spans.get(decision.pairedServer) : undefined;
      if (server && server.state === 'drawn') retract(state, server, events);
      return;
    }
    case 'hidden': {
      settle(state, span, 'hidden');
      const client = decision.pairedClient ? buffer.spans.get(decision.pairedClient) : undefined;
      if (client && client.state === 'drawn' && client.targetKind === 'external') {
        const key = addressKey(addressOf(client.attributes));
        if (key) learn(state, key, { id: span.service, kind: span.sdkLanguage === 'webjs' ? 'browser' : 'service' }, now, events);
      }
      return;
    }
  }
}

/**
 * @param {State} state
 * @param {Span} span
 * @param {Span['state']} to
 */
function settle(state, span, to) {
  span.state = to;
  state.pending.delete(span.spanId);
}

/**
 * Records host:port -> service. If calls were already drawn to that address's external node,
 * the node is replaced by the service and those calls move with it.
 * @param {State} state
 * @param {string} key
 * @param {import('./pair.mjs').NodeRef} service
 * @param {number} now
 * @param {Event[]} events
 */
function learn(state, key, service, now, events) {
  state.addresses.set(key, service.id);
  const cut = key.lastIndexOf(':');
  const externalId = externalNodeId({ host: key.slice(0, cut), port: key.slice(cut + 1) });
  const external = state.graph.nodes.get(externalId);
  if (!external || external.kind !== 'external' || externalId === service.id) return;
  const { createdNode, createdEdges } = mergeNode(state.graph, externalId, service, now);
  if (createdNode) events.push({ type: 'node', data: createdNode });
  for (const edge of createdEdges) events.push({ type: 'edge', data: edge });
  events.push({ type: 'node-removed', data: { id: externalId, into: service.id } });
  for (const s of state.buffer.spans.values()) {
    if (s.state !== 'drawn' || (s.target !== externalId && s.source !== externalId)) continue;
    if (s.target === externalId) {
      s.target = service.id;
      s.targetKind = service.kind;
    }
    if (s.source === externalId) s.source = service.id;
    const row = state.feed.find((r) => r.spanId === s.spanId);
    if (row) {
      row.source = s.source;
      row.target = s.target;
    }
    events.push({ type: 'span', data: row || toRow(s) });
  }
}

/**
 * @param {State} state
 * @param {Span} span
 * @param {import('./pair.mjs').NodeRef} source
 * @param {import('./pair.mjs').NodeRef|null} target null for a pulse
 * @param {number} now
 * @param {Event[]} events
 */
function draw(state, span, source, target, now, events) {
  const { graph } = state;
  const srcNode = ensureNode(graph, source, now);
  if (srcNode) events.push({ type: 'node', data: srcNode });
  if (target) {
    const dstNode = ensureNode(graph, target, now);
    if (dstNode) events.push({ type: 'node', data: dstNode });
    const edge = ensureEdge(graph, source.id, target.id, now);
    if (edge) events.push({ type: 'edge', data: edge });
  }
  recordCall(graph, source.id, target ? target.id : '', span.durationMs, now);
  span.source = source.id;
  span.target = target ? target.id : '';
  span.targetKind = target ? target.kind : '';
  span.pulse = !target;
  span.drawnAt = now;
  settle(state, span, 'drawn');
  const row = toRow(span);
  state.feed.push(row);
  if (state.feed.length > FEED_MAX) state.feed.splice(0, state.feed.length - FEED_MAX);
  events.push({ type: 'span', data: row });
}

/**
 * Takes back a drawn call: its row goes, and so do an edge and a node nothing else uses.
 * @param {State} state
 * @param {Span} span
 * @param {Event[]} events
 */
function retract(state, span, events) {
  span.state = 'hidden';
  const i = state.feed.findIndex((r) => r.spanId === span.spanId);
  if (i !== -1) state.feed.splice(i, 1);
  events.push({ type: 'span-removed', data: { spanId: span.spanId } });
  const { removedEdges, removedNodes } = unrecordCall(state.graph, span.source, span.target, span.durationMs, span.drawnAt);
  for (const id of removedEdges) events.push({ type: 'edge-removed', data: { id } });
  for (const id of removedNodes) events.push({ type: 'node-removed', data: { id, into: '' } });
}

/**
 * @param {Span} s
 * @returns {Row}
 */
function toRow(s) {
  return {
    spanId: s.spanId,
    traceId: s.traceId,
    name: s.name,
    kind: s.kind,
    status: s.status,
    durationMs: s.durationMs,
    startMs: s.startMs,
    source: s.source,
    target: s.target,
    pulse: s.pulse,
  };
}
