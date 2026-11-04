import { createHash, randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { McpToken, Permission, RouterConfig, UserConfig } from '@routerly/shared'
import { readConfig, writeConfig } from '../config/loader.js'
import { getEffectiveRoles } from '../auth/roles.js'

/** Distinct from the `sk-rt-` router-token prefix, so the two are never confused. */
export const MCP_TOKEN_PREFIX = 'sk-rt-mcp-'

/** SHA-256, as for every random bearer token in the service (never bcrypt: not a password). */
export function hashMcpToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Mint a token record plus its raw value. The raw value is returned exactly once. */
export function mintMcpToken(name: string, expiresAt?: string): { raw: string; token: McpToken } {
  const raw = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`
  return {
    raw,
    token: {
      id: uuidv4(),
      name,
      tokenHash: hashMcpToken(raw),
      tokenSnippet: raw.substring(0, 14),
      createdAt: new Date().toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
    },
  }
}

/** Resolve a raw MCP token to its owning user, or null when no user owns it. */
export async function resolveUserByMcpToken(
  raw: string,
): Promise<{ user: UserConfig; token: McpToken } | null> {
  if (!raw.startsWith(MCP_TOKEN_PREFIX)) return null
  const hash = hashMcpToken(raw)
  const users = await readConfig('users')
  for (const user of users) {
    const token = user.mcpTokens?.find((t) => t.tokenHash === hash)
    if (token) return { user, token }
  }
  return null
}

/** Record a use. Fire-and-forget by contract: a failure here must not fail the call. */
export async function touchMcpToken(userId: string, tokenId: string): Promise<void> {
  const users = await readConfig('users')
  const user = users.find((u) => u.id === userId)
  const token = user?.mcpTokens?.find((t) => t.id === tokenId)
  if (!token) return
  token.lastUsedAt = new Date().toISOString()
  await writeConfig('users', users)
}

/** Permissions of the user's role, resolved the same way the dashboard JWT hook does. */
export async function resolveUserPermissions(user: UserConfig): Promise<Permission[]> {
  const customRoles = await readConfig('roles')
  return getEffectiveRoles(customRoles).find((r) => r.id === user.roleId)?.permissions ?? []
}

/**
 * Routers an MCP token may act on.
 *
 * A user is scoped by `routerIds` or by router membership. An unscoped user
 * (no routerIds, no membership anywhere) reaches every router, which is what
 * the dashboard already does today: `GET /api/routers` returns the full list to
 * any authenticated user. Permissions, not this list, are the real gate.
 */
export async function accessibleRouters(user: UserConfig): Promise<RouterConfig[]> {
  const routers = await readConfig('routers')
  const scoped = routers.filter(
    (p) => (user.routerIds ?? []).includes(p.id) || p.members?.some((m) => m.userId === user.id),
  )
  return scoped.length > 0 ? scoped : routers
}
