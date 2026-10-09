import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { api, edges, healthz, node, nodes, postLogs, postMetrics, postTraces } from './helpers/livemap';
import { env } from './helpers/env';
import { llmBare, llmBareLogs } from './fixtures/spans.mjs';

const NODE_APP = `http://127.0.0.1:${env.NODE_EXAMPLE_PORT}`;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '__pycache__' || name === '.venv') return [];
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** A feed row with this kind and route. */
const routeRow = (page: Page, kind: string, route: string) =>
  page.locator(`[data-testid="feed-row"][data-kind="${kind}"]`).filter({
    has: page.getByTestId('row-route').getByText(route, { exact: true }),
  });

test('E2E-24 @stage4 a Node app shows up with no code changes', async ({ page }) => {
  const appFiles = [...filesUnder('examples/node-app/src'), ...filesUnder('examples/python-app/app')];
  expect(appFiles.length).toBeGreaterThan(0);
  for (const f of appFiles) expect(readFileSync(f, 'utf8'), f).not.toMatch(/opentelemetry/i);
  const readme = readFileSync('README.md', 'utf8');
  for (const line of [
    'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318',
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    'OTEL_TRACES_EXPORTER=otlp',
    'OTEL_BSP_SCHEDULE_DELAY=200',
  ]) expect(readme).toContain(line);

  const ctx = await api();
  const res = await ctx.get(`${NODE_APP}/hello`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ reply: 'Hello from the mock model.' });

  await expect(node(page, 'Outside')).toHaveCount(1, { timeout: 5000 });
  await expect(node(page, 'node-example')).toHaveAttribute('data-kind', 'service', { timeout: 5000 });
  await expect(node(page, 'openai')).toHaveAttribute('data-kind', 'llm', { timeout: 5000 });
  const httpRow = routeRow(page, 'http', 'Outside → node-example').filter({ has: page.getByTestId('row-name').getByText('GET /hello', { exact: true }) });
  await expect(httpRow).toHaveCount(1, { timeout: 5000 });
  const llmRow = routeRow(page, 'llm', 'node-example → openai');
  await expect(llmRow).toHaveCount(1, { timeout: 5000 });
  const labels = await page.getByTestId('node-label').allTextContents();
  expect(labels.some((l) => l.includes('4599'))).toBe(false);

  await llmRow.click();
  await expect(page.getByTestId('llm-model')).toHaveText('mock-model');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('12');
  await expect(page.getByTestId('llm-output-tokens')).toHaveText('6');
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('say hello');
  await expect(page.getByTestId('llm-response')).toContainText('Hello from the mock model.');
});

test('E2E-25 @stage4 one request across two real apps appears live, with its prompt', async ({ page }) => {
  const ctx = await api();
  const res = await ctx.get(`${NODE_APP}/order/1042`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ order: 1042, status: 'shipped', summary: 'Order 1042 has shipped.' });

  await expect(nodes(page)).toHaveCount(5, { timeout: 5000 });
  const nodeIds = await nodes(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')));
  expect([...nodeIds].sort()).toEqual(['Outside', 'node-example', 'openai', 'python-example', 'sqlite']);
  await expect(node(page, 'sqlite')).toHaveAttribute('data-kind', 'db');
  await expect(node(page, 'openai')).toHaveAttribute('data-kind', 'llm');
  await expect(edges(page)).toHaveCount(4, { timeout: 5000 });
  const edgeIds = await edges(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-edge-id')));
  expect([...edgeIds].sort()).toEqual(['Outside>node-example', 'node-example>python-example', 'python-example>openai', 'python-example>sqlite']);

  const routes = await page.getByTestId('row-route').allTextContents();
  expect(routes.filter((r) => r === 'node-example → python-example')).toHaveLength(1);
  expect(routes.some((r) => r.includes('4502') || r.includes('4599'))).toBe(false);

  const dbRow = routeRow(page, 'db', 'python-example → sqlite');
  await expect(dbRow).toHaveCount(1, { timeout: 5000 });
  await dbRow.click();
  await expect(page.getByTestId('db-system')).toHaveText('sqlite');
  await expect(page.getByTestId('db-statement')).toContainText('SELECT');
  await expect(page.getByTestId('db-statement')).toContainText('orders');

  const llmRow = routeRow(page, 'llm', 'python-example → openai');
  await expect(llmRow).toHaveCount(1, { timeout: 5000 });
  await llmRow.click();
  await expect(page.getByTestId('llm-model')).toHaveText('mock-model');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('18');
  await expect(page.getByTestId('llm-output-tokens')).toHaveText('5');
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('order status');
  await expect(page.getByTestId('llm-response')).toContainText('Order 1042 has shipped.');

  const wf = page.getByTestId('waterfall').getByTestId('waterfall-row');
  await expect(page.locator('[data-testid="waterfall-row"][data-service="node-example"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="waterfall-row"][data-service="python-example"]').first()).toBeVisible();
  await expect(wf.first()).toHaveAttribute('data-depth', '0');
  await expect(wf.first()).toHaveAttribute('data-service', 'node-example');
  await expect(wf.first()).toContainText('GET /order/:id');
});

test('E2E-26 @stage4 a failed LLM call from a real app shows as an error', async ({ page }) => {
  const ctx = await api();
  const res = await ctx.get(`${NODE_APP}/boom`);
  expect(res.status()).toBe(502);
  expect(await res.json()).toEqual({ error: 'llm_failed' });
  await expect(routeRow(page, 'llm', 'node-example → openai')).toHaveAttribute('data-status', 'error', { timeout: 5000 });
  const boom = page.locator('[data-testid="feed-row"]').filter({ has: page.getByTestId('row-name').getByText('GET /boom', { exact: true }) });
  await expect(boom).toHaveAttribute('data-status', 'error', { timeout: 5000 });
});

test('E2E-27 @stage4 prompt text can arrive as log events', async ({ page }) => {
  await postTraces(llmBare());
  const r = page.locator('[data-testid="feed-row"][data-span-id="d500000000000001"]');
  await r.click();
  await expect(page.getByTestId('llm-model')).toHaveText('gpt-x');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('7');
  await expect(page.getByTestId('llm-no-content')).toBeVisible();
  await expect(page.getByTestId('llm-no-content')).toHaveText('Content not captured');
  await page.getByTestId('detail-close').click();
  await expect(page.getByTestId('detail-panel')).toBeHidden();

  const logRes = await postLogs(llmBareLogs());
  expect(logRes.status()).toBe(200);
  await r.click();
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('ping from logs');
  await expect(page.getByTestId('llm-response')).toContainText('pong from logs');
  await expect(page.getByTestId('llm-no-content')).toBeHidden();

  expect((await postMetrics({})).status()).toBe(200);
  expect((await healthz()).body.spans).toBe(1);
});
