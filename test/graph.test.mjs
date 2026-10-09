import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counts, createGraph, ensureEdge, ensureNode, median, mergeNode, recordCall } from '../src/core/graph.mjs';

test('nodes take the next row of their column, in order of first appearance', () => {
  const g = createGraph();
  const a = ensureNode(g, { id: 'Outside', kind: 'outside' }, 0);
  const b = ensureNode(g, { id: 'api', kind: 'service' }, 0);
  const c = ensureNode(g, { id: 'web', kind: 'service' }, 0);
  const d = ensureNode(g, { id: 'pg', kind: 'db' }, 0);
  assert.deepEqual([a?.column, a?.row], [0, 0]);
  assert.deepEqual([b?.column, b?.row], [1, 0]);
  assert.deepEqual([c?.column, c?.row], [1, 1]);
  assert.deepEqual([d?.column, d?.row], [2, 0]);
  assert.equal(ensureNode(g, { id: 'api', kind: 'service' }, 0), null);
});

test('rows are never reused, so existing nodes never move', () => {
  const g = createGraph();
  ensureNode(g, { id: 'x:1', kind: 'external' }, 0);
  mergeNode(g, 'x:1', { id: 'svc', kind: 'service' }, 0);
  const next = ensureNode(g, { id: 'pg', kind: 'db' }, 0);
  assert.equal(next?.row, 1);
});

test('edges are keyed source>target and created once', () => {
  const g = createGraph();
  assert.equal(ensureEdge(g, 'a', 'b', 0)?.id, 'a>b');
  assert.equal(ensureEdge(g, 'a', 'b', 0), null);
  assert.equal(ensureEdge(g, 'b', 'a', 0)?.id, 'b>a');
});

test('counts: calls arriving plus pulses per node, count and median per edge, last 60 s only', () => {
  const g = createGraph();
  ensureNode(g, { id: 'api', kind: 'service' }, 0);
  ensureNode(g, { id: 'pg', kind: 'db' }, 0);
  ensureEdge(g, 'api', 'pg', 0);
  recordCall(g, 'api', 'pg', 38, 1000);
  recordCall(g, 'api', 'pg', 22, 1000);
  recordCall(g, 'api', 'pg', 41, 1000);
  recordCall(g, 'api', '', 5, 1000);
  let c = counts(g, 2000);
  assert.deepEqual(c.nodes.api, { count: 1, lastSeen: 1000 });
  assert.deepEqual(c.nodes.pg, { count: 3, lastSeen: 1000 });
  assert.deepEqual(c.edges['api>pg'], { count: 3, medianMs: 38 });
  c = counts(g, 61_001);
  assert.equal(c.nodes.pg.count, 0);
  assert.deepEqual(c.edges['api>pg'], { count: 0, medianMs: null });
});

test('merging a node moves its edges and counts', () => {
  const g = createGraph();
  ensureNode(g, { id: 'front', kind: 'service' }, 0);
  ensureNode(g, { id: 'orders:9000', kind: 'external' }, 0);
  ensureEdge(g, 'front', 'orders:9000', 0);
  recordCall(g, 'front', 'orders:9000', 50, 10);
  const res = mergeNode(g, 'orders:9000', { id: 'orders-svc', kind: 'service' }, 20);
  assert.equal(res.createdNode?.id, 'orders-svc');
  assert.deepEqual(res.createdEdges.map((e) => e.id), ['front>orders-svc']);
  assert.deepEqual(res.removedEdges, ['front>orders:9000']);
  assert.equal(g.nodes.has('orders:9000'), false);
  const c = counts(g, 100);
  assert.equal(c.nodes['orders-svc'].count, 1);
  assert.deepEqual(c.edges['front>orders-svc'], { count: 1, medianMs: 50 });
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([880, 620, 2000]), 880);
  assert.equal(median([1, 3]), 2);
});
