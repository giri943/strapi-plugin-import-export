import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/tests/integration/**/*.test.ts'],
    environment: 'node',
    // Booting Strapi and migrating a fresh SQLite schema takes tens of seconds on a cold start.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One Strapi instance at a time: the app boots in-process and owns a database file.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
