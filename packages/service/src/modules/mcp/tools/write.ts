import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { RouterToken } from '@routerly/shared'
import { CONFIG_STORE } from '../../../core/tokens.js'
import { readConfig, writeConfig } from '../../config/loader.js'
import type { McpToolEntry } from '../registry.js'
import { errorResult, jsonResult, resolveRouter, ROUTER_ID_PROPERTY } from './context.js'

/**
 * create_router_token: mint a new router token on an accessible router and
 * persist it, reusing the exact shape of POST /api/routers/:id/tokens (plaintext
 * token in routers.json by design; file permissions protect it, this is NOT a
 * hashed bearer path). The raw token is NEVER returned: the result carries only
 * id/tokenSnippet/createdAt/scopes, so an MCP client cannot exfiltrate the secret.
 * The raw token remains retrievable through the existing CLI/dashboard token flow.
 */
export const createRouterTokenTool: McpToolEntry = {
  name: 'create_router_token',
  description:
    "Create a new API token on a router. Returns the token id, snippet, creation time, and scopes only; the raw token is never returned (retrieve it via the CLI or dashboard token flow). Requires the 'token:write' permission.",
  inputSchema: {
    type: 'object',
    properties: {
      ...ROUTER_ID_PROPERTY,
      scopes: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  scope: 'write',
  permission: 'token:write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    const { routerId, scopes, labels } = (input ?? {}) as {
      routerId?: string
      scopes?: string[]
      labels?: string[]
    }
    const resolved = resolveRouter(authCtx, routerId)
    if ('error' in resolved) return resolved.error

    const rawToken = `sk-rt-${randomBytes(32).toString('hex')}`
    const newToken: RouterToken = {
      id: uuidv4(),
      token: rawToken,
      tokenSnippet: rawToken.substring(0, 10),
      createdAt: new Date().toISOString(),
      ...(scopes ? { scopes } : {}),
      ...(labels ? { labels } : {}),
    }

    const routers = await readConfig('routers')
    const index = routers.findIndex((p) => p.id === resolved.router.id)
    if (index === -1) return errorResult('Router not found')
    const updated = { ...routers[index]! }
    updated.tokens = [...(updated.tokens ?? []), newToken]
    routers[index] = updated
    await writeConfig('routers', routers)

    // Build the result with ONLY the four allowed keys; the raw token is omitted
    // entirely (never set to undefined, which can round-trip through JSON).
    return jsonResult({
      id: newToken.id,
      tokenSnippet: newToken.tokenSnippet,
      createdAt: newToken.createdAt,
      scopes: scopes ?? [],
    })
  },
}

/**
 * toggle_model: flip the `enabled` flag on one of an accessible router's model
 * refs and persist it (read-modify-write on routers.json, same as
 * create_router_token). The flag is genuinely stored on RouterModelRef but is
 * NOT yet consumed by the routing engine, so toggling it is currently inert at
 * request time until a later plan wires routing to honor it. Absent flag is
 * treated as `true`, so the first toggle disables the model.
 */
export const toggleModelTool: McpToolEntry = {
  name: 'toggle_model',
  description:
    "Enable or disable one of a router's model refs (flips its `enabled` flag). The flag is persisted but not yet honored by the routing engine. Requires the 'router:write' permission.",
  inputSchema: {
    type: 'object',
    properties: { ...ROUTER_ID_PROPERTY, modelId: { type: 'string' } },
    required: ['modelId'],
    additionalProperties: false,
  },
  scope: 'write',
  permission: 'router:write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    const { routerId, modelId } = (input ?? {}) as { routerId?: string; modelId?: string }
    const resolved = resolveRouter(authCtx, routerId)
    if ('error' in resolved) return resolved.error

    const routers = await readConfig('routers')
    const index = routers.findIndex((p) => p.id === resolved.router.id)
    if (index === -1) return errorResult('Router not found')
    const router = routers[index]!
    const ref = router.models.find((m) => m.modelId === modelId)
    if (!ref) return errorResult(`Model not found in router: ${String(modelId)}`)
    const enabled = !(ref.enabled ?? true)
    ref.enabled = enabled
    await writeConfig('routers', routers)

    return jsonResult({ modelId: ref.modelId, enabled })
  },
}
