import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { pingTelemetry, TELEMETRY_ENDPOINT } from './telemetry.js'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('TELEMETRY_ENDPOINT', () => {
  it('is a valid https URL', () => {
    expect(TELEMETRY_ENDPOINT).toMatch(/^https:\/\//)
  })
})

describe('pingTelemetry', () => {
  it('calls fetch with correct endpoint', () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)
    pingTelemetry('install-id-1', 'install')
    expect(mockFetch).toHaveBeenCalledWith(
      TELEMETRY_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends correct event payload', () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)
    pingTelemetry('abc-123', 'upgrade')
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.event).toBe('upgrade')
    expect(body.installId).toBe('abc-123')
    expect(body.platform).toBe(process.platform)
    expect(typeof body.version).toBe('string')
  })

  it('sends uninstall event', () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)
    pingTelemetry('id-x', 'uninstall')
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.event).toBe('uninstall')
  })

  it('does not throw when fetch rejects', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', mockFetch)
    expect(() => pingTelemetry('id', 'install')).not.toThrow()
    // allow the rejected promise to settle without unhandled rejection
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('does not throw when fetch is undefined', () => {
    vi.stubGlobal('fetch', undefined)
    expect(() => pingTelemetry('id', 'install')).not.toThrow()
  })

  it('sends JSON content-type header', () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)
    pingTelemetry('id', 'install')
    const opts = mockFetch.mock.calls[0]![1]
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('returns void (fire-and-forget)', () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)
    const result = pingTelemetry('id', 'install')
    expect(result).toBeUndefined()
  })
})

describe('pkgVersion module-level branch (line 11)', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses "unknown" as version when package.json has no version field (falsy branch)', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn().mockReturnValue('{}'),
    }))
    vi.resetModules()

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)

    const { pingTelemetry: ping } = await import('./telemetry.js')
    ping('id-noversion', 'install')

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.version).toBe('unknown')
  })

  it('uses "unknown" as version when package.json read throws (catch branch)', async () => {
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT') }),
    }))
    vi.resetModules()

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', mockFetch)

    const { pingTelemetry: ping } = await import('./telemetry.js')
    ping('id-throw', 'install')

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.version).toBe('unknown')
  })
})
