import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsageError, checkLoopbackTarget, hookupLines, parseArgs } from '../src/cli/args.mjs';

test('defaults', () => {
  const o = parseArgs([]);
  assert.equal(o.command, 'serve');
  assert.equal(o.port, 4400);
  assert.equal(o.otlpPort, 4318);
  assert.equal(o.maxSpans, 5000);
  assert.equal(o.open, false);
});

test('flags, in both spellings', () => {
  const o = parseArgs(['--port', '4490', '--otlp-port=4491', '--max-spans', '10', '--open']);
  assert.deepEqual([o.port, o.otlpPort, o.maxSpans, o.open], [4490, 4491, 10, true]);
});

test('demo flags', () => {
  const o = parseArgs(['demo', '--seed', '7', '--rate', '200', '--once', '--target', 'http://127.0.0.1:4318']);
  assert.deepEqual([o.command, o.seed, o.rate, o.once, o.target], ['demo', 7, 200, true, 'http://127.0.0.1:4318']);
});

test('init command', () => {
  assert.equal(parseArgs(['init']).command, 'init');
});

test('demo-only flags are rejected without demo', () => {
  assert.throws(() => parseArgs(['--once']), UsageError);
});

test('bad values are rejected', () => {
  assert.throws(() => parseArgs(['--port', 'abc']), UsageError);
  assert.throws(() => parseArgs(['--port']), UsageError);
  assert.throws(() => parseArgs(['--nope']), UsageError);
  assert.throws(() => parseArgs(['serve']), UsageError);
  assert.throws(() => parseArgs(['--port', '70000']), UsageError);
});

test('port 4317 is never used', () => {
  assert.throws(() => parseArgs(['--otlp-port', '4317']), UsageError);
  assert.throws(() => parseArgs(['--port', '4317']), UsageError);
});

test('--target accepts loopback addresses only', () => {
  assert.equal(checkLoopbackTarget('http://127.0.0.1:4318/'), 'http://127.0.0.1:4318');
  assert.equal(checkLoopbackTarget('localhost:4318'), 'http://localhost:4318');
  assert.equal(checkLoopbackTarget('http://[::1]:4318'), 'http://[::1]:4318');
  assert.throws(() => checkLoopbackTarget('http://example.com:4318'), UsageError);
  assert.throws(() => checkLoopbackTarget('http://10.0.0.5:4318'), UsageError);
  assert.throws(() => checkLoopbackTarget('https://127.0.0.1:4318'), UsageError);
});

test('hookup lines name the receiver port', () => {
  assert.deepEqual(hookupLines(4491), [
    'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4491',
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    'OTEL_TRACES_EXPORTER=otlp',
    'OTEL_BSP_SCHEDULE_DELAY=200',
  ]);
});
