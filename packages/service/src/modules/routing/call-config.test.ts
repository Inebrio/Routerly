import { describe, it, expect } from 'vitest';
import type { CallConfig, ChatCompletionRequest, ModelConfig, RoutingProfile } from '@routerly/shared';
import {
  callConfigSchema,
  callConfigTraceDetails,
  clientSentSettings,
  decideCallTier,
  pickCallConfig,
  resolveAttemptCallConfig,
  resolveForModel,
  type CallDecision,
} from './call-config.js';

const model = (provider: string, id: string, extra: Partial<ModelConfig> = {}): ModelConfig =>
  ({ id: `${provider}/${id}`, provider, ...extra }) as unknown as ModelConfig;

const req = (content: string, extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest =>
  ({ model: 'auto', messages: [{ role: 'user', content }], ...extra }) as ChatCompletionRequest;

const ALL: CallConfig = {
  enabled: true,
  tiers: {
    low: { effort: 'low', maxOutputTokens: 256, verbosity: 'low' },
    medium: { effort: 'medium', maxOutputTokens: 1024, verbosity: 'medium' },
    high: { effort: 'high', maxOutputTokens: 4096, verbosity: 'high' },
  },
};

describe('callConfigSchema', () => {
  it('accepts a full valid config', () => {
    expect(callConfigSchema.safeParse({ ...ALL, clientValues: { effort: 'override' }, thresholds: { mediumFromTokens: 100, highFromTokens: 200 } }).success).toBe(true);
  });
  it.each([
    ['unknown top-level key', { ...ALL, extra: 1 }],
    ['unknown setting', { enabled: true, tiers: { low: { temperature: 1 } } }],
    ['bad effort', { enabled: true, tiers: { low: { effort: 'max' } } }],
    ['maxOutputTokens too small', { enabled: true, tiers: { low: { maxOutputTokens: 1 } } }],
    ['maxOutputTokens fractional', { enabled: true, tiers: { low: { maxOutputTokens: 100.5 } } }],
    ['bad policy', { ...ALL, clientValues: { effort: 'merge' } }],
    ['medium >= high', { ...ALL, thresholds: { mediumFromTokens: 500, highFromTokens: 500 } }],
    ['medium above default high', { ...ALL, thresholds: { mediumFromTokens: 17000 } }],
    ['missing enabled', { tiers: {} }],
  ])('rejects %s', (_n, body) => {
    expect(callConfigSchema.safeParse(body).success).toBe(false);
  });
});

describe('pickCallConfig', () => {
  const p = (id: string, callConfig?: CallConfig) => ({ id, callConfig }) as unknown as RoutingProfile;
  it('returns undefined when absent or disabled', () => {
    expect(pickCallConfig(p('custom'))).toBeUndefined();
    expect(pickCallConfig(p('custom', { ...ALL, enabled: false }))).toBeUndefined();
  });
  it('source is router for the custom profile, profile otherwise', () => {
    expect(pickCallConfig(p('custom', ALL))?.source).toBe('router');
    expect(pickCallConfig(p('u1', ALL))?.source).toBe('profile');
  });
});

describe('decideCallTier', () => {
  const tokens = (n: number) => req('x'.repeat(n * 4));
  it('low below medium threshold', () => {
    const d = decideCallTier(req('hi'), ALL, 'router');
    expect(d.tier).toBe('low');
    expect(d.desired).toEqual(ALL.tiers.low);
    expect(d.signals).toMatchObject({ hasTools: false, messageCount: 1 });
    expect(d.thresholds).toEqual({ mediumFromTokens: 2000, highFromTokens: 16000 });
  });
  it('boundaries are inclusive on the lower edge', () => {
    expect(decideCallTier(tokens(1999), ALL, 'router').tier).toBe('low');
    expect(decideCallTier(tokens(2000), ALL, 'router').tier).toBe('medium');
    expect(decideCallTier(tokens(15999), ALL, 'router').tier).toBe('medium');
    expect(decideCallTier(tokens(16000), ALL, 'router').tier).toBe('high');
  });
  it('tools raise a short request to medium, never to high', () => {
    const d = decideCallTier(req('hi', { tools: [{ type: 'function', function: { name: 'f' } }] } as never), ALL, 'router');
    expect(d.tier).toBe('medium');
    expect(d.signals.hasTools).toBe(true);
  });
  it('custom thresholds apply', () => {
    const d = decideCallTier(tokens(60), { ...ALL, thresholds: { mediumFromTokens: 50, highFromTokens: 100 } }, 'profile');
    expect(d.tier).toBe('medium');
    expect(d.source).toBe('profile');
  });
  it('tier without settings yields empty desired', () => {
    expect(decideCallTier(req('hi'), { enabled: true, tiers: {} }, 'router').desired).toEqual({});
  });
});

describe('clientSentSettings', () => {
  it('chat', () => {
    expect(clientSentSettings({}, 'chat')).toEqual({ effort: false, verbosity: false, maxOutputTokens: false });
    expect(clientSentSettings({ reasoning_effort: 'low', verbosity: 'low', max_completion_tokens: 5 }, 'chat')).toEqual({ effort: true, verbosity: true, maxOutputTokens: true });
    expect(clientSentSettings({ max_tokens: 5 }, 'chat').maxOutputTokens).toBe(true);
  });
  it('responses', () => {
    expect(clientSentSettings({ reasoning: { effort: 'low' }, text: { verbosity: 'low' }, max_output_tokens: 9 }, 'responses')).toEqual({ effort: true, verbosity: true, maxOutputTokens: true });
    expect(clientSentSettings({ reasoning: {}, text: {} }, 'responses')).toEqual({ effort: false, verbosity: false, maxOutputTokens: false });
  });
  it('anthropic', () => {
    expect(clientSentSettings({ output_config: { effort: 'high' }, max_tokens: 9 }, 'anthropic')).toEqual({ effort: true, verbosity: false, maxOutputTokens: true });
  });
  it('null and non-object inputs are tolerated and not mutated', () => {
    expect(clientSentSettings(null, 'chat').effort).toBe(false);
    expect(clientSentSettings('x', 'anthropic').maxOutputTokens).toBe(false);
    const body = Object.freeze({ reasoning_effort: 'low' });
    expect(() => clientSentSettings(body, 'chat')).not.toThrow();
  });
});

describe('resolveForModel gating', () => {
  const high = decideCallTier(req('x'.repeat(16000 * 4)), ALL, 'router');
  const none = { effort: false, verbosity: false, maxOutputTokens: false };
  const run = (m: ModelConfig, sent = none, d: CallDecision = high) => resolveForModel(d, sent, m);

  it.each([
    'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-5', 'claude-opus-4-6-20260101',
  ])('anthropic %s gets effort and max', (id) => {
    expect(run(model('anthropic', id)).applied).toEqual({ effort: 'high', maxOutputTokens: 4096 });
  });
  it.each(['claude-3-5-sonnet-20241022', 'claude-opus-4-1', 'claude-haiku-4-5', 'claude-sonnet-4-5'])('anthropic %s: effort unsupported, max still applied', (id) => {
    const r = run(model('anthropic', id));
    expect(r.applied).toEqual({ maxOutputTokens: 4096 });
    expect(r.skipped).toEqual(expect.arrayContaining([{ setting: 'effort', reason: 'unsupported' }, { setting: 'verbosity', reason: 'unsupported' }]));
  });
  it('anthropic-oauth follows the anthropic table', () => {
    expect(run(model('anthropic-oauth', 'claude-opus-4-7')).applied).toEqual({ effort: 'high', maxOutputTokens: 4096 });
  });
  it.each(['gpt-5', 'gpt-5-mini', 'gpt-5.1'])('openai %s gets everything', (id) => {
    expect(run(model('openai', id)).applied).toEqual({ effort: 'high', maxOutputTokens: 4096, verbosity: 'high' });
  });
  it.each(['o3', 'o4-mini'])('openai %s gets effort and max, not verbosity', (id) => {
    const r = run(model('openai', id));
    expect(r.applied).toEqual({ effort: 'high', maxOutputTokens: 4096 });
    expect(r.skipped).toEqual([{ setting: 'verbosity', reason: 'unsupported' }]);
  });
  it.each(['gpt-4o', 'gpt-4.1', 'o1-mini', 'o1-preview', 'gpt-5-chat-latest'])('openai %s: no effort', (id) => {
    expect(run(model('openai', id)).applied.effort).toBeUndefined();
  });
  it('gpt-5-chat gets no verbosity', () => {
    expect(run(model('openai', 'gpt-5-chat-latest')).applied.verbosity).toBeUndefined();
  });
  it('azure-openai uses the OpenAI table via upstreamModelId', () => {
    expect(run(model('azure-openai', 'my-deployment', { upstreamModelId: 'gpt-5' })).applied.effort).toBe('high');
    expect(run(model('azure-openai', 'gpt-4o')).applied.effort).toBeUndefined();
  });
  it('upstreamModelId with provider prefix is stripped', () => {
    expect(run(model('openai', 'alias', { id: 'openai/alias', upstreamModelId: 'openai/gpt-5' } as never)).applied.effort).toBe('high');
  });
  it('openai-oauth gets effort and verbosity but never maxOutputTokens', () => {
    const r = run(model('openai-oauth', 'gpt-5'));
    expect(r.applied).toEqual({ effort: 'high', verbosity: 'high' });
    expect(r.skipped).toEqual([{ setting: 'maxOutputTokens', reason: 'unsupported' }]);
  });
  it.each(['gemini', 'vertex', 'bedrock', 'ollama', 'custom', 'mistral', 'groq'])('%s: only maxOutputTokens', (p) => {
    expect(run(model(p, 'some-model')).applied).toEqual({ maxOutputTokens: 4096 });
  });
  it.each(['chatgpt-web', 'claude-web', 'some-future-provider'])('unknown or web provider %s: nothing sent', (p) => {
    const r = run(model(p, 'gpt-5'));
    expect(r.applied).toEqual({});
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped!.every((s) => s.reason === 'unsupported')).toBe(true);
  });
  it('invalid configured value is skipped, not sent', () => {
    const d = { ...high, desired: { effort: 'extreme', maxOutputTokens: 5 } } as unknown as CallDecision;
    expect(run(model('openai', 'gpt-5'), none, d)).toEqual({
      applied: {},
      skipped: [{ setting: 'effort', reason: 'invalid' }, { setting: 'maxOutputTokens', reason: 'invalid' }],
    });
  });
  it('no skipped key when nothing skipped', () => {
    expect('skipped' in run(model('openai', 'gpt-5'))).toBe(false);
  });
  it('settings absent from the tier are not reported', () => {
    const d = decideCallTier(req('hi'), { enabled: true, tiers: { low: { maxOutputTokens: 100 } } }, 'router');
    expect(resolveForModel(d, none, model('openai', 'gpt-5'))).toEqual({ applied: { maxOutputTokens: 100 } });
  });

  describe('client-value policy', () => {
    const sent = { effort: true, verbosity: false, maxOutputTokens: true };
    it('keep is the default: client value wins, skip is client_kept', () => {
      const r = run(model('openai', 'gpt-5'), sent);
      expect(r.applied).toEqual({ verbosity: 'high' });
      expect(r.skipped).toEqual([{ setting: 'effort', reason: 'client_kept' }, { setting: 'maxOutputTokens', reason: 'client_kept' }]);
    });
    it('override replaces the client value per setting', () => {
      const d = decideCallTier(req('x'.repeat(16000 * 4)), { ...ALL, clientValues: { effort: 'override' } }, 'router');
      const r = run(model('openai', 'gpt-5'), sent, d);
      expect(r.applied).toEqual({ effort: 'high', verbosity: 'high' });
      expect(r.skipped).toEqual([{ setting: 'maxOutputTokens', reason: 'client_kept' }]);
    });
    it('unsupported wins over client_kept', () => {
      expect(run(model('openai', 'gpt-4o'), sent).skipped).toEqual(expect.arrayContaining([{ setting: 'effort', reason: 'unsupported' }]));
    });
  });
});

describe('resolveAttemptCallConfig', () => {
  const decision = decideCallTier(req('hi'), ALL, 'router');
  const ctx = (m: ModelConfig | undefined, extra: Record<string, unknown> = {}) => ({
    callDecision: decision,
    original: {},
    protocol: 'openai' as const,
    ...(m ? { attempt: { model: m } } : {}),
    ...extra,
  });

  it('undefined without a decision or an attempt', () => {
    expect(resolveAttemptCallConfig({ original: {}, protocol: 'openai', attempt: { model: model('openai', 'gpt-5') } })).toBeUndefined();
    expect(resolveAttemptCallConfig(ctx(undefined))).toBeUndefined();
  });
  it('re-evaluated per candidate: a fallback to another model changes what is applied', () => {
    const c = ctx(model('openai', 'gpt-5'));
    const first = resolveAttemptCallConfig(c)!;
    expect(first.applied).toEqual({ effort: 'low', maxOutputTokens: 256, verbosity: 'low' });
    c.attempt = { model: model('anthropic', 'claude-3-5-sonnet-20241022') };
    const second = resolveAttemptCallConfig(c)!;
    expect(second.applied).toEqual({ maxOutputTokens: 256 });
    expect(second.skipped).toHaveLength(2);
    expect(second).toMatchObject({ tier: 'low', source: 'router' });
    c.attempt = { model: model('chatgpt-web', 'x') };
    expect(resolveAttemptCallConfig(c)!.applied).toEqual({});
  });
  it('shape: anthropic protocol reads output_config and max_tokens', () => {
    const r = resolveAttemptCallConfig(ctx(model('anthropic', 'claude-opus-4-7'), { protocol: 'anthropic', original: { output_config: { effort: 'high' } } }))!;
    expect(r.applied).toEqual({ maxOutputTokens: 256 });
    expect(r.skipped).toEqual(expect.arrayContaining([{ setting: 'effort', reason: 'client_kept' }]));
  });
  it('shape: responses API reads reasoning.effort and max_output_tokens', () => {
    const r = resolveAttemptCallConfig(ctx(model('openai-oauth', 'gpt-5'), { responsesApi: true, original: { reasoning: { effort: 'high' }, text: { verbosity: 'high' } } }))!;
    expect(r.applied).toEqual({});
    expect(r.skipped).toEqual(expect.arrayContaining([{ setting: 'effort', reason: 'client_kept' }, { setting: 'verbosity', reason: 'client_kept' }]));
  });
  it('does not mutate the original body', () => {
    const original = Object.freeze({ model: 'x', messages: [] });
    expect(() => resolveAttemptCallConfig(ctx(model('openai', 'gpt-5'), { original }))).not.toThrow();
  });
});

describe('callConfigTraceDetails', () => {
  it('lists the decision and a per-model preview in ranked order, skipping unknown models', () => {
    const d = decideCallTier(req('hi'), ALL, 'profile');
    const out = callConfigTraceDetails(
      d,
      [
        { id: 'openai/gpt-5', model: model('openai', 'gpt-5') },
        { id: 'ghost/none', model: undefined },
        { id: 'chatgpt-web/x', model: model('chatgpt-web', 'x') },
      ],
      req('hi', { reasoning_effort: 'low' } as never),
    );
    expect(out).toMatchObject({ tier: 'low', source: 'profile', desired: ALL.tiers.low, thresholds: { mediumFromTokens: 2000, highFromTokens: 16000 } });
    const perModel = out.perModel as { model: string; applied: unknown; skipped?: unknown }[];
    expect(perModel.map((p) => p.model)).toEqual(['openai/gpt-5', 'chatgpt-web/x']);
    expect(perModel[0]!.applied).toEqual({ maxOutputTokens: 256, verbosity: 'low' });
    expect(perModel[1]!.applied).toEqual({});
  });
});
