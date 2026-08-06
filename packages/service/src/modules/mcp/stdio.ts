import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpAuthContext } from '@routerly/shared'
import type { ServiceContainer } from '../../core/index.js'
import type { McpToolRegistry } from './registry.js'
import { buildMcpServer } from './server.js'
import { buildAuthContext } from './auth-context.js'

/** Resolves a raw MCP token to the context every tool runs with, or an error message. */
type ResolveAuth = (
  token: string,
) => Promise<{ context: McpAuthContext } | { error: string }>

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
 * `ROUTERLY_MCP_STDIO=1` (see index.ts). Identity comes from the personal
 * `ROUTERLY_MCP_TOKEN`, resolved through the same `buildAuthContext` the HTTP
 * transport uses per-request; here it runs once, at startup, because the process
 * serves exactly one user. A missing, invalid or expired token makes this mode
 * pointless, so it fails loudly (throws) rather than starting a dead server.
 *
 * The resulting context is fixed for the process lifetime: permissions are read
 * at startup, so a role change requires a restart. That matches the single-user,
 * short-lived nature of a stdio session.
 *
 * `server.connect(transport)` resolves once `transport.start()` resolves (for
 * stdio: immediately, after attaching stdin listeners), NOT when the session
 * closes, so awaiting this does not block module boot.
 *
 * `resolveAuth` and `baseTransport` are injectable for tests (an
 * `InMemoryTransport`); the 2-arg call site in index.ts uses the defaults.
 */
export async function startStdioServer(
  registry: McpToolRegistry,
  container: ServiceContainer,
  resolveAuth: ResolveAuth = buildAuthContext,
  baseTransport: Transport = new StdioServerTransport(),
): Promise<void> {
  const rawToken = process.env['ROUTERLY_MCP_TOKEN']
  if (!rawToken) {
    throw new Error('ROUTERLY_MCP_TOKEN is required to start the stdio MCP server')
  }

  const resolved = await resolveAuth(rawToken)
  if ('error' in resolved) {
    throw new Error(`ROUTERLY_MCP_TOKEN rejected: ${resolved.error}`)
  }

  const authInfo: AuthInfo = {
    token: rawToken,
    clientId: resolved.context.user.id,
    scopes: resolved.context.permissions,
    extra: { mcpContext: resolved.context },
  }

  const server = buildMcpServer(registry, container)
  await server.connect(new FixedAuthTransport(baseTransport, authInfo))
}
