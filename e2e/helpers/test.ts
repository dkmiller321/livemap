// The shared `test`: every spec starts from a cleared Livemap with the page open and Live (1.2).
import { test as base, expect } from '@playwright/test';
import { clear, openLivemap } from './livemap';

export const test = base.extend<{ livemap: void }>({
  livemap: [
    async ({ page }, use) => {
      const res = await clear();
      expect(res.status()).toBe(200);
      await openLivemap(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
