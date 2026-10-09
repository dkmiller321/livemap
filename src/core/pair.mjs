// The pairing rules (PRD section 6): decide how one span is drawn, given what else has arrived.
import {
  addressKey,
  addressOf,
  dbSystemOf,
  externalNodeId,
  providerOf,
  queueSystemOf,
  serviceNodeKind,
} from './classify.mjs';

/** How long a client span to an unknown address, or a server span, waits for its other half. */
export const PAIR_WAIT_MS = 300;

export const OUTSIDE = 'Outside';

/**
 * @typedef {object} PairSpan
 * @property {string} spanId
 * @property {string} parentSpanId
 * @property {string} service
 * @property {string} sdkLanguage
 * @property {string} otelKind
 * @property {import('./classify.mjs').SpanKind} kind
 * @property {Record<string, any>} attributes
 */

/** @typedef {{id: string, kind: import('./classify.mjs').NodeKind}} NodeRef */

/**
 * @typedef {{type: 'none'}
 *   | {type: 'pulse', node: NodeRef}
 *   | {type: 'draw', source: NodeRef, target: NodeRef, learn?: {key: string, service: string}, pairedServer?: string}
 *   | {type: 'hidden', pairedClient?: string}
 *   | {type: 'wait'}} Decision
 */

/**
 * @typedef {object} PairContext
 * @property {(spanId: string) => PairSpan|undefined} get a span that has arrived
 * @property {(spanId: string) => PairSpan|undefined} serverChild an arrived SERVER http span whose parent is this span
 * @property {(key: string) => string|undefined} knownAddress the service learned for host:port
 */

/**
 * @param {PairSpan} span
 * @param {PairContext} ctx
 * @param {boolean} final true once the span's wait is over: never returns `wait`
 * @returns {Decision}
 */
export function decide(span, ctx, final) {
  const self = serviceRef(span);
  switch (span.kind) {
    case 'internal':
      return { type: 'none' };
    case 'agent':
    case 'tool':
      return { type: 'pulse', node: self };
    case 'llm': {
      const provider = providerOf(span.attributes);
      const target = provider ? provider : externalNodeId(addressOf(span.attributes));
      return { type: 'draw', source: self, target: { id: target === 'unknown' ? 'llm' : target, kind: 'llm' } };
    }
    case 'db':
      return { type: 'draw', source: self, target: { id: dbSystemOf(span.attributes), kind: 'db' } };
    case 'queue': {
      const queue = { id: queueSystemOf(span.attributes), kind: /** @type {const} */ ('queue') };
      return span.otelKind === 'CONSUMER'
        ? { type: 'draw', source: queue, target: self }
        : { type: 'draw', source: self, target: queue };
    }
    case 'http':
      return span.otelKind === 'SERVER' ? decideServer(span, ctx, final) : decideClient(span, ctx, final);
  }
}

/**
 * @param {PairSpan} span
 * @returns {NodeRef}
 */
function serviceRef(span) {
  return { id: span.service, kind: serviceNodeKind(span.sdkLanguage) };
}

/** @type {NodeRef} */
const OUTSIDE_REF = { id: OUTSIDE, kind: 'outside' };

/**
 * @param {PairSpan} span
 * @param {PairContext} ctx
 * @param {boolean} final
 * @returns {Decision}
 */
function decideServer(span, ctx, final) {
  const self = serviceRef(span);
  if (!span.parentSpanId) return { type: 'draw', source: OUTSIDE_REF, target: self };
  const parent = ctx.get(span.parentSpanId);
  if (parent) {
    if (isClientCall(parent)) return { type: 'hidden', pairedClient: parent.spanId };
    if (parent.service !== span.service) return { type: 'draw', source: serviceRef(parent), target: self };
    return { type: 'draw', source: OUTSIDE_REF, target: self };
  }
  if (!final) return { type: 'wait' };
  return { type: 'draw', source: OUTSIDE_REF, target: self };
}

/**
 * @param {PairSpan} span
 * @param {PairContext} ctx
 * @param {boolean} final
 * @returns {Decision}
 */
function decideClient(span, ctx, final) {
  const self = serviceRef(span);
  const parent = span.parentSpanId ? ctx.get(span.parentSpanId) : undefined;
  // The same call seen twice: an LLM SDK's own HTTP request.
  if (parent && parent.kind === 'llm' && parent.service === span.service) return { type: 'hidden' };
  const addr = addressOf(span.attributes);
  const key = addressKey(addr);
  const server = ctx.serverChild(span.spanId);
  if (server) {
    const target = serviceRef(server);
    return key
      ? { type: 'draw', source: self, target, learn: { key, service: target.id }, pairedServer: server.spanId }
      : { type: 'draw', source: self, target, pairedServer: server.spanId };
  }
  const known = key ? ctx.knownAddress(key) : undefined;
  if (known) return { type: 'draw', source: self, target: { id: known, kind: 'service' } };
  if (!final) return { type: 'wait' };
  return { type: 'draw', source: self, target: { id: externalNodeId(addr), kind: 'external' } };
}

/**
 * A span that calls another process over HTTP or RPC.
 * @param {PairSpan} s
 */
export function isClientCall(s) {
  return s.kind === 'http' && s.otelKind !== 'SERVER' && s.otelKind !== 'CONSUMER';
}
