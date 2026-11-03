import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@routerly/shared': path.resolve(__dirname, '../shared/src/browser.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // 68 files render React in parallel: the 5s default expires on load, not on
    // a broken assertion, and the file that times out changes every run.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts', 'src/test-setup.ts'],
      // Floor tracks the measured baseline (2026-10-13, release/0.5.4: lines
      // 96.25, branches 93.68, functions 94.08, statements 95.72). The 98%
      // target is an aim; the floor only ever moves up, never down.
      thresholds: { lines: 96.2, branches: 93.6, functions: 94.0, statements: 95.7 },
    },
  },
})
