import type { ChatCompletionRequest } from '@routerly/shared'
import {
  CATALOG,
  ROUTER,
  USAGE_TRACKER,
  BUDGET,
  OBSERVABILITY,
  CONFIG_STORE,
} from '../../../core/tokens.js'
import { readConfig } from '../../config/loader.js'
import { routeRequest } from '../../routing/router.js'
import { readUsageRecords } from '../../usage/usageStore.js'
import { getLimitUsageSnapshot } from '../../budget/budget.js'
import { getMetricsSnapshot, percentile } from '../../observability/metrics-snapshot.js'
import type { McpToolEntry } from '../registry.js'

/**
 * list_models: enumerate the models configured on this gateway for MCP clients.
 * Read scope, global (models are gateway-wide, not project-owned) so authCtx is
 * unused. The output whitelists only id/provider/enabled/contextWindow — a
 * strictly safer stance than api.ts's `apiKey: undefined, cfClearance: undefined`
 * blacklist, since a fresh object cannot carry any provider credential fields.
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
  requires: CATALOG,
  async handler() {
    const models = await readConfig('models')
    const list = models.map((m) => ({
      id: m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
  },
}

/**
 * get_model: return one model's public config (same whitelist as list_models).
 * Read scope, global (gateway-wide), so authCtx is unused. Not-found is reported
 * as an isError McpToolResult, not a thrown exception, keeping the tool contract.
 * // ponytail: same CATALOG gate + direct readConfig as list_models; no DI
 * // container at handler-call time (McpTool.handler carries none).
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
  requires: CATALOG,
  async handler(input) {
    const { id } = (input ?? {}) as { id?: string }
    const models = await readConfig('models')
    const m = models.find((x) => x.id === id)
    if (!m) {
      return {
        content: [{ type: 'text', text: `Model not found: ${String(id)}` }],
        isError: true,
      }
    }
    const out = { id: m.id, provider: m.provider, contextWindow: m.contextWindow }
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}

/**
 * route_preview: run the router's scoring pipeline for the auth project and return
 * the ordered candidate models (id + weight) plus the reasoning trace, without
 * forwarding anything upstream. routeRequest only scores and orders candidates; it
 * makes no provider call. The trace is already secret-free (router redacts
 * key/secret/token/password from policy config) and candidates carry only ids/weights.
 */
export const routePreviewTool: McpToolEntry = {
  name: 'route_preview',
  description:
    'Preview which model(s) this project would route a request to (ordered candidates + reasoning trace). Does not call any provider. No secrets are returned.',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string' },
      messages: { type: 'array', items: { type: 'object' } },
    },
    additionalProperties: false,
  },
  scope: 'read',
  requires: ROUTER,
  async handler(input, authCtx) {
    const inp = (input ?? {}) as { model?: string; messages?: ChatCompletionRequest['messages'] }
    const request: ChatCompletionRequest = {
      model: inp.model ?? '',
      messages: inp.messages ?? [],
    }
    const result = await routeRequest(
      request,
      authCtx.project,
      undefined,
      undefined,
      authCtx.token,
    )
    const out = { models: result.models, trace: result.trace }
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}

/**
 * get_usage_summary: aggregate call count / cost / tokens for the AUTH project over a
 * trailing window (default 24h). Reads usage directly via readUsageRecords because the
 * USAGE_TRACKER token exposes only trackUsage, not read access (documented spec gap).
 * Filtered to authCtx.project.id, never other projects' records.
 */
export const usageSummaryTool: McpToolEntry = {
  name: 'get_usage_summary',
  description:
    "Summarize this project's usage over a trailing window (default 24 hours): call count, cost (USD), input/output tokens. Scoped to the calling project only.",
  inputSchema: {
    type: 'object',
    properties: { windowHours: { type: 'number' } },
    additionalProperties: false,
  },
  scope: 'read',
  requires: USAGE_TRACKER,
  async handler(input, authCtx) {
    const { windowHours = 24 } = (input ?? {}) as { windowHours?: number }
    const since = Date.now() - windowHours * 3_600_000
    const records = await readUsageRecords()
    const scoped = records.filter(
      (r) => r.projectId === authCtx.project.id && new Date(r.timestamp).getTime() >= since,
    )
    const out = {
      projectId: authCtx.project.id,
      windowHours,
      count: scoped.length,
      cost: +scoped.reduce((s, r) => s + r.cost, 0).toFixed(6),
      inputTokens: scoped.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: scoped.reduce((s, r) => s + r.outputTokens, 0),
    }
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}

/**
 * get_budget_status: per-model limit-usage snapshots for the AUTH project. Calls
 * getLimitUsageSnapshot once per project model, resolving each ModelConfig from the
 * catalog by id. The snapshot already scopes to project/token internally and echoes
 * only limit metrics/windows/values, never provider keys.
 */
export const budgetStatusTool: McpToolEntry = {
  name: 'get_budget_status',
  description:
    "Report current budget/limit usage for each of this project's models (metric, window, limit, current, remaining). Scoped to the calling project only. No secrets are returned.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requires: BUDGET,
  async handler(_input, authCtx) {
    const models = await readConfig('models')
    const perModel = await Promise.all(
      authCtx.project.models.map(async (ref) => {
        const model = models.find((m) => m.id === ref.modelId)
        if (!model) return null
        const limits = await getLimitUsageSnapshot(model, authCtx.project, authCtx.token)
        return { modelId: ref.modelId, limits }
      }),
    )
    const out = perModel.filter((x): x is NonNullable<typeof x> => x !== null)
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}

/**
 * get_metrics_snapshot: aggregate request/token/cost/latency metrics for the AUTH
 * project only. getMetricsSnapshot() is global (every project's name + every model),
 * so the raw snapshot would be a cross-project leak. Filter every aggregate to rows
 * labelled with this project's name and drop the projects list and model catalog,
 * consistent with the other project-scoped tools in this task.
 */
export const metricsSnapshotTool: McpToolEntry = {
  name: 'get_metrics_snapshot',
  description:
    "Aggregate metrics for this project only (requests by status, tokens, cost, latency percentiles). Scoped to the calling project; other projects' data is never returned.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requires: OBSERVABILITY,
  async handler(_input, authCtx) {
    const snap = await getMetricsSnapshot()
    const pname = authCtx.project.name
    const rows = (
      map: Map<string, { labels: Record<string, string>; value: number }>,
    ): Array<Record<string, unknown>> =>
      [...map.values()]
        .filter((e) => e.labels.project === pname)
        .map((e) => {
          const { project: _p, ...rest } = e.labels
          return { ...rest, value: e.value }
        })
    const latency = [...snap.agg.durations.values()]
      .filter((d) => d.labels.project === pname)
      .map((d) => {
        const sorted = [...d.latencies].sort((a, b) => a - b)
        return {
          model: d.labels.model,
          count: sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
        }
      })
    const out = {
      project: { id: authCtx.project.id, name: pname },
      requests: rows(snap.agg.requests),
      tokens: rows(snap.agg.tokens),
      cost: rows(snap.agg.cost),
      latency,
    }
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}

/**
 * list_projects: return ONLY the auth project (id, name, model count). Derived
 * straight from authCtx.project so no other project can ever appear in the output.
 * // ponytail: leak-proof by construction, no readConfig('projects') scan needed;
 * // the CONFIG_STORE gate is the capability marker (Task 5 wires container.has).
 */
export const listProjectsTool: McpToolEntry = {
  name: 'list_projects',
  description:
    'List the project this token belongs to (id, name, model count). Only the calling project is returned.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requires: CONFIG_STORE,
  async handler(_input, authCtx) {
    const out = [
      {
        id: authCtx.project.id,
        name: authCtx.project.name,
        modelCount: authCtx.project.models.length,
      },
    ]
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  },
}
