import { describe, it, expect } from 'vitest';
import type { ModelConfig } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';

const cases = [
  ['openai', new OpenAIAdapter()],
  ['anthropic', new AnthropicAdapter()],
  ['gemini', new GeminiAdapter()],
] as const;

describe.each(cases)('%s getUpstreamModelId', (provider, adapter) => {
  const up = (m: Partial<ModelConfig>) =>
    (adapter as unknown as { getUpstreamModelId(m: ModelConfig): string }).getUpstreamModelId(
      { id: `${provider}/x`, provider, ...m } as ModelConfig,
    );
  it('prefers upstreamModelId', () => expect(up({ id: 'demo/alias', upstreamModelId: 'real-model' })).toBe('real-model'));
  it('falls back to id suffix', () => expect(up({ id: 'demo/alias' })).toBe('alias'));
});
