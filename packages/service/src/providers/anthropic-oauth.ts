import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig } from '@routerly/shared';
import { AnthropicAdapter } from './anthropic.js';

const OAUTH_BETA = 'oauth-2025-04-20';

export class AnthropicOAuthAdapter extends AnthropicAdapter {
  protected override getClient(model: ModelConfig): Anthropic {
    return new Anthropic({
      authToken: model.apiKey ?? '',
      baseURL: model.endpoint || 'https://api.anthropic.com',
      timeout: model.timeout ?? 60000,
      defaultHeaders: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': OAUTH_BETA,
      },
    });
  }
}
