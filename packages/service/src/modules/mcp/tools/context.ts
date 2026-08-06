import type { McpAuthContext, McpToolResult, ProjectConfig } from '@routerly/shared'

/** Tool-execution-level error result (isError: true), not a protocol-level throw. */
export function errorResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** JSON payload result, the shape every successful tool returns. */
export function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * Resolve the project a tool call targets.
 *
 * An MCP token belongs to a user, not to a project, so project-scoped tools take
 * an explicit `projectId` (id or name). It stays optional when the token reaches
 * exactly one project: asking for it there would be pure ceremony. Lookup is
 * always against `authCtx.projects`, so a project the user cannot reach is
 * indistinguishable from one that does not exist.
 */
export function resolveProject(
  authCtx: McpAuthContext,
  projectId?: string,
): { project: ProjectConfig } | { error: McpToolResult } {
  if (projectId) {
    const project = authCtx.projects.find(p => p.id === projectId || p.name === projectId)
    if (!project) return { error: errorResult(`Project not found or not accessible: ${projectId}`) }
    return { project }
  }
  if (authCtx.projects.length === 1) return { project: authCtx.projects[0]! }
  if (authCtx.projects.length === 0) {
    return { error: errorResult('This token has access to no project.') }
  }
  const names = authCtx.projects.map(p => p.name).join(', ')
  return {
    error: errorResult(`projectId is required: this token can reach several projects (${names}).`),
  }
}

/** Shared input schema fragment for the project-scoped tools. */
export const PROJECT_ID_PROPERTY = {
  projectId: {
    type: 'string',
    description: 'Project id or name. Optional when the token reaches a single project.',
  },
} as const
