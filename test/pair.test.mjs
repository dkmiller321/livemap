import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyKind } from '../src/core/classify.mjs';
import { decide } from '../src/core/pair.mjs';

/** @param {Partial<import('../src/core/pair.mjs').PairSpan> & {attributes?: Record<string, any>}} o */
function sp(o) {
  const attributes = o.attributes ?? {};
  return {
    spanId: o.spanId ?? 's1',
    parentSpanId: o.parentSpanId ?? '',
    service: o.service ?? 'svc',
    sdkLanguage: o.sdkLanguage ?? 'nodejs',
    otelKind: o.otelKind ?? 'INTERNAL',
    kind: o.kind ?? classifyKind(attributes),
    attributes,
  };
}

/** @param {any[]} spans @param {Record<string, string>} [addresses] */
function ctx(spans, addresses = {}) {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  return {
    get: (/** @type {string} */ id) => byId.get(id),
    serverChild: (/** @type {string} */ id) => spans.find((s) => s.parentSpanId === id && s.kind === 'http' && s.otelKind === 'SERVER'),
    knownAddress: (/** @type {string} */ k) => addresses[k],
  };
}

const client = sp({ spanId: 'c', service: 'front', otelKind: 'CLIENT', attributes: { 'http.request.method': 'GET', 'server.address': 'back.internal', 'server.port': 8080 } });
const server = sp({ spanId: 's', parentSpanId: 'c', service: 'back', otelKind: 'SERVER', attributes: { 'http.request.method': 'GET', 'http.route': '/items' } });

test('internal spans are not drawn', () => {
  assert.deepEqual(decide(sp({}), ctx([]), false), { type: 'none' });
});

test('agent and tool spans pulse their own service node', () => {
  const agent = sp({ attributes: { 'gen_ai.operation.name': 'invoke_agent' } });
  assert.deepEqual(decide(agent, ctx([]), false), { type: 'pulse', node: { id: 'svc', kind: 'service' } });
  const tool = sp({ attributes: { 'gen_ai.operation.name': 'execute_tool' } });
  assert.equal(decide(tool, ctx([]), false).type, 'pulse');
});

test('llm, db and queue spans go to nodes named by provider, system and queue system', () => {
  const llm = decide(sp({ attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openai' } }), ctx([]), false);
  assert.deepEqual(llm, { type: 'draw', source: { id: 'svc', kind: 'service' }, target: { id: 'openai', kind: 'llm' } });
  const db = decide(sp({ attributes: { 'db.system.name': 'redis' } }), ctx([]), false);
  assert.deepEqual(db.type === 'draw' && db.target, { id: 'redis', kind: 'db' });
  const producer = decide(sp({ otelKind: 'PRODUCER', attributes: { 'messaging.system': 'kafka' } }), ctx([]), false);
  assert.deepEqual(producer.type === 'draw' && [producer.source.id, producer.target.id], ['svc', 'kafka']);
});

test('queues: a consumer is drawn from the queue node to its service, without waiting', () => {
  const consumer = decide(sp({ service: 'worker', otelKind: 'CONSUMER', parentSpanId: 'missing', attributes: { 'messaging.system': 'kafka' } }), ctx([]), false);
  assert.deepEqual(consumer, { type: 'draw', source: { id: 'kafka', kind: 'queue' }, target: { id: 'worker', kind: 'service' } });
});

test('a browser service is a browser node', () => {
  const d = decide(sp({ sdkLanguage: 'webjs', attributes: { 'db.system.name': 'x' } }), ctx([]), false);
  assert.deepEqual(d.type === 'draw' && d.source, { id: 'svc', kind: 'browser' });
});

test('pairing: client with its server span draws client -> server service and learns the address', () => {
  assert.deepEqual(decide(client, ctx([client, server]), false), {
    type: 'draw',
    source: { id: 'front', kind: 'service' },
    target: { id: 'back', kind: 'service' },
    learn: { key: 'back.internal:8080', service: 'back' },
  });
});

test('pairing: the server span of a pair is not drawn', () => {
  assert.deepEqual(decide(server, ctx([client, server]), false), { type: 'hidden', pairedClient: 'c' });
});

test('first client span to an unknown host:port waits; at the deadline it becomes an external node', () => {
  assert.deepEqual(decide(client, ctx([client]), false), { type: 'wait' });
  assert.deepEqual(decide(client, ctx([client]), true), {
    type: 'draw',
    source: { id: 'front', kind: 'service' },
    target: { id: 'back.internal:8080', kind: 'external' },
  });
});

test('later client spans to a known address are drawn at once', () => {
  assert.deepEqual(decide(client, ctx([client], { 'back.internal:8080': 'back' }), false), {
    type: 'draw',
    source: { id: 'front', kind: 'service' },
    target: { id: 'back', kind: 'service' },
  });
});

test('external nodes drop :443 and :80', () => {
  const stripe = sp({ spanId: 'x', service: 'front', otelKind: 'CLIENT', attributes: { 'http.request.method': 'POST', 'server.address': 'api.stripe.com', 'server.port': 443 } });
  const d = decide(stripe, ctx([stripe]), true);
  assert.deepEqual(d.type === 'draw' && d.target, { id: 'api.stripe.com', kind: 'external' });
});

test('a server span with no parent is an entry request from Outside', () => {
  const entry = sp({ otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } });
  assert.deepEqual(decide(entry, ctx([entry]), false), { type: 'draw', source: { id: 'Outside', kind: 'outside' }, target: { id: 'svc', kind: 'service' } });
});

test('arrival order: a server span waits for its client, then is drawn from Outside', () => {
  assert.deepEqual(decide(server, ctx([server]), false), { type: 'wait' });
  assert.deepEqual(decide(server, ctx([server]), true), { type: 'draw', source: { id: 'Outside', kind: 'outside' }, target: { id: 'back', kind: 'service' } });
});

test('an HTTP client span whose parent is an LLM span in the same service is hidden', () => {
  const llm = sp({ spanId: 'l', service: 'api', otelKind: 'CLIENT', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openai' } });
  const http = sp({ spanId: 'h', parentSpanId: 'l', service: 'api', otelKind: 'CLIENT', attributes: { 'http.request.method': 'POST', 'server.address': 'api.openai.com', 'server.port': 443 } });
  assert.deepEqual(decide(http, ctx([llm, http]), false), { type: 'hidden' });
  const otherService = { ...http, service: 'other' };
  assert.equal(decide(otherService, ctx([llm, otherService]), true).type, 'draw');
});

test('a server span whose parent is not a client call is drawn from the parent service', () => {
  const producer = sp({ spanId: 'p', service: 'up', otelKind: 'INTERNAL', attributes: {} });
  const s = sp({ spanId: 's2', parentSpanId: 'p', service: 'down', otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } });
  assert.deepEqual(decide(s, ctx([producer, s]), false), { type: 'draw', source: { id: 'up', kind: 'service' }, target: { id: 'down', kind: 'service' } });
});
