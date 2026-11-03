import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const version = (p: string): string => JSON.parse(readFileSync(p, 'utf-8')).version

describe('product version stamp', () => {
  it('root and every workspace package.json carry the same version', () => {
    const root = version('package.json')
    for (const pkg of ['shared', 'service', 'cli', 'dashboard']) {
      expect(version(`packages/${pkg}/package.json`), pkg).toBe(root)
    }
  })

  it('module manifests match the service version', () => {
    expect(() => execFileSync('node', ['scripts/sync-module-versions.mjs', '--check'], { stdio: 'pipe' })).not.toThrow()
  })
})
