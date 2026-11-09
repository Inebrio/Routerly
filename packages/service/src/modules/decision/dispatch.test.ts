import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ModelConfig } from '@routerly/shared';
import { decide, decideSafe } from './dispatch.js';

const model = { id: 'typesafe/jev-latest', provider: 'typesafe', apiKey: 'k-secret', upstreamModelId: 'jev-latest', cost: { inputPerMillion: 0, outputPerMillion: 0 } } as unknown as ModelConfig;
const q = { q1: { type: 'noul' as const, instructions: 'Yes?' } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('decision dispatch', () => {
  it('parses noul, choice and score answers and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {
      model: 'jev-1',
      answers: {
        a: { type: 'noul', noul: 0.9 },
        b: { type: 'choice', choice: 'x', confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } },
        c: { type: 'score', score: 3.2, confidence: 0.7, legend: {}, probabilities: { '1': 0.1 } },
      },
      usage: { input_tokens: 12, output_tokens: 0 },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await decide(model, 'hello', q);
    expect(r.answers['a']).toEqual({ type: 'noul', probability: 0.9 });
    expect(r.answers['b']).toMatchObject({ type: 'choice', choice: 'x', confidence: 0.8 });
    expect(r.answers['c']).toMatchObject({ type: 'score', score: 3.2 });
    expect(r.inputTokens).toBe(12);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer k-secret');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'jev-latest', state: 'hello' });
  });

  it('decideSafe: 401 returns ok:false without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { detail: { error_type: 'authentication_error', message: 'Cannot authenticate' } })));
    const r = await decideSafe(model, 's', q);
    expect(r).toMatchObject({ ok: false, timedOut: false });
    expect((r as { error: string }).error).toBe('HTTP 401: Cannot authenticate');
    expect(JSON.stringify(r)).not.toContain('k-secret');
  });

  it('decideSafe: 422 list, network error, malformed JSON, unknown provider never throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { detail: [{ loc: ['body'], msg: 'bad', type: 'x' }] })));
    expect(await decideSafe(model, 's', q)).toMatchObject({ ok: false, error: 'HTTP 422: bad' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await decideSafe(model, 's', q)).toMatchObject({ ok: false, error: 'fetch failed' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(await decideSafe(model, 's', q)).toMatchObject({ ok: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { answers: { a: { type: 'weird' } } })));
    expect(await decideSafe(model, 's', q)).toMatchObject({ ok: false });
    expect(await decideSafe({ ...model, provider: 'openai' } as ModelConfig, 's', q)).toMatchObject({ ok: false });
  });

  it('decideSafe: timeout is reported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError')));
    expect(await decideSafe(model, 's', q, { timeoutMs: 5 })).toMatchObject({ ok: false, timedOut: true });
  });
});
