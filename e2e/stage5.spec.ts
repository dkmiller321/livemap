import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import {
  OTLP_URL,
  api,
  edge,
  healthz,
  node,
  nodes,
  playDemoOnce,
  postTraces,
  row,
  rows,
  sid,
  sleep,
  spawnLivemap,
  startDemo,
  stats,
  visibleRowIds,
  visibleRows,
  waterfallRow,
} from './helpers/livemap';
import { env } from './helpers/env';
import { entries, entryHttp, entryId, lateTraceFirst, lateTraceSecond, otherConventions } from './fixtures/spans.mjs';

const NODE_APP = `http://127.0.0.1:${env.NODE_EXAMPLE_PORT}`;

const routeRow = (page: Page, kind: string, route: string) =>
  page.locator(`[data-testid="feed-row"][data-kind="${kind}"]`).filter({
    has: page.getByTestId('row-route').getByText(route, { exact: true }),
  });

test('E2E-28 @stage5 a browser page joins the trace', async ({ page, context }) => {
  const app = await context.newPage();
  await app.goto(`${NODE_APP}/`);
  await app.getByTestId('ask-button').click();
  await expect(app.getByTestId('ask-result')).toHaveText('Hello from the mock model.', { timeout: 10_000 });

  await expect(node(page, 'browser-example')).toHaveAttribute('data-kind', 'browser', { timeout: 5000 });
  await expect(node(page, 'browser-example')).toHaveAttribute('data-column', '0');
  await expect(edge(page, 'browser-example>node-example')).toHaveCount(1, { timeout: 5000 });
  await expect(routeRow(page, 'http', 'browser-example → node-example')).toHaveCount(1, { timeout: 5000 });
  const routes = await page.getByTestId('row-route').allTextContents();
  expect(routes.filter((r) => r === 'browser-example → node-example')).toHaveLength(1);

  const llmRow = routeRow(page, 'llm', 'node-example → openai');
  await expect(llmRow).toHaveCount(1, { timeout: 5000 });
  await llmRow.click();
  const wf = page.getByTestId('waterfall').getByTestId('waterfall-row');
  await expect(page.locator('[data-testid="waterfall-row"][data-service="browser-example"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="waterfall-row"][data-service="node-example"]').first()).toBeVisible();
  await expect(wf.first()).toHaveAttribute('data-service', 'browser-example');

  const ctx = await api();
  const ok = await ctx.fetch(`${OTLP_URL}/v1/traces`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:4501', 'Access-Control-Request-Method': 'POST' },
  });
  expect(ok.status()).toBe(204);
  expect(ok.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:4501');
  const evil = await ctx.fetch(`${OTLP_URL}/v1/traces`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
});

test('E2E-29 @stage5 other LLM conventions are recognised', async ({ page }) => {
  await postTraces(otherConventions());
  await expect(row(page, 'd600000000000001')).toHaveAttribute('data-kind', 'llm');
  await expect(row(page, 'd600000000000002')).toHaveAttribute('data-kind', 'llm');
  await expect(node(page, 'anthropic')).toHaveAttribute('data-kind', 'llm');
  await expect(node(page, 'openai')).toHaveAttribute('data-kind', 'llm');

  await row(page, 'd600000000000001').click();
  await expect(page.getByTestId('llm-model')).toHaveText('claude-x');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('11');
  await expect(page.getByTestId('llm-output-tokens')).toHaveText('4');
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('hi from openinference');
  await expect(page.getByTestId('llm-response')).toContainText('hello back');

  await row(page, 'd600000000000002').click();
  await expect(page.getByTestId('llm-model')).toHaveText('gpt-y');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('9');
  await expect(page.getByTestId('llm-output-tokens')).toHaveText('2');
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('hi from openllmetry');
  await expect(page.getByTestId('llm-response')).toContainText('hey there');
});

test('E2E-30 @stage5 nodes and edges carry counts', async ({ page }) => {
  await playDemoOnce();
  const expected: Record<string, string> = {
    'shop-browser': '0',
    'shop-web': '3',
    'shop-api': '6',
    'shop-worker': '1',
    redis: '1',
    openai: '3',
    postgresql: '4',
    kafka: '1',
  };
  for (const [id, count] of Object.entries(expected)) await expect(node(page, id).getByTestId('node-count')).toHaveText(count);
  await expect(edge(page, 'shop-api>postgresql').getByTestId('edge-label')).toHaveText('3 · 38 ms');
  await expect(edge(page, 'shop-api>openai').getByTestId('edge-label')).toHaveText('3 · 880 ms');
  const idle = await nodes(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-idle')));
  expect(idle).toEqual(Array(8).fill('false'));
});

test('E2E-31 @stage5 filters', async ({ page }) => {
  await playDemoOnce();
  await expect(rows(page)).toHaveCount(19);

  await page.getByTestId('filter-kind').selectOption('llm');
  await expect(visibleRows(page)).toHaveCount(3);
  expect(await visibleRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['llm', 'llm', 'llm']);
  await page.getByTestId('filter-kind').selectOption('all');

  await page.getByTestId('filter-errors').check();
  await expect(visibleRows(page)).toHaveCount(3);
  expect((await visibleRowIds(page)).sort()).toEqual(['c01', 'c03', 'c05'].map(sid));
  await page.getByTestId('filter-errors').uncheck();

  await page.getByTestId('filter-text').fill('ORDERS');
  await expect(visibleRows(page)).toHaveCount(7);
  expect((await visibleRowIds(page)).sort()).toEqual(['a10', 'b01', 'b03', 'b05', 'b06', 'b07', 'b08'].map(sid));
  await page.getByTestId('filter-text').fill('');

  await node(page, 'postgresql').click();
  await expect(page.getByTestId('filter-chip')).toContainText('postgresql');
  await expect(visibleRows(page)).toHaveCount(4);
  expect((await visibleRowIds(page)).sort()).toEqual(['a10', 'a12', 'b05', 'b08'].map(sid));
  await page.getByTestId('filter-chip-clear').click();
  await expect(visibleRows(page)).toHaveCount(19);

  await edge(page, 'kafka>shop-worker').click();
  await expect(visibleRows(page)).toHaveCount(1);
  expect(await visibleRowIds(page)).toEqual([sid('b07')]);
});

test('E2E-32 @stage5 pause, resume and the clear button', async ({ page }) => {
  const pause = page.getByTestId('pause-button');
  await pause.click();
  await expect(pause).toHaveText('Resume');
  await playDemoOnce();
  await sleep(1000);
  await expect(rows(page)).toHaveCount(0);
  await expect(nodes(page)).toHaveCount(0);
  expect((await healthz()).body.spans).toBe(27);

  await pause.click();
  await expect(pause).toHaveText('Pause');
  await expect(rows(page)).toHaveCount(19);
  await expect(nodes(page)).toHaveCount(8);

  await page.getByTestId('clear-button').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect.poll(async () => (await healthz()).body.spans).toBe(0);
});

test('E2E-33 @stage5 scrolling back holds the feed still', async ({ page }) => {
  await postTraces(entries(60));
  await expect(rows(page)).toHaveCount(60);
  const feed = page.getByTestId('feed');
  await feed.evaluate((el) => el.scrollBy(0, 300));
  await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const first = await rows(page).first().getAttribute('data-span-id');

  await postTraces(entries(3, 60));
  const pill = page.getByTestId('new-rows-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('3 new');
  expect(await rows(page).first().getAttribute('data-span-id')).toBe(first);

  await pill.click();
  await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(pill).toBeHidden();
  await expect(rows(page).first()).toHaveAttribute('data-span-id', entryId(62));
});

test('E2E-34 @stage5 hide content masks everything sensitive and survives a reload', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('a13')).click();
  await expect(page.getByTestId('llm-response')).toContainText('Order 1042');

  const toggle = page.getByTestId('hide-content-toggle');
  await toggle.check();
  const messages = page.getByTestId('llm-message');
  await expect(messages.first()).toHaveText('[hidden]');
  for (const text of await messages.allTextContents()) expect(text).toBe('[hidden]');
  await expect(page.getByTestId('llm-response')).toHaveText('[hidden]');
  await expect(page.locator('[data-testid="attr-row"][data-key="gen_ai.input.messages"]')).toHaveText('[hidden]');

  await row(page, sid('b05')).click();
  await expect(page.getByTestId('db-statement')).toHaveText('[hidden]');

  await row(page, sid('c01')).click();
  const masked = 'http://localhost:3000/api/recommendations?[hidden]';
  await expect(page.getByTestId('http-target')).toHaveText(masked);
  await expect(page.locator('[data-testid="attr-row"][data-key="url.full"]')).toHaveText(masked);

  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
  await expect(toggle).toBeChecked();
  await row(page, sid('a13')).click();
  await expect(page.getByTestId('llm-response')).toHaveText('[hidden]');
  await toggle.uncheck();
  await expect(page.getByTestId('llm-response')).toContainText('Order 1042');
});

test('E2E-35 @stage5 a failed span shows its exception', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('c03')).click();
  await waterfallRow(page, sid('c04')).click();
  await expect(page.getByTestId('error-type')).toHaveText('UpstreamTimeout');
  await expect(page.getByTestId('error-message')).toHaveText('recommendation model timed out');
  await expect(page.getByTestId('error-stack')).toContainText('at recommend (');
  await row(page, sid('c05')).click();
  await expect(page.getByTestId('error-type')).toHaveText('timeout');
});

test('E2E-36 @stage5 late spans join an open waterfall', async ({ page }) => {
  await postTraces(lateTraceFirst());
  await row(page, 'd700000000000002').click();
  const wf = page.getByTestId('waterfall').getByTestId('waterfall-row');
  await expect(wf).toHaveCount(2);
  await postTraces(lateTraceSecond());
  await expect(wf).toHaveCount(3);
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await expect(waterfallRow(page, 'd700000000000002')).toHaveAttribute('data-selected', 'true');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('E2E-37 @stage5 reduced motion', async ({ page }) => {
    await postTraces(entryHttp());
    await expect(row(page, 'f100000000000001')).toBeVisible();
    await expect(edge(page, 'Outside>solo-api')).toHaveAttribute('data-flash', 'true', { timeout: 500 });
    await sleep(1000);
    await expect(edge(page, 'Outside>solo-api')).toHaveAttribute('data-flash', 'false', { timeout: 100 });
    expect((await stats(page)).particlesSpawned).toBe(0);
  });
});

test('E2E-38 @stage5 sustained load', async ({ page }) => {
  test.setTimeout(120_000);
  await postTraces(entryHttp());
  await expect(row(page, 'f100000000000001')).toBeVisible();
  const demo = startDemo({ rate: 200, seed: 1 });
  const samples: { fps: number; max: number; live: string }[] = [];
  try {
    const start = Date.now();
    for (let i = 1; i <= 60; i++) {
      await sleep(Math.max(0, start + i * 1000 - Date.now()));
      const s = await stats(page);
      const live = (await page.getByTestId('connection-status').textContent()) ?? '';
      samples.push({ fps: s.fps, max: s.maxActiveParticles, live });
    }
  } finally {
    await demo.stop();
  }
  const fps = samples.map((s) => s.fps).sort((a, b) => a - b);
  const median = fps[Math.floor(fps.length / 2)];
  expect(median).toBeGreaterThanOrEqual(30);
  expect((await stats(page)).maxActiveParticles).toBeLessThanOrEqual(150);
  expect(samples.every((s) => s.live === 'Live')).toBe(true);
  await expect(rows(page)).toHaveCount(500);
  const h = await healthz();
  expect(h.status).toBe(200);
  expect(h.body.spans).toBe(5000);
  await expect(node(page, 'solo-api')).toHaveAttribute('data-idle', 'true', { timeout: 5000 });
  await expect(node(page, 'shop-api')).toHaveAttribute('data-idle', 'false');
});

test('E2E-39 @stage5 the page reconnects by itself', async ({ page }) => {
  let lm = spawnLivemap(['--port', '4490', '--otlp-port', '4491']);
  try {
    await expect.poll(() => lm.stdout(), { timeout: 5000 }).toContain('http://127.0.0.1:4490');
    await page.goto('http://127.0.0.1:4490/');
    await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
    await page.evaluate(() => ((window as any).__marker = 1));
    lm.kill('SIGKILL');
    await lm.exit;
    await expect(page.getByTestId('connection-status')).toHaveText('Reconnecting…', { timeout: 3000 });
    lm = spawnLivemap(['--port', '4490', '--otlp-port', '4491']);
    await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
    expect(await page.evaluate(() => (window as any).__marker)).toBe(1);
  } finally {
    lm.kill('SIGKILL');
    await lm.exit;
  }
});

function folderState(dir: string) {
  return readdirSync(dir)
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

test('E2E-40 @stage5 init prints the right lines and touches nothing', async () => {
  const lines = [
    'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318',
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    'OTEL_TRACES_EXPORTER=otlp',
    'OTEL_BSP_SCHEDULE_DELAY=200',
  ];
  const dirs: string[] = [];
  const run = async (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'livemap-init-'));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const before = folderState(dir);
    const p = spawnLivemap(['init'], { cwd: dir });
    const code = await p.exit;
    expect(folderState(dir)).toEqual(before);
    return { code, out: p.stdout() };
  };
  try {
    const nodeRun = await run({ 'package.json': '{"name":"some-app","version":"1.0.0"}\n' });
    expect(nodeRun.code).toBe(0);
    expect(nodeRun.out).toContain('--require @opentelemetry/auto-instrumentations-node/register');
    for (const l of lines) expect(nodeRun.out).toContain(l);

    const pyRun = await run({ 'requirements.txt': 'fastapi\n' });
    expect(pyRun.code).toBe(0);
    expect(pyRun.out).toContain('opentelemetry-instrument');

    const emptyRun = await run({});
    expect(emptyRun.code).toBe(0);
    expect(emptyRun.out).toContain('No Node or Python project found');
    for (const l of lines) expect(emptyRun.out).toContain(l);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('E2E-41 @stage5 keyboard and labels', async ({ page }) => {
  await playDemoOnce();
  await expect(rows(page)).toHaveCount(19);
  const first = rows(page).first();
  const firstId = await first.getAttribute('data-span-id');
  let focused = false;
  for (let i = 0; i < 120 && !focused; i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate((id) => document.activeElement?.getAttribute('data-span-id') === id, firstId);
  }
  expect(focused).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-panel')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-span-id'))).toBe(firstId);

  await expect(row(page, sid('a13')).getByTestId('row-kind')).toHaveText('LLM');
  await expect(row(page, sid('a06')).getByTestId('row-kind')).toHaveText('Agent');
});
