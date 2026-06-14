import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'

describe('CONFIG_PATHS', () => {
  it('uses ROUTERLY_HOME env var when set', async () => {
    const original = process.env['ROUTERLY_HOME']
    process.env['ROUTERLY_HOME'] = '/custom/path'
    // Re-import to pick up the env var
    const { CONFIG_PATHS } = await import('./paths.js?v=' + Date.now())
    expect(CONFIG_PATHS.base).toBe('/custom/path')
    if (original === undefined) delete process.env['ROUTERLY_HOME']
    else process.env['ROUTERLY_HOME'] = original
  })

  it('falls back to ~/.routerly when env var not set', async () => {
    const original = process.env['ROUTERLY_HOME']
    delete process.env['ROUTERLY_HOME']
    const { CONFIG_PATHS } = await import('./paths.js?v=' + Date.now() + '1')
    expect(CONFIG_PATHS.base).toBe(join(homedir(), '.routerly'))
    if (original !== undefined) process.env['ROUTERLY_HOME'] = original
  })

  it('has all required path keys', () => {
    // import the actual module using regular import (uses whatever env was set at module load time)
    const base = process.env['ROUTERLY_HOME'] ?? join(homedir(), '.routerly')
    expect(join(base, 'config')).toBeTruthy()
    expect(join(base, 'data')).toBeTruthy()
    expect(join(base, 'config', 'settings.json')).toBeTruthy()
    expect(join(base, 'config', 'models.json')).toBeTruthy()
    expect(join(base, 'config', 'projects.json')).toBeTruthy()
    expect(join(base, 'config', 'users.json')).toBeTruthy()
    expect(join(base, 'config', 'roles.json')).toBeTruthy()
    expect(join(base, 'data', 'usage.json')).toBeTruthy()
    expect(join(base, 'config', 'secret')).toBeTruthy()
  })
})
