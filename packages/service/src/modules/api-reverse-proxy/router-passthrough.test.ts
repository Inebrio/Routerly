import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { RouterConfig } from '@routerly/shared';

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }));
vi.mock('../usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../usage/activity.js', () => ({ appendActivity: vi.fn().mockResolvedValue(undefined) }));

import { readConfig } from '../config/loader.js';
import { trackUsage } from '../usage/tracker.js';
import { appendActivity } from '../usage/activity.js';
import { routerPassthroughRoutes } from './router-passthrough.js';

const mockReadConfig = vi.mocked(readConfig);
const mockTrackUsage = vi.mocked(trackUsage);
const mockAppendActivity = vi.mocked(appendActivity);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const plainRouter: RouterConfig = {
  id: 'pr-1', name: 'My Passthrough', kind: 'passthrough', slug: 'my-openai',
  tokens: [], members: [], models: [],
};

async function buildApp(routers: RouterConfig[]) {
  mockReadConfig.mockImplementation(async (key: string) => (key === 'routers' ? routers : []) as never);
  const app = Fastify({ logger: false });
  await app.register(routerPassthroughRoutes);
  await app.ready();
  return app;
}

describe('routerPassthroughRoutes', () => {
  it('returns the provider error body on upstream 401 (not empty)', async () => {
    const errBody = JSON.stringify({ error: { message: 'bad key' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(errBody, { status: 401, headers: { 'content-type': 'application/json' } }),
    ));
    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST', url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer bad', 'content-type': 'application/json' },
      payload: '{"model":"gpt-4o","messages":[]}',
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(errBody);
  });

  it('streams the provider SSE body when stream:true', async () => {
    const sse = 'data: {"x":1}\n\ndata: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ));
    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST', url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
      payload: '{"model":"gpt-4o","stream":true,"messages":[]}',
    });
    await app.close();
    expect(res.body).toBe(sse);
  });

  // ROUT-237: exceptions run only on the token-authenticated lanes. This route is unauthenticated,
  // so a matching model must still be forwarded raw with the client's own credential.
  it('never diverts a request to an exception target, even for a matching model', async () => {
    const withExceptions: RouterConfig = {
      ...plainRouter,
      models: [{ modelId: '__passthrough__' }, { modelId: 'openai/x' }],
      exceptions: [{ match: 'gpt-4o', targetModelId: 'openai/x' }],
    };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);
    const app = await buildApp([withExceptions]);
    const res = await app.inject({
      method: 'POST', url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer client-key', 'content-type': 'application/json' },
      payload: '{"model":"gpt-4o","messages":[]}',
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.stringify(init.headers).toLowerCase()).toContain('bearer client-key');
    expect(mockTrackUsage.mock.calls.some((c) => (c[0] as { routedBy?: string }).routedBy)).toBe(false);
  });

  it('404s when no passthrough router matches the slug', async () => {
    const app = await buildApp([]);
    const res = await app.inject({ method: 'POST', url: '/passthrough/unknown/v1/chat/completions' });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', message: 'No passthrough router at this path' });
  });

  it('400s on a path that matches no known wire format', async () => {
    const app = await buildApp([plainRouter]);
    const res = await app.inject({ method: 'GET', url: '/passthrough/my-openai/v1/totally-unknown' });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unrecognized_wire_format');
  });

  it('records a non-model path as a proxy event (method + path without query, router, status 400) (ROUT-563)', async () => {
    const app = await buildApp([plainRouter]);
    await app.inject({ method: 'GET', url: '/passthrough/my-openai/v1/models?key=secret-query' });
    await app.close();

    expect(mockAppendActivity).toHaveBeenCalledOnce();
    const event = mockAppendActivity.mock.calls[0]![0];
    expect(event).toMatchObject({ kind: 'proxy', outcome: 'error', name: 'GET /v1/models', status: 400, routerId: 'pr-1' });
    expect(JSON.stringify(event)).not.toContain('secret-query');
    expect(mockTrackUsage).not.toHaveBeenCalled();
  });

  it('does not record model calls as activity (ROUT-563)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const app = await buildApp([plainRouter]);
    await app.inject({
      method: 'POST', url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, payload: '{"model":"gpt-4o","messages":[]}',
    });
    await app.close();

    expect(mockAppendActivity).not.toHaveBeenCalled();
  });

  it('a failing activity log does not change the 400 response (ROUT-563)', async () => {
    mockAppendActivity.mockRejectedValueOnce(new Error('disk full'));
    const app = await buildApp([plainRouter]);
    const res = await app.inject({ method: 'GET', url: '/passthrough/my-openai/v1/models' });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unrecognized_wire_format');
  });

  it('forwards the client Authorization header byte-for-byte to api.openai.com, no auth check of its own', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer sk-caller-owns-this', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', choices: [] }));
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe('Bearer sk-caller-owns-this');
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      routerId: 'pr-1', modelId: 'gpt-4o', outcome: 'success',
    }));
  });

  it('routes /v1/messages to api.anthropic.com and forwards x-api-key untouched', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockFetch);

    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/messages',
      headers: { 'x-api-key': 'sk-ant-caller', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-caller');
  });

  it('forwards a malformed JSON body as-is without erroring (EC2)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockFetch);

    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer sk-x', 'content-type': 'application/json' },
      payload: '{not valid json',
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: Buffer }];
    expect(Buffer.from(init.body).toString()).toBe('{not valid json');
  });

  it('strips Expect: 100-continue before forwarding so the request reaches upstream instead of 502ing (B1)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const app = await buildApp([plainRouter]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer sk-x', 'content-type': 'application/json', expect: '100-continue' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['expect']).toBeUndefined();
  });

  // PR-E AC5/EC4 — a passthrough router that now holds real target models must still
  // raw-forward exactly as before: family resolution reads only the URL path, never the
  // body's `model` field, even when that field happens to name one of the router's own
  // configured real target models.
  it('a body `model` matching one of the router\'s real target models has zero effect on family resolution or forwarding (AC5/EC4)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const routerWithRealModels: RouterConfig = {
      ...plainRouter,
      models: [{ modelId: 'gpt-4o' }, { modelId: 'claude-3-5-sonnet' }],
    };
    const app = await buildApp([routerWithRealModels]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer sk-caller-owns-this', 'content-type': 'application/json' },
      // body.model names one of the router's own real target models — must not steer
      // resolution away from the plain path-based family match (still OpenAI, from the URL).
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions'); // path-based, unaffected by body.model
    expect(init.headers['authorization']).toBe('Bearer sk-caller-owns-this'); // unauthenticated lane, client's own credential forwarded as-is
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ routerId: 'pr-1', modelId: 'gpt-4o', outcome: 'success' }));
  });

  it('a body `model` matching one of the router\'s real target models still resolves to the Anthropic family purely from the URL path (AC5/EC4)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', mockFetch);

    const routerWithRealModels: RouterConfig = {
      ...plainRouter,
      models: [{ modelId: 'gpt-4o' }, { modelId: 'claude-3-5-sonnet' }],
    };
    const app = await buildApp([routerWithRealModels]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/messages',
      headers: { 'x-api-key': 'sk-ant-caller', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('blocks a request matched by a blocking guardrail rule before forwarding', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const guardedRouter: RouterConfig = {
      ...plainRouter,
      guardrails: {
        rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['SECRET'] }, enabled: true }],
      },
    };
    const app = await buildApp([guardedRouter]);
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/my-openai/v1/chat/completions',
      headers: { authorization: 'Bearer sk-x', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'the SECRET word' }] }),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].finish_reason).toBe('content_filter');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'blocked' }));
  });
});
