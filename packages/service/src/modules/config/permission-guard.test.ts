import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('../../lib/paths.js', () => ({
  CONFIG_PATHS: {
    base: '/test',
    config: '/test/config',
    data: '/test/data',
    settings: '/test/config/settings.json',
    models: '/test/config/models.json',
    projects: '/test/config/projects.json',
    users: '/test/config/users.json',
    roles: '/test/config/roles.json',
    modules: '/test/config/modules.json',
    profiles: '/test/config/profiles.json',
    connections: '/test/config/connections.json',
    instances: '/test/config/instances.json',
    experiments: '/test/config/experiments.json',
    usage: '/test/data/usage.json',
    notifications: '/test/data/notifications.json',
    audit: '/test/data/audit.json',
    updateAnnouncement: '/test/data/update-announcement.json',
    secret: '/test/config/secret',
  },
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

import * as fs from 'node:fs/promises'
import {
  SECRET_KEYS, GENERAL_KEYS, isBypassActive, checkPermissions, fixPermissions, enforceStartupGuard,
} from './permission-guard.js'

const mockStat = vi.mocked(fs.stat)
const mockChmod = vi.mocked(fs.chmod)

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

function eacces(): NodeJS.ErrnoException {
  const err = new Error('EACCES') as NodeJS.ErrnoException
  err.code = 'EACCES'
  return err
}

function statResult(mode: number) {
  return { mode } as unknown as import('node:fs').Stats
}

/** All CONFIG_PATHS keys stat as ENOENT — the fresh-install/EC1 baseline. */
function mockAllMissing(): void {
  mockStat.mockRejectedValue(enoent())
}

afterEach(() => { vi.clearAllMocks(); delete process.env['ROUTERLY_SKIP_PERMISSION_CHECK'] })
beforeEach(() => { mockAllMissing() })

describe('classification', () => {
  it('classifies secret and general keys per the frozen list', () => {
    expect([...SECRET_KEYS].sort()).toEqual(['connections', 'models', 'routers', 'secret', 'users'].sort())
    expect([...GENERAL_KEYS].sort()).toEqual(
      ['settings', 'roles', 'modules', 'profiles', 'instances', 'experiments', 'usage', 'notifications', 'audit', 'updateAnnouncement'].sort(),
    )
  })
})

describe('checkPermissions — mode math', () => {
  it('0o600 (owner-only) is safe', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/users.json' ? statResult(0o600) : Promise.reject(enoent())) as any)
    const status = await checkPermissions()
    expect(status.unsafe).toEqual([])
    expect(status.blocked).toBe(false)
  })

  it('0o644 (group/other read) on a secret file is unsafe and blocks', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/users.json' ? statResult(0o644) : Promise.reject(enoent())) as any)
    const status = await checkPermissions()
    expect(status.blocked).toBe(true)
    expect(status.unsafe).toEqual([{ file: 'users', path: '/test/config/users.json', mode: '644', severity: 'secret' }])
  })

  it('0o640 (group read only) is still unsafe — any group-or-other bit blocks', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/models.json' ? statResult(0o640) : Promise.reject(enoent())) as any)
    const status = await checkPermissions()
    expect(status.blocked).toBe(true)
  })

  it('unsafe general file warns but does not block', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/settings.json' ? statResult(0o644) : Promise.reject(enoent())) as any)
    const status = await checkPermissions()
    expect(status.blocked).toBe(false)
    expect(status.unsafe).toEqual([{ file: 'settings', path: '/test/config/settings.json', mode: '644', severity: 'general' }])
  })
})

describe('EC1 — missing config dir/file', () => {
  it('is treated as safe, no false block', async () => {
    mockAllMissing()
    const status = await checkPermissions()
    expect(status.blocked).toBe(false)
    expect(status.unsafe).toEqual([])
  })
})

describe('EC2 — stat throws for a reason other than ENOENT', () => {
  it('is treated as unsafe for a secrets file, never silently skipped', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/users.json' ? Promise.reject(eacces()) : Promise.reject(enoent())) as any)
    const status = await checkPermissions()
    expect(status.blocked).toBe(true)
    expect(status.unsafe).toEqual([{ file: 'users', path: '/test/config/users.json', mode: 'unknown', severity: 'secret' }])
  })
})

describe('EC3 — fresh stat every call, no caching', () => {
  it('picks up an external chmod between two checks without needing a restart', async () => {
    mockStat.mockImplementationOnce(async () => statResult(0o644))
    const first = await checkPermissions()
    expect(first.blocked).toBe(true)

    mockAllMissing()
    mockStat.mockImplementationOnce(async () => statResult(0o600))
    const second = await checkPermissions()
    expect(second.blocked).toBe(false)
  })
})

describe('bypass', () => {
  it('isBypassActive reflects the env var', () => {
    expect(isBypassActive()).toBe(false)
    process.env['ROUTERLY_SKIP_PERMISSION_CHECK'] = '1'
    expect(isBypassActive()).toBe(true)
  })

  it('checkPermissions reports bypassActive true, blocked false, unsafe [] — even when actually unsafe', async () => {
    process.env['ROUTERLY_SKIP_PERMISSION_CHECK'] = '1'
    mockStat.mockImplementation(async () => statResult(0o644))
    const status = await checkPermissions()
    expect(status).toEqual({ blocked: false, bypassActive: true, unsafe: [] })
  })

  it('every call that has bypass active logs a warning at the startup call site (not once)', async () => {
    process.env['ROUTERLY_SKIP_PERMISSION_CHECK'] = '1'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await enforceStartupGuard()
    await enforceStartupGuard()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })
})

describe('EC5 — bypass active + actually unsafe never triggers an automatic fix', () => {
  it('fixPermissions is never invoked by the bypass path', async () => {
    process.env['ROUTERLY_SKIP_PERMISSION_CHECK'] = '1'
    mockStat.mockImplementation(async () => statResult(0o644))
    await enforceStartupGuard()
    expect(mockChmod).not.toHaveBeenCalled()
  })
})

describe('fixPermissions', () => {
  it('chmods only the currently-unsafe files (secret and general both) and strips group/other bits', async () => {
    mockStat.mockImplementation(async (p) => {
      if (p === '/test/config/users.json') return statResult(0o644)
      if (p === '/test/config/settings.json') return statResult(0o646)
      return Promise.reject(enoent())
    })
    const fixed = await fixPermissions()
    expect(fixed.sort()).toEqual(['settings', 'users'].sort())
    expect(mockChmod).toHaveBeenCalledWith('/test/config/users.json', 0o600)
    expect(mockChmod).toHaveBeenCalledWith('/test/config/settings.json', 0o600)
  })
})

describe('AC1-3 — startup guard', () => {
  it('AC1: unsafe secrets file refuses to start and names the file when non-interactive', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/users.json' ? statResult(0o644) : Promise.reject(enoent())) as any)
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as any)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enforceStartupGuard()).rejects.toThrow('exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('/test/config/users.json'))).toBe(true)
    expect(mockChmod).not.toHaveBeenCalled()
    exitSpy.mockRestore(); errSpy.mockRestore()
  })

  it('AC4: unsafe general file only warns, startup proceeds', async () => {
    mockStat.mockImplementation(async (p) => (p === '/test/config/settings.json' ? statResult(0o644) : Promise.reject(enoent())) as any)
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as any)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(enforceStartupGuard()).resolves.toBeUndefined()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('settings.json'))).toBe(true)
    exitSpy.mockRestore(); warnSpy.mockRestore()
  })

  it('AC8: safe permissions proceed with no block, warning or prompt', async () => {
    mockAllMissing()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as any)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enforceStartupGuard()).resolves.toBeUndefined()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore()
  })
})
