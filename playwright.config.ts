import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { env } from './e2e/helpers/env';

// Playwright starts Livemap (and the examples once `npm run examples:setup` has run) unless BASE_URL is set.
const webServer = env.EXTERNAL_LIVEMAP
  ? []
  : [
      {
        command: `node bin/livemap.mjs --port ${env.LIVEMAP_PORT} --otlp-port ${env.LIVEMAP_OTLP_PORT}`,
        url: `http://127.0.0.1:${env.LIVEMAP_PORT}/healthz`,
        reuseExistingServer: false,
        timeout: 15_000,
        stdout: 'ignore' as const,
        stderr: 'pipe' as const,
      },
      ...(existsSync('examples/python-app/.venv')
        ? [
            {
              command: 'node examples/mock-llm/server.mjs',
              url: `http://127.0.0.1:${env.MOCK_LLM_PORT}/healthz`,
              reuseExistingServer: false,
              timeout: 15_000,
            },
            {
              command: 'npm run example:node',
              url: `http://127.0.0.1:${env.NODE_EXAMPLE_PORT}/healthz`,
              reuseExistingServer: false,
              timeout: 60_000,
            },
            {
              command: 'npm run example:python',
              url: `http://127.0.0.1:${env.PYTHON_EXAMPLE_PORT}/healthz`,
              reuseExistingServer: false,
              timeout: 60_000,
            },
          ]
        : []),
    ];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  expect: { timeout: 1000 },
  grepInvert: env.RUN_SMOKE === '1' ? undefined : /@smoke/,
  use: {
    baseURL: env.BASE_URL,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer,
});
