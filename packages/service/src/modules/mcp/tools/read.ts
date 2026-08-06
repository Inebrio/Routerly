import type { ChatCompletionRequest } from '@routerly/shared'
import {
  CATALOG,
  ROUTER,
  USAGE_TRACKER,
  BUDGET,
  OBSERVABILITY,
  CONFIG_STORE,
} from '../../../core/tokens.js'
import { listEffectiveModelsIncludingDisabled } from '../../provider/list-effective.js'
import { routeRequest } from '../../routing/router.js'
import { readUsageRecords } from '../../usage/usageStore.js'
import { getLimitUsageSnapshot } from '../../budget/budget.js'
import { getMetricsSnapshot, percentile } from '../../observability/metrics-snapshot.js'
import type { McpToolEntry } from '../registry.js'
import { errorResult, jsonResult, resolveRouter, ROUTER_ID_PROPERTY } from './context.js'

/**
 * list_models: enumerate the models configured on this gateway for MCP clients.
 * Gateway-wide (models are not router-owned), so no router resolution. The
 * output whitelists only id/provider/contextWindow, a strictly safer stance than
 * api.ts's `apiKey: undefined, cfClearance: undefined` blacklist, since a fresh
 * object cannot carry any provider credential fields.
 * // ponytail: gated on CATALOG (the models feature's DI token); the handler
 * // reads config directly like api.ts rather than resolving a DI token, as the
 * // McpTool.handler signature carries no container.
 */
export const listModelsTool: McpToolEntry = {
  name: 'list_models',
  description:
    'List the models configured on this Routerly gateway (id, provider, context window). No secrets are returned.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  permission: 'model:read',
  requires: CATALOG,
  async handler() {
    // read-only management listing: show disabled-connection models too
    const models = await listEffectiveModelsIncludingDisabled()
    return jsonResult(
      models.map((m) => ({ id: m.id, provider: m.provider, contextWindow: m.contextWindow })),
    )
  },
}

/**
 * get_model: return one model's public config (same whitelist as list_models).
 * Gateway-wide. Not-found is reported as an isError McpToolResult, not a thrown
 * exception, keeping the tool contract.
 */
export const getModelInstanceTool: McpToolEntry = {
  name: 'get_model',
  description:
    'Get one configured model on this Routerly gateway by id (id, provider, context window). No secrets are returned.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  scope: 'read',
  permission: 'model:read',
  requires: CATALOG,
  async handler(input) {
    const { id } = (input ?? {}) as { id?: string }
    // read-only management lookup: show disabled-connection models too
    const models = await listEffectiveModelsIncludingDisabled()
    const m = models.find((x) => x.id === id)
    if (!m) return errorResult(`Model not found: ${String(id)}`)
    return jsonResult({ id: m.id, provider: m.provider, contextWindow: m.contextWindow })
  },
}

/**
 * route_preview: run the router's scoring pipeline for one accessible router and
 * return the ordered candidate models (id + weight) plus the reasoning trace,
 * without forwarding anything upstream. routeRequest only scores and orders
 * candidates; it makes no provider call. The trace is already secret-free (router
 * redacts key/secret/token/password from policy config) and candidates carry only
 * ids/weights.
 */
export const routePreviewTool: McpToolEntry = {
  name: 'route_preview',
  description:
    'Preview which model(s) a router would route a request to (ordered candidates + reasoning trace). Does not call any provider. No secrets are returned.',
  inputSchema: {
    type: 'object',
    properties: {
      ...ROUTER_ID_PROPERTY,
      model: { type: 'string' },
      messages: { type: 'array', items: { type: 'object' } },
    },
    additionalProperties: false,
  },
  scope: 'read',
  permission: 'router:read',
  requires: ROUTER,
  async handler(input, authCtx) {
    const inp = (input ?? {}) as {
      routerId?: string
      model?: string
      messages?: ChatCompletionRequest['messages']
    }
    const resolved = resolveRouter(authCtx, inp.routerId)
    if ('error' in resolved) return resolved.error

    const request: ChatCompletionRequest = { model: inp.model ?? '', messages: inp.messages ?? [] }
    const result = await routeRequest(request, resolved.router)
    return jsonResult({ models: result.models, trace: result.trace })
  },
}

/**
 * get_usage_summary: aggregate call count / cost / tokens for one accessible
 * router over a trailing window (default 24h). Reads usage directly via
 * readUsageRecords because the USAGE_TRACKER token exposes only trackUsage, not
 * read access (documented spec gap). Filtered to the resolved router, never to
 * routers the token owner cannot reach.
 */
export const usageSummaryTool: McpToolEntry = {
  name: 'get_usage_summary',
  description:
    "Summarize a router's usage over a trailing window (default 24 hours): call count, cost (USD), input/output tokens.",
  inputSchema: {
    type: 'object',
    properties: { ...ROUTER_ID_PROPERTY, windowHours: { type: 'number' } },
    additionalProperties: false,
  },
  scope: 'read',
  permission: 'report:read',
  requires: USAGE_TRACKER,
  async handler(input, authCtx) {
    const { routerId, windowHours = 24 } = (input ?? {}) as {
      routerId?: string
      windowHours?: number
    }
    const resolved = resolveRouter(authCtx, routerId)
    if ('error' in resolved) return resolved.error

    const since = Date.now() - windowHours * 3_600_000
    const records = await readUsageRecords()
    const scoped = records.filter(
      (r) => r.routerId === resolved.router.id && new Date(r.timestamp).getTime() >= since,
    )
    return jsonResult({
      routerId: resolved.router.id,
      windowHours,
      count: scoped.length,
      cost: +scoped.reduce((s, r) => s + r.cost, 0).toFixed(6),
      inputTokens: scoped.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: scoped.reduce((s, r) => s + r.outputTokens, 0),
    })
  },
}

/**
 * get_budget_status: per-model limit-usage snapshots for one accessible router.
 * Calls getLimitUsageSnapshot once per router model, resolving each ModelConfig
 * from the catalog by id. The snapshot echoes only limit metrics/windows/values,
 * never provider keys.
 */
export const budgetStatusTool: McpToolEntry = {
  name: 'get_budget_status',
  description:
    "Report current budget/limit usage for each of a router's models (metric, window, limit, current, remaining). No secrets are returned.",
  inputSchema: {
    type: 'object',
    properties: { ...ROUTER_ID_PROPERTY },
    additionalProperties: false,
  },
  scope: 'read',
  permission: 'report:read',
  requires: BUDGET,
  async handler(input, authCtx) {
    const { routerId } = (input ?? {}) as { routerId?: string }
    const resolved = resolveRouter(authCtx, routerId)
    if ('error' in resolved) return resolved.error

    // budget/usage reporting: still account for disabled-connection models
    const models = await listEffectiveModelsIncludingDisabled()
    const perModel = await Promise.all(
      resolved.router.models.map(async (ref) => {
        const model = models.find((m) => m.id === ref.modelId)
        if (!model) return null
        const limits = await getLimitUsageSnapshot(model, resolved.router)
        return { modelId: ref.modelId, limits }
      }),
    )
    return jsonResult(perModel.filter((x): x is NonNullable<typeof x> => x !== null))
  },
}

/**
 * get_metrics_snapshot: aggregate request/token/cost/latency metrics for one
 * accessible router. getMetricsSnapshot() is global (every router's name + every
 * model), so the raw snapshot would be a cross-router leak. Filter every
 * aggregate to rows labelled with the resolved router's name and drop the
 * routers list and model catalog.
 */
export const metricsSnapshotTool: McpToolEntry = {
  name: 'get_metrics_snapshot',
  description:
    "Aggregate metrics for one router (requests by status, tokens, cost, latency percentiles). Other routers' data is never returned.",
  inputSchema: {
    type: 'object',
    properties: { ...ROUTER_ID_PROPERTY },
    additionalProperties: false,
  },
  scope: 'read',
  permission: 'report:read',
  requires: OBSERVABILITY,
  async handler(input, authCtx) {
    const { routerId } = (input ?? {}) as { routerId?: string }
    const resolved = resolveRouter(authCtx, routerId)
    if ('error' in resolved) return resolved.error

    const snap = await getMetricsSnapshot()
    const pname = resolved.router.name
    const rows = (
      map: Map<string, { labels: Record<string, string>; value: number }>,
    ): Array<Record<string, unknown>> =>
      [...map.values()]
        .filter((e) => e.labels.router === pname)
        .map((e) => {
          const { router: _p, ...rest } = e.labels
          return { ...rest, value: e.value }
        })
    const latency = [...snap.agg.durations.values()]
      .filter((d) => d.labels.router === pname)
      .map((d) => {
        const sorted = [...d.latencies].sort((a, b) => a - b)
        return {
          model: d.labels.model,
          count: sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
        }
      })
    return jsonResult({
      router: { id: resolved.router.id, name: pname },
      requests: rows(snap.agg.requests),
      tokens: rows(snap.agg.tokens),
      cost: rows(snap.agg.cost),
      latency,
    })
  },
}

/**
 * list_routers: return the routers this token's owner can reach (id, name,
 * model count). Derived straight from authCtx.routers, so a router outside the
 * owner's scope can never appear in the output.
 */
export const listRoutersTool: McpToolEntry = {
  name: 'list_routers',
  description:
    'List the routers this token can reach (id, name, model count). Routers outside the token owner\'s scope are never returned.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  permission: 'router:read',
  requires: CONFIG_STORE,
  async handler(_input, authCtx) {
    return jsonResult(
      authCtx.routers.map((p) => ({ id: p.id, name: p.name, modelCount: p.models.length })),
    )
  },
}
