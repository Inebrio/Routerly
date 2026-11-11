import type { ModelConfig } from '@routerly/shared';
import { AlterableRegistry } from '../../core/hooks/registry.js';
import type { ProviderAdapter } from './types.js';
import { normalizeForModel } from './compat/normalize.js';
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

/**
 * Hook-based provider dispatch. Built-in providers are registered below as
 * contributions; a future provider (built-in or third-party) is added with
 * a `.contribute()` call, no edit to this file's dispatch logic required.
 */
export const providerRegistry = new AlterableRegistry<ProviderAdapter>();

providerRegistry.contribute({ id: 'openai', value: new OpenAIAdapter() });
providerRegistry.contribute({ id: 'openai-oauth', value: new OpenAIOAuthAdapter() });
// ponytail: unofficial web adapters, session key from browser cookies, may violate ToS
providerRegistry.contribute({ id: 'openai-web', value: new OpenAIWebAdapter() });
providerRegistry.contribute({ id: 'anthropic', value: new AnthropicAdapter() });
providerRegistry.contribute({ id: 'anthropic-oauth', value: new AnthropicOAuthAdapter() });
providerRegistry.contribute({ id: 'anthropic-web', value: new AnthropicWebAdapter() });
providerRegistry.contribute({ id: 'gemini', value: new GeminiAdapter() });
providerRegistry.contribute({ id: 'ollama', value: new OllamaAdapter() });
providerRegistry.contribute({ id: 'custom', value: new CustomAdapter() });
// OpenAI-compatible hosted providers: default endpoints live in resolve.ts
const compatAdapter = new CustomAdapter();
for (const id of ['deepseek', 'groq', 'together', 'perplexity', 'xai', 'mistral', 'cohere', 'fireworks', 'cerebras']) {
  providerRegistry.contribute({ id, value: compatAdapter });
}
providerRegistry.contribute({ id: 'azure-openai', value: new AzureOpenAIAdapter() });
providerRegistry.contribute({ id: 'bedrock', value: new BedrockAdapter() });
providerRegistry.contribute({ id: 'vertex', value: new VertexAdapter() });

const normalized = new WeakMap<ProviderAdapter, ProviderAdapter>();

/**
 * Wraps an adapter so every request goes through the provider's compat profile
 * (ROUT-713) before the adapter sees it: one seam for all lanes, the connection test
 * and the conformance runner.
 */
function withCompat(adapter: ProviderAdapter): ProviderAdapter {
  let wrapped = normalized.get(adapter);
  if (!wrapped) {
    wrapped = Object.create(adapter, {
      chatCompletion: { value: (r: Parameters<ProviderAdapter['chatCompletion']>[0], m: ModelConfig, o?: Parameters<ProviderAdapter['chatCompletion']>[2]) => adapter.chatCompletion(normalizeForModel(r, m), m, o) },
      streamCompletion: { value: (r: Parameters<ProviderAdapter['streamCompletion']>[0], m: ModelConfig, o?: Parameters<ProviderAdapter['streamCompletion']>[2]) => adapter.streamCompletion(normalizeForModel(r, m), m, o) },
    }) as ProviderAdapter;
    normalized.set(adapter, wrapped);
  }
  return wrapped;
}

/**
 * Returns the appropriate adapter for a given model config.
 * Throws if the provider is not recognized.
 */
export function getProviderAdapter(model: ModelConfig): ProviderAdapter {
  const adapter = providerRegistry.get(model.provider);
  if (!adapter) {
    throw new Error(`Unknown provider "${model.provider}" for model "${model.id}"`);
  }
  return withCompat(adapter);
}
