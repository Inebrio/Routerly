import { describe, it, expect } from 'vitest';
import { runConformance } from './runner.js';
import { CORPUS, type Invoker } from './corpus.js';

const reply = (content: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }] }) as never;

function invoker(over: Partial<Invoker> = {}): Invoker {
  return {
    chat: async req => {
      if (req.tools && req.messages.length === 1) {
        return reply('', { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"code":"ABC"}' } }] });
      }
      if ((req as { response_format?: unknown }).response_format) return reply('{"a":1}');
      return reply('ok');
    },
    stream: async function* () {
      yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] } as never;
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] } as never;
    },
    ...over,
  };
}

describe('runConformance', () => {
  it('marks a fully working model conformant and proves capabilities', async () => {
    const r = await runConformance(invoker(), { functionCalling: true, json: true });
    expect(r.status).toBe('conformant');
    expect(r.verified).toMatchObject({ functionCalling: true, json: true, streaming: true });
    expect(r.cases.find(c => c.id === 'vision')?.status).toBe('skip');
    expect(r.cases.find(c => c.id === 'thinking')?.status).toBe('skip');
  });

  it('marks the model limited and the capability false when a case fails', async () => {
    const r = await runConformance(invoker({
      chat: async req => { if (req.tools) throw new Error('400 invalid tool schema'); return reply('ok'); },
    }), { functionCalling: true });
    expect(r.status).toBe('limited');
    expect(r.verified.functionCalling).toBe(false);
    const f = r.cases.find(c => c.id === 'tool-call');
    expect(f).toMatchObject({ status: 'fail', detail: '400 invalid tool schema' });
  });

  it('fails the stripped-client continuation case when the provider rejects it', async () => {
    const r = await runConformance(invoker({
      chat: async req => {
        if (req.messages.some(m => m.role === 'tool')) throw new Error('reasoning_content must be passed back');
        return invoker().chat(req);
      },
    }), { functionCalling: true });
    expect(r.cases.find(c => c.id === 'tool-result-continuation-client-stripped')?.status).toBe('fail');
    expect(r.status).toBe('limited');
  });

  it('times out a hung case', async () => {
    const r = await runConformance(invoker({ chat: () => new Promise(() => {}) }), undefined, { corpus: [CORPUS[0]!], timeoutMs: 20 });
    expect(r.cases[0]).toMatchObject({ status: 'fail', detail: 'timeout after 20ms' });
  });

  it('fails streaming without finish_reason', async () => {
    const r = await runConformance(invoker({
      stream: async function* () { yield { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] } as never; },
    }), undefined, { corpus: CORPUS.filter(c => c.id === 'streaming') });
    expect(r.verified.streaming).toBe(false);
  });
});
