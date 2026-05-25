import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.js'],
    // Round-trip tests do real disk I/O across two tmp dirs; give them headroom on Windows.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Run serially: several specs mock node:fs globally; parallel workers would still be isolated
    // per-file, but Windows AV interaction with rapid tmp-dir churn is calmer single-threaded.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
