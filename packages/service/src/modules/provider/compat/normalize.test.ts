import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';
import { normalizeRequest, normalizeForModel, sanitizeSchema } from './normalize.js';
import { getProviderDescriptor } from '../descriptor.js';
import { getProviderAdapter } from '../registry.js';

afterEach(() => { vi.unstubAllGlobals(); });

const schema = { type: 'object', properties: { path: { type: 'string', pattern: '^[^\\0]*$' }, pattern: { type: 'string' }, list: { type: 'array', items: { type: 'string', pattern: 'x' } } } };
const tools = [{ type: 'function', function: { name: 'Artifact', parameters: schema } }];
const history = [
  { role: 'user', content: 'go' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: 'r' },
];
const req = (extra: Record<string, unknown> = {}) => ({ model: 'm', messages: history, tools, ...extra }) as unknown as ChatCompletionRequest;
const model = (provider: string): ModelConfig => ({ id: `${provider}/m`, name: 'm', provider, endpoint: 'http://x/v1', apiKey: 'k' }) as ModelConfig;

describe('sanitizeSchema', () => {
  it('drops the keyword recursively and keeps a property named like it', () => {
    expect(sanitizeSchema(schema, ['pattern'])).toEqual({ type: 'object', properties: { path: { type: 'string' }, pattern: { type: 'string' }, list: { type: 'array', items: { type: 'string' } } } });
  });
});

describe('normalizeRequest — every registered provider follows its profile', () => {
  const ids = ['openai', 'openai-oauth', 'anthropic', 'anthropic-oauth', 'gemini', 'ollama', 'deepseek', 'groq', 'together', 'perplexity', 'xai', 'mistral', 'cohere', 'fireworks', 'cerebras', 'azure-openai', 'bedrock', 'vertex', 'custom'];
  for (const id of ids) {
    it(`${id}: tool schema keywords`, () => {
      const drop = getProviderDescriptor(id)?.compat?.schemaDropKeywords ?? [];
      const sent = JSON.stringify(normalizeForModel(req(), model(id)).tools);
      for (const k of ['pattern']) {
        expect(sent.includes(`"${k}":"`)).toBe(!drop.includes(k));
      }
      expect(sent).toContain('"pattern":{"type":"string"}'); // argument named pattern is never dropped
    });
    it(`${id}: reasoning passback`, () => {
      const pb = getProviderDescriptor(id)?.compat?.reasoningPassback;
      const out = normalizeForModel(req(), model(id)) as unknown as Record<string, unknown>;
      expect(out.thinking).toEqual(pb ? { type: 'disabled' } : undefined);
    });
  }
  it('does not mutate and returns the same object when nothing applies', () => {
    const r = req();
    expect(normalizeRequest(r, undefined)).toBe(r);
    const before = JSON.stringify(r);
    normalizeForModel(r, model('openai-oauth'));
    expect(JSON.stringify(r)).toBe(before);
  });
  it('reasoning passback leaves the request alone with reasoning_content, no tools, or a client choice', () => {
    const m = model('deepseek');
    const withR = [history[0], { ...history[1], reasoning_content: 'r' }, history[2]];
    expect((normalizeForModel(req({ messages: withR }), m) as any).thinking).toBeUndefined();
    expect((normalizeForModel(req({ tools: undefined }), m) as any).thinking).toBeUndefined();
    expect((normalizeForModel(req({ thinking: { type: 'enabled' } }), m) as any).thinking).toEqual({ type: 'enabled' });
  });
  it('dropParams removes top-level params', () => {
    const out = normalizeRequest({ model: 'm', messages: [], temperature: 1, top_p: 1 } as any, { dropParams: ['temperature'] });
    expect(out).toEqual({ model: 'm', messages: [], top_p: 1 });
  });
});

describe('getProviderAdapter applies the profile on the real adapter (fetch level)', () => {
  it('deepseek: chat and stream bodies carry thinking disabled', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [], usage: {} }), body: (async function* () { yield new TextEncoder().encode('data: [DONE]\n'); })() });
    vi.stubGlobal('fetch', f);
    const a = getProviderAdapter(model('deepseek'));
    await a.chatCompletion(req(), model('deepseek'));
    for await (const _ of a.streamCompletion(req(), model('deepseek'))) { /* drain */ }
    for (const c of f.mock.calls) expect(JSON.parse(c[1].body as string).thinking).toEqual({ type: 'disabled' });
  });
});
