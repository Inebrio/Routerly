import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { pingTelemetry, TELEMETRY_ENDPOINT } from './telemetry.js'

// vitest.config sets ROUTERLY_TELEMETRY_DISABLED=1 so no real pings fire.
// Tests that exercise HTTP logic must temporarily unset it.

function withTelemetryEnabled(fn: () => void | Promise<void>) {
  return async () => {
    delete process.env['ROUTERLY_TELEMETRY_DISABLED']
    try {
      await fn()
    } finally {
      process.env['ROUTERLY_TELEMETRY_DISABLED'] = '1'
    }
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env['ROUTERLY_TELEMETRY_DISABLED'] = '1'
})

describe('TELEMETRY_ENDPOINT', () => {
  it('is a valid https URL', () => {
    expect(TELEMETRY_ENDPOINT).toMatch(/^https:\/\//)
  })
})

describe('pingTelemetry', () => {
  it('returns false immediately when ROUTERLY_TELEMETRY_DISABLED is set', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const result = await pingTelemetry('id', 'install')
    expect(result).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls fetch with correct endpoint', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)
    await pingTelemetry('install-id-1', 'install')
    expect(mockFetch).toHaveBeenCalledWith(
      TELEMETRY_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    )
  }))

  it('sends correct event payload', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)
    await pingTelemetry('abc-123', 'upgrade')
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.event).toBe('upgrade')
    expect(body.installId).toBe('abc-123')
    expect(body.platform).toBe(process.platform)
    expect(typeof body.version).toBe('string')
  }))

  it('sends uninstall event', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)
    await pingTelemetry('id-x', 'uninstall')
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.event).toBe('uninstall')
  }))

  it('returns false and does not throw when fetch rejects', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', mockFetch)
    const result = await pingTelemetry('id', 'install')
    expect(result).toBe(false)
  }))

  it('returns false and does not throw when fetch is undefined', withTelemetryEnabled(async () => {
    vi.stubGlobal('fetch', undefined)
    const result = await pingTelemetry('id', 'install')
    expect(result).toBe(false)
  }))

  it('sends JSON content-type header', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)
    await pingTelemetry('id', 'install')
    const opts = mockFetch.mock.calls[0]![1]
    expect(opts.headers['Content-Type']).toBe('application/json')
  }))

  it('returns true when server responds ok', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)
    const result = await pingTelemetry('id', 'install')
    expect(result).toBe(true)
  }))

  it('returns false when server responds not-ok', withTelemetryEnabled(async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 500, ok: false })
    vi.stubGlobal('fetch', mockFetch)
    const result = await pingTelemetry('id', 'install')
    expect(result).toBe(false)
  }))
})

describe('pkgVersion module-level branch (line 11)', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    process.env['ROUTERLY_TELEMETRY_DISABLED'] = '1'
  })

  it('uses "unknown" as version when package.json has no version field (falsy branch)', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn().mockReturnValue('{}'),
    }))
    vi.resetModules()

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)

    delete process.env['ROUTERLY_TELEMETRY_DISABLED']
    const { pingTelemetry: ping } = await import('./telemetry.js')
    await ping('id-noversion', 'install')

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.version).toBe('unknown')
  })

  it('uses "unknown" as version when package.json read throws (catch branch)', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT') }),
    }))
    vi.resetModules()

    const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', mockFetch)

    delete process.env['ROUTERLY_TELEMETRY_DISABLED']
    const { pingTelemetry: ping } = await import('./telemetry.js')
    await ping('id-throw', 'install')

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.version).toBe('unknown')
  })
})
