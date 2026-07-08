/**
 * Tests for the BudgetExceededError path in anthropic.ts lines 41-44.
 * Also covers: RESPONSE guardrail block writes usage record (BLOCKER 2).
 * Isolated here because checkGuardrails must be mocked, which conflicts with
 * the real-implementation guardrail tests in anthropic.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'

vi.mock('../routing/router.js', () => ({ routeRequest: vi.fn() }))
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), appendUsageRecord: vi.fn() }))
vi.mock('../routing/traceStore.js', () => ({ setTrace: vi.fn(), appendTrace: vi.fn(), getTrace: vi.fn(() => []) }))
vi.mock('../llm/executor.js', () => ({
  llmMessages: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError'
    modelId: string
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId }
  },
}))
vi.mock('../middleware/guardrails.js', () => ({
  checkGuardrails: vi.fn(),
}))
vi.mock('../middleware/piiScrubber.js', () => ({
  mergePolicies: vi.fn(() => null),
  scrubMessages: vi.fn((msgs: unknown) => ({ messages: msgs, redacted: [] })),
  scrubText: vi.fn((t: string) => ({ text: t, found: [] })),
}))
vi.mock('./oauthForward.js', () => ({ forwardAnthropicOAuth: vi.fn() }))
vi.mock('../cost/tracker.js', () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}))

import { anthropicRoutes } from './anthropic.js'
import { checkGuardrails } from '../middleware/guardrails.js'
import { BudgetExceededError, llmMessages } from '../llm/executor.js'
import { readConfig } from '../config/loader.js'
import { routeRequest } from '../routing/router.js'
import { trackUsage } from '../cost/tracker.js'

const mockCheckGuardrails = vi.mocked(checkGuardrails)
const mockLlmMessages = vi.mocked(llmMessages)
const mockReadConfig = vi.mocked(readConfig)
const mockRouteRequest = vi.mocked(routeRequest)
const mockTrackUsage = vi.mocked(trackUsage)

afterEach(() => vi.clearAllMocks())

const testModel: any = {
  id: 'm1', name: 'Claude', provider: 'anthropic',
  endpoint: 'https://api.anthropic.com', apiKey: 'sk-test',
  cost: { inputPerMillion: 3, outputPerMillion: 15 },
}

const testProject: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
  guardrails: { rules: [{ type: 'regex', enabled: true, target: 'request', block: true, config: { patterns: ['x'] } }] },
} as any

async function buildApp(project: any = testProject) {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.decorateRequest('token', null as any)
  app.addHook('preHandler', async (req: any) => {
    req.project = project
    req.token = undefined
  })
  await app.register(anthropicRoutes)
  await app.ready()
  return app
}

describe('POST /v1/messages — guardrail BudgetExceededError → 429 (line 41-43)', () => {
  it('returns 429 when guardrail check throws BudgetExceededError', async () => {
    mockCheckGuardrails.mockRejectedValue(new BudgetExceededError('m1'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json', 'x-routerly-trace': '1' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(429)
    const body = JSON.parse(res.body)
    expect(body.error.type).toBe('rate_limit_error')
    expect(res.headers['x-routerly-trace-id']).toBeDefined()
  })

  it('rethrows non-BudgetExceededError from guardrail check (line 45)', async () => {
    mockCheckGuardrails.mockRejectedValue(new Error('unexpected guardrail error'))

    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    // Fastify converts unhandled errors to 500
    expect(res.statusCode).toBe(500)
  })
})

// ─── RESPONSE guardrail BLOCK: trackBlockedRequest called (BLOCKER 2) ─────────

describe('POST /v1/messages — RESPONSE guardrail block writes usage record (BLOCKER 2)', () => {
  const responseBlockProject: any = {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId: 'm1' }],
    guardrails: { rules: [{ type: 'regex', target: 'response', block: true, config: { patterns: ['bad'] } }] },
  }

  it('response block calls trackUsage with outcome blocked', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })  // request passes
      .mockResolvedValueOnce({ triggered: 'regex:response', block: true, log: false, evaluated: [] })  // response block
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockLlmMessages.mockResolvedValue({
      id: 'msg_1', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'bad response content' }],
      model: 'claude', stop_reason: 'end_turn', stop_details: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.stop_reason).toBe('refusal')
    expect(body.content).toEqual([])
    // trackBlockedRequest → trackUsage with outcome:'blocked'
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeDefined()
    expect((blockedCall![0] as any).blockedBy).toBe('regex:response')
  })

  it('response log-only does NOT call trackUsage with blocked outcome', async () => {
    mockCheckGuardrails
      .mockResolvedValueOnce({ evaluated: [] })
      .mockResolvedValueOnce({ triggered: 'regex:response', block: false, log: true, evaluated: [] })
    mockReadConfig.mockResolvedValue([testModel])
    mockRouteRequest.mockResolvedValue({ models: [{ model: 'm1', weight: 1 }], trace: [] })
    mockLlmMessages.mockResolvedValue({
      id: 'msg_1', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'logged content' }],
      model: 'claude', stop_reason: 'end_turn', stop_details: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    } as any)

    const app = await buildApp(responseBlockProject)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.content[0].text).toBe('logged content')
    const blockedCall = mockTrackUsage.mock.calls.find((c) => (c[0] as any).outcome === 'blocked')
    expect(blockedCall).toBeUndefined()
  })
})
