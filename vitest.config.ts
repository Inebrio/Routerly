import { defineConfig, loadEnv } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Load .env if present — provides ROUTERLY_TEST_TOKEN and other E2E credentials
  const env = loadEnv(mode ?? 'test', process.cwd(), '')

  return {
    test: {
      include: ['test/**/*.test.ts'],
      env,
      // E2E tests hit a real network — generous timeouts
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }
})
