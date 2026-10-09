import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbInfo, errorInfo, httpInfo } from '../src/core/detail.mjs';

test('http: full URL when known, otherwise the route; current and legacy names', () => {
  assert.deepEqual(httpInfo({ 'http.request.method': 'GET', 'url.full': 'http://x/a?b=1', 'http.response.status_code': 502 }), {
    method: 'GET',
    target: 'http://x/a?b=1',
    status: '502',
  });
  assert.deepEqual(httpInfo({ 'http.method': 'POST', 'http.route': '/v1/answer', 'http.status_code': 200 }), {
    method: 'POST',
    target: '/v1/answer',
    status: '200',
  });
});

test('db: system and statement, current and legacy names', () => {
  assert.deepEqual(dbInfo({ 'db.system.name': 'postgresql', 'db.query.text': 'SELECT 1' }), { system: 'postgresql', statement: 'SELECT 1' });
  assert.deepEqual(dbInfo({ 'db.system': 'sqlite', 'db.statement': 'SELECT 2' }), { system: 'sqlite', statement: 'SELECT 2' });
});

test('error: the exception event first, then error.type and the status message', () => {
  const ex = errorInfo({
    status: 'error',
    statusMessage: 'x',
    attributes: {},
    events: [{ name: 'exception', attributes: { 'exception.type': 'UpstreamTimeout', 'exception.message': 'm', 'exception.stacktrace': 'at f (' } }],
  });
  assert.deepEqual(ex, { type: 'UpstreamTimeout', message: 'm', stack: 'at f (' });
  assert.deepEqual(errorInfo({ status: 'error', statusMessage: 'boom', attributes: { 'error.type': 'timeout' }, events: [] }), {
    type: 'timeout',
    message: 'boom',
    stack: '',
  });
  assert.equal(errorInfo({ status: 'ok', statusMessage: '', attributes: {}, events: [] }), null);
});
