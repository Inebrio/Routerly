import { expect } from 'vitest'

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
 */
export function expectNoSecrets(text: string, secretValues: string[] = []): void {
  for (const marker of [...FORBIDDEN_MARKERS, ...secretValues]) {
    expect(text).not.toContain(marker)
  }
}
