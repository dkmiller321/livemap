// Real-model smoke suite (manual only). Loose assertions: model output varies.
import { test, expect } from './helpers/test';
import { api } from './helpers/livemap';
import { env } from './helpers/env';

const NODE_APP = `http://127.0.0.1:${env.NODE_EXAMPLE_PORT}`;
const enabled = env.RUN_SMOKE === '1' && env.MOCK_LLM === '0' && !!env.LLM_API_KEY && !!env.LLM_MODEL;

test.skip(!enabled, 'needs RUN_SMOKE=1, MOCK_LLM=0, LLM_API_KEY and LLM_MODEL');

test('SMOKE-1 @smoke Node app, real model', async ({ page }) => {
  const res = await (await api()).get(`${NODE_APP}/hello`, { timeout: 30_000 });
  expect(res.status()).toBe(200);
  const llm = page.locator('[data-testid="feed-row"][data-kind="llm"]').filter({ hasText: 'node-example' });
  await expect(llm.first()).toBeVisible({ timeout: 10_000 });
  await llm.first().click();
  await expect(page.getByTestId('llm-model')).toContainText(env.LLM_MODEL);
  expect(Number(await page.getByTestId('llm-input-tokens').textContent())).toBeGreaterThan(0);
  await expect(page.getByTestId('llm-response')).not.toBeEmpty({ timeout: 5000 });
});

test('SMOKE-2 @smoke Python app, real model', async ({ page }) => {
  const res = await (await api()).get(`${NODE_APP}/order/1042`, { timeout: 30_000 });
  expect(res.status()).toBe(200);
  const llm = page.locator('[data-testid="feed-row"][data-kind="llm"]').filter({ hasText: 'python-example' });
  await expect(llm.first()).toBeVisible({ timeout: 10_000 });
  await llm.first().click();
  await expect(page.getByTestId('llm-response')).not.toBeEmpty({ timeout: 5000 });
  await expect(page.locator('[data-testid="waterfall-row"][data-service="node-example"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="waterfall-row"][data-service="python-example"]').first()).toBeVisible();
});

test('SMOKE-3 @smoke hide content on a real reply', async ({ page }) => {
  await page.getByTestId('hide-content-toggle').check();
  const res = await (await api()).get(`${NODE_APP}/hello`, { timeout: 30_000 });
  expect(res.status()).toBe(200);
  const llm = page.locator('[data-testid="feed-row"][data-kind="llm"]').filter({ hasText: 'node-example' });
  await expect(llm.first()).toBeVisible({ timeout: 10_000 });
  await llm.first().click();
  await expect(page.getByTestId('llm-response')).toHaveText('[hidden]', { timeout: 5000 });
});
