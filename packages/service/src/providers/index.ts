import type { ModelConfig } from '@routerly/shared';
import type { ProviderAdapter } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { CustomAdapter } from './custom.js';

export type { ProviderAdapter };

const adapters: Record<string, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  ollama: new OllamaAdapter(),
  custom: new CustomAdapter(),
};

/**
 * Returns the appropriate adapter for a given model config.
 * Throws if the provider is not recognized.
 */
export function getProviderAdapter(model: ModelConfig): ProviderAdapter {
  const adapter = adapters[model.provider];
  if (!adapter) {
    throw new Error(`Unknown provider "${model.provider}" for model "${model.id}"`);
  }
  return adapter;
}
