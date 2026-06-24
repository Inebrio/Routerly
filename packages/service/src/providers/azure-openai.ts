import OpenAI from 'openai';
import type { ModelConfig } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';

/**
 * Azure OpenAI adapter — identical to OpenAI but with a different base URL and auth.
 * Inherits all normalisation (max_tokens, reasoning, etc.) from OpenAIAdapter.
 */
export class AzureOpenAIAdapter extends OpenAIAdapter {
  protected override getClient(model: ModelConfig): OpenAI {
    const resource = model.azureResourceName ?? '';
    const deployment = model.azureDeploymentId ?? '';
    const apiVersion = model.azureApiVersion ?? '2024-02-01';
    return new OpenAI({
      apiKey: model.apiKey ?? '',
      baseURL: `https://${resource}.openai.azure.com/openai/deployments/${deployment}`,
      defaultQuery: { 'api-version': apiVersion },
      defaultHeaders: { 'api-key': model.apiKey ?? '' },
      timeout: model.timeout ?? 60000,
    });
  }
}
