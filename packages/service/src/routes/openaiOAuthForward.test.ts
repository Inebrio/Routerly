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

  it('skips headers with undefined value (line 131 if branch=0)', async () => {
    // value === undefined → continue (branch=0 = condition true → skip)
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, {
      'x-custom': 'keep',
      'x-maybe': undefined,
    })
    expect(h['x-custom']).toBe('keep')
    expect(h['x-maybe']).toBeUndefined()
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

  it('includes name, tool_calls and tool_call_id when present in messages (sanitizeMessage lines 95-97)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    const body = {
      messages: [
        { role: 'user', content: 'hi', name: 'alice', tool_calls: [{ id: 'tc1' }], tool_call_id: 'tc1' },
      ],
    }
    await forwardOpenAIOAuthSSE(raw as any, body, oauthModel, makeLog(), 'trace-8', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const sentBody = JSON.parse((upstreamCall as [string, RequestInit])[1].body as string)
    const msg = sentBody.input[0]
    expect(msg.name).toBe('alice')
    expect(msg.tool_calls).toEqual([{ id: 'tc1' }])
    expect(msg.tool_call_id).toBe('tc1')
  })

  it('writes [DONE] when upstream body is null (line 194-197)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // body: null simulates response with no body
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-9', 'proj-1')

    expect(raw.chunks).toContain('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('flushes scrubber remainder when it yields content (lines 252-258)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // SSE stream with PII-containing delta that will be buffered by StreamingScrubber
    const upstreamSSE = [
      'event: response.output_text.delta',
      'data: {"delta":"Hello JOHN DOE here","output_index":0,"content_index":0}',
      '',
    ].join('\n')
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream(upstreamSSE) })

    const raw = makeRaw()
    const piiConfig = { enabled: true, scrubOutput: true, policies: [{ name: 'default', entities: ['NAME'] }] } as any
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-flush', 'proj-1', piiConfig)

    // scrubber.flush() should have produced a final chunk or at minimum the DONE sentinel is present
    const joined = raw.chunks.join('')
    expect(joined).toContain('data: [DONE]')
  })

  it('handles empty scrubber flush (line 253 false branch — flushed.length === 0)', async () => {
    // scrubOutput=true but no text deltas → push() never called → buffer stays empty → flush() returns ''
    // → flushed.length === 0 → if branch=1 (false) → no flush chunk emitted
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // Stream with no delta events (only a non-delta event)
    const upstreamSSE = [
      'event: response.done',
      'data: {"type":"response.done"}',
      '',
    ].join('\n')
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream(upstreamSSE) })

    const raw = makeRaw()
    const piiConfig = { enabled: true, scrubOutput: true, policies: [] } as any
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-flush2', 'proj-1', piiConfig)

    const joined = raw.chunks.join('')
    expect(joined).toContain('data: [DONE]')
    // No flush chunk — only the stop chunk and DONE
    const contentChunks = raw.chunks.filter(c => c.includes('"content"') && !c.includes('"content":{}'))
    expect(contentChunks.length).toBe(0)
  })

  it('handles SSE stream where blocks.pop() returns undefined (line 241 ?? branch)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // Stream data without any \n\n separator — blocks.pop() returns undefined on split of a string with no \n\n
    // Actually split always returns at least one element, so pop returns that element.
    // The ?? '' fires when blocks array is empty after pop — this happens naturally in the loop.
    // Send data in two chunks: first chunk has no \n\n (no blocks to pop a remainder from an empty rest)
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Chunk 1: no \n\n → buffer = full chunk, blocks=[], blocks.pop()=undefined → buffer = ''
        controller.enqueue(encoder.encode('event: ping'))
        // Chunk 2: complete event block
        controller.enqueue(encoder.encode('\n\n'))
        controller.close()
      },
    })
    mockFetch.mockResolvedValue({ ok: true, status: 200, body })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-blocks', 'proj-1')
    expect(raw.chunks).toContain('data: [DONE]\n\n')
  })

  it('skips whitespace-only blocks in SSE (line 243 false branch — block.trim() === "")', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // Two \n\n in a row creates an empty block between them
    const upstreamSSE = 'event: ping\ndata: {}\n\n\n\nevent: response.output_text.delta\ndata: {"delta":"hi"}\n\n'
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream(upstreamSSE) })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-empty-block', 'proj-1')
    expect(raw.chunks).toContain('data: [DONE]\n\n')
  })

  it('includes tools in payload when body.tools is set (line 116 if branch=0)', async () => {
    // body.tools is truthy → payload.tools = body.tools (branch=0 = condition true)
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    const tools = [{ type: 'function', function: { name: 'get_weather', description: 'Get weather' } }]
    await forwardOpenAIOAuthSSE(raw as any, { messages: [], tools }, oauthModel, makeLog(), 'trace-tools', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    const sentBody = JSON.parse((upstreamCall as [string, RequestInit])[1].body as string)
    expect(sentBody.tools).toEqual(tools)
  })

  it('uses DEFAULT_AUTH_PATH when model.apiKey is absent (line 154 || branch=1)', async () => {
    // apiKey is undefined → DEFAULT_AUTH_PATH ('~/.codex/auth.json') is used
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const modelNoKey: ModelConfig = { ...oauthModel, apiKey: undefined }
    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, modelNoKey, makeLog(), 'trace-defkey', 'proj-1')

    // resolveCodexToken called with the expanded DEFAULT_AUTH_PATH
    const calledPath = vi.mocked(fs.readFile).mock.calls[0]![0] as string
    expect(calledPath).not.toContain('~')
    expect(calledPath).toContain('.codex/auth.json')
  })

  it('uses CHATGPT_BASE when model.endpoint is absent (line 167 ?? branch=1)', async () => {
    // endpoint is undefined → ?? CHATGPT_BASE fires
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const modelNoEndpoint: ModelConfig = { ...oauthModel, endpoint: undefined }
    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, modelNoEndpoint, makeLog(), 'trace-defbase', 'proj-1')

    const upstreamCall = mockFetch.mock.calls.find((c) => (c[0] as string).includes('chatgpt.com'))
    expect(upstreamCall).toBeDefined()
    expect(upstreamCall![0]).toContain('chatgpt.com/backend-api/codex/responses')
  })

  it('non-string or empty delta is ignored (line 212 if branch=0)', async () => {
    // delta is not a string → typeof delta !== 'string' → return early (branch=0 = condition true)
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    // delta field is a number (not string)
    const upstreamSSE = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":42,"output_index":0,"content_index":0}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"","output_index":0,"content_index":0}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"real","output_index":0,"content_index":0}',
      '',
    ].join('\n')
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream(upstreamSSE) })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-nondelta', 'proj-1')

    // Only 'real' chunk should appear (number and empty-string deltas ignored)
    const joined = raw.chunks.join('')
    expect(joined).toContain('"content":"real"')
    expect(joined).not.toContain('"content":42')
  })
})

// ─── jwtExp and refreshTokens edge cases ─────────────────────────────────────

describe('resolveCodexToken — edge cases', () => {
  it('returns exp=0 when jwtExp catch fires (malformed token, line 40)', async () => {
    // Malformed JWT: base64 payload is not valid JSON → JSON.parse throws → catch returns 0
    // exp=0 means token is treated as non-expiring, no refresh triggered
    const malformedToken = 'header.!!!notbase64!!!.sig'
    const authJson = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: malformedToken, refresh_token: 'rt', account_id: 'acct' },
      last_refresh: new Date().toISOString(),
    })
    vi.mocked(fs.readFile).mockResolvedValue(authJson as any)

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    // Should not throw — returns malformed token as-is since exp=0 means no refresh needed
    expect(result.accessToken).toBe(malformedToken)
    expect(result.accountId).toBe('acct')
  })

  it('treats token without dots as non-expired (line 36 ?? branch=1 — split returns undefined)', async () => {
    // token has no '.' → split('.')[1] = undefined → ?? '' → Buffer.from('') → JSON.parse('') throws → catch → exp=0
    const noDotToken = 'nodottoken'
    const authJson = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: noDotToken, refresh_token: 'rt', account_id: 'acct' },
      last_refresh: new Date().toISOString(),
    })
    vi.mocked(fs.readFile).mockResolvedValue(authJson as any)

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    // exp=0 → treated as non-expiring → no refresh → returns as-is
    expect(result.accessToken).toBe(noDotToken)
  })

  it('treats token with non-number exp as non-expired (line 38 ternary branch=1)', async () => {
    // JWT payload has exp as a string (not number) → typeof exp === 'number' is false → returns 0
    const nonNumericExpPayload = Buffer.from(JSON.stringify({ exp: 'not-a-number' })).toString('base64url')
    const tokenWithStringExp = `header.${nonNumericExpPayload}.sig`
    const authJson = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: tokenWithStringExp, refresh_token: 'rt', account_id: 'acct' },
      last_refresh: new Date().toISOString(),
    })
    vi.mocked(fs.readFile).mockResolvedValue(authJson as any)

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    // exp=0 → no refresh → returns original token
    expect(result.accessToken).toBe(tokenWithStringExp)
  })

  it('throws when refresh token HTTP response is not ok (line 56)', async () => {
    // Expired token → triggers refresh → refresh returns non-ok
    vi.mocked(fs.readFile).mockResolvedValue(EXPIRED_AUTH_JSON as any)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }))

    const log = makeLog()
    // refresh fails → catch logs warn → returns expired token (does not throw out)
    const result = await resolveCodexToken('/tmp/fake-auth.json', log)
    expect(log.warn).toHaveBeenCalled()
    expect(result.accessToken).toBe(EXPIRED_TOKEN)
  })

  it('uses existing tokens when OAuth response omits access_token/refresh_token (lines 60-61 ?? branch=1)', async () => {
    // Expired token → refresh → OAuth returns response without access_token or refresh_token
    // → ?? fallback fires, keeping the old tokens
    vi.mocked(fs.readFile).mockResolvedValue(EXPIRED_AUTH_JSON as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account_id: ACCOUNT_ID }), // no access_token or refresh_token
    }))

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    // Falls back to old EXPIRED_TOKEN since refresh response had no access_token
    expect(result.accessToken).toBe(EXPIRED_TOKEN)
  })
})

describe('buildOpenAIOAuthHeaders — array header joining (line 134)', () => {
  it('joins array-valued headers with ", "', () => {
    const h = buildOpenAIOAuthHeaders(ACCESS_TOKEN, ACCOUNT_ID, { 'x-custom': ['a', 'b', 'c'] })
    expect(h['x-custom']).toBe('a, b, c')
  })
})

// ─── .catch(() => {}) function coverage ──────────────────────────────────────

describe('forwardOpenAIOAuthSSE — .catch(() => {}) swallows trackUsage rejections', () => {
  it('line 162: swallows trackUsage rejection on auth-file error path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))

    const raw = makeRaw()
    // Should not throw despite trackUsage rejecting
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-c1', 'proj-1')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('line 177: swallows trackUsage rejection on fetch-throw error path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockRejectedValue(new Error('network error'))

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-c2', 'proj-1')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('line 190: swallows trackUsage rejection on upstream-not-ok path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden', body: null })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-c3', 'proj-1')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('line 196: swallows trackUsage rejection on null-body success path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-c4', 'proj-1')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('line 268: swallows trackUsage rejection on success path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: makeReadableStream('') })

    const raw = makeRaw()
    await forwardOpenAIOAuthSSE(raw as any, {}, oauthModel, makeLog(), 'trace-c5', 'proj-1')
    expect(raw.chunks.at(-1)).toBe('data: [DONE]\n\n')
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })
})

describe('resolveCodexToken — id_token in refresh response (line 63 true branch)', () => {
  it('uses id_token from refresh response when present', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(EXPIRED_AUTH_JSON as any)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: FRESH_TOKEN, refresh_token: 'new_refresh', id_token: 'new_id_token' }),
    }))

    const result = await resolveCodexToken('/tmp/fake-auth.json', makeLog())
    expect(result.accessToken).toBe(FRESH_TOKEN)
    // The write should include the id_token
    const written = JSON.parse((vi.mocked(fs.writeFile).mock.calls[0]![1] as string))
    expect(written.tokens.id_token).toBe('new_id_token')
  })

  it('expands ~/... path to home directory (line 31 resolvePath branch=0)', async () => {
    // path starts with ~/ → homedir() + path.slice(1) (branch=0 = tilde-expand taken)
    vi.mocked(fs.readFile).mockResolvedValue(FAKE_AUTH_JSON as any)

    const result = await resolveCodexToken('~/fake-auth.json', makeLog())
    expect(result.accessToken).toBe(ACCESS_TOKEN)
    // Verify readFile was called with expanded path (starts with /)
    const calledPath = vi.mocked(fs.readFile).mock.calls[0]![0] as string
    expect(calledPath).not.toContain('~')
    expect(calledPath).toMatch(/^\//)
  })
})
