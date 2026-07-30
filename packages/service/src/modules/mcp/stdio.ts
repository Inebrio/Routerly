import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { ProjectConfig, ProjectToken } from '@routerly/shared'
import type { ServiceContainer } from '../../core/index.js'
import type { McpToolRegistry } from './registry.js'
import { buildMcpServer } from './server.js'

/** Resolves a raw project-token string to its project + token, or null. */
type ResolveAuth = (
  token: string,
) => Promise<{ project: ProjectConfig; token: ProjectToken } | null>

/**
 * Transport wrapper that re-injects a fixed, pre-resolved `AuthInfo` on every
 * inbound message.
 *
 * The stdio transport is single-identity: one process, one token (from
 * `ROUTERLY_MCP_TOKEN`), unlike HTTP where each request carries its own token.
 * `StdioServerTransport` never passes an `extra`/`authInfo` argument to
 * `onmessage`, so without this wrapper every request would reach
 * `server.ts`'s `toAuthContext` with `extra.authInfo === undefined` and throw
 * "Missing MCP auth context". This wrapper forwards each message with the fixed
 * `authInfo` attached, matching the `extra.authInfo` contract the HTTP transport
 * satisfies per-request.
 */
class FixedAuthTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void
  sessionId?: string

  constructor(
    private readonly inner: Transport,
    private readonly authInfo: AuthInfo,
  ) {
    this.inner.onclose = () => this.onclose?.()
    this.inner.onerror = (error) => this.onerror?.(error)
    this.inner.onmessage = (message) => this.onmessage?.(message, { authInfo: this.authInfo })
  }

  start(): Promise<void> {
    return this.inner.start()
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.inner.send(message, options)
  }

  close(): Promise<void> {
    return this.inner.close()
  }
}

/**
 * Start the local stdio MCP server. Opt-in local tooling gated by
 * `ROUTERLY_MCP_STDIO=1` (see index.ts). Identity comes from the
 * `ROUTERLY_MCP_TOKEN` project token; the same scope/expiry rules the HTTP
 * transport enforces per-request (auth.ts authPlugin mirror) apply here once, at
 * startup. A missing, invalid, expired or under-scoped token makes this mode
 * pointless, so it fails loudly (throws) rather than starting a dead server.
 *
 * `server.connect(transport)` resolves once `transport.start()` resolves (for
 * stdio: immediately, after attaching stdin listeners), NOT when the session
 * closes, so awaiting this does not block module boot.
 *
 * `baseTransport` is injectable for tests (an `InMemoryTransport`); the 3-arg
 * call site in index.ts uses the default `StdioServerTransport`.
 */
export async function startStdioServer(
  registry: McpToolRegistry,
  container: ServiceContainer,
  resolveAuth: ResolveAuth,
  baseTransport: Transport = new StdioServerTransport(),
): Promise<void> {
  const rawToken = process.env['ROUTERLY_MCP_TOKEN']
  if (!rawToken) {
    throw new Error('ROUTERLY_MCP_TOKEN is required to start the stdio MCP server')
  }

  const resolved = await resolveAuth(rawToken)
  if (!resolved) {
    throw new Error('Invalid ROUTERLY_MCP_TOKEN')
  }

  const { project, token } = resolved
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    throw new Error('ROUTERLY_MCP_TOKEN has expired')
  }

  const scopes = token.scopes ?? []
  if (!scopes.includes('mcp')) {
    throw new Error("ROUTERLY_MCP_TOKEN lacks the required 'mcp' scope")
  }

  const authInfo: AuthInfo = {
    token: rawToken,
    clientId: project.id,
    scopes,
    extra: { project, projectToken: token },
  }

  const server = buildMcpServer(registry, container)
  await server.connect(new FixedAuthTransport(baseTransport, authInfo))
}
