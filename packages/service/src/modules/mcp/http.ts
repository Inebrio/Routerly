import type { FastifyPluginAsync } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { extractProjectToken, resolveProjectByToken } from '../auth/auth.js'
import { MCP_TOOLS } from '../../core/tokens.js'
import { buildMcpServer } from './server.js'

/**
 * MCP Streamable HTTP entrypoint at POST /mcp.
 *
 * This route is self-authenticating (authPlugin's preHandler skips /mcp): it
 * resolves the project token itself, rejects on missing token (401), expired
 * token (401) or a token that lacks the 'mcp' scope (403), then hands off to the
 * SDK's StreamableHTTPServerTransport. It attaches an `AuthInfo` to the raw Node
 * request as `req.auth` before the handoff, the shape buildMcpServer's handlers
 * read via `extra.authInfo` (see server.ts toAuthContext). Transport and Server
 * are built fresh per request: stateless mode (no sessionIdGenerator) has no
 * persistent state to reuse, and each request is an independent authenticated
 * call.
 */
export const mcpHttpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/mcp', async (request, reply) => {
    const incomingToken = extractProjectToken(request.headers)
    if (!incomingToken) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <project-token>',
      })
    }

    const resolved = await resolveProjectByToken(incomingToken)
    if (!resolved) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid project token.' })
    }

    const { project, token } = resolved
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
      return reply.status(401).send({ error: 'Token expired' })
    }

    const scopes = token.scopes ?? []
    if (!scopes.includes('mcp')) {
      return reply.status(403).send({
        error: 'forbidden',
        message: "Project token lacks the 'mcp' scope required to use the MCP endpoint.",
      })
    }

    const container = fastify.kernel.container
    const registry = container.resolve(MCP_TOOLS)
    const server = buildMcpServer(registry, container)
    const transport = new StreamableHTTPServerTransport({
      // Omitting sessionIdGenerator selects stateless mode (no session tracking).
      // enableJsonResponse returns a plain JSON HTTP response instead of an SSE
      // stream (simple request/response). sessionIdGenerator is left off rather
      // than set to undefined to satisfy exactOptionalPropertyTypes.
      enableJsonResponse: true,
    })

    const auth: AuthInfo = {
      token: incomingToken,
      clientId: project.id,
      scopes,
      extra: { project, projectToken: token },
    }
    ;(request.raw as typeof request.raw & { auth?: AuthInfo }).auth = auth

    // handleRequest writes directly to the raw Node response, so Fastify must
    // release the reply. Pass Fastify's already-parsed body as parsedBody.
    reply.hijack()
    // SDK-boundary cast: the concrete transport's optional members (onclose?)
    // trip exactOptionalPropertyTypes against connect()'s Transport param.
    await server.connect(transport as Parameters<typeof server.connect>[0])
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
}
