import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import protobuf from 'protobufjs';
import { DecodeError, decodeLogs, decodeTraces, emptyResponse, formatOf, inflate } from '../src/otlp/decode.mjs';

const require = createRequire(import.meta.url);
const root = protobuf.Root.fromJSON(require('../src/otlp/descriptor.json'));
const TraceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

const json = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }, { key: 'telemetry.sdk.language', value: { stringValue: 'webjs' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'ab'.repeat(16),
              spanId: 'cd'.repeat(8),
              parentSpanId: 'ef'.repeat(8),
              name: 'GET /x',
              kind: 3,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000000025000000',
              attributes: [
                { key: 's', value: { stringValue: 'v' } },
                { key: 'i', value: { intValue: '42' } },
                { key: 'd', value: { doubleValue: 1.5 } },
                { key: 'b', value: { boolValue: true } },
                { key: 'a', value: { arrayValue: { values: [{ stringValue: 'stop' }] } } },
                { key: 'k', value: { kvlistValue: { values: [{ key: 'n', value: { intValue: 1 } }] } } },
              ],
              events: [{ name: 'exception', timeUnixNano: '1700000000010000000', attributes: [{ key: 'exception.type', value: { stringValue: 'Boom' } }] }],
              status: { code: 2, message: 'bad' },
            },
          ],
        },
      ],
    },
  ],
};

test('JSON spans', () => {
  const [s] = decodeTraces(Buffer.from(JSON.stringify(json)), 'json');
  assert.equal(s.service, 'svc');
  assert.equal(s.sdkLanguage, 'webjs');
  assert.equal(s.traceId, 'ab'.repeat(16));
  assert.equal(s.parentSpanId, 'ef'.repeat(8));
  assert.equal(s.otelKind, 'CLIENT');
  assert.equal(s.durationMs, 25);
  assert.equal(s.startMs, 1700000000000);
  assert.equal(s.status, 'error');
  assert.equal(s.statusMessage, 'bad');
  assert.deepEqual(s.attributes, { s: 'v', i: 42, d: 1.5, b: true, a: ['stop'], k: { n: 1 } });
  assert.equal(s.events[0].name, 'exception');
  assert.equal(s.events[0].timeMs, 1700000000010);
});

test('protobuf gives the same span as JSON', () => {
  const hex = (/** @type {string} */ h) => Buffer.from(h, 'hex');
  const sp = json.resourceSpans[0].scopeSpans[0].spans[0];
  const msg = TraceRequest.fromObject({
    resourceSpans: [
      {
        resource: json.resourceSpans[0].resource,
        scopeSpans: [{ spans: [{ ...sp, traceId: hex(sp.traceId), spanId: hex(sp.spanId), parentSpanId: hex(sp.parentSpanId) }] }],
      },
    ],
  });
  const buf = Buffer.from(TraceRequest.encode(msg).finish());
  assert.deepEqual(decodeTraces(buf, 'protobuf'), decodeTraces(Buffer.from(JSON.stringify(json)), 'json'));
});

test('enum names are accepted as well as numbers', () => {
  const copy = structuredClone(json);
  /** @type {any} */ (copy.resourceSpans[0].scopeSpans[0].spans[0]).kind = 'SPAN_KIND_SERVER';
  /** @type {any} */ (copy.resourceSpans[0].scopeSpans[0].spans[0]).status = { code: 'STATUS_CODE_ERROR' };
  const [s] = decodeTraces(Buffer.from(JSON.stringify(copy)), 'json');
  assert.equal(s.otelKind, 'SERVER');
  assert.equal(s.status, 'error');
});

test('a missing service name becomes unknown_service; no parent is empty', () => {
  const body = { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: '1'.repeat(32), spanId: '2'.repeat(16), name: 'x' }] }] }] };
  const [s] = decodeTraces(Buffer.from(JSON.stringify(body)), 'json');
  assert.equal(s.service, 'unknown_service');
  assert.equal(s.parentSpanId, '');
  assert.equal(s.otelKind, 'UNSPECIFIED');
  assert.equal(s.status, 'ok');
});

test('an empty request has no spans', () => {
  assert.deepEqual(decodeTraces(Buffer.from('{}'), 'json'), []);
  assert.deepEqual(decodeTraces(Buffer.alloc(0), 'protobuf'), []);
});

test('bad input throws DecodeError', () => {
  assert.throws(() => decodeTraces(Buffer.from('{not json'), 'json'), DecodeError);
  assert.throws(() => decodeTraces(Buffer.from('[1]'), 'json'), DecodeError);
  assert.throws(() => decodeTraces(Buffer.from([0xff, 0xff, 0xff, 0xff]), 'protobuf'), DecodeError);
  assert.throws(() => decodeTraces(Buffer.from('{"resourceSpans":{}}'), 'json'), DecodeError);
  const badId = { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'zz', spanId: '2'.repeat(16) }] }] }] };
  assert.throws(() => decodeTraces(Buffer.from(JSON.stringify(badId)), 'json'), DecodeError);
});

test('content types and encodings', () => {
  assert.equal(formatOf('application/json; charset=utf-8'), 'json');
  assert.equal(formatOf('application/x-protobuf'), 'protobuf');
  assert.throws(() => formatOf('text/plain'), DecodeError);
  assert.equal(inflate(gzipSync(Buffer.from('hi')), 'gzip').toString(), 'hi');
  assert.equal(inflate(Buffer.from('hi'), undefined).toString(), 'hi');
  assert.throws(() => inflate(Buffer.from('not gzip'), 'gzip'), DecodeError);
  assert.throws(() => inflate(Buffer.from('x'), 'br'), DecodeError);
  assert.equal(emptyResponse('json').toString(), '{}');
  assert.equal(emptyResponse('protobuf').length, 0);
});

test('log records: event name from the field or the event.name attribute; kvlist bodies', () => {
  const body = {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              { traceId: 'ab'.repeat(16), spanId: 'cd'.repeat(8), eventName: 'gen_ai.user.message', body: { kvlistValue: { values: [{ key: 'content', value: { stringValue: 'hi' } }] } } },
              { traceId: 'ab'.repeat(16), spanId: 'cd'.repeat(8), attributes: [{ key: 'event.name', value: { stringValue: 'gen_ai.choice' } }], body: { stringValue: '{"index":0}' } },
            ],
          },
        ],
      },
    ],
  };
  const logs = decodeLogs(Buffer.from(JSON.stringify(body)), 'json');
  assert.equal(logs[0].eventName, 'gen_ai.user.message');
  assert.deepEqual(logs[0].body, { content: 'hi' });
  assert.equal(logs[1].eventName, 'gen_ai.choice');
  assert.equal(logs[1].body, '{"index":0}');
  assert.equal(logs[1].spanId, 'cd'.repeat(8));
});
