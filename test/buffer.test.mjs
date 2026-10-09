import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSpan, childrenOf, clearBuffer, createBuffer, spansInTrace } from '../src/core/buffer.mjs';

const s = (/** @type {string} */ spanId, traceId = 't1', parentSpanId = '') => ({ spanId, traceId, parentSpanId });

test('holds the newest spans and drops the oldest first', () => {
  const buf = createBuffer(3);
  for (const id of ['a', 'b', 'c']) assert.deepEqual(addSpan(buf, s(id)).evicted, []);
  const res = addSpan(buf, s('d'));
  assert.equal(res.added, true);
  assert.deepEqual(res.evicted.map((x) => x.spanId), ['a']);
  assert.deepEqual([...buf.spans.keys()], ['b', 'c', 'd']);
});

test('a span id already held is ignored', () => {
  const buf = createBuffer(3);
  addSpan(buf, s('a'));
  assert.equal(addSpan(buf, s('a')).added, false);
  assert.equal(buf.spans.size, 1);
});

test('trace and parent indexes follow eviction', () => {
  const buf = createBuffer(2);
  addSpan(buf, s('p', 't1'));
  addSpan(buf, s('c', 't1', 'p'));
  assert.deepEqual(spansInTrace(buf, 't1').map((x) => x.spanId), ['p', 'c']);
  assert.deepEqual(childrenOf(buf, 'p').map((x) => x.spanId), ['c']);
  addSpan(buf, s('x', 't2'));
  addSpan(buf, s('y', 't2'));
  assert.deepEqual(spansInTrace(buf, 't1'), []);
  assert.deepEqual(childrenOf(buf, 'p'), []);
  assert.equal(buf.byTrace.has('t1'), false);
  assert.equal(buf.byParent.has('p'), false);
});

test('clear empties everything', () => {
  const buf = createBuffer(5);
  addSpan(buf, s('a', 't', 'z'));
  clearBuffer(buf);
  assert.equal(buf.spans.size + buf.byTrace.size + buf.byParent.size, 0);
});
