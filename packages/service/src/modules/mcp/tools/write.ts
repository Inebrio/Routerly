import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { ProjectToken } from '@routerly/shared'
import { CONFIG_STORE } from '../../../core/tokens.js'
import { readConfig, writeConfig } from '../../config/loader.js'
import type { McpToolEntry } from '../registry.js'
import { errorResult, jsonResult, resolveProject, PROJECT_ID_PROPERTY } from './context.js'

/**
 * create_project_token: mint a new project token on an accessible project and
 * persist it, reusing the exact shape of POST /api/projects/:id/tokens (plaintext
 * token in projects.json by design; file permissions protect it, this is NOT a
 * hashed bearer path). The raw token is NEVER returned: the result carries only
 * id/tokenSnippet/createdAt/scopes, so an MCP client cannot exfiltrate the secret.
 * The raw token remains retrievable through the existing CLI/dashboard token flow.
 */
export const createProjectTokenTool: McpToolEntry = {
  name: 'create_project_token',
  description:
    "Create a new API token on a project. Returns the token id, snippet, creation time, and scopes only; the raw token is never returned (retrieve it via the CLI or dashboard token flow). Requires the 'token:write' permission.",
  inputSchema: {
    type: 'object',
    properties: {
      ...PROJECT_ID_PROPERTY,
      scopes: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  scope: 'write',
  permission: 'token:write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    const { projectId, scopes, labels } = (input ?? {}) as {
      projectId?: string
      scopes?: string[]
      labels?: string[]
    }
    const resolved = resolveProject(authCtx, projectId)
    if ('error' in resolved) return resolved.error

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
    const index = projects.findIndex((p) => p.id === resolved.project.id)
    if (index === -1) return errorResult('Project not found')
    const updated = { ...projects[index]! }
    updated.tokens = [...(updated.tokens ?? []), newToken]
    projects[index] = updated
    await writeConfig('projects', projects)

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
 * toggle_model: flip the `enabled` flag on one of an accessible project's model
 * refs and persist it (read-modify-write on projects.json, same as
 * create_project_token). The flag is genuinely stored on ProjectModelRef but is
 * NOT yet consumed by the routing engine, so toggling it is currently inert at
 * request time until a later plan wires routing to honor it. Absent flag is
 * treated as `true`, so the first toggle disables the model.
 */
export const toggleModelTool: McpToolEntry = {
  name: 'toggle_model',
  description:
    "Enable or disable one of a project's model refs (flips its `enabled` flag). The flag is persisted but not yet honored by the routing engine. Requires the 'project:write' permission.",
  inputSchema: {
    type: 'object',
    properties: { ...PROJECT_ID_PROPERTY, modelId: { type: 'string' } },
    required: ['modelId'],
    additionalProperties: false,
  },
  scope: 'write',
  permission: 'project:write',
  requires: CONFIG_STORE,
  async handler(input, authCtx) {
    const { projectId, modelId } = (input ?? {}) as { projectId?: string; modelId?: string }
    const resolved = resolveProject(authCtx, projectId)
    if ('error' in resolved) return resolved.error

    const projects = await readConfig('projects')
    const index = projects.findIndex((p) => p.id === resolved.project.id)
    if (index === -1) return errorResult('Project not found')
    const project = projects[index]!
    const ref = project.models.find((m) => m.modelId === modelId)
    if (!ref) return errorResult(`Model not found in project: ${String(modelId)}`)
    const enabled = !(ref.enabled ?? true)
    ref.enabled = enabled
    await writeConfig('projects', projects)

    return jsonResult({ modelId: ref.modelId, enabled })
  },
}
