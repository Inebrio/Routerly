import type { ProviderId } from '@routerly/shared';
import type { ModelCapabilities } from '@routerly/shared';
import { AlterableRegistry } from '../../core/hooks/registry.js';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  supportLevel: 'native' | 'compatible' | 'oauth' | 'web';
  nativeCapabilities: ModelCapabilities;
}

const providerDescriptorRegistry = new AlterableRegistry<ProviderDescriptor>();

// OpenAI protocol (13 providers)
providerDescriptorRegistry.contribute({
  id: 'openai',
  value: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'azure-openai',
  value: {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'deepseek',
  value: {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'groq',
  value: {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'together',
  value: {
    id: 'together',
    label: 'Together AI',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'perplexity',
  value: {
    id: 'perplexity',
    label: 'Perplexity',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'xai',
  value: {
    id: 'xai',
    label: 'xAI',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'mistral',
  value: {
    id: 'mistral',
    label: 'Mistral',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'cohere',
  value: {
    id: 'cohere',
    label: 'Cohere',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {
      functionCalling: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'ollama',
  value: {
    id: 'ollama',
    label: 'Ollama',
    protocol: 'openai',
    supportLevel: 'native',
    nativeCapabilities: {},
  },
});

providerDescriptorRegistry.contribute({
  id: 'custom',
  value: {
    id: 'custom',
    label: 'Custom',
    protocol: 'openai',
    supportLevel: 'compatible',
    nativeCapabilities: {},
  },
});

providerDescriptorRegistry.contribute({
  id: 'openai-oauth',
  value: {
    id: 'openai-oauth',
    label: 'OpenAI (OAuth)',
    protocol: 'openai',
    supportLevel: 'oauth',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'openai-web',
  value: {
    id: 'openai-web',
    label: 'OpenAI (Web)',
    protocol: 'openai',
    supportLevel: 'web',
    nativeCapabilities: {
      vision: true,
    },
  },
});

// Anthropic protocol (4 providers)
providerDescriptorRegistry.contribute({
  id: 'anthropic',
  value: {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    supportLevel: 'native',
    nativeCapabilities: {
      thinking: true,
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'anthropic-oauth',
  value: {
    id: 'anthropic-oauth',
    label: 'Anthropic (OAuth)',
    protocol: 'anthropic',
    supportLevel: 'oauth',
    nativeCapabilities: {
      thinking: true,
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'anthropic-web',
  value: {
    id: 'anthropic-web',
    label: 'Anthropic (Web)',
    protocol: 'anthropic',
    supportLevel: 'web',
    nativeCapabilities: {
      vision: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'bedrock',
  value: {
    id: 'bedrock',
    label: 'AWS Bedrock',
    protocol: 'anthropic',
    supportLevel: 'native',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

// Gemini protocol (2 providers)
providerDescriptorRegistry.contribute({
  id: 'gemini',
  value: {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    supportLevel: 'native',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

providerDescriptorRegistry.contribute({
  id: 'vertex',
  value: {
    id: 'vertex',
    label: 'Google Vertex AI',
    protocol: 'gemini',
    supportLevel: 'native',
    nativeCapabilities: {
      vision: true,
      functionCalling: true,
      json: true,
    },
  },
});

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor | undefined {
  return providerDescriptorRegistry.get(id);
}

export function isKnownProvider(id: ProviderId): boolean {
  return providerDescriptorRegistry.get(id) !== undefined;
}

export { providerDescriptorRegistry };
