import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('proper-lockfile', () => ({
  default: { lock: vi.fn() },
}))

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
    usage: '/test/data/usage.json',
    secret: '/test/config/secret',
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

import { readConfig, writeConfig, initConfigDirs, getOrCreateSecret, appendUsageRecord, pruneOrphanUsage } from './loader.js'
import * as fs from 'node:fs/promises'
import lockfile from 'proper-lockfile'

const mockReadFile = vi.mocked(fs.readFile)
const mockWriteFile = vi.mocked(fs.writeFile)
const mockRename = vi.mocked(fs.rename)
const mockUnlink = vi.mocked(fs.unlink)
const mockMkdir = vi.mocked(fs.mkdir)
const mockChmod = vi.mocked(fs.chmod)
const mockLock = vi.mocked(lockfile.lock)

afterEach(() => { vi.clearAllMocks() })

describe('initConfigDirs', () => {
  it('creates config and data directories', async () => {
    await initConfigDirs()
    expect(mockMkdir).toHaveBeenCalledWith('/test/config', { recursive: true })
    expect(mockMkdir).toHaveBeenCalledWith('/test/data', { recursive: true })
  })
})

describe('readConfig', () => {
  it('parses and returns existing JSON file', async () => {
    const models = [{ id: 'm1', name: 'M1' }]
    mockReadFile.mockResolvedValue(JSON.stringify(models) as any)
    const result = await readConfig('models')
    expect(result).toEqual(models)
  })

  it('returns default value and creates file when ENOENT', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValueOnce(err)
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    // Second readFile call (inside writeConfig) also fails → write initial file
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await readConfig('models')
    expect(Array.isArray(result)).toBe(true)
    expect((result as any[]).length).toBe(0)
  })

  it('returns default IN MEMORY for a persistently-empty file and NEVER writes (data-loss guard)', async () => {
    // File exists but reads empty on every attempt (initial + 2 retries).
    mockReadFile.mockResolvedValue('   ' as any) // empty/whitespace, always
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)

    const result = await readConfig('projects')

    expect(Array.isArray(result)).toBe(true)
    expect((result as any[]).length).toBe(0)
    // The wipe bug: a transient empty read must NOT persist anything.
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockRename).not.toHaveBeenCalled()
    expect(mockLock).not.toHaveBeenCalled()
  })

  it('rides out a transient empty read: returns the populated data on retry, no write', async () => {
    // First read observes the truncation window (empty); a retry sees the
    // fully-written file. Must return the real data and never persist a default.
    const projects = [{ id: 'p1', name: 'Real' }]
    mockReadFile
      .mockResolvedValueOnce('' as any)                       // racing writer mid-rename
      .mockResolvedValueOnce(JSON.stringify(projects) as any) // rename completed
    const result = await readConfig('projects')

    expect(result).toEqual(projects)
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('rethrows non-ENOENT errors', async () => {
    mockReadFile.mockRejectedValue(new Error('permission denied'))
    await expect(readConfig('models')).rejects.toThrow('permission denied')
  })

  it('seeds modules default with provider-web disabled (off by default) on first run', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValueOnce(err)
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await readConfig('modules')
    expect(result).toEqual([{ id: 'provider-web', enabled: false }])
  })

  it('returns default settings when settings file missing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValueOnce(err)
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await readConfig('settings')
    expect((result as any).port).toBe(3000)
  })
})

describe('writeConfig', () => {
  it('writes to a temp file then renames over the target (atomic publish)', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('[]' as any)

    const models = [{ id: 'm1' }]
    await writeConfig('models', models as any)

    expect(mockLock).toHaveBeenCalled()
    // The final content is written to a temp sibling, never directly to the target.
    const publishWrite = mockWriteFile.mock.calls.find(c => c[1] === JSON.stringify(models, null, 2))
    expect(publishWrite).toBeDefined()
    const tmpPath = String(publishWrite![0])
    expect(tmpPath).toMatch(/^\/test\/config\/models\.json\.tmp-/)
    // The target is never the destination of a direct content writeFile (only via rename).
    expect(mockWriteFile.mock.calls.some(c => c[0] === '/test/config/models.json' && c[1] === JSON.stringify(models, null, 2))).toBe(false)
    // rename publishes temp → target atomically.
    expect(mockRename).toHaveBeenCalledWith(tmpPath, '/test/config/models.json')
    expect(releaseFn).toHaveBeenCalled()
  })

  it('the target is never observed truncated: no empty string is ever written to it', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('[]' as any)

    await writeConfig('projects', [{ id: 'p1' }] as any)

    // No writeFile call ever puts '' or '{}' (truncated/placeholder) onto the real target path.
    const badTargetWrite = mockWriteFile.mock.calls.find(
      c => c[0] === '/test/config/projects.json' && (c[1] === '' || c[1] === '{}'),
    )
    expect(badTargetWrite).toBeUndefined()
  })

  it('releases lock and cleans up the temp file if the write fails', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('[]' as any)
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(writeConfig('models', [] as any)).rejects.toThrow('disk full')
    expect(releaseFn).toHaveBeenCalled()
    // temp file cleaned up on failure (rename never ran)
    expect(mockUnlink).toHaveBeenCalledTimes(1)
    expect(String(mockUnlink.mock.calls[0]![0])).toMatch(/\/test\/config\/models\.json\.tmp-/)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('swallows a temp-cleanup failure and still surfaces the original write error', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('[]' as any)
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))
    mockUnlink.mockRejectedValueOnce(new Error('temp already gone')) // cleanup itself fails

    // The original write error wins; the cleanup failure is swallowed.
    await expect(writeConfig('models', [] as any)).rejects.toThrow('disk full')
    expect(releaseFn).toHaveBeenCalled()
  })

  it('creates initial file with the typed default (not "{}") when it does not exist', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT')) // first read fails → create initial

    await writeConfig('models', [] as any)
    // Seed write uses the correct empty default for an array config, not '{}'.
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/config/models.json',
      JSON.stringify([], null, 2),
      'utf-8',
    )
  })

  it('rethrows when lock acquisition fails and does not publish', async () => {
    mockLock.mockRejectedValue(new Error('lock failed'))
    mockReadFile.mockResolvedValue('[]' as any)

    await expect(writeConfig('models', [] as any)).rejects.toThrow('lock failed')
    // lock never acquired → no rename publish; temp cleanup runs in the catch.
    expect(mockRename).not.toHaveBeenCalled()
  })
})

describe('appendUsageRecord', () => {
  it('skips write when ROUTERLY_SKIP_TRACKING is set', async () => {
    const orig = process.env['ROUTERLY_SKIP_TRACKING']
    process.env['ROUTERLY_SKIP_TRACKING'] = '1'
    try {
      await appendUsageRecord({ id: 'skip-test' } as any)
      expect(mockWriteFile).not.toHaveBeenCalled()
    } finally {
      if (orig === undefined) delete process.env['ROUTERLY_SKIP_TRACKING']
      else process.env['ROUTERLY_SKIP_TRACKING'] = orig
    }
  })

  it('reads existing usage and appends new record', async () => {
    const existing = [{ id: 'r1' }]
    mockReadFile.mockResolvedValueOnce(JSON.stringify(existing) as any)
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValueOnce('{}' as any)

    const newRecord = { id: 'r2', timestamp: new Date().toISOString() } as any
    await appendUsageRecord(newRecord)

    // Content is published via temp file (atomic write), then renamed onto usage.json.
    const writeCall = mockWriteFile.mock.calls.find(c => String(c[0]).startsWith('/test/data/usage.json.tmp-'))
    expect(writeCall).toBeDefined()
    const written = JSON.parse(writeCall![1] as string)
    expect(written).toHaveLength(2)
    expect(written[1].id).toBe('r2')
    expect(mockRename).toHaveBeenCalledWith(String(writeCall![0]), '/test/data/usage.json')
  })
})

describe('getOrCreateSecret', () => {
  it('returns existing secret from file', async () => {
    mockReadFile.mockResolvedValue('existing-secret\n' as any)
    const secret = await getOrCreateSecret()
    expect(secret).toBe('existing-secret')
  })

  it('generates and stores new secret when file does not exist', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)

    const secret = await getOrCreateSecret()
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/config/secret',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.objectContaining({ encoding: 'utf-8' }),
    )
    expect(mockChmod).toHaveBeenCalledWith('/test/config/secret', 0o600)
  })

  it('rethrows non-ENOENT errors', async () => {
    mockReadFile.mockRejectedValue(new Error('access denied'))
    await expect(getOrCreateSecret()).rejects.toThrow('access denied')
  })
})

describe('pruneOrphanUsage (#77 BUG-5)', () => {
  // readConfig reads usage.json and projects.json by path; route the mock per path.
  function byPath(usage: unknown[], projects: unknown[]) {
    mockReadFile.mockImplementation(((p: string) =>
      Promise.resolve(
        p.endsWith('usage.json') ? JSON.stringify(usage)
        : p.endsWith('projects.json') ? JSON.stringify(projects)
        : '[]',
      )) as any)
  }

  it('removes records whose projectId matches no project, keeps real ones', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    const usage = [
      { id: 'u1', projectId: 'real-1', cost: 0.1 },
      { id: 'u2', projectId: 'guardrail', cost: 0, outcome: 'error' },
      { id: 'u3', projectId: 'real-2', cost: 0.2 },
      { id: 'u4', projectId: 'guardrail', cost: 0, outcome: 'error' },
    ]
    byPath(usage, [{ id: 'real-1' }, { id: 'real-2' }])

    const removed = await pruneOrphanUsage()

    expect(removed).toBe(2)
    // wrote the pruned usage back (via temp file), keeping only real records
    const writeCall = mockWriteFile.mock.calls.find(c => String(c[0]).startsWith('/test/data/usage.json.tmp-'))
    expect(writeCall).toBeDefined()
    const written = JSON.parse(String(writeCall![1]))
    expect(written.map((r: any) => r.id)).toEqual(['u1', 'u3'])
  })

  it('does nothing (no write) when there are no orphans', async () => {
    byPath(
      [{ id: 'u1', projectId: 'real-1', cost: 0.1 }],
      [{ id: 'real-1' }],
    )
    const removed = await pruneOrphanUsage()
    expect(removed).toBe(0)
    expect(mockWriteFile.mock.calls.some(c => String(c[0]).endsWith('usage.json'))).toBe(false)
  })
})
