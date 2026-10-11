import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 20000,
    coverage: { include: ['packages/core/src/**'], thresholds: { lines: 80 } },
  },
});
