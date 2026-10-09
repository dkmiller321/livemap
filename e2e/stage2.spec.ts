import { test, expect } from './helpers/test';
import { edge, edges, node, nodes, playDemoOnce, postTraces, row, rows, sid, sleep, stats } from './helpers/livemap';
import {
  entries,
  entryHttp,
  lateClient,
  lateServer,
  orphan,
  pair,
  pairAgain,
  pairClient,
  pairServer,
  request,
  stripe,
} from './fixtures/spans.mjs';

const DEMO_EDGES = [
  'shop-browser>shop-web',
  'shop-web>shop-api',
  'shop-api>redis',
  'shop-api>postgresql',
  'shop-api>openai',
  'shop-api>kafka',
  'kafka>shop-worker',
  'shop-worker>postgresql',
];

test('E2E-10 @stage2 the demo draws the whole app', async ({ page }) => {
  await playDemoOnce();
  await expect(nodes(page)).toHaveCount(8);
  const expected: [string, string, string][] = [
    ['shop-browser', 'browser', '0'],
    ['shop-web', 'service', '1'],
    ['shop-api', 'service', '1'],
    ['shop-worker', 'service', '1'],
    ['redis', 'db', '2'],
    ['postgresql', 'db', '2'],
    ['openai', 'llm', '2'],
    ['kafka', 'queue', '2'],
  ];
  for (const [id, kind, column] of expected) {
    await expect(node(page, id)).toHaveAttribute('data-kind', kind);
    await expect(node(page, id)).toHaveAttribute('data-column', column);
  }
  const slots = await nodes(page).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-column')}:${e.getAttribute('data-row')}`));
  expect(new Set(slots).size).toBe(8);

  await expect(edges(page)).toHaveCount(8);
  const edgeIds = await edges(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-edge-id')));
  expect([...edgeIds].sort()).toEqual([...DEMO_EDGES].sort());
  const labels = await page.getByTestId('node-label').allTextContents();
  expect(labels).not.toContain('Outside');
  expect(labels.some((l) => l.includes('api.openai.com'))).toBe(false);

  await expect(rows(page)).toHaveCount(19);
  const kindCounts = await rows(page).evaluateAll((els) =>
    els.reduce<Record<string, number>>((acc, e) => {
      const k = e.getAttribute('data-kind') ?? '';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  );
  expect(kindCounts).toEqual({ http: 6, db: 5, llm: 3, agent: 1, tool: 2, queue: 2 });
  for (const short of ['a02', 'a04', 'a08', 'a14', 'b02', 'b04', 'c02', 'c04']) await expect(row(page, sid(short))).toHaveCount(0);
  await expect(row(page, sid('a03')).getByTestId('row-route')).toHaveText('shop-web → shop-api');
  await expect(row(page, sid('b06')).getByTestId('row-route')).toHaveText('shop-api → kafka');
  await expect(row(page, sid('b07')).getByTestId('row-route')).toHaveText('kafka → shop-worker');
  await expect(row(page, sid('a06')).getByTestId('row-route')).toHaveText('shop-api');
  await expect.poll(async () => {
    const s = await stats(page);
    return [s.particlesSpawned + s.particlesMerged, s.pulsesSpawned];
  }).toEqual([16, 3]);
});

test('E2E-11 @stage2 client and server spans pair into one call', async ({ page }) => {
  await postTraces(pair());
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'd100000000000001').getByTestId('row-route')).toHaveText('front → back');
  await expect(nodes(page)).toHaveCount(2);
  await expect(node(page, 'front')).toHaveCount(1);
  await expect(node(page, 'back')).toHaveCount(1);
  await expect(edges(page)).toHaveCount(1);
  await expect(edge(page, 'front>back')).toHaveCount(1);
  await expect.poll(async () => (await stats(page)).particlesSpawned).toBe(1);

  await postTraces(pairAgain());
  await expect(row(page, 'd100000000000003').getByTestId('row-route')).toHaveText('front → back');
  await expect(rows(page)).toHaveCount(2);
  await expect(nodes(page)).toHaveCount(2);
});

test('E2E-12 @stage2 arrival order does not matter', async ({ page }) => {
  await postTraces(request(pairServer()));
  await sleep(100);
  await postTraces(request(pairClient()));
  await sleep(1000);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'd100000000000001')).toHaveCount(1);
  await expect(nodes(page)).toHaveCount(2);

  await postTraces(orphan());
  await expect(row(page, 'd200000000000001').getByTestId('row-route')).toHaveText('Outside → orphan', { timeout: 1500 });
});

test('E2E-13 @stage2 unknown hosts become external nodes, and a late pairing corrects the map', async ({ page }) => {
  await postTraces(stripe());
  await expect(node(page, 'api.stripe.com')).toHaveAttribute('data-kind', 'external', { timeout: 1500 });
  await expect(node(page, 'api.stripe.com')).toHaveAttribute('data-column', '2');
  await expect(edge(page, 'front>api.stripe.com')).toHaveCount(1);
  await expect(row(page, 'd300000000000001').getByTestId('row-route')).toHaveText('front → api.stripe.com');

  await postTraces(lateClient());
  await expect(node(page, 'orders.internal:9000')).toHaveCount(1, { timeout: 1500 });
  await postTraces(lateServer());
  await expect(node(page, 'orders.internal:9000')).toHaveCount(0);
  await expect(node(page, 'orders-svc')).toHaveAttribute('data-kind', 'service');
  await expect(edge(page, 'front>orders-svc')).toHaveCount(1);
  await expect(edge(page, 'front>orders.internal:9000')).toHaveCount(0);
  await expect(row(page, 'd400000000000001').getByTestId('row-route')).toHaveText('front → orders-svc');
  await expect(row(page, 'd400000000000001')).toHaveCount(1);
  await expect(row(page, 'd400000000000002')).toHaveCount(0);
});

test('E2E-14 @stage2 entry requests come from Outside', async ({ page }) => {
  await postTraces(entryHttp());
  await expect(node(page, 'Outside')).toHaveAttribute('data-kind', 'outside');
  await expect(node(page, 'Outside')).toHaveAttribute('data-column', '0');
  await expect(node(page, 'solo-api')).toHaveAttribute('data-column', '1');
  await expect(edge(page, 'Outside>solo-api')).toHaveCount(1);
  await expect(row(page, 'f100000000000001').getByTestId('row-route')).toHaveText('Outside → solo-api');
});

test('E2E-15 @stage2 nodes appear live and never move', async ({ page }) => {
  await page.evaluate(() => ((window as any).__marker = 1));
  await postTraces(pair());
  await expect(nodes(page)).toHaveCount(2);
  const record = async (id: string) => ({
    column: await node(page, id).getAttribute('data-column'),
    row: await node(page, id).getAttribute('data-row'),
    box: await node(page, id).boundingBox(),
  });
  const before = { front: await record('front'), back: await record('back') };

  await playDemoOnce();
  await expect(nodes(page)).toHaveCount(10);
  for (const id of ['front', 'back'] as const) {
    const after = await record(id);
    expect(after.column).toBe(before[id].column);
    expect(after.row).toBe(before[id].row);
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after.box![k] - before[id].box![k])).toBeLessThanOrEqual(1);
    }
  }
  expect(await page.evaluate(() => (window as any).__marker)).toBe(1);
});

test('E2E-16 @stage2 failures show red, then fade', async ({ page }) => {
  await playDemoOnce();
  const exited = Date.now();
  const left = () => Math.max(1, 1000 - (Date.now() - exited));
  await expect(edge(page, 'shop-api>openai')).toHaveAttribute('data-error', 'true', { timeout: left() });
  await expect(node(page, 'openai')).toHaveAttribute('data-error', 'true', { timeout: left() });

  await expect(rows(page)).toHaveCount(19);
  const errorRows = ['c01', 'c03', 'c05'].map(sid);
  for (const id of errorRows) {
    await expect(row(page, id)).toHaveAttribute('data-status', 'error');
    await expect(row(page, id).getByTestId('row-status')).toHaveText('Error');
  }
  const okCount = await rows(page).evaluateAll(
    (els, errs) => els.filter((e) => !errs.includes(e.getAttribute('data-span-id') ?? '') && e.getAttribute('data-status') === 'ok').length,
    errorRows,
  );
  expect(okCount).toBe(16);

  const legend = page.getByTestId('legend').getByTestId('legend-item');
  await expect(legend).toHaveCount(6);
  expect(await legend.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['http', 'db', 'llm', 'agent', 'tool', 'queue']);

  await sleep(Math.max(0, 3500 - (Date.now() - exited)));
  await expect(edge(page, 'shop-api>openai')).toHaveAttribute('data-error', 'false', { timeout: 100 });
  await expect(node(page, 'openai')).toHaveAttribute('data-error', 'false', { timeout: 100 });
});

test('E2E-17 @stage2 agent and tool steps pulse their service', async ({ page }) => {
  await playDemoOnce();
  await expect.poll(async () => (await stats(page)).pulsesSpawned).toBe(3);
  const a06 = row(page, sid('a06'));
  await expect(a06).toHaveAttribute('data-kind', 'agent');
  await expect(a06.getByTestId('row-name')).toHaveText('invoke_agent support-agent');
  await expect(a06.getByTestId('row-route')).toHaveText('shop-api');
  await expect(row(page, sid('a09'))).toHaveAttribute('data-kind', 'tool');
  await expect(row(page, sid('a11'))).toHaveAttribute('data-kind', 'tool');
  const ids = await edges(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-edge-id') ?? ''));
  for (const id of ids) {
    const [source, target] = id.split('>');
    expect(source).not.toBe(target);
  }
});

test('E2E-18 @stage2 a particle travels for the span\'s duration', async ({ page }) => {
  const waitActive = async (n: number, timeout: number) => {
    await page.waitForFunction((want) => (window as any).__livemap.stats().activeParticles === want, n, { polling: 'raf', timeout });
    return Date.now();
  };
  const active = async () => (await stats(page)).activeParticles;
  const variant = (i: number, durationMs: number) =>
    entryHttp({ id: `f10000000000001${i}`, traceId: `f1b${i}`.padEnd(32, '0'), name: `GET /travel/${i}`, durationMs });

  // 800 ms: travels for 800 ms.
  await postTraces(variant(1, 800));
  let seen = await waitActive(1, 500);
  await sleep(seen + 400 - Date.now());
  expect(await active()).toBe(1);
  await sleep(seen + 1500 - Date.now());
  expect(await active()).toBe(0);

  // 5 ms: clamped up to 300 ms.
  const before = (await stats(page)).particlesSpawned;
  const posted = Date.now();
  await postTraces(variant(2, 5));
  await expect.poll(async () => (await stats(page)).particlesSpawned).toBe(before + 1);
  await waitActive(0, Math.max(1, 1000 - (Date.now() - posted)));

  // 10,000 ms: clamped down to 2,000 ms.
  await postTraces(variant(3, 10_000));
  seen = await waitActive(1, 500);
  await sleep(seen + 1500 - Date.now());
  expect(await active()).toBe(1);
  await sleep(seen + 2600 - Date.now());
  expect(await active()).toBe(0);
});

test('E2E-19 @stage2 at most 150 particles', async ({ page }) => {
  await postTraces(entries(600));
  await sleep(3000);
  const s = await stats(page);
  expect(s.maxActiveParticles).toBeLessThanOrEqual(150);
  expect(s.particlesSpawned + s.particlesMerged).toBe(600);
  expect(s.particlesMerged).toBeGreaterThanOrEqual(450);
});
