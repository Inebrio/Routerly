import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ProcessorRegistry } from '../../core/index.js'

// Same mocking boundary as lanes/anthropic.test.ts and lanes/openai.test.ts: only the
// network-touching leaf (llmChat/llmStream) is stubbed. Everything above it — the model
// attempt loop, the orchestrator candidate loop (`forwardToRouter`), budget gating — runs
// for real against writeConfig-seeded routers/models.
vi.mock('./execute.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./execute.js')>()
  return { ...actual, llmChat: vi.fn(), llmStream: vi.fn() }
})

import { openaiAttempt, openaiUpstream } from './lanes/openai.js'
import { llmChat } from './execute.js'
import type { LLMCallContext } from './execute.js'
import { setProxyPipeline } from './run.js'
import type { ProxyContext } from './context.js'
import { writeConfig, appendUsageRecord } from '../config/loader.js'
import { readUsageRecords } from '../usage/usageStore.js'
import { trackUsage } from '../usage/tracker.js'
import { isAllowedForRoutingModel } from '../budget/budget.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { ChatCompletionResponse, ModelConfig, OrchestratorCandidateRef, RouterConfig, UsageRecord } from '@routerly/shared'

async function seedModels(models: ModelConfig[]): Promise<void> {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  await writeConfig('connections', connections)
  await writeConfig('instances', instances)
}

const mockLlmChat = vi.mocked(llmChat)

afterEach(() => vi.clearAllMocks())

function makeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeModel(id: string): ModelConfig {
  return { id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 2 } }
}

function makeRouter(id: string, modelIds: string[]): RouterConfig {
  return { id, name: id, tokens: [], members: [], models: modelIds.map((modelId) => ({ modelId })) }
}

function makeOrchestrator(id: string, candidates: OrchestratorCandidateRef[]): RouterConfig {
  return { id, name: id, kind: 'orchestrator', candidates, tokens: [], members: [], models: [] }
}

function makeResponse(modelId: string): ChatCompletionResponse {
  return {
    id: `chatcmpl-${modelId}`, object: 'chat.completion', created: 0, model: modelId,
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
}

/**
 * Stands in for the real 'routing.prepare' processor (routing/index.ts's `makePrepare`,
 * not exported): resolves a plain Router's own model refs into `RoutingCandidate`s.
 * `makePrepare` itself no-ops for `kind === 'orchestrator'` (candidate scoring is
 * `forwardToRouter`'s job, under test here), so this only ever runs against the
 * candidate Router `forwardToRouter` points `ctx.router` at.
 */
const testRoutingPrepare = {
  id: 'test:routing-prepare', phase: 'routing.prepare',
  run(ctx: ProxyContext) {
    if (ctx.router.kind === 'orchestrator') return
    ctx.candidates = ctx.router.models.map((m) => ({ model: m.modelId, weight: 1 }))
  },
}

function buildPipeline(): ProcessorRegistry<ProxyContext> {
  const reg = new ProcessorRegistry<ProxyContext>()
  reg.contribute(testRoutingPrepare)
  reg.contribute(openaiUpstream)
  reg.contribute(openaiAttempt)
  setProxyPipeline(reg)
  return reg
}

function buildCtx(orchestrator: RouterConfig): ProxyContext {
  return {
    protocol: 'openai', log: makeLog(), router: orchestrator, routerId: orchestrator.id, traceId: `t-${orchestrator.id}`,
    original: { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] },
    request: { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] },
    stream: false, passthrough: false,
  } as unknown as ProxyContext
}

describe('orchestrator forwarding (RTR-02 task 3)', () => {
  it('AC2: forwards to the winning candidate and returns its response byte-identical, no wrapping', async () => {
    buildPipeline()
    const model = makeModel(`m-${randomUUID()}`)
    await seedModels([model])
    const router = makeRouter(`r-${randomUUID()}`, [model.id])
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [{ routerId: router.id, weight: 1 }])
    await writeConfig('routers', [orchestrator, router])

    const response = makeResponse(model.id)
    mockLlmChat.mockResolvedValueOnce(response)

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    expect(ctx.result).toEqual({ kind: 'json', body: response })
  })

  it('AC5: records exactly one usage entry, orchestratorId set to the orchestrator, routerId set to the candidate that executed it', async () => {
    buildPipeline()
    const model = makeModel(`m-${randomUUID()}`)
    await seedModels([model])
    const router = makeRouter(`r-${randomUUID()}`, [model.id])
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [{ routerId: router.id, weight: 1 }])
    await writeConfig('routers', [orchestrator, router])

    // Simulates the one side effect the mocked-away real llmChat would have performed
    // (execute.ts calls trackUsage with `...(ctx.orchestratorId ? { orchestratorId } : {})`
    // taken from the LLMCallContext it receives) — proving that field was actually threaded
    // from `forwardToRouter` down to the call, not just present on the outer ProxyContext.
    mockLlmChat.mockImplementationOnce(async (_req, respModel, cctx: LLMCallContext) => {
      await trackUsage({
        routerId: cctx.routerId, model: respModel, inputTokens: 10, outputTokens: 5, latencyMs: 5,
        outcome: 'success', ...(cctx.traceId ? { traceId: cctx.traceId } : {}),
        ...(cctx.orchestratorId ? { orchestratorId: cctx.orchestratorId } : {}),
      })
      return makeResponse(respModel.id)
    })

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    const records = (await readUsageRecords()).filter((r) => r.orchestratorId === orchestrator.id)
    expect(records).toHaveLength(1)
    expect(records[0]!.orchestratorId).toBe(orchestrator.id)
    expect(records[0]!.routerId).toBe(router.id) // the candidate Router, never the Orchestrator itself
  })

  it('AC6: skips a candidate whose own orchestrator-level limit is already exceeded, leaving the candidate Router\'s own independent budget check untouched', async () => {
    buildPipeline()
    const model = makeModel(`m-${randomUUID()}`)
    await seedModels([model])
    const router = makeRouter(`r-${randomUUID()}`, [model.id])
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [
      { routerId: router.id, weight: 1, limits: [{ metric: 'calls', windowType: 'period', period: 'daily', value: 1 }] },
    ])
    await writeConfig('routers', [orchestrator, router])

    // Pre-exhaust the orchestrator-candidate limit (1 call/day, already used).
    const seededRecord: UsageRecord = {
      id: randomUUID(), timestamp: new Date().toISOString(), routerId: router.id, modelId: model.id,
      inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 1, outcome: 'success', orchestratorId: orchestrator.id,
    }
    await appendUsageRecord(seededRecord)

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    // Blocked before ever reaching the candidate's own model loop.
    expect(mockLlmChat).not.toHaveBeenCalled()
    expect(ctx.result).toEqual({ kind: 'block', status: 503, body: { error: { message: 'All orchestrator candidate routers failed or are budget-exhausted.', type: 'server_error' } } })

    // The candidate Router's own independent budget (its model has no limits of its own)
    // is a separate concern and still passes, unaffected by the orchestrator-level block.
    await expect(isAllowedForRoutingModel(model, router.id)).resolves.toBe(true)
  })

  it('EC1: exhausts every candidate without ever falling back to a model outside the seeded candidates, and returns a routing-failure result', async () => {
    buildPipeline()
    const modelA = makeModel(`m-${randomUUID()}`)
    const modelB = makeModel(`m-${randomUUID()}`)
    await seedModels([modelA, modelB])
    const routerA = makeRouter(`r-${randomUUID()}`, [modelA.id])
    const routerB = makeRouter(`r-${randomUUID()}`, [modelB.id])
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [
      { routerId: routerA.id, weight: 2 }, { routerId: routerB.id, weight: 1 },
    ])
    await writeConfig('routers', [orchestrator, routerA, routerB])

    mockLlmChat.mockRejectedValue(new Error('upstream boom'))

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    expect(ctx.result).toEqual({ kind: 'block', status: 503, body: { error: { message: 'All orchestrator candidate routers failed or are budget-exhausted.', type: 'server_error' } } })
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
    const calledModelIds = mockLlmChat.mock.calls.map((call) => (call[1] as ModelConfig).id)
    expect(calledModelIds.every((id) => id === modelA.id || id === modelB.id)).toBe(true)
  })

  it('B2: tries the quality-ranked candidate first, not the highest-weight one — the loop must not re-sort scoreOrchestratorCandidates\' order by raw weight', async () => {
    buildPipeline()
    const modelA = makeModel(`m-${randomUUID()}`)
    const modelB = makeModel(`m-${randomUUID()}`)
    await seedModels([modelA, modelB])
    const routerA = makeRouter(`r-${randomUUID()}`, [modelA.id]) // weight 70, but recently all errors
    const routerB = makeRouter(`r-${randomUUID()}`, [modelB.id]) // weight 30, no history (perfect score)
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [
      { routerId: routerA.id, weight: 70 }, { routerId: routerB.id, weight: 30 },
    ])
    await writeConfig('routers', [orchestrator, routerA, routerB])

    // Recent error history crashes candidate A's health score to 0 (weighted error rate
    // over the circuit-breaker threshold) — a quality gap far above scoreOrchestratorCandidates'
    // 0.0001 weight-tiebreak, so B must be tried first despite A's more-than-double weight.
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await appendUsageRecord({
        id: randomUUID(), timestamp: new Date(now - i * 1000).toISOString(),
        routerId: routerA.id, modelId: modelA.id, inputTokens: 1, outputTokens: 1, cost: 0,
        latencyMs: 1, outcome: 'error', orchestratorId: orchestrator.id,
      })
    }

    mockLlmChat.mockResolvedValueOnce(makeResponse(modelB.id))

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    expect(mockLlmChat).toHaveBeenCalledTimes(1)
    expect((mockLlmChat.mock.calls[0]![1] as ModelConfig).id).toBe(modelB.id)
  })

  it('EC3: a candidate deleted from the router config since it was scored is never attempted; the surviving candidate is used', async () => {
    buildPipeline()
    const survivorModel = makeModel(`m-${randomUUID()}`)
    await seedModels([survivorModel])
    const survivor = makeRouter(`r-${randomUUID()}`, [survivorModel.id])
    const deletedRouterId = `r-deleted-${randomUUID()}`
    // Higher weight than the survivor, so it would be tried first if it still existed.
    const orchestrator = makeOrchestrator(`o-${randomUUID()}`, [
      { routerId: deletedRouterId, weight: 5 }, { routerId: survivor.id, weight: 1 },
    ])
    // Only the survivor is written back — the other candidate's Router was deleted.
    await writeConfig('routers', [orchestrator, survivor])

    const response = makeResponse(survivorModel.id)
    mockLlmChat.mockResolvedValueOnce(response)

    const ctx = buildCtx(orchestrator)
    await openaiAttempt.run(ctx)

    expect(ctx.result).toEqual({ kind: 'json', body: response })
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
    expect((mockLlmChat.mock.calls[0]![1] as ModelConfig).id).toBe(survivorModel.id)
  })
})
