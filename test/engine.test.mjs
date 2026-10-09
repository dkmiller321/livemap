import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearState, createState, expire, ingestLogs, ingestSpans, nextDeadline, snapshot, spanView, traceView } from '../src/core/engine.mjs';

/**
 * @param {Partial<import('../src/otlp/decode.mjs').RawSpan>} o
 * @returns {import('../src/otlp/decode.mjs').RawSpan}
 */
function raw(o) {
  return {
    traceId: 't'.repeat(32),
    spanId: '0',
    parentSpanId: '',
    service: 'svc',
    sdkLanguage: 'nodejs',
    name: 'span',
    otelKind: 'INTERNAL',
    startMs: 1000,
    endMs: 1010,
    durationMs: 10,
    status: 'ok',
    statusMessage: '',
    attributes: {},
    resource: {},
    events: [],
    ...o,
  };
}

const CLIENT = raw({ spanId: 'c1', service: 'front', name: 'GET /items', otelKind: 'CLIENT', durationMs: 40, attributes: { 'http.request.method': 'GET', 'server.address': 'back.internal', 'server.port': 8080 } });
const SERVER = raw({ spanId: 's1', parentSpanId: 'c1', service: 'back', name: 'GET /items', otelKind: 'SERVER', durationMs: 30, attributes: { 'http.request.method': 'GET', 'http.route': '/items' } });

/** @param {import('../src/core/engine.mjs').Event[]} events */
const types = (events) => events.map((e) => e.type);
/** @param {import('../src/core/engine.mjs').Event[]} events */
const spanRows = (events) => events.filter((e) => e.type === 'span').map((e) => /** @type {any} */ (e.data));

test('a pair in one request draws one row, from the client span', () => {
  const st = createState({ maxSpans: 100 });
  const events = ingestSpans(st, [CLIENT, SERVER], 0);
  const rows = spanRows(events);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].spanId, rows[0].source, rows[0].target], ['c1', 'front', 'back']);
  assert.deepEqual([...st.graph.nodes.keys()], ['front', 'back']);
  assert.deepEqual([...st.graph.edges.keys()], ['front>back']);
  assert.equal(st.addresses.get('back.internal:8080'), 'back');
  // Server listed first: same result.
  const st2 = createState({ maxSpans: 100 });
  assert.equal(spanRows(ingestSpans(st2, [SERVER, CLIENT], 0)).length, 1);
});

test('later calls to a learned address are drawn at once', () => {
  const st = createState({ maxSpans: 100 });
  ingestSpans(st, [CLIENT, SERVER], 0);
  const again = raw({ ...CLIENT, spanId: 'c2' });
  const rows = spanRows(ingestSpans(st, [again], 10));
  assert.deepEqual(rows.map((r) => r.target), ['back']);
  assert.equal(nextDeadline(st), null);
});

test('server first, client 100 ms later: one row, no Outside', () => {
  const st = createState({ maxSpans: 100 });
  assert.deepEqual(spanRows(ingestSpans(st, [SERVER], 0)), []);
  assert.equal(nextDeadline(st), 300);
  const rows = spanRows(ingestSpans(st, [CLIENT], 100));
  assert.deepEqual(rows.map((r) => [r.spanId, r.source, r.target]), [['c1', 'front', 'back']]);
  assert.deepEqual(expire(st, 1000), []);
  assert.equal(st.graph.nodes.has('Outside'), false);
});

test('server span whose client never comes is drawn from Outside after 300 ms', () => {
  const st = createState({ maxSpans: 100 });
  const orphan = raw({ spanId: 'o1', parentSpanId: 'ff', service: 'orphan', otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } });
  ingestSpans(st, [orphan], 0);
  assert.deepEqual(expire(st, 299), []);
  const rows = spanRows(expire(st, 300));
  assert.deepEqual(rows.map((r) => [r.source, r.target]), [['Outside', 'orphan']]);
});

test('client to an unknown address becomes external after 300 ms; a late server span corrects it', () => {
  const st = createState({ maxSpans: 100 });
  const lateClient = raw({ spanId: 'l1', service: 'front', name: 'GET', otelKind: 'CLIENT', attributes: { 'http.request.method': 'GET', 'server.address': 'orders.internal', 'server.port': 9000 } });
  ingestSpans(st, [lateClient], 0);
  const drawn = spanRows(expire(st, 300));
  assert.deepEqual(drawn.map((r) => r.target), ['orders.internal:9000']);
  assert.equal(st.graph.nodes.get('orders.internal:9000')?.kind, 'external');

  const lateServer = raw({ spanId: 'l2', parentSpanId: 'l1', service: 'orders-svc', otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } });
  const events = ingestSpans(st, [lateServer], 500);
  assert.deepEqual(types(events), ['node', 'edge', 'node-removed', 'span', 'trace']);
  assert.deepEqual(/** @type {any} */ (events[2].data), { id: 'orders.internal:9000', into: 'orders-svc' });
  const updated = spanRows(events);
  assert.deepEqual(updated.map((r) => [r.spanId, r.target]), [['l1', 'orders-svc']]);
  assert.equal(st.graph.nodes.has('orders.internal:9000'), false);
  assert.deepEqual([...st.graph.edges.keys()], ['front>orders-svc']);
  assert.equal(st.feed.length, 1);
  assert.equal(st.feed[0].target, 'orders-svc');
});

test('the LLM SDK HTTP call under an LLM span is hidden, whichever arrives first', () => {
  const llm = raw({ spanId: 'm1', service: 'api', otelKind: 'CLIENT', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'openai' } });
  const http = raw({ spanId: 'h1', parentSpanId: 'm1', service: 'api', otelKind: 'CLIENT', attributes: { 'http.request.method': 'POST', 'server.address': '127.0.0.1', 'server.port': 4599 } });
  const st = createState({ maxSpans: 100 });
  ingestSpans(st, [http], 0);
  const rows = spanRows(ingestSpans(st, [llm], 150));
  assert.deepEqual(rows.map((r) => r.spanId), ['m1']);
  assert.deepEqual(expire(st, 1000), []);
  assert.equal([...st.graph.nodes.keys()].some((n) => n.includes('4599')), false);
});

test('the buffer evicts the oldest span and its pending wait', () => {
  const st = createState({ maxSpans: 2 });
  const pending = raw({ spanId: 'p1', parentSpanId: 'zz', otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } });
  ingestSpans(st, [pending, raw({ spanId: 'i1' }), raw({ spanId: 'i2' })], 0);
  assert.equal(st.buffer.spans.size, 2);
  assert.equal(st.buffer.spans.has('p1'), false);
  assert.equal(nextDeadline(st), null);
});

test('the feed keeps the newest 500 rows', () => {
  const st = createState({ maxSpans: 5000 });
  const entries = Array.from({ length: 600 }, (_, i) => raw({ spanId: `e${i}`, otelKind: 'SERVER', attributes: { 'http.request.method': 'GET' } }));
  ingestSpans(st, entries, 0);
  assert.equal(st.feed.length, 500);
  assert.equal(st.feed.at(-1)?.spanId, 'e599');
  assert.equal(snapshot(st, 0).rows.length, 500);
});

test('gen_ai log events attach to their span; others are dropped; early logs wait for the span', () => {
  const st = createState({ maxSpans: 10 });
  const log = { traceId: 't'.repeat(32), spanId: 'x1', eventName: 'gen_ai.user.message', timeMs: 0, body: { content: 'hi' }, attributes: {} };
  ingestLogs(st, [log, { ...log, eventName: 'app.started' }]);
  ingestSpans(st, [raw({ spanId: 'x1', attributes: { 'gen_ai.operation.name': 'chat' } })], 0);
  const view = spanView(st, 'x1');
  assert.equal(view?.logs.length, 1);
  assert.deepEqual(view?.llm?.messages, [{ role: 'user', content: 'hi', toolCalls: [] }]);
  const after = ingestLogs(st, [{ ...log, eventName: 'gen_ai.choice', body: { message: { content: 'yo' } } }]);
  assert.deepEqual(types(after), ['trace']);
  assert.equal(spanView(st, 'x1')?.llm?.response, 'yo');
});

test('trace view: ordered by start, with depth from the parent chain', () => {
  const st = createState({ maxSpans: 10 });
  ingestSpans(st, [raw({ spanId: 'b', parentSpanId: 'a', startMs: 5 }), raw({ spanId: 'a', startMs: 0 }), raw({ spanId: 'c', parentSpanId: 'b', startMs: 6 })], 0);
  assert.deepEqual(traceView(st, 't'.repeat(32)).map((s) => [s.spanId, s.depth]), [['a', 0], ['b', 1], ['c', 2]]);
});

test('clear empties buffer, graph, addresses, waits and feed', () => {
  const st = createState({ maxSpans: 10 });
  ingestSpans(st, [CLIENT, SERVER, raw({ spanId: 'w', parentSpanId: 'q', otelKind: 'SERVER', attributes: { 'http.method': 'GET' } })], 0);
  assert.deepEqual(types(clearState(st)), ['clear']);
  assert.equal(st.buffer.spans.size + st.graph.nodes.size + st.graph.edges.size + st.addresses.size + st.pending.size + st.feed.length, 0);
});
