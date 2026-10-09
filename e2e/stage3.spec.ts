import { test, expect } from './helpers/test';
import { clear, edge, edges, healthz, nodes, playDemoOnce, row, rows, sid, stats, waterfallRow } from './helpers/livemap';

test('E2E-20 @stage3 an LLM call shows what was asked and answered', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('a13')).click();
  const panel = page.getByTestId('detail-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('detail-name')).toHaveText('chat gpt-4o-mini');
  await expect(page.getByTestId('detail-kind')).toHaveText('llm');
  await expect(page.getByTestId('detail-service')).toHaveText('shop-api');
  await expect(page.getByTestId('detail-duration')).toHaveText('880 ms');
  await expect(page.getByTestId('detail-status')).toHaveText('OK');
  await expect(page.getByTestId('llm-provider')).toHaveText('openai');
  await expect(page.getByTestId('llm-model')).toHaveText('gpt-4o-mini');
  await expect(page.getByTestId('llm-input-tokens')).toHaveText('96');
  await expect(page.getByTestId('llm-output-tokens')).toHaveText('23');
  await expect(page.getByTestId('llm-finish-reason')).toHaveText('stop');
  await expect(page.locator('[data-testid="llm-message"][data-role="system"]')).toContainText('You are a support agent for an online shop.');
  await expect(page.locator('[data-testid="llm-message"][data-role="user"]')).toContainText('Where is my order 1042?');
  await expect(page.getByTestId('llm-response')).toContainText('Order 1042 has shipped. 3 units of SKU-7 are in stock.');
  await expect(page.getByTestId('llm-no-content')).toBeHidden();
  await expect(page.locator('[data-testid="attr-row"][data-key="gen_ai.usage.input_tokens"]')).toContainText('96');
  await expect(edge(page, 'shop-api>openai')).toHaveAttribute('data-highlighted', 'true');
  const others = await edges(page).evaluateAll((els) =>
    els.filter((e) => e.getAttribute('data-edge-id') !== 'shop-api>openai').map((e) => e.getAttribute('data-highlighted')),
  );
  expect(others).toEqual(Array(7).fill('false'));

  await row(page, sid('a07')).click();
  await expect(page.getByTestId('llm-finish-reason')).toHaveText('tool_calls');
  const calls = page.getByTestId('llm-tool-call');
  await expect(calls).toHaveCount(2);
  await expect(page.locator('[data-testid="llm-tool-call"][data-tool-name="lookup_order"]')).toContainText('1042');
  await expect(page.locator('[data-testid="llm-tool-call"][data-tool-name="check_stock"]')).toContainText('SKU-7');
});

test('E2E-21 @stage3 the waterfall follows one request through every hop', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('a10')).click();
  const wf = page.getByTestId('waterfall').getByTestId('waterfall-row');
  await expect(wf).toHaveCount(14);
  const order = await wf.evaluateAll((els) => els.map((e) => e.getAttribute('data-span-id')));
  const shorts = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12', 'a13', 'a14'];
  expect(order).toEqual(shorts.map(sid));
  await expect(wf.first()).toHaveAttribute('data-service', 'shop-browser');
  const depths: [string, string][] = [
    ['a01', '0'],
    ['a02', '1'],
    ['a03', '2'],
    ['a04', '3'],
    ['a06', '4'],
    ['a09', '5'],
    ['a10', '6'],
    ['a14', '4'],
    ['a08', '6'],
  ];
  for (const [short, depth] of depths) await expect(waterfallRow(page, sid(short))).toHaveAttribute('data-depth', depth);
  const selected = await wf.evaluateAll((els) => els.filter((e) => e.getAttribute('data-selected') === 'true').map((e) => e.getAttribute('data-span-id')));
  expect(selected).toEqual([sid('a10')]);

  await waterfallRow(page, sid('a05')).click();
  await expect(page.getByTestId('detail-name')).toHaveText('GET session:42');
  await expect(page.getByTestId('db-system')).toHaveText('redis');
  await expect
    .poll(() => wf.evaluateAll((els) => els.filter((e) => e.getAttribute('data-selected') === 'true').map((e) => e.getAttribute('data-span-id'))))
    .toEqual([sid('a05')]);
});

test('E2E-22 @stage3 HTTP and database detail', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('b05')).click();
  await expect(page.getByTestId('db-system')).toHaveText('postgresql');
  await expect(page.getByTestId('db-statement')).toHaveText('INSERT INTO orders (id, sku, qty) VALUES ($1, $2, $3)');

  await row(page, sid('c01')).click();
  await expect(page.getByTestId('http-method')).toHaveText('GET');
  await expect(page.getByTestId('http-target')).toHaveText('http://localhost:3000/api/recommendations?user=42');
  await expect(page.getByTestId('http-status')).toHaveText('502');
  await expect(page.getByTestId('detail-status')).toHaveText('Error');

  await row(page, sid('a03')).click();
  await expect(page.getByTestId('http-method')).toHaveText('POST');
  await expect(page.getByTestId('http-status')).toHaveText('200');
});

test('E2E-23 @stage3 clear empties everything, even with detail open', async ({ page }) => {
  await playDemoOnce();
  await row(page, sid('a13')).click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await clear();
  await expect(page.getByTestId('detail-panel')).toBeHidden();
  await expect(rows(page)).toHaveCount(0);
  await expect(nodes(page)).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  expect((await healthz()).body.spans).toBe(0);
  const s = await stats(page);
  expect([s.particlesSpawned, s.pulsesSpawned, s.maxActiveParticles]).toEqual([0, 0, 0]);

  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
  await playDemoOnce();
  await row(page, sid('a13')).click();
  await expect(page.getByTestId('llm-model')).toHaveText('gpt-4o-mini');
});
