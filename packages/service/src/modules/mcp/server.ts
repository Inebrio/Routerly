import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpAuthContext, McpToolResult, ProjectConfig, ProjectToken } from '@routerly/shared'
import type { ServiceContainer } from '../../core/index.js'
import type { McpToolRegistry } from './registry.js'
import { assertWriteScope } from './tools/write.js'

/**
 * Bridge the SDK's generic (OAuth-shaped) `AuthInfo` into our project-scoped
 * `McpAuthContext`. The transports (Task 8 HTTP, Task 9 stdio) own real auth: they
 * resolve the project token, then set the incoming request's `auth` field to
 *
 *   req.auth = {
 *     token: <raw project-token string>,
 *     clientId: project.id,
 *     scopes: token.scopes ?? [],
 *     extra: { project, projectToken: token },
 *   }
 *
 * before handing off to the transport. The SDK forwards that `AuthInfo` verbatim
 * to every request handler as `extra.authInfo`, so `authInfo.extra.project` /
 * `authInfo.extra.projectToken` arrive populated exactly as this function reads
 * them. `scopes` is taken from the SDK-standard `authInfo.scopes` (same array the
 * transport copied from `token.scopes`). This naming (`extra.project`,
 * `extra.projectToken`) is the contract Tasks 8/9 must follow.
 */
function toAuthContext(authInfo: AuthInfo | undefined): McpAuthContext {
  const project = authInfo?.extra?.project
  const projectToken = authInfo?.extra?.projectToken
  if (!project || !projectToken) {
    throw new McpError(ErrorCode.InvalidRequest, 'Missing MCP auth context')
  }
  return {
    project: project as ProjectConfig,
    token: projectToken as ProjectToken,
    scopes: authInfo!.scopes,
  }
}

/**
 * Build the shared low-level MCP `Server` both transports reuse. The `Server`
 * class (not the high-level `McpServer`) is deliberate: our tool list is dynamic,
 * driven by the registry, which the high-level API does not model well.
 *
 * `container` is accepted for signature-parity with the plan's contract (Tasks
 * 8/9 call `buildMcpServer(registry, container)`) and left available for a future
 * capability check.
 * // ponytail: container unused in server.ts's own logic today; kept as the
 * // declared public contract, wire a real use only when one exists.
 */
export function buildMcpServer(registry: McpToolRegistry, container: ServiceContainer): Server {
  void container
  const server = new Server(
    { name: 'routerly', version: '0.4.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const authCtx = toAuthContext(extra.authInfo)
    const canWrite = authCtx.scopes.includes('mcp:write')
    const tools = registry
      .ordered()
      .filter((tool) => tool.scope === 'read' || canWrite)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object' },
      }))
    return { tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const authCtx = toAuthContext(extra.authInfo)
    const name = request.params.name
    const tool = registry.get(name)
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`)
    }

    if (tool.scope === 'write') {
      try {
        // Belt-and-suspenders: the tool handler also calls this, but enforcing it
        // here guarantees no write handler runs when the scope is missing.
        assertWriteScope(authCtx)
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }

    // McpToolResult ({ content, isError? }) is structurally a CallToolResult.
    return (await tool.handler(request.params.arguments ?? {}, authCtx)) as CallToolResult
  })

  return server
}

/** Tool-execution-level error result (isError: true), not a protocol-level throw. */
function errorResult(text: string): McpToolResult & CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
