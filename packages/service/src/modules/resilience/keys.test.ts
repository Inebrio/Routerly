import { describe, it, expect } from 'vitest';
import { resilienceKeys } from './keys.js';
import type { ModelConfig } from '@routerly/shared';

describe('resilienceKeys', () => {
  it('derives provider, connection, and model keys from ModelConfig', () => {
    const model: ModelConfig = {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: {
        inputPerMillion: 0.01,
        outputPerMillion: 0.03,
      },
    };

    const keys = resilienceKeys(model);

    expect(keys).toEqual({
      provider: { level: 'provider', id: 'openai' },
      connection: { level: 'connection', id: 'openai' },
      model: { level: 'model', id: 'gpt-4-turbo' },
    });
  });

  it('produces stable keys across multiple calls with same model', () => {
    const model: ModelConfig = {
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1',
      cost: {
        inputPerMillion: 0.003,
        outputPerMillion: 0.015,
      },
    };

    const keys1 = resilienceKeys(model);
    const keys2 = resilienceKeys(model);

    expect(keys1).toEqual(keys2);
  });

  it('differentiates keys for different providers', () => {
    const openaiModel: ModelConfig = {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: {
        inputPerMillion: 0.03,
        outputPerMillion: 0.06,
      },
    };

    const anthropicModel: ModelConfig = {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1',
      cost: {
        inputPerMillion: 0.015,
        outputPerMillion: 0.075,
      },
    };

    const openaiKeys = resilienceKeys(openaiModel);
    const anthropicKeys = resilienceKeys(anthropicModel);

    expect(openaiKeys.provider.id).toBe('openai');
    expect(anthropicKeys.provider.id).toBe('anthropic');
    expect(openaiKeys.provider).not.toEqual(anthropicKeys.provider);
  });

  it('differentiates keys for different models from same provider', () => {
    const model1: ModelConfig = {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: {
        inputPerMillion: 0.01,
        outputPerMillion: 0.03,
      },
    };

    const model2: ModelConfig = {
      id: 'gpt-3-5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: {
        inputPerMillion: 0.0005,
        outputPerMillion: 0.0015,
      },
    };

    const keys1 = resilienceKeys(model1);
    const keys2 = resilienceKeys(model2);

    expect(keys1.provider).toEqual(keys2.provider);
    expect(keys1.model).not.toEqual(keys2.model);
    expect(keys1.model.id).toBe('gpt-4-turbo');
    expect(keys2.model.id).toBe('gpt-3-5-turbo');
  });
});
