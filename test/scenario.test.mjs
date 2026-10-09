import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createState, ingestSpans, spanCount } from '../src/core/engine.mjs';
import { decodeTraces } from '../src/otlp/decode.mjs';
import { TRACES, TRACE_IDS, exportRequest, longSpanId, onceRequests } from '../src/demo/scenario.mjs';
import { mulberry32, randomTrace } from '../src/demo/generator.mjs';

/** Runs the three --once requests through the real decoder and engine. */
function play() {
  const state = createState({ maxSpans: 5000 });
  const now = 1_800_000_000_000;
  for (const req of onceRequests(now)) ingestSpans(state, decodeTraces(Buffer.from(JSON.stringify(req)), 'json'), now);
  return state;
}

test('27 spans: 14 in A, 8 in B, 5 in C', () => {
  assert.equal(TRACES.A.length, 14);
  assert.equal(TRACES.B.length, 8);
  assert.equal(TRACES.C.length, 5);
  assert.equal(spanCount(play()), 27);
});

test('19 feed rows: http 6, db 5, llm 3, agent 1, tool 2, queue 2', () => {
  const state = play();
  assert.equal(state.feed.length, 19);
  /** @type {Record<string, number>} */
  const kinds = {};
  for (const r of state.feed) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  assert.deepEqual(kinds, { http: 6, db: 5, llm: 3, agent: 1, tool: 2, queue: 2 });
  assert.equal(state.feed.filter((r) => r.pulse).length, 3);
  assert.equal(state.feed.filter((r) => !r.pulse).length, 16);
  assert.deepEqual(state.feed.filter((r) => r.status === 'error').map((r) => r.spanId).sort(), ['c01', 'c03', 'c05'].map(longSpanId));
});

test('8 nodes and 8 edges', () => {
  const state = play();
  assert.deepEqual([...state.graph.nodes.keys()].sort(), ['kafka', 'openai', 'postgresql', 'redis', 'shop-api', 'shop-browser', 'shop-web', 'shop-worker']);
  assert.deepEqual([...state.graph.edges.keys()].sort(), [
    'kafka>shop-worker',
    'shop-api>kafka',
    'shop-api>openai',
    'shop-api>postgresql',
    'shop-api>redis',
    'shop-browser>shop-web',
    'shop-web>shop-api',
    'shop-worker>postgresql',
  ]);
});

test('the table: ids, parents, offsets, durations and statuses', () => {
  const req = exportRequest(TRACES.A, { traceId: TRACE_IDS.A, endMs: 1_800_000_000_000 });
  const spans = decodeTraces(Buffer.from(JSON.stringify(req)), 'json');
  const a01 = spans.find((s) => s.spanId === 'a000000000000001');
  const a13 = spans.find((s) => s.spanId === 'a000000000000013');
  assert.ok(a01 && a13);
  assert.equal(a01.durationMs, 1840);
  assert.equal(a01.endMs, 1_800_000_000_000, 'the latest span ends at send time');
  assert.equal(a13.startMs - a01.startMs, 790);
  assert.equal(a13.parentSpanId, 'a000000000000006');
  // Grouped by service in the order listed.
  assert.deepEqual(req.resourceSpans.map((rs) => rs.resource.attributes[0].value.stringValue), ['shop-browser', 'shop-web', 'shop-api']);
});

test('--once data is identical every run apart from the clock', () => {
  const strip = (/** @type {any} */ reqs) => JSON.stringify(reqs).replace(/"\d{19}"/g, '"T"');
  assert.equal(strip(onceRequests(1_800_000_000_000)), strip(onceRequests(1_800_000_123_456)));
});

test('random variations are seeded', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const ta = randomTrace(a, 1000);
  const tb = randomTrace(b, 1000);
  assert.deepEqual(ta, tb);
  let failing = 0;
  const r = mulberry32(1);
  for (let i = 0; i < 1000; i++) if (randomTrace(r, 0).key === 'C') failing++;
  assert.ok(failing > 60 && failing < 140, `about one trace in ten fails (${failing}/1000)`);
});
