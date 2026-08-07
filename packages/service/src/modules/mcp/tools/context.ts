import type { McpAuthContext, McpToolResult, RouterConfig } from '@routerly/shared'

/** Tool-execution-level error result (isError: true), not a protocol-level throw. */
export function errorResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** JSON payload result, the shape every successful tool returns. */
export function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * Resolve the router a tool call targets.
 *
 * An MCP token belongs to a user, not to a router, so router-scoped tools take
 * an explicit `routerId` (id or name). It stays optional when the token reaches
 * exactly one router: asking for it there would be pure ceremony. Lookup is
 * always against `authCtx.routers`, so a router the user cannot reach is
 * indistinguishable from one that does not exist.
 */
export function resolveRouter(
  authCtx: McpAuthContext,
  routerId?: string,
): { router: RouterConfig } | { error: McpToolResult } {
  if (routerId) {
    const router = authCtx.routers.find(p => p.id === routerId || p.name === routerId)
    if (!router) return { error: errorResult(`Router not found or not accessible: ${routerId}`) }
    return { router }
  }
  if (authCtx.routers.length === 1) return { router: authCtx.routers[0]! }
  if (authCtx.routers.length === 0) {
    return { error: errorResult('This token has access to no router.') }
  }
  const names = authCtx.routers.map(p => p.name).join(', ')
  return {
    error: errorResult(`routerId is required: this token can reach several routers (${names}).`),
  }
}

/** Shared input schema fragment for the router-scoped tools. */
export const ROUTER_ID_PROPERTY = {
  routerId: {
    type: 'string',
    description: 'Router id or name. Optional when the token reaches a single router.',
  },
} as const
