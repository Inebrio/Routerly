import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperimentConfig } from '@routerly/shared';

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../provider/list-effective.js', () => ({ listEffectiveModels: vi.fn() }));
vi.mock('../reverse-proxy/execute.js', () => ({ llmChat: vi.fn() }));

import { judgeExperimentCall, answerOf } from './judge.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { listEffectiveModels } from '../provider/list-effective.js';
import { llmChat } from '../reverse-proxy/execute.js';
import type { ProxyContext } from '../reverse-proxy/context.js';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockListModels = vi.mocked(listEffectiveModels);
const mockLlmChat = vi.mocked(llmChat);

/** `undefined` is allowed per field so a test can drop one from the fixture. */
function experiment(over: { [K in keyof ExperimentConfig]?: ExperimentConfig[K] | undefined } = {}): ExperimentConfig {
  return {
    id: 'exp-1',
    name: 'Prompt A vs B',
    rotation: 'round-robin',
    variants: [{ id: 'v-a', projectId: 'proj-a' }, { id: 'v-b', projectId: 'proj-b' }],
    tokens: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    judge: { enabled: true, modelId: 'judge-model', criteria: ['Is it correct?'], sampleRate: 1 },
    ...over,
  } as ExperimentConfig;
}

function ctx(over: Record<string, unknown> = {}): ProxyContext {
  return {
    protocol: 'openai',
    req: { experiment: { id: 'exp-1', variantId: 'v-a' } },
    project: { id: 'proj-a', name: 'A', tokens: [], members: [], models: [] },
    projectId: 'proj-a',
    request: { model: 'm1', messages: [{ role: 'user', content: 'What is 2+2?' }] },
    result: { kind: 'json', body: { choices: [{ message: { content: '4' } }] } },
    ...over,
  } as unknown as ProxyContext;
}

function reply(content: string) {
  return { choices: [{ message: { content } }] } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadConfig.mockImplementation((() => Promise.resolve([experiment()])) as never);
  mockListModels.mockResolvedValue([{ id: 'judge-model', name: 'judge', provider: 'openai', endpoint: 'https://x' }] as never);
  mockLlmChat.mockResolvedValue(reply('{"score": 8, "reason": "correct"}'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

describe('answerOf', () => {
  it('reads an OpenAI answer', () => {
    expect(answerOf({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('joins the text blocks of an Anthropic answer', () => {
    expect(answerOf({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
  });

  it('returns empty on anything else', () => {
    expect(answerOf(null)).toBe('');
    expect(answerOf('a string')).toBe('');
    expect(answerOf({})).toBe('');
  });
});

describe('judgeExperimentCall', () => {
  it('scores a sampled answer and folds it into the tally', async () => {
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).toHaveBeenCalledTimes(1);
    const [request, , callCtx] = mockLlmChat.mock.calls[0]!;
    expect(callCtx.callType).toBe('judge');
    expect(callCtx.experiment).toEqual({ id: 'exp-1', variantId: 'v-a' });
    expect(JSON.stringify(request.messages)).toContain('What is 2+2?');
    expect(JSON.stringify(request.messages)).toContain('Is it correct?');

    const [key, value] = mockWriteConfig.mock.calls[0] as [string, ExperimentConfig[]];
    expect(key).toBe('experiments');
    expect(value[0]!.judgeScores!['v-a']).toMatchObject({ count: 1, totalScore: 8 });
  });

  it('adds to a tally that already exists', async () => {
    mockReadConfig.mockImplementation((() =>
      Promise.resolve([experiment({ judgeScores: { 'v-a': { count: 2, totalScore: 12, lastAt: '2026-08-01T09:00:00.000Z' } } })])) as never);
    await judgeExperimentCall(ctx());
    const [, value] = mockWriteConfig.mock.calls[0] as [string, ExperimentConfig[]];
    expect(value[0]!.judgeScores!['v-a']).toMatchObject({ count: 3, totalScore: 20 });
  });

  it('keeps the other variants tallies untouched', async () => {
    mockReadConfig.mockImplementation((() =>
      Promise.resolve([experiment({ judgeScores: { 'v-b': { count: 5, totalScore: 40, lastAt: '2026-08-01T09:00:00.000Z' } } })])) as never);
    await judgeExperimentCall(ctx());
    const [, value] = mockWriteConfig.mock.calls[0] as [string, ExperimentConfig[]];
    expect(value[0]!.judgeScores!['v-b']).toMatchObject({ count: 5, totalScore: 40 });
    expect(value[0]!.judgeScores!['v-a']).toMatchObject({ count: 1 });
  });

  it('does nothing when no experiment routed the call', async () => {
    await judgeExperimentCall(ctx({ req: {} }));
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips a streamed answer', async () => {
    await judgeExperimentCall(ctx({ result: { kind: 'stream', body: {} } }));
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips a blocked request', async () => {
    await judgeExperimentCall(ctx({ result: { kind: 'block', status: 403 } }));
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips when the judge is off or absent', async () => {
    mockReadConfig.mockImplementation((() => Promise.resolve([experiment({ judge: undefined })])) as never);
    await judgeExperimentCall(ctx());
    mockReadConfig.mockImplementation((() =>
      Promise.resolve([experiment({ judge: { enabled: false, modelId: 'judge-model', criteria: [], sampleRate: 1 } })])) as never);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips when the experiment vanished between routing and finalize', async () => {
    mockReadConfig.mockImplementation((() => Promise.resolve([])) as never);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('respects the sample rate', async () => {
    mockReadConfig.mockImplementation((() =>
      Promise.resolve([experiment({ judge: { enabled: true, modelId: 'judge-model', criteria: [], sampleRate: 0.1 } })])) as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).not.toHaveBeenCalled();

    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).toHaveBeenCalledTimes(1);
  });

  it('never calls the judge at sampleRate 0', async () => {
    mockReadConfig.mockImplementation((() =>
      Promise.resolve([experiment({ judge: { enabled: true, modelId: 'judge-model', criteria: [], sampleRate: 0 } })])) as never);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips an empty answer', async () => {
    await judgeExperimentCall(ctx({ result: { kind: 'json', body: { choices: [{ message: { content: '   ' } }] } } }));
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('skips when the judge model no longer exists', async () => {
    mockListModels.mockResolvedValue([] as never);
    await judgeExperimentCall(ctx());
    expect(mockLlmChat).not.toHaveBeenCalled();
  });

  it('records nothing when the verdict carries no usable score', async () => {
    mockLlmChat.mockResolvedValue(reply('the answer was fine'));
    await judgeExperimentCall(ctx());
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('clamps a score outside the 0-10 band', async () => {
    mockLlmChat.mockResolvedValue(reply('{"score": 42}'));
    await judgeExperimentCall(ctx());
    const [, value] = mockWriteConfig.mock.calls[0] as [string, ExperimentConfig[]];
    expect(value[0]!.judgeScores!['v-a']!.totalScore).toBe(10);
  });

  it('scores the Anthropic answer shape too', async () => {
    await judgeExperimentCall(ctx({ result: { kind: 'json', body: { content: [{ type: 'text', text: 'four' }] } } }));
    const [request] = mockLlmChat.mock.calls[0]!;
    expect(JSON.stringify(request.messages)).toContain('four');
  });

  it('reads the text parts of a multimodal question', async () => {
    await judgeExperimentCall(ctx({
      request: { model: 'm1', messages: [{ role: 'user', content: [{ type: 'text', text: 'describe this' }, { type: 'image_url' }] }] },
    }));
    const [request] = mockLlmChat.mock.calls[0]!;
    expect(JSON.stringify(request.messages)).toContain('describe this');
  });

  it('judges the latest user turn of a conversation', async () => {
    await judgeExperimentCall(ctx({
      request: {
        model: 'm1',
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'second' },
        ],
      },
    }));
    const [request] = mockLlmChat.mock.calls[0]!;
    const sent = JSON.stringify(request.messages);
    expect(sent).toContain('second');
    expect(sent).not.toContain('first');
  });

  it('still scores when the question cannot be read', async () => {
    await judgeExperimentCall(ctx({ request: { model: 'm1', messages: [] } }));
    expect(mockLlmChat).toHaveBeenCalledTimes(1);
  });

  it('lets a judge model failure surface to the caller that swallows it', async () => {
    mockLlmChat.mockRejectedValue(new Error('upstream down'));
    await expect(judgeExperimentCall(ctx())).rejects.toThrow('upstream down');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});
