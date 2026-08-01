import type { McpAuthContext } from '@routerly/shared'
import {
  accessibleProjects,
  resolveUserByMcpToken,
  resolveUserPermissions,
  touchMcpToken,
} from './tokens.js'

/**
 * Turn a raw MCP token into the auth context every tool runs with, or an error
 * message the transport reports as 401. Shared by both transports so HTTP and
 * stdio authenticate identically.
 *
 * lastUsedAt is updated fire-and-forget: a write failure must never fail an
 * otherwise valid MCP call.
 */
export async function buildAuthContext(
  raw: string,
): Promise<{ context: McpAuthContext } | { error: string }> {
  const resolved = await resolveUserByMcpToken(raw)
  if (!resolved) return { error: 'Invalid MCP token.' }

  const { user, token } = resolved
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { error: 'MCP token expired.' }
  }

  const [permissions, projects] = await Promise.all([
    resolveUserPermissions(user),
    accessibleProjects(user),
  ])
  void touchMcpToken(user.id, token.id).catch(() => {
    /* non-fatal */
  })

  return {
    context: {
      user: { id: user.id, email: user.email, roleId: user.roleId },
      permissions,
      projects,
      token,
    },
  }
}
