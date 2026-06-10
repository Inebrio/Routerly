/**
 * E2E regression tests — run against a live Routerly instance.
 *
 * Prerequisites:
 *   - Routerly must be running (npm run dev, or Docker)
 *   - ROUTERLY_TEST_TOKEN must be set (project token)
 *
 * Optional variables:
 *   - ROUTERLY_TEST_BASE_URL       default: http://localhost:3000
 *   - ROUTERLY_TEST_ADMIN_EMAIL    default: info@routerly.ai
 *   - ROUTERLY_TEST_ADMIN_PASSWORD enables /api management tests when set
 *
 * Usage:
 *   ROUTERLY_TEST_TOKEN=sk-rt-... npm test
 *   ROUTERLY_TEST_TOKEN=sk-rt-... ROUTERLY_TEST_ADMIN_EMAIL=... ROUTERLY_TEST_ADMIN_PASSWORD=... npm test
 *
 * When ROUTERLY_TEST_TOKEN is not set, all tests in this file are skipped
 * silently — the regular unit/integration suite still runs normally.
 */

import { describe, it, expect, beforeAll } from 'vitest'

const TOKEN         = process.env['ROUTERLY_TEST_TOKEN']
const BASE_URL      = process.env['ROUTERLY_TEST_BASE_URL'] ?? 'http://localhost:3000'
const ADMIN_EMAIL   = process.env['ROUTERLY_TEST_ADMIN_EMAIL'] ?? 'info@routerly.ai'
const ADMIN_PASSWORD = process.env['ROUTERLY_TEST_ADMIN_PASSWORD'] ?? ''

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, { method: 'GET', headers })
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function put(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/** Reads the full SSE body and returns all parsed JSON events. */
async function consumeSSE(res: Response): Promise<unknown[]> {
  const text = await res.text()
  const events: unknown[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') continue
    try { events.push(JSON.parse(data)) } catch { /* non-JSON line — skip */ }
  }
  return events
}

// ─── LLM Proxy tests (project token) ─────────────────────────────────────────

describe.skipIf(!TOKEN)('E2E · LLM Proxy', () => {

  // ── Health ────────────────────────────────────────────────────────────────

  describe('health', () => {
    it('GET /health → 200 with status:ok', async () => {
      const res = await get('/health')
      expect(res.status).toBe(200)
      const body = await res.json() as { status: string }
      expect(body.status).toBe('ok')
    })
  })

  // ── Auth guard ────────────────────────────────────────────────────────────

  describe('auth guard', () => {
    it('POST /v1/chat/completions without token → 401', async () => {
      const res = await post('/v1/chat/completions', {
        model: 'auto',
        messages: [{ role: 'user', content: 'ping' }],
      })
      expect(res.status).toBe(401)
    })

    it('POST /v1/messages without token → 401', async () => {
      const res = await post('/v1/messages', {
        model: 'auto',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      })
      expect(res.status).toBe(401)
    })

    it('POST /v1/chat/completions with invalid token → 401', async () => {
      const res = await post(
        '/v1/chat/completions',
        { model: 'auto', messages: [{ role: 'user', content: 'ping' }] },
        auth('sk-rt-invalid-token-000'),
      )
      expect(res.status).toBe(401)
    })
  })

  // ── Models list ───────────────────────────────────────────────────────────

  describe('GET /v1/models', () => {
    it('returns 200 with non-empty data array', async () => {
      const res = await get('/v1/models', auth(TOKEN!))
      expect(res.status).toBe(200)
      const body = await res.json() as { data: unknown[] }
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
    })
  })

  // ── OpenAI proxy — streaming ──────────────────────────────────────────────

  describe('POST /v1/chat/completions (streaming)', () => {
    it('returns 200 SSE with x-routerly-trace-id header', async () => {
      const res = await post(
        '/v1/chat/completions',
        { model: 'auto', messages: [{ role: 'user', content: 'Ping.' }], max_tokens: 10, stream: true },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('x-routerly-trace-id')).toBeTruthy()
      await res.body?.cancel()
    })

    it('SSE stream contains at least one parseable event', async () => {
      const res = await post(
        '/v1/chat/completions',
        { model: 'auto', messages: [{ role: 'user', content: 'Say "ok".' }], max_tokens: 10, stream: true },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      const events = await consumeSSE(res)
      expect(events.length).toBeGreaterThan(0)
    })

    it('SSE stream contains routing trace events', async () => {
      const res = await post(
        '/v1/chat/completions',
        { model: 'auto', messages: [{ role: 'user', content: 'What is 2+2?' }], max_tokens: 10, stream: true },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      const events = await consumeSSE(res) as Array<{ type?: string }>
      const hasTrace  = events.some(e => e.type === 'trace')
      const hasResult = events.some(e => e.type === 'result')
      expect(hasTrace || hasResult).toBe(true)
    })
  })

  // ── OpenAI proxy — non-streaming ──────────────────────────────────────────

  describe('POST /v1/chat/completions (non-streaming)', () => {
    it('returns 200 JSON with choices array', async () => {
      const res = await post(
        '/v1/chat/completions',
        { model: 'auto', messages: [{ role: 'user', content: 'Reply with "ok".' }], max_tokens: 10, stream: false },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      const body = await res.json() as { choices: unknown[] }
      expect(Array.isArray(body.choices)).toBe(true)
      expect(body.choices.length).toBeGreaterThan(0)
    })
  })

  // ── OpenAI Responses API ──────────────────────────────────────────────────

  describe('POST /v1/responses', () => {
    it('accepts "input" field and returns SSE stream', async () => {
      const res = await post(
        '/v1/responses',
        { model: 'auto', input: [{ role: 'user', content: 'Ping.' }], max_output_tokens: 10 },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const events = await consumeSSE(res)
      expect(events.length).toBeGreaterThan(0)
    })

    it('accepts legacy "max_tokens" field (normalized internally)', async () => {
      const res = await post(
        '/v1/responses',
        { model: 'auto', input: [{ role: 'user', content: 'Ping.' }], max_tokens: 10 },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      await res.body?.cancel()
    })
  })

  // ── Anthropic proxy ───────────────────────────────────────────────────────

  // NOTE: /v1/messages streaming is not yet implemented — the endpoint always
  // returns a non-streaming JSON response regardless of the `stream` field.
  // Add streaming tests here when the feature is implemented.
  describe('POST /v1/messages', () => {
    it('returns 200 JSON with Anthropic message shape', async () => {
      const res = await post(
        '/v1/messages',
        { model: 'auto', messages: [{ role: 'user', content: 'Say hello.' }], max_tokens: 20 },
        auth(TOKEN!),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = await res.json() as { type: string; content: unknown[] }
      expect(body.type).toBe('message')
      expect(Array.isArray(body.content)).toBe(true)
    })
  })
})

// ─── Management API tests (admin credentials) ────────────────────────────────

describe.skipIf(!TOKEN || !ADMIN_PASSWORD)('E2E · Management API', () => {
  let adminJwt = ''

  beforeAll(async () => {
    const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(res.status, 'Admin login failed — check ROUTERLY_TEST_ADMIN_EMAIL / ROUTERLY_TEST_ADMIN_PASSWORD').toBe(200)
    const body = await res.json() as { token: string }
    adminJwt = body.token
    expect(adminJwt).toBeTruthy()
  })

  it('GET /api/projects returns an array', async () => {
    const res = await get('/api/projects', auth(adminJwt))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/models returns an array', async () => {
    const res = await get('/api/models', auth(adminJwt))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/users returns an array', async () => {
    const res = await get('/api/users', auth(adminJwt))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/roles returns an array', async () => {
    const res = await get('/api/roles', auth(adminJwt))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/settings returns settings object', async () => {
    const res = await get('/api/settings', auth(adminJwt))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
    expect(typeof body).toBe('object')
  })

  // ── GET /api/system/info — extended fields ────────────────────────────────

  describe('GET /api/system/info', () => {
    it('returns version string', async () => {
      const res = await get('/api/system/info')
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body['version']).toBe('string')
      expect((body['version'] as string).length).toBeGreaterThan(0)
    })

    it('returns channel field (string)', async () => {
      const res = await get('/api/system/info')
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body['channel']).toBe('string')
    })

    it('returns isDocker field (boolean)', async () => {
      const res = await get('/api/system/info')
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body['isDocker']).toBe('boolean')
    })

    it('returns updateInfo as null or object with expected shape', async () => {
      const res = await get('/api/system/info')
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      if (body['updateInfo'] !== null) {
        const ui = body['updateInfo'] as Record<string, unknown>
        expect(typeof ui['available']).toBe('boolean')
        expect(typeof ui['currentVersion']).toBe('string')
        expect(typeof ui['latestVersion']).toBe('string')
        expect(typeof ui['channel']).toBe('string')
        expect(typeof ui['checkedAt']).toBe('string')
      }
    })
  })

  // ── GET /api/system/update-check ─────────────────────────────────────────

  describe('GET /api/system/update-check', () => {
    it('returns 401 when called without auth', async () => {
      const res = await get('/api/system/update-check')
      expect(res.status).toBe(401)
    })

    it('returns UpdateInfo shape when called with admin JWT', async () => {
      const res = await get('/api/system/update-check', auth(adminJwt))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body['available']).toBe('boolean')
      expect(typeof body['currentVersion']).toBe('string')
      expect(typeof body['latestVersion']).toBe('string')
      expect(typeof body['channel']).toBe('string')
      expect(typeof body['checkedAt']).toBe('string')
    })
  })

  // ── POST /api/system/update — auth guards ────────────────────────────────

  describe('POST /api/system/update', () => {
    it('returns 401 when called without auth', async () => {
      const res = await post('/api/system/update', {})
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, unknown>
      expect(typeof body['error']).toBe('string')
    })

    it('returns 401 when called with a project token (not a dashboard session)', async () => {
      const res = await post('/api/system/update', {}, auth(TOKEN!))
      expect(res.status).toBe(401)
    })
  })

  // ── PUT /api/settings with channel ───────────────────────────────────────

  describe('PUT /api/settings (channel)', () => {
    let originalChannel = 'latest'

    beforeAll(async () => {
      const res = await get('/api/settings', auth(adminJwt))
      const body = await res.json() as Record<string, unknown>
      originalChannel = (body['channel'] as string | undefined) ?? 'latest'
    })

    it('updates the channel field and returns updated settings', async () => {
      const res = await put('/api/settings', { channel: 'stable' }, auth(adminJwt))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body['channel']).toBe('stable')
    })

    it('restores original channel after test', async () => {
      const res = await put('/api/settings', { channel: originalChannel }, auth(adminJwt))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body['channel']).toBe(originalChannel)
    })

    it('returns 401 when called without auth', async () => {
      const res = await put('/api/settings', { channel: 'stable' })
      expect(res.status).toBe(401)
    })
  })
})
