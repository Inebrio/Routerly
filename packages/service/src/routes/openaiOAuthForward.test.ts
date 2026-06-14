import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { ModelConfig } from '@routerly/shared'
import { buildOpenAIOAuthHeaders, forwardOpenAIOAuthSSE, resolveCodexToken } from './openaiOAuthForward.js'

vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
import { trackUsage } from '../cost/tracker.js'
const mockTrackUsage = vi.mocked(trackUsage)

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'acct_test123'
const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.' + Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 }),
).toString('base64url') + '.sig'

const EXPIRED_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.' + Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }),
).toString('base64url') + '.sig'

const FRESH_TOKEN = 'fresh_access_token'
const REFRESH_TOKEN = 'refresh_tok'

const FAKE_AUTH_JSON = JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    account_id: ACCOUNT_ID,
  },
  last_refresh: new Date().toISOString(),
})

const EXPIRED_AUTH_JSON = JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: {
    access_token: EXPIRED_TOKEN,
    refresh_token: REFRESH_TOKEN,
    account_id: ACCOUNT_ID,
  },
  last_refresh: '2026-01-01T00:00:00.000Z',
})

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import * as fs from 'node:fs/promises'

const oauthModel: ModelConfig = {
  id: 'gpt-4o',
  name: 'GPT-4o (Plus subscription)',
  provider: 'openai-oauth',
  endpoint: 'https://chatgpt.com',
  apiKey: '/tmp/fake-auth.json',
  cost: { inputPerMillion: 0, outputPerMillion: 0 },
}

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any
}

// ─── resolveCodexToken ────────────────────────────────────────────────────────

describe('resolveCodexToken', () => {
  it('returns access_token and account_id from auth.json', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    expect(result.accessToken).toBe(ACCESS_TOKEN)
    expect(result.accountId).toBe(ACCOUNT_ID)
  })

  it('refreshes token when expired and saves updated file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(EXPIRED_AUTH_JSON as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    const mockFetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: FRESH_TOKEN, refresh_token: 'new_refresh' }),
    })
    vi.stubGlobal('fetch', mockFetchImpl)

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    expect(result.accessToken).toBe(FRESH_TOKEN)

    const [url, init] = mockFetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://auth.openai.com/oauth/token')
    expect(init.method).toBe('POST')
    expect((init.body as string)).toContain('grant_type=refresh_token')
    expect((init.body as string)).toContain('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(fs.writeFile).toHaveBeenCalled()
  })

  it('continues with old token if refresh fails', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(EXPIRED_AUTH_JSON as any)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const log = makeLog()
    const result = await resolveCodexToken('/tmp/fake-auth.json', log)
    expect(result.accessToken).toBe(EXPIRED_TOKEN)
    expect(log.warn).toHaveBeenCalled()
  })
})

// ─── buildOpenAIOAuthHeaders ──────────────────────────────────────────────────

describe('buildOpenAIOAuthHeaders', () => {
  it('injects Authorization: Bearer with the access token', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, { authorization: 'Bearer rly-token' })
    expect(h['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('sets originator to codex_cli_rs', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {})
    expect(h['originator']).toBe('codex_cli_rs')
  })

  it('sets OpenAI-Beta to responses=experimental', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {})
    expect(h['openai-beta']).toBe('responses=experimental')
  })

  it('sets chatgpt-account-id from the provided accountId', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {})
    expect(h['chatgpt-account-id']).toBe(ACCOUNT_ID)
  })

  it('omits chatgpt-account-id when accountId is empty', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, '', {})
    expect(h['chatgpt-account-id']).toBeUndefined()
  })

  it('drops hop-by-hop and inbound auth headers', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {
      host: 'localhost:3000',
      'content-length': '42',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      authorization: 'Bearer rly-token',
    })
    expect(h['host']).toBeUndefined()
    expect(h['content-length']).toBeUndefined()
    expect(h['connection']).toBeUndefined()
    expect(h['transfer-encoding']).toBeUndefined()
  })

  it('does not set Anthropic-specific headers', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {})
    expect(h['anthropic-beta']).toBeUndefined()
    expect(h['anthropic-dangerous-direct-browser-access']).toBeUndefined()
    expect(h['anthropic-version']).toBeUndefined()
  })
})

// ─── forwardOpenAIOAuthSSE ────────────────────────────────────────────────────

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

function makeRaw() {
  const chunks: string[] = []
  return {
    write: vi.fn((chunk: string) => { chunks.push(chunk) }),
    chunks,
  }
}

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(text))
      ctrl.close()
    },
  })
}

describe('forwardOpenAIOAuthSSE', () => {
  it('loads token from auth file and converts Responses API SSE to chat completion format', async () => {
    const upstreamSSE = [
      'event: response.created',
      'data: {"type":"response.created"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello!","output_index":0,"content_index":0}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n')

    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream(upstreamSSE) })

    const raw = makeRaw()
    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await forwardOpenAIOAuthSSE(raw as any, body, oauthModel, makeLog(), 'trace-1', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    expect(upstreamCall).toBeDefined()
    const [url, init] = upstreamCall as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init.method).toBe('POST')

    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.input).toEqual([{ role: 'user', content: 'Hello' }])
    expect(sentBody.stream).toBe(true)
    expect(sentBody.store).toBe(false)
    expect(sentBody.instructions).toBe('')

    const joined = raw.chunks.join('')
    expect(joined).toContain('"content":"Hello!"')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'success' }))
  })

  it('extracts instructions from system message and excludes it from input', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    }
    await forwardOpenAIOAuthSSE(raw as any, body, oauthModel, makeLog(), 'trace-2', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const sentBody = JSON.parse((upstreamCall as [string, RequestInit])[1].body as string)
    expect(sentBody.instructions).toBe('You are helpful.')
    expect(sentBody.input).toEqual([{ role: 'user', content: 'Hi' }])
  })

  it('injects required auth headers in the upstream request', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-3', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const headers = (upstreamCall as [string, { headers: Record<string, string> }])[1].headers
    expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(headers['originator']).toBe('codex_cli_rs')
    expect(headers['openai-beta']).toBe('responses=experimental')
    expect(headers['chatgpt-account-id']).toBe(ACCOUNT_ID)
  })

  it('writes [DONE] and logs on upstream error status', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden', body: null })

    const raw = makeRaw()
    const log = makeLog()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, log, 'trace-4', 'proj-1')

    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(log.warn).toHaveBeenCalled()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'error' }))
  })

  it('writes [DONE] and logs on fetch throw', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockRejectedValue(new Error('network error'))

    const raw = makeRaw()
    const log = makeLog()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, log, 'trace-5', 'proj-1')

    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(log.error).toHaveBeenCalled()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'error' }))
  })

  it('strips non-standard fields (model, thinking) from assistant messages before forwarding', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    const body = {
      messages: [
        { role: 'user', content: 'ciao' },
        { role: 'assistant', content: 'Ciao!', model: 'gpt-5.5', thinking: 'some thought' },
        { role: 'user', content: 'ok' },
      ],
    }
    await forwardOpenAIOAuthSSE(raw as any, body, oauthModel, makeLog(), 'trace-strip', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const sentBody = JSON.parse((upstreamCall as [string, RequestInit])[1].body as string)
    const assistantMsg = sentBody.input.find((m: any) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg.content).toBe('Ciao!')
    expect(assistantMsg.model).toBeUndefined()
    expect(assistantMsg.thinking).toBeUndefined()
  })

  it('strips model-name provider prefix when forwarding model id', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    const prefixedModel = { ...oauthModel, id: 'openai-oauth/gpt-4o' }
    await forwardOpenAIOAuthSSE(raw as any, {}, prefixedModel, makeLog(), 'trace-6', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const sentBody = JSON.parse((upstreamCall as [string, RequestInit])[1].body as string)
    expect(sentBody.model).toBe('gpt-4o')
  })

  it('writes [DONE] and logs error when auth file cannot be read', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))

    const raw = makeRaw()
    const log = makeLog()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, log, 'trace-7', 'proj-1')

    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(log.error).toHaveBeenCalled()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'error' }))
  })
})
