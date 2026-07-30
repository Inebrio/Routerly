import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { McpAuthContext, ProjectToken } from '@routerly/shared'
import { CONFIG_STORE } from '../../../core/tokens.js'
import { readConfig, writeConfig } from '../../config/loader.js'
import type { McpToolEntry } from '../registry.js'

/**
 * Shared enforcement for every MCP write tool. Throws a plain Error (not an
 * McpToolResult) when the auth context lacks the 'mcp:write' scope, so a caller
 * missing the scope can never reach a writeConfig. server.ts (Task 7) calls this
 * in its tools/call dispatcher; each write tool also calls it as its first
 * handler statement, and the tests drive the tools through it directly.
 */
export function assertWriteScope(authCtx: McpAuthContext): void {
  if (!authCtx.scopes.includes('mcp:write')) {
    throw new Error('mcp:write scope required')
  }
}

/**
 * create_project_token: mint a new project token on the AUTH project and persist
 * it, reusing the exact shape of POST /api/projects/:id/tokens (plaintext token in
 * projects.json by design; file permissions protect it, this is NOT a hashed
 * bearer path). The raw token is NEVER returned: the result carries only
 * id/tokenSnippet/createdAt/scopes, so an MCP client cannot exfiltrate the secret.
 * The raw token remains retrievable through the existing CLI/dashboard token flow.
 */
export const createProjectTokenTool: McpToolEntry = {
  name: 'create_project_token',
  description:
    "Create a new API token for this project. Returns the token id, snippet, creation time, and scopes only; the raw token is never returned (retrieve it via the CLI or dashboard token flow). Requires the 'mcp:write' scope.",
  inputSchema: {
    type: 'object',
    properties: {
      scopes: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  scope: 'write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    assertWriteScope(authCtx)
    const { scopes, labels } = (input ?? {}) as { scopes?: string[]; labels?: string[] }

    const rawToken = `sk-rt-${randomBytes(32).toString('hex')}`
    const newToken: ProjectToken = {
      id: uuidv4(),
      token: rawToken,
      tokenSnippet: rawToken.substring(0, 10),
      createdAt: new Date().toISOString(),
      ...(scopes ? { scopes } : {}),
      ...(labels ? { labels } : {}),
    }

    const projects = await readConfig('projects')
    const index = projects.findIndex((p) => p.id === authCtx.project.id)
    if (index === -1) {
      return { content: [{ type: 'text', text: 'Project not found' }], isError: true }
    }
    const updated = { ...projects[index]! }
    updated.tokens = [...(updated.tokens ?? []), newToken]
    projects[index] = updated
    await writeConfig('projects', projects)

    // Build the result with ONLY the four allowed keys; the raw token is omitted
    // entirely (never set to undefined, which can round-trip through JSON).
    const result = {
      id: newToken.id,
      tokenSnippet: newToken.tokenSnippet,
      createdAt: newToken.createdAt,
      scopes: scopes ?? [],
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
}

/**
 * toggle_model: flip the `enabled` flag on one of the AUTH project's model refs
 * and persist it (read-modify-write on projects.json, same as create_project_token).
 * The flag is genuinely stored on ProjectModelRef but is NOT yet consumed by the
 * routing engine, so toggling it is currently inert at request time until a later
 * plan wires routing to honor it. Absent flag is treated as `true`, so the first
 * toggle disables the model.
 */
export const toggleModelTool: McpToolEntry = {
  name: 'toggle_model',
  description:
    "Enable or disable one of this project's model refs (flips its `enabled` flag). The flag is persisted but not yet honored by the routing engine. Requires the 'mcp:write' scope.",
  inputSchema: {
    type: 'object',
    properties: { modelId: { type: 'string' } },
    required: ['modelId'],
    additionalProperties: false,
  },
  scope: 'write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    assertWriteScope(authCtx)
    const { modelId } = (input ?? {}) as { modelId?: string }

    const projects = await readConfig('projects')
    const index = projects.findIndex((p) => p.id === authCtx.project.id)
    if (index === -1) {
      return { content: [{ type: 'text', text: 'Project not found' }], isError: true }
    }
    const project = projects[index]!
    const ref = project.models.find((m) => m.modelId === modelId)
    if (!ref) {
      return {
        content: [{ type: 'text', text: `Model not found in project: ${String(modelId)}` }],
        isError: true,
      }
    }
    const enabled = !(ref.enabled ?? true)
    ref.enabled = enabled
    await writeConfig('projects', projects)

    const result = { modelId: ref.modelId, enabled }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
}
