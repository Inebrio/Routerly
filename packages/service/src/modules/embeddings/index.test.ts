import { describe, it, expect } from 'vitest';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { embeddingsModule } from './index.js';
import { EMBEDDINGS } from '../../core/tokens.js';
import { getEmbeddingProvider } from './dispatch.js';
import { PRODUCT_VERSION } from '../../core/version.js';

describe('embeddings module', () => {
  it('has the frozen manifest', () => {
    expect(embeddingsModule.manifest.id).toBe('embeddings');
    expect(embeddingsModule.manifest.version).toBe(PRODUCT_VERSION);
    expect(embeddingsModule.manifest.dependsOn).toBeUndefined();
  });

  it('registers EMBEDDINGS exposing the real getEmbeddingProvider', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await embeddingsModule.register({ container, events });

    expect(container.has(EMBEDDINGS)).toBe(true);
    const registry = container.resolve(EMBEDDINGS);
    expect(registry.getEmbeddingProvider).toBe(getEmbeddingProvider);

    const provider = registry.getEmbeddingProvider('openai', 'https://api.openai.com/v1', 'sk-test');
    expect(typeof provider.embed).toBe('function');

    expect(() => registry.getEmbeddingProvider('unknown' as any)).toThrow(
      /Unknown embedding provider type/,
    );
  });
});
