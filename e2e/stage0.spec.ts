import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { test, expect } from './helpers/test';
import { BASE_URL, clear, healthz, sleep, spawnLivemap, stats } from './helpers/livemap';
import { env } from './helpers/env';

const HOOKUP = (port: string | number) => [
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${port}`,
  'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
  'OTEL_TRACES_EXPORTER=otlp',
  'OTEL_BSP_SCHEDULE_DELAY=200',
];

test('E2E-00 @stage0 app boots', async ({ page }) => {
  const h = await healthz();
  expect(h.status).toBe(200);
  expect(h.body).toEqual({ status: 'ok', spans: 0 });

  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toContainText('Waiting for traffic');
  for (const line of HOOKUP(4318)) await expect(page.getByTestId('hookup-lines')).toContainText(line);

  await expect(page.getByTestId('connection-status')).toHaveText('Live');
  const s = await stats(page);
  expect(s.connected).toBe(true);
  expect(s.nodes).toBe(0);
  expect(s.edges).toBe(0);
  expect(s.rows).toBe(0);

  const res = await clear();
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ cleared: true });
});

/** Resolves with the exit code, or 'timeout'. */
const exitWithin = (exit: Promise<number | null>, ms: number) =>
  Promise.race([exit, sleep(ms).then(() => 'timeout' as const)]);

/** Resolves with the error code of a TCP connect attempt, or 'connected'. */
function tryConnect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    // Windows retries a refused SYN for about 2 s before reporting ECONNREFUSED.
    socket.setTimeout(6000);
    socket.on('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve('timeout');
    });
    socket.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'error'));
  });
}

test('E2E-01 @stage0 command line and port clash', async () => {
  const pagePort = new URL(BASE_URL).port || '80';
  const otlpPort = new URL(env.OTLP_URL).port || '80';

  const a = spawnLivemap(['--port', pagePort, '--otlp-port', '4491']);
  expect(await exitWithin(a.exit, 3000)).toBe(1);
  expect(a.stderr()).toContain(`Port ${pagePort} is already in use. Choose another with --port.`);

  const b = spawnLivemap(['--port', '4490', '--otlp-port', otlpPort]);
  expect(await exitWithin(b.exit, 3000)).toBe(1);
  expect(b.stderr()).toContain(`Port ${otlpPort} is already in use. Choose another with --otlp-port.`);

  const c = spawnLivemap(['--port', '4490', '--otlp-port', '4491']);
  try {
    await expect
      .poll(() => c.stdout(), { timeout: 1000, intervals: [25] })
      .toContain('http://127.0.0.1:4490');
    for (const line of HOOKUP(4491)) expect(c.stdout()).toContain(line);

    const res = await fetch('http://127.0.0.1:4490/healthz');
    expect(res.status).toBe(200);

    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (external) {
      for (const port of [4490, 4491]) expect(await tryConnect(external.address, port)).toBe('ECONNREFUSED');
    }

    const t0 = Date.now();
    c.kill('SIGINT');
    expect(await exitWithin(c.exit, 1000)).not.toBe('timeout');
    expect(Date.now() - t0).toBeLessThanOrEqual(1000);
  } finally {
    c.kill('SIGKILL');
  }
});
