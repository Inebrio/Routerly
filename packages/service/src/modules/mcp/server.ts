import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpAuthContext, McpToolResult } from '@routerly/shared'
import type { ServiceContainer } from '../../core/index.js'
import type { McpToolRegistry } from './registry.js'

/**
 * Bridge the SDK's generic (OAuth-shaped) `AuthInfo` into our user-scoped
 * `McpAuthContext`. The transports (HTTP, stdio) own real auth: they resolve the
 * user's MCP token, then set the incoming request's `auth` field to
 *
 *   req.auth = {
 *     token: <raw mcp-token string>,
 *     clientId: user.id,
 *     scopes: <the user's permissions>,
 *     extra: { mcpContext: <McpAuthContext> },
 *   }
 *
 * before handing off to the transport. The SDK forwards that `AuthInfo` verbatim
 * to every request handler as `extra.authInfo`, so `authInfo.extra.mcpContext`
 * arrives populated exactly as this function reads it. `scopes` carries the same
 * permission list, in the SDK-standard field, for transports and SDK middleware
 * that inspect it.
 */
function toAuthContext(authInfo: AuthInfo | undefined): McpAuthContext {
  const context = authInfo?.extra?.['mcpContext']
  if (!context) {
    throw new McpError(ErrorCode.InvalidRequest, 'Missing MCP auth context')
  }
  return context as McpAuthContext
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
    const tools = registry
      .ordered()
      .filter((tool) => authCtx.permissions.includes(tool.permission))
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

    // A tool the caller cannot list is a tool the caller cannot call: the same
    // permission gates both, so an under-permissioned client can never reach a
    // handler by guessing the tool name.
    if (!authCtx.permissions.includes(tool.permission)) {
      return errorResult(`Permission denied: ${tool.permission} is required to call ${name}.`)
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
