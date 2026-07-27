import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig } from '@routerly/shared'
import { anthropicRoutes } from './anthropic.js'

const testProject: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }],
}

async function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.decorateRequest('token', null as any)
  app.addHook('preHandler', async (req: any) => {
    req.project = testProject
    req.token = undefined
  })
  await app.register(anthropicRoutes)
  await app.ready()
  return app
}

// POST /v1/messages is now a pipeline-dispatch one-liner (buildAnthropicContext +
// runProxy); its behavior is covered by reverse-proxy/lanes/anthropic.test.ts (wire
// format) and the Plan 5 module tests (guardrails/pii/budget/routing). count_tokens
// is untouched by the flip and keeps its route-level tests here.
describe('POST /v1/messages/count_tokens', () => {
  it('estimates token count from message content', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello world' }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(typeof body.input_tokens).toBe('number')
    expect(body.input_tokens).toBeGreaterThan(0)
  })

  it('counts tokens with system prompt', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })
    await app.close()

    const body = JSON.parse(res.body)
    expect(body.input_tokens).toBeGreaterThan(0)
  })

  it('counts tokens with array content parts', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Tell me about the image' }] }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
  })

  it('handles content that is neither string nor array (line 96 else-if false branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: null }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // null content → neither string nor array → adds nothing
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })

  it('skips array parts with no text field (line 98 false branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'm', max_tokens: 100,
        messages: [{ role: 'user', content: [{ type: 'image_url', url: 'http://x.com/img.png' }] }],
      }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    // image part has no text → adds nothing
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })

  it('returns 0 tokens when messages is absent (covers line 93 || [] branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'm', max_tokens: 100 }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).input_tokens).toBe(0)
  })
})
