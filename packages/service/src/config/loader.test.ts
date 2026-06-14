import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('proper-lockfile', () => ({
  default: { lock: vi.fn() },
}))

vi.mock('./paths.js', () => ({
  CONFIG_PATHS: {
    base: '/test',
    config: '/test/config',
    data: '/test/data',
    settings: '/test/config/settings.json',
    models: '/test/config/models.json',
    projects: '/test/config/projects.json',
    users: '/test/config/users.json',
    roles: '/test/config/roles.json',
    usage: '/test/data/usage.json',
    secret: '/test/config/secret',
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

import { readConfig, writeConfig, initConfigDirs, getOrCreateSecret, appendUsageRecord } from './loader.js'
import * as fs from 'node:fs/promises'
import lockfile from 'proper-lockfile'

const mockReadFile = vi.mocked(fs.readFile)
const mockWriteFile = vi.mocked(fs.writeFile)
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

  it('returns default and writes file when file is empty', async () => {
    mockReadFile.mockResolvedValueOnce('   ' as any) // empty/whitespace
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await readConfig('models')
    expect(Array.isArray(result)).toBe(true)
  })

  it('rethrows non-ENOENT errors', async () => {
    mockReadFile.mockRejectedValue(new Error('permission denied'))
    await expect(readConfig('models')).rejects.toThrow('permission denied')
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
  it('acquires lock, writes JSON, and releases lock', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('{}' as any)

    const models = [{ id: 'm1' }]
    await writeConfig('models', models as any)

    expect(mockLock).toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/config/models.json',
      JSON.stringify(models, null, 2),
      'utf-8',
    )
    expect(releaseFn).toHaveBeenCalled()
  })

  it('releases lock even if write fails', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValue('{}' as any)
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(writeConfig('models', [] as any)).rejects.toThrow('disk full')
    expect(releaseFn).toHaveBeenCalled()
  })

  it('creates initial file when it does not exist', async () => {
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT')) // first read fails → create initial

    await writeConfig('models', [] as any)
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/config/models.json',
      '{}',
      'utf-8',
    )
  })

  it('rethrows when lock acquisition fails and does not call release (line 98 false branch)', async () => {
    mockLock.mockRejectedValue(new Error('lock failed'))
    mockReadFile.mockResolvedValue('{}' as any)

    await expect(writeConfig('models', [] as any)).rejects.toThrow('lock failed')
    // release is undefined (lock never acquired) → finally skips release call
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('appendUsageRecord', () => {
  it('reads existing usage and appends new record', async () => {
    const existing = [{ id: 'r1' }]
    mockReadFile.mockResolvedValueOnce(JSON.stringify(existing) as any)
    const releaseFn = vi.fn().mockResolvedValue(undefined)
    mockLock.mockResolvedValue(releaseFn)
    mockReadFile.mockResolvedValueOnce('{}' as any)

    const newRecord = { id: 'r2', timestamp: new Date().toISOString() } as any
    await appendUsageRecord(newRecord)

    const writeCall = mockWriteFile.mock.calls.find(c => c[0] === '/test/data/usage.json')
    expect(writeCall).toBeDefined()
    const written = JSON.parse(writeCall![1] as string)
    expect(written).toHaveLength(2)
    expect(written[1].id).toBe('r2')
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
