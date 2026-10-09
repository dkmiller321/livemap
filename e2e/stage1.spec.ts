import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import {
  DEMO_TRACE,
  clear,
  getJson,
  healthz,
  playDemoOnce,
  postTraces,
  row,
  rowIds,
  rows,
  sleep,
  stats,
  toProtobuf,
  BASE_URL,
} from './helpers/livemap';
import { entries, entryHttp, flood, floodId, kinds } from './fixtures/spans.mjs';

const ENTRY = 'f100000000000001';

async function expectEntryRow(page: Page) {
  const r = row(page, ENTRY);
  await expect(r).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(r).toHaveAttribute('data-kind', 'http');
  await expect(r.getByTestId('row-name')).toHaveText('GET /ping');
  await expect(r.getByTestId('row-kind')).toHaveText('HTTP');
  await expect(r.getByTestId('row-duration')).toHaveText('25 ms');
}

test('E2E-02 @stage1 a JSON span becomes a feed row', async ({ page }) => {
  const res = await postTraces(entryHttp());
  const returned = Date.now();
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
  const body = JSON.parse(await res.text());
  expect(typeof body).toBe('object');
  expect(Array.isArray(body)).toBe(false);
  expect(body).not.toBeNull();

  const r = row(page, ENTRY);
  await expect(r).toBeVisible({ timeout: 500 });
  expect(Date.now() - returned).toBeLessThan(500);
  await expect(r).toHaveAttribute('data-kind', 'http');
  await expect(r).toHaveAttribute('data-status', 'ok');
  await expect(r.getByTestId('row-name')).toHaveText('GET /ping');
  await expect(r.getByTestId('row-kind')).toHaveText('HTTP');
  await expect(r.getByTestId('row-duration')).toHaveText('25 ms');
  await expect(r.getByTestId('row-status')).toHaveText('OK');
  await expect(r.getByTestId('row-time')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId('empty-state')).toBeHidden();
  expect((await healthz()).body.spans).toBe(1);
});

test('E2E-03 @stage1 protobuf and gzip give the same row', async ({ page }) => {
  let res = await postTraces(toProtobuf(entryHttp()), { contentType: 'application/x-protobuf' });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/x-protobuf');
  await expectEntryRow(page);

  await clear();
  await expect(rows(page)).toHaveCount(0);
  res = await postTraces(entryHttp(), { gzip: true });
  expect(res.status()).toBe(200);
  await expectEntryRow(page);

  await clear();
  await expect(rows(page)).toHaveCount(0);
  res = await postTraces(toProtobuf(entryHttp()), { contentType: 'application/x-protobuf', gzip: true });
  expect(res.status()).toBe(200);
  await expectEntryRow(page);
});

test('E2E-04 @stage1 bad input is rejected and the process survives', async ({ page }) => {
  expect((await postTraces('{not json', { contentType: 'application/json' })).status()).toBe(400);
  expect((await postTraces(Buffer.from([0xff, 0xff, 0xff, 0xff]), { contentType: 'application/x-protobuf' })).status()).toBe(400);
  const big = `{"resourceSpans":[],"pad":"${'x'.repeat(11 * 1024 * 1024)}"}`;
  expect((await postTraces(big, { contentType: 'application/json' })).status()).toBe(400);

  const h = await healthz();
  expect(h.status).toBe(200);
  expect(h.body.spans).toBe(0);
  await expect(rows(page)).toHaveCount(0);

  await postTraces(entryHttp());
  await expect(row(page, ENTRY)).toBeVisible();
});

test('E2E-05 @stage1 every kind is recognised', async ({ page }) => {
  await postTraces(kinds());
  await expect(rows(page)).toHaveCount(9, { timeout: 1500 });
  const expected: Record<string, string> = {
    '01': 'http',
    '02': 'db',
    '03': 'llm',
    '04': 'agent',
    '05': 'tool',
    '06': 'queue',
    '08': 'llm',
    '09': 'db',
    '0a': 'http',
  };
  for (const [suffix, kind] of Object.entries(expected)) {
    await expect(row(page, `e1000000000000${suffix}`)).toHaveAttribute('data-kind', kind);
  }
  await expect(row(page, 'e100000000000007')).toHaveCount(0);
  const internal = await getJson(`${BASE_URL}/api/span/e100000000000007`);
  expect(internal.status).toBe(200);
  expect(internal.body.kind).toBe('internal');
  expect((await healthz()).body.spans).toBe(10);
});

test('E2E-06 @stage1 the buffer drops the oldest span', async ({ page }) => {
  for (const req of flood(5001)) expect((await postTraces(req)).status()).toBe(200);
  expect((await healthz()).body.spans).toBe(5000);
  expect((await getJson(`${BASE_URL}/api/span/${floodId(0)}`)).status).toBe(404);
  expect((await getJson(`${BASE_URL}/api/span/${floodId(1)}`)).status).toBe(200);
  expect((await getJson(`${BASE_URL}/api/span/${floodId(5000)}`)).status).toBe(200);
  await expect(rows(page)).toHaveCount(0);
});

async function collectRows(page: Page) {
  const list = await rows(page).evaluateAll((els) =>
    els.map((e) => [
      e.getAttribute('data-span-id') ?? '',
      e.getAttribute('data-kind') ?? '',
      e.querySelector('[data-testid="row-name"]')?.textContent ?? '',
      e.querySelector('[data-testid="row-duration"]')?.textContent ?? '',
      e.getAttribute('data-status') ?? '',
    ]),
  );
  return list.sort((a, b) => a[0].localeCompare(b[0]));
}

test('E2E-07 @stage1 the demo is the same every run', async ({ page }) => {
  const t0 = Date.now();
  expect(await playDemoOnce()).toBe(0);
  expect(Date.now() - t0).toBeLessThan(5000);
  expect((await healthz()).body.spans).toBe(27);
  expect((await getJson(`${BASE_URL}/api/trace/${DEMO_TRACE.A}`)).body.spans).toHaveLength(14);
  expect((await getJson(`${BASE_URL}/api/trace/${DEMO_TRACE.B}`)).body.spans).toHaveLength(8);
  expect((await getJson(`${BASE_URL}/api/trace/${DEMO_TRACE.C}`)).body.spans).toHaveLength(5);
  await sleep(1000); // past every pairing wait
  const first = await collectRows(page);
  expect(first.length).toBeGreaterThan(0);

  await clear();
  await expect(rows(page)).toHaveCount(0);
  expect(await playDemoOnce()).toBe(0);
  await sleep(1000);
  expect(await collectRows(page)).toEqual(first);
});

test('E2E-08 @stage1 newest first, at most 500 rows', async ({ page }) => {
  const names = ['GET /one', 'GET /two', 'GET /three'];
  for (const [i, name] of names.entries()) {
    await postTraces(entryHttp({ id: `f1000000000000a${i}`, traceId: `f1a${i}`.padEnd(32, '0'), name }));
    await expect(rows(page)).toHaveCount(i + 1);
  }
  await expect(rows(page).nth(0).getByTestId('row-name')).toHaveText('GET /three');
  await expect(rows(page).nth(2).getByTestId('row-name')).toHaveText('GET /one');

  await postTraces(entries(600));
  await expect(rows(page)).toHaveCount(500, { timeout: 3000 });
  expect((await stats(page)).rows).toBe(500);
  await expect(rows(page).nth(0).getByTestId('row-name')).toHaveText('GET /ping/599');
  expect((await healthz()).body.spans).toBe(603);
});

test('E2E-09 @stage1 a reload loses nothing', async ({ page }) => {
  await playDemoOnce();
  await sleep(1000);
  const ids = await rowIds(page);
  expect(ids.length).toBeGreaterThan(0);
  const before = await stats(page);

  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
  await expect.poll(() => rowIds(page)).toEqual(ids);
  const after = await stats(page);
  expect(after.nodes).toBe(before.nodes);
  expect(after.edges).toBe(before.edges);
});
