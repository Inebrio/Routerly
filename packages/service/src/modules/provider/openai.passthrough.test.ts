import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ModelConfig } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';
import { CustomAdapter } from './custom.js';
import { forwardableRequestHeaders } from './passthrough.js';

let server: Server;
let endpoint: string;
let seen: { headers: IncomingHttpHeaders; body: Record<string, unknown> };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req_abc', 'openai-processing-ms': '12', 'x-ratelimit-remaining-requests': '99' });
      res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

const model = (id: string, extra: Partial<ModelConfig> = {}) =>
  ({ id, provider: 'openai', endpoint, apiKey: 'sk-provider', cost: { inputPerMillion: 0, outputPerMillion: 0 }, ...extra }) as unknown as ModelConfig;
const req = { model: 'x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 };

describe.each([
  ['openai', () => new OpenAIAdapter(), 'openai/gpt-4o'],
  ['custom', () => new CustomAdapter(), 'custom/foo'],
])('%s adapter wire transparency', (_n, make, id) => {
  it('forwards body unchanged, client headers, and exposes provider response headers', async () => {
    let resp: Record<string, string> = {};
    await make().chatCompletion(req as never, model(id), {
      headers: { 'user-agent': 'my-client/1', 'openai-organization': 'org-x', 'x-custom': 'yes' },
      onResponseHeaders: (h) => (resp = h),
    });
    expect(seen.body).toEqual({ model: id.split('/')[1], messages: req.messages, max_tokens: 5 });
    expect(seen.headers['user-agent']).toBe('my-client/1');
    expect(seen.headers['openai-organization']).toBe('org-x');
    expect(seen.headers['x-custom']).toBe('yes');
    expect(Object.keys(seen.headers).filter((h) => h.startsWith('x-stainless'))).toEqual([]);
    expect(seen.headers.authorization).toBe('Bearer sk-provider');
    expect(resp['x-request-id']).toBe('req_abc');
    expect(resp['openai-processing-ms']).toBe('12');
    expect(resp['content-length']).toBeUndefined();
  });

  it('keeps an explicit stream:false', async () => {
    await make().chatCompletion({ ...req, stream: false } as never, model(id));
    expect(seen.body.stream).toBe(false);
  });
});

describe('OpenAI max_tokens handling', () => {
  it.each(['openai/o3', 'openai/gpt-5-mini'])('maps max_tokens for %s', async (id) => {
    await new OpenAIAdapter().chatCompletion(req as never, model(id));
    expect(seen.body.max_completion_tokens).toBe(5);
    expect(seen.body.max_tokens).toBeUndefined();
  });
});

describe('forwardableRequestHeaders', () => {
  it('drops credentials, hop-by-hop and routerly headers', () => {
    const out = forwardableRequestHeaders({
      Authorization: 'Bearer t', cookie: 'a=b', host: 'h', 'content-length': '3', 'x-api-key': 'k',
      'x-routerly-conversation-id': 'c', 'openai-organization': 'o', 'X-Custom': 'v',
    });
    expect(out).toEqual({ 'openai-organization': 'o', 'x-custom': 'v' });
  });
});
