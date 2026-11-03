import { describe, it, expect } from 'vitest'
import type { TraceEntry } from '@routerly/shared'
import { buildRecap } from './recap.js'

const e = (panel: string, message: string, details: Record<string, unknown> = {}): TraceEntry =>
  ({ panel, message, details })

describe('buildRecap', () => {
  it('is a router-response entry named trace:recap', () => {
    const recap = buildRecap([], 5)
    expect(recap.panel).toBe('router-response')
    expect(recap.message).toBe('trace:recap')
    expect(recap.details).toMatchObject({ outcome: 'incomplete', durationMs: 5, attempts: 0 })
  })

  it('sums the completion calls and keeps the router overhead apart', () => {
    const recap = buildRecap(
      [
        e('router-request', 'model:request', { modelId: 'router-m', provider: 'ollama' }),
        e('router-response', 'model:success', { modelId: 'router-m', inputTokens: 500, outputTokens: 5, totalCostUsd: 0.0001 }),
        e('request', 'model:request', { modelId: 'gpt-4o', provider: 'openai' }),
        e('response', 'model:error', { modelId: 'gpt-4o', error: 'upstream 500' }),
        e('request', 'model:request', { modelId: 'claude', provider: 'anthropic' }),
        e('response', 'model:success', {
          modelId: 'claude', inputTokens: 100, cachedInputTokens: 40, outputTokens: 20,
          totalCostUsd: 0.003, latencyMs: 900, ttftMs: 300, tokensPerSec: 133,
        }),
      ],
      1_200,
    )
    expect(recap.details).toMatchObject({
      outcome: 'ok',
      model: 'claude',
      provider: 'anthropic',
      attempts: 2,
      tokens: { input: 100, cachedInput: 40, output: 20 },
      costUsd: 0.003,
      latencyMs: 900,
      ttftMs: 300,
      tokensPerSec: 133,
      overhead: { calls: 1, costUsd: 0.0001 },
      errors: [{ model: 'gpt-4o', error: 'upstream 500' }],
    })
  })

  it('reports error when every attempt failed', () => {
    const recap = buildRecap(
      [e('request', 'model:request', { modelId: 'm' }), e('response', 'model:error', { modelId: 'm', error: 'timeout' })],
      10,
    )
    expect(recap.details.outcome).toBe('error')
  })

  it('reports blocked, and by which rule, whichever side blocked', () => {
    const request = buildRecap(
      [e('request', 'guardrail:triggered', { rule: 'topic:legal', block: true })],
      10,
    )
    expect(request.details).toMatchObject({ outcome: 'blocked', guardrails: { blockedBy: 'topic:legal' } })

    const response = buildRecap(
      [
        e('response', 'model:success', { modelId: 'm' }),
        e('response', 'guardrail:response-triggered', { rule: 'moderation', block: true }),
      ],
      10,
    )
    expect(response.details).toMatchObject({ outcome: 'blocked', guardrails: { blockedBy: 'moderation' } })
  })

  it('counts guardrail rules by outcome, and a log-only trigger does not block', () => {
    const recap = buildRecap(
      [
        e('request', 'guardrail:evaluated', {
          rules: [
            { rule: 'regex', outcome: 'passed' },
            { rule: 'topic:a', outcome: 'triggered' },
            { rule: 'topic:b', outcome: 'skipped' },
          ],
        }),
        e('request', 'guardrail:triggered', { rule: 'topic:a', block: false, log: true }),
        e('request', 'guardrail:injected', { chars: 42 }),
      ],
      10,
    )
    expect(recap.details).toMatchObject({
      outcome: 'incomplete',
      guardrails: { rules: 3, triggered: 1, skipped: 1, injected: 1 },
    })
    expect((recap.details.guardrails as Record<string, unknown>).blockedBy).toBeUndefined()
  })

  it('adds up the PII redactions per side', () => {
    const recap = buildRecap(
      [
        e('request', 'pii:evaluated', { counts: { EMAIL: 2, PHONE: 1 } }),
        e('response', 'pii:evaluated', { counts: {} }),
      ],
      10,
    )
    expect(recap.details.pii).toEqual({ request: 3, response: 0 })
  })

  it('counts optimizer steps and only credits the applied ones with the saving', () => {
    const recap = buildRecap(
      [
        e('request', 'optimizer:step', { id: 'a', outcome: 'applied', saved: 120 }),
        e('request', 'optimizer:step', { id: 'b', outcome: 'rolled-back', saved: 0 }),
        e('request', 'optimizer:step', { id: 'c', outcome: 'skipped' }),
      ],
      10,
    )
    expect(recap.details.optimizers).toEqual({ steps: 3, applied: 1, rolledBack: 1, savedTokens: 120 })
  })

  it('omits the sections a request never went through', () => {
    const details = buildRecap([e('response', 'model:success', { modelId: 'm' })], 10).details
    expect(details.guardrails).toBeUndefined()
    expect(details.pii).toBeUndefined()
    expect(details.optimizers).toBeUndefined()
    expect(details.overhead).toBeUndefined()
    expect(details.errors).toBeUndefined()
  })
})
