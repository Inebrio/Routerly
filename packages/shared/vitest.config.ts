import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      reportOnFailure: true,
      // Coverage floor rule: this floor only ever moves up, never down. It is
      // raised by a maintainer, in a pull request that also shows the
      // measurement supporting the new value. It is never lowered just to
      // make a red build green.
      thresholds: { lines: 83.4, branches: 80.0, functions: 78.1, statements: 83.9 },
    },
  },
})
