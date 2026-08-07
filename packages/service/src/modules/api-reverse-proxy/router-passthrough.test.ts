import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { RouterConfig } from '@routerly/shared';

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }));
vi.mock('../usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }));

import { readConfig } from '../config/loader.js';
import { trackUsage } from '../usage/tracker.js';
import { routerPassthroughRoutes } from './router-passthrough.js';

const mockReadConfig = vi.mocked(readConfig);
const mockTrackUsage = vi.mocked(trackUsage);

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
