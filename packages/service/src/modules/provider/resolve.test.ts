import { describe, it, expect } from 'vitest';
import { resolveEffectiveModel } from './resolve.js';
import type { ModelInstance, ProviderConnection } from '@routerly/shared';

describe('resolveEffectiveModel', () => {
  it('produces a ModelConfig-shaped effective model', () => {
    const conn: ProviderConnection = {
      id: 'c1',
      providerId: 'anthropic',
      label: 'A',
      credentials: { apiKey: 'sk-x' },
      endpoint: 'https://api.anthropic.com',
      enabled: true,
    };
    const inst: ModelInstance = {
      id: 'anthropic/claude',
      connectionId: 'c1',
      upstreamModelId: 'claude-3-5-sonnet',
      cost: { inputPerMillion: 3, outputPerMillion: 15 },
      contextWindow: 200000,
    };
    const eff = resolveEffectiveModel(inst, conn);
    expect(eff.provider).toBe('anthropic');
    expect(eff.apiKey).toBe('sk-x');
    expect(eff.endpoint).toBe('https://api.anthropic.com');
    expect(eff.upstreamModelId).toBe('claude-3-5-sonnet');
    expect(eff.id).toBe('anthropic/claude');
  });

  it('carries the instance timeout to the effective model', () => {
    const conn = { id: 'c1', providerId: 'custom', label: 'A', credentials: {}, endpoint: 'http://x', enabled: true } as ProviderConnection;
    const inst = { id: 'm', connectionId: 'c1', upstreamModelId: 'm', cost: { inputPerMillion: 0, outputPerMillion: 0 }, contextWindow: 0, timeout: 5000 } as ModelInstance;
    expect(resolveEffectiveModel(inst, conn).timeout).toBe(5000);
  });

  it('maps aws credentials for bedrock connections', () => {
    const conn: ProviderConnection = {
      id: 'c2',
      providerId: 'bedrock',
      label: 'B',
      credentials: { awsAccessKeyId: 'k', awsSecretAccessKey: 's', awsRegion: 'us-east-1' },
      enabled: true,
    };
    const inst: ModelInstance = {
      id: 'bedrock/claude',
      connectionId: 'c2',
      upstreamModelId: 'anthropic.claude',
      cost: { inputPerMillion: 3, outputPerMillion: 15 },
      contextWindow: 200000,
    };
    const eff = resolveEffectiveModel(inst, conn);
    expect(eff.awsRegion).toBe('us-east-1');
  });
});
