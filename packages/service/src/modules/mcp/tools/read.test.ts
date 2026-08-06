import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelConfig, RouterConfig } from '@routerly/shared'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))
vi.mock('../../routing/router.js', () => ({
  routeRequest: vi.fn(),
}))
vi.mock('../../usage/usageStore.js', () => ({
  readUsageRecords: vi.fn(),
}))
vi.mock('../../budget/budget.js', () => ({
  getLimitUsageSnapshot: vi.fn(),
}))
// Mock only the data source; keep the real percentile helper the tool reuses.
vi.mock('../../observability/metrics-snapshot.js', async (orig) => ({
  ...(await orig<typeof import('../../observability/metrics-snapshot.js')>()),
  getMetricsSnapshot: vi.fn(),
}))

import { readConfig } from '../../config/loader.js'
import { routeRequest } from '../../routing/router.js'
import { readUsageRecords } from '../../usage/usageStore.js'
import { getLimitUsageSnapshot } from '../../budget/budget.js'
import { getMetricsSnapshot } from '../../observability/metrics-snapshot.js'
import {
  listModelsTool,
  getModelInstanceTool,
  routePreviewTool,
  usageSummaryTool,
  budgetStatusTool,
  metricsSnapshotTool,
  listRoutersTool,
} from './read.js'
import { expectNoSecrets } from './expectNoSecrets.js'
import { splitModelsIntoInstancesConnections } from '../../../test-support/effective-models.js'
import { mcpAuthContext, TEST_MCP_ROUTER } from '../../../test-support/mcp-auth.js'

const mockReadConfig = vi.mocked(readConfig)
const mockRouteRequest = vi.mocked(routeRequest)
const mockReadUsageRecords = vi.mocked(readUsageRecords)
const mockGetLimitUsageSnapshot = vi.mocked(getLimitUsageSnapshot)
const mockGetMetricsSnapshot = vi.mocked(getMetricsSnapshot)

const SECRET_KEY = 'sk-secret-openai-key-abc123'
const SECRET_CF = 'cf-clearance-cookie-xyz'

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: SECRET_KEY,
    cfClearance: SECRET_CF,
    cost: { inputPerMillion: 2.5, outputPerMillion: 10 },
    contextWindow: 128000,
    ...overrides,
  }
}

const router = TEST_MCP_ROUTER

// Single accessible router: routerId stays optional on every router-scoped tool.
const authCtx = mcpAuthContext()

// list_models is gateway-wide; the handler ignores authCtx entirely.
const emptyAuthCtx = mcpAuthContext({ routers: [] })

function mockModels(models: ModelConfig[]) {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    return [] as never
  })
}

describe('listModelsTool', () => {
  beforeEach(() => {
    mockReadConfig.mockReset()
  })

  it('is a read-scoped tool gated on the catalog DI token', () => {
    expect(listModelsTool.name).toBe('list_models')
    expect(listModelsTool.scope).toBe('read')
    expect(listModelsTool.requires.key).toBe('catalog.registry')
  })

  it('lists id/provider/contextWindow for each configured model', async () => {
    mockModels([
      model(),
      model({
        id: 'anthropic/claude',
        provider: 'anthropic',
        contextWindow: 200000,
        apiKey: 'sk-ant-secret',
      }),
    ])

    const res = await listModelsTool.handler({}, emptyAuthCtx)

    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed).toEqual([
      { id: 'openai/gpt-4o', provider: 'openai', contextWindow: 128000 },
      { id: 'anthropic/claude', provider: 'anthropic', contextWindow: 200000 },
    ])
  })

  it('never leaks provider secrets in the output text', async () => {
    mockModels([model()])

    const res = await listModelsTool.handler({}, emptyAuthCtx)

    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })
})

describe('getModelInstanceTool', () => {
  beforeEach(() => mockReadConfig.mockReset())

  it('is a read-scoped tool gated on the catalog DI token', () => {
    expect(getModelInstanceTool.name).toBe('get_model')
    expect(getModelInstanceTool.scope).toBe('read')
    expect(getModelInstanceTool.requires.key).toBe('catalog.registry')
  })

  it('returns id/provider/contextWindow for the requested model, no secrets', async () => {
    mockModels([model()])

    const res = await getModelInstanceTool.handler({ id: 'openai/gpt-4o' }, emptyAuthCtx)

    expect(res.isError).toBeUndefined()
    expect(JSON.parse(res.content[0]!.text)).toEqual({
      id: 'openai/gpt-4o',
      provider: 'openai',
      contextWindow: 128000,
    })
    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })

  it('returns an isError result when the model is not found', async () => {
    mockModels([model()])

    const res = await getModelInstanceTool.handler({ id: 'nope' }, emptyAuthCtx)

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('nope')
  })
})

describe('routePreviewTool', () => {
  beforeEach(() => mockRouteRequest.mockReset())

  it('is a read-scoped tool gated on the router DI token', () => {
    expect(routePreviewTool.name).toBe('route_preview')
    expect(routePreviewTool.scope).toBe('read')
    expect(routePreviewTool.requires.key).toBe('routing.router')
  })

  it('returns ordered candidate ids/weights and the trace for the auth router', async () => {
    mockRouteRequest.mockResolvedValue({
      models: [
        { model: 'openai/gpt-4o', weight: 2 },
        { model: 'anthropic/claude', weight: 1 },
      ],
      trace: [{ panel: 'router-response', message: 'router:result', details: { final: [] } }],
    } as never)

    const res = await routePreviewTool.handler(
      { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      authCtx,
    )

    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed.models).toEqual([
      { model: 'openai/gpt-4o', weight: 2 },
      { model: 'anthropic/claude', weight: 1 },
    ])
    expect(parsed.trace[0].message).toBe('router:result')
    // routeRequest is called with the resolved router, minimal request.
    const call = mockRouteRequest.mock.calls[0]!
    expect(call[1]).toBe(router)
  })

  it('resolves an explicit routerId against the accessible routers only', async () => {
    mockRouteRequest.mockResolvedValue({ models: [], trace: [] } as never)
    const beta = { id: 'proj-2', name: 'Beta', models: [] } as unknown as RouterConfig
    const ctx = mcpAuthContext({ routers: [router, beta] })

    const ok = await routePreviewTool.handler({ routerId: 'Beta' }, ctx)
    expect(ok.isError).toBeUndefined()
    expect(mockRouteRequest.mock.calls[0]![1]).toBe(beta)

    const denied = await routePreviewTool.handler({ routerId: 'proj-9' }, ctx)
    expect(denied.isError).toBe(true)
    expect(denied.content[0]!.text).toContain('not accessible')
  })

  it('requires routerId when the token reaches several routers', async () => {
    const ctx = mcpAuthContext({
      routers: [router, { id: 'proj-2', name: 'Beta', models: [] } as unknown as RouterConfig],
    })

    const res = await routePreviewTool.handler({}, ctx)

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('routerId is required')
  })

  it('reports no accessible router when the token reaches none', async () => {
    const res = await routePreviewTool.handler({}, mcpAuthContext({ routers: [] }))

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('no router')
  })

  it('leaks no upstream key in candidates or trace', async () => {
    // A realistic router trace: policy config already value-redacted by the
    // router, candidates carry only ids/weights. No provider secret appears.
    mockRouteRequest.mockResolvedValue({
      models: [{ model: 'openai/gpt-4o', weight: 1 }],
      trace: [
        {
          panel: 'router-request',
          message: 'router:policies',
          details: { policies: [{ type: 'llm', weight: 1, config: { key: '***' } }] },
        },
      ],
    } as never)

    const res = await routePreviewTool.handler({}, authCtx)

    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })
})

describe('usageSummaryTool', () => {
  beforeEach(() => mockReadUsageRecords.mockReset())

  it('is a read-scoped tool gated on the usage-tracker DI token', () => {
    expect(usageSummaryTool.name).toBe('get_usage_summary')
    expect(usageSummaryTool.scope).toBe('read')
    expect(usageSummaryTool.requires.key).toBe('usage.tracker')
  })

  it('aggregates count/cost/tokens for the auth router within the window only', async () => {
    const now = Date.now()
    mockReadUsageRecords.mockResolvedValue([
      { routerId: 'proj-1', timestamp: new Date(now - 3_600_000).toISOString(), cost: 0.5, inputTokens: 100, outputTokens: 40 },
      { routerId: 'proj-1', timestamp: new Date(now - 2 * 3_600_000).toISOString(), cost: 0.25, inputTokens: 50, outputTokens: 10 },
      // other router: excluded
      { routerId: 'proj-2', timestamp: new Date(now).toISOString(), cost: 99, inputTokens: 9, outputTokens: 9 },
      // out of window: excluded
      { routerId: 'proj-1', timestamp: new Date(now - 48 * 3_600_000).toISOString(), cost: 9, inputTokens: 9, outputTokens: 9 },
    ] as never)

    const res = await usageSummaryTool.handler({ windowHours: 24 }, authCtx)

    expect(JSON.parse(res.content[0]!.text)).toEqual({
      routerId: 'proj-1',
      windowHours: 24,
      count: 2,
      cost: 0.75,
      inputTokens: 150,
      outputTokens: 50,
    })
  })

  it('defaults to a 24h window and leaks no secrets', async () => {
    mockReadUsageRecords.mockResolvedValue([] as never)

    const res = await usageSummaryTool.handler({}, authCtx)

    expect(JSON.parse(res.content[0]!.text).windowHours).toBe(24)
    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })
})

describe('budgetStatusTool', () => {
  beforeEach(() => {
    mockReadConfig.mockReset()
    mockGetLimitUsageSnapshot.mockReset()
  })

  it('is a read-scoped tool gated on the budget DI token', () => {
    expect(budgetStatusTool.name).toBe('get_budget_status')
    expect(budgetStatusTool.scope).toBe('read')
    expect(budgetStatusTool.requires.key).toBe('cost.budget')
  })

  it('reports per-model limit snapshots for the router, no secrets', async () => {
    mockModels([model()])
    mockGetLimitUsageSnapshot.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 10, current: 3, remaining: 7 },
    ] as never)

    const res = await budgetStatusTool.handler({}, authCtx)

    expect(JSON.parse(res.content[0]!.text)).toEqual([
      {
        modelId: 'openai/gpt-4o',
        limits: [{ metric: 'cost', window: 'daily', value: 10, current: 3, remaining: 7 }],
      },
    ])
    expect(mockGetLimitUsageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai/gpt-4o' }),
      router,
    )
    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })
})

describe('metricsSnapshotTool', () => {
  beforeEach(() => mockGetMetricsSnapshot.mockReset())

  it('is a read-scoped tool gated on the observability DI token', () => {
    expect(metricsSnapshotTool.name).toBe('get_metrics_snapshot')
    expect(metricsSnapshotTool.scope).toBe('read')
    expect(metricsSnapshotTool.requires.key).toBe('observability.registry')
  })

  it('returns only the auth router slice, never other routers', async () => {
    mockGetMetricsSnapshot.mockResolvedValue({
      agg: {
        requests: new Map([
          ['a', { labels: { router: 'Alpha', model: 'openai/gpt-4o', provider: 'openai', status: 'success' }, value: 5 }],
          ['b', { labels: { router: 'Beta', model: 'x/secret-model', provider: 'openai', status: 'success' }, value: 99 }],
        ]),
        tokens: new Map([
          ['c', { labels: { router: 'Alpha', model: 'openai/gpt-4o', type: 'input' }, value: 200 }],
          ['d', { labels: { router: 'Beta', model: 'x/secret-model', type: 'input' }, value: 999 }],
        ]),
        cost: new Map([
          ['e', { labels: { router: 'Alpha', model: 'openai/gpt-4o' }, value: 1.5 }],
        ]),
        durations: new Map([
          ['f', { labels: { router: 'Alpha', model: 'openai/gpt-4o' }, latencies: [100, 200, 300] }],
          ['g', { labels: { router: 'Beta', model: 'x/secret-model' }, latencies: [1, 2] }],
        ]),
      },
      routerName: (id: string) => id,
      modelInfo: (id: string) => ({ model: id, provider: 'x' }),
      routers: [],
      models: [],
    } as never)

    const res = await metricsSnapshotTool.handler({}, authCtx)
    const parsed = JSON.parse(res.content[0]!.text)

    expect(parsed.router).toEqual({ id: 'proj-1', name: 'Alpha' })
    expect(parsed.requests).toEqual([{ model: 'openai/gpt-4o', provider: 'openai', status: 'success', value: 5 }])
    expect(parsed.tokens).toEqual([{ model: 'openai/gpt-4o', type: 'input', value: 200 }])
    expect(parsed.cost).toEqual([{ model: 'openai/gpt-4o', value: 1.5 }])
    expect(parsed.latency).toEqual([{ model: 'openai/gpt-4o', count: 3, p50: 200, p95: 300 }])
    // No other router's name/model may appear.
    expect(res.content[0]!.text).not.toContain('Beta')
    expect(res.content[0]!.text).not.toContain('secret-model')
  })
})

describe('listRoutersTool', () => {
  beforeEach(() => mockReadConfig.mockReset())

  it('is a read-scoped tool gated on the config-store DI token', () => {
    expect(listRoutersTool.name).toBe('list_routers')
    expect(listRoutersTool.scope).toBe('read')
    expect(listRoutersTool.requires.key).toBe('config.store')
  })

  it('returns every accessible router, never one outside the token scope', async () => {
    // A second router exists in config; it is not in authCtx.routers, so it
    // must never appear in the output.
    mockReadConfig.mockResolvedValue([
      router,
      { id: 'proj-2', name: 'Beta', models: [] },
    ] as never)

    const res = await listRoutersTool.handler({}, authCtx)
    const parsed = JSON.parse(res.content[0]!.text)

    expect(parsed).toEqual([{ id: 'proj-1', name: 'Alpha', modelCount: 1 }])
    expect(res.content[0]!.text).not.toContain('proj-2')
    expect(res.content[0]!.text).not.toContain('Beta')
    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })

  it('lists all routers the token owner can reach', async () => {
    const ctx = mcpAuthContext({
      routers: [
        router,
        { id: 'proj-2', name: 'Beta', models: [{ modelId: 'a' }, { modelId: 'b' }] } as unknown as RouterConfig,
      ],
    })

    const parsed = JSON.parse((await listRoutersTool.handler({}, ctx)).content[0]!.text)

    expect(parsed).toEqual([
      { id: 'proj-1', name: 'Alpha', modelCount: 1 },
      { id: 'proj-2', name: 'Beta', modelCount: 2 },
    ])
  })
})

describe('tool permissions', () => {
  it('gates every read tool on the matching dashboard permission', () => {
    expect(listModelsTool.permission).toBe('model:read')
    expect(getModelInstanceTool.permission).toBe('model:read')
    expect(routePreviewTool.permission).toBe('router:read')
    expect(listRoutersTool.permission).toBe('router:read')
    expect(usageSummaryTool.permission).toBe('report:read')
    expect(budgetStatusTool.permission).toBe('report:read')
    expect(metricsSnapshotTool.permission).toBe('report:read')
  })
})
