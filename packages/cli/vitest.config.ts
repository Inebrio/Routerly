import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/test-setup.ts'],
      reportOnFailure: true,
      // Coverage floor rule: this floor only ever moves up, never down. It is
      // raised by a maintainer, in a pull request that also shows the
      // measurement supporting the new value. It is never lowered just to
      // make a red build green.
      thresholds: { lines: 98.6, branches: 95.3, functions: 99.1, statements: 98.4 },
    },
  },
})
