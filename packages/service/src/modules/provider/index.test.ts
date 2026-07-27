import { describe, it, expect } from 'vitest';
import type { ModelConfig } from '@routerly/shared';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { providerModule } from './index.js';
import { PROVIDER_REGISTRY } from '../../core/tokens.js';
import { getProviderAdapter } from '../../providers/index.js';

// Minimal ModelConfig views: getProviderAdapter only reads `provider` and `id`.
// Casting keeps the test focused on registry behavior, not model shape.
const model = (provider: string): ModelConfig =>
  ({ provider, id: 'test-model' }) as ModelConfig;

describe('provider module', () => {
  it('has the frozen manifest', () => {
    expect(providerModule.manifest.id).toBe('provider');
    expect(providerModule.manifest.version).toBe('0.4.0');
    expect(providerModule.manifest.dependsOn).toEqual({ config: '^0.4.0' });
  });

  it('registers PROVIDER_REGISTRY exposing the real getProviderAdapter', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await providerModule.register({ container, events });

    expect(container.has(PROVIDER_REGISTRY)).toBe(true);
    const registry = container.resolve(PROVIDER_REGISTRY);
    // Wrapper strategy: the token hands back the real function, not a copy.
    expect(registry.getProviderAdapter).toBe(getProviderAdapter);

    // Known provider with an adapter -> returns a working ProviderAdapter.
    const adapter = registry.getProviderAdapter(model('openai'));
    expect(typeof adapter.chatCompletion).toBe('function');
    expect(typeof adapter.streamCompletion).toBe('function');

    // Provider in the union but with no adapter entry -> still throws today.
    expect(() => registry.getProviderAdapter(model('mistral'))).toThrow(
      /Unknown provider/,
    );
  });
});
