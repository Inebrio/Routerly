import type { ModelConfig } from '@routerly/shared';
import type { ProviderAdapter } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { AnthropicOAuthAdapter } from './anthropic-oauth.js';
import { OpenAIOAuthAdapter } from './openai-oauth.js';
import { OpenAIWebAdapter } from './openai-web.js';
import { AnthropicWebAdapter } from './anthropic-web.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { CustomAdapter } from './custom.js';
import { AzureOpenAIAdapter } from './azure-openai.js';
import { BedrockAdapter } from './bedrock.js';
import { VertexAdapter } from './vertex.js';

export type { ProviderAdapter };

const adapters: Record<string, ProviderAdapter> = {
  openai: new OpenAIAdapter(),
  'openai-oauth': new OpenAIOAuthAdapter(),
  // ponytail: unofficial web adapters — session key from browser cookies, may violate ToS
  'openai-web': new OpenAIWebAdapter(),
  anthropic: new AnthropicAdapter(),
  'anthropic-oauth': new AnthropicOAuthAdapter(),
  'anthropic-web': new AnthropicWebAdapter(),
  gemini: new GeminiAdapter(),
  ollama: new OllamaAdapter(),
  custom: new CustomAdapter(),
  'azure-openai': new AzureOpenAIAdapter(),
  bedrock: new BedrockAdapter(),
  vertex: new VertexAdapter(),
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
