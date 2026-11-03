import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { PRODUCT_VERSION } from './version.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('RA-04 — PRODUCT_VERSION', () => {
  it('AC — equals the version declared in packages/service/package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
    ) as { version: string }

    expect(PRODUCT_VERSION).toBe(pkg.version)
    expect(PRODUCT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
