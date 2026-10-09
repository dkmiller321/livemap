// Writes every E2E fixture as an OTLP JSON file, for feeding Livemap by hand with curl
// (the playwright-headless walkthrough in E2E_TESTS.md section 3).
//   curl -s -H "content-type: application/json" --data-binary @fixtures-out/pair.json http://127.0.0.1:4318/v1/traces
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as f from '../e2e/fixtures/spans.mjs';

const out = 'fixtures-out';
mkdirSync(out, { recursive: true });

/** @type {Record<string, any>} */
const fixtures = {
  'entry-http': f.entryHttp(),
  'entry-http-800ms': f.entryHttp({ id: 'f100000000000011', traceId: 'f1b1'.padEnd(32, '0'), name: 'GET /travel/1', durationMs: 800 }),
  pair: f.pair(),
  'pair-server': f.request(f.pairServer()),
  'pair-client': f.request(f.pairClient()),
  'pair-again': f.pairAgain(),
  orphan: f.orphan(),
  stripe: f.stripe(),
  'late-client': f.lateClient(),
  'late-server': f.lateServer(),
  kinds: f.kinds(),
  'entries-600': f.entries(600),
  'entries-60': f.entries(60),
  'entries-3-fresh': f.entries(3, 60),
  'llm-bare': f.llmBare(),
  'llm-bare-logs': f.llmBareLogs(),
  'other-conventions': f.otherConventions(),
  'late-trace-first': f.lateTraceFirst(),
  'late-trace-second': f.lateTraceSecond(),
};
f.flood(5001).forEach((req, i) => (fixtures[`flood-5001-part${i + 1}`] = req));

for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(out, `${name}.json`), JSON.stringify(body));
process.stdout.write(`Wrote ${Object.keys(fixtures).length} fixtures to ${out}/ (timestamps are "now" at dump time).\n`);
