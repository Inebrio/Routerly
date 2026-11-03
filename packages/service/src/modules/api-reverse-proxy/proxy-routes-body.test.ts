import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { Readable } from 'node:stream'

// A pipeline that streams the reply from inside runProxy (as the passthrough
// fallback does) must reach the client: the route handlers have to return the reply.
vi.mock('../reverse-proxy/index.js', () => ({
  buildOpenAIContext: (_req: unknown, reply: unknown) => ({ reply }),
  buildResponsesContext: (_req: unknown, reply: unknown) => ({ reply }),
  buildAnthropicContext: (_req: unknown, reply: unknown) => ({ reply }),
  getProxyPipeline: () => ({}),
  runProxy: async (_p: unknown, ctx: { reply: { code: (n: number) => { send: (b: unknown) => void } } }) => {
    await new Promise((r) => setTimeout(r, 10))
    ctx.reply.code(401).send(Readable.from((async function* () { await new Promise((r) => setTimeout(r, 10)); yield 'provider-error-body' })()))
  },
}))

import { openaiRoutes } from './openai.js'
import { anthropicRoutes } from './anthropic.js'

describe.each([
  ['/v1/chat/completions', openaiRoutes],
  ['/v1/responses', openaiRoutes],
  ['/v1/messages', anthropicRoutes],
] as const)('POST %s', (url, plugin) => {
  it('keeps a body streamed from inside the pipeline', async () => {
    const app = Fastify({ logger: false })
    await app.register(plugin)
    await app.ready()
    const res = await app.inject({ method: 'POST', url, payload: {} })
    await app.close()
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('provider-error-body')
  })

  // ROUT-363: on a router the body `model` is a hint; the route must not reject an unknown one.
  it('hands an unknown body model to the pipeline instead of answering 404', async () => {
    const app = Fastify({ logger: false })
    await app.register(plugin)
    await app.ready()
    const res = await app.inject({ method: 'POST', url, payload: { model: 'openai/nope' } })
    await app.close()
    expect(res.statusCode).not.toBe(404)
    expect(res.body).toBe('provider-error-body')
  })
})
