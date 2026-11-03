/**
 * Secret field names that must never appear in any MCP tool's text output,
 * regardless of the fixture used. Mirrors the secret set api.ts strips from
 * model config (apiKey/cfClearance) plus the other provider credential fields.
 */
const FORBIDDEN_MARKERS = [
  'apiKey',
  'cfClearance',
  'awsSecretAccessKey',
  'awsSessionToken',
  'vertexServiceAccountKey',
  'Bearer',
]

/**
 * Assert an MCP tool's text output leaks no secrets: neither a secret field
 * name nor any concrete secret value the test planted in its fixtures.
 * Reused by every tool test (Tasks 3, 4, 6) so the secret-leak contract is
 * checked identically everywhere.
 * // ponytail: plain throw instead of vitest's `expect`, this file lives in
 * // the shipped source tree (not *.test.ts), and this repo has no build-time
 * // exclusion for test files (dist already ships *.test.js with vitest
 * // imports as inert dead code); avoiding the vitest import here removes the
 * // devDependency-in-dist concern at the root instead of chasing a naming
 * // convention that doesn't exist in this codebase.
 */
export function expectNoSecrets(text: string, secretValues: string[] = []): void {
  for (const marker of [...FORBIDDEN_MARKERS, ...secretValues]) {
    if (text.includes(marker)) {
      throw new Error(`expectNoSecrets: output leaked forbidden marker "${marker}"`)
    }
  }
}
