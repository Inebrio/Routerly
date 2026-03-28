import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

export class OpenAIAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? '';
    return new OpenAI({
      apiKey,
      baseURL: model.endpoint || 'https://api.openai.com/v1',
      timeout: model.timeout ?? 60000,
    });
  }

  // Helper to extract the actual upstream model string
  private getUpstreamModelId(model: ModelConfig): string {
    // If the ID contains a slash (e.g., 'openai/gpt-4o'), take the part after the slash
    if (model.id.includes('/')) {
      return model.id.split('/').slice(1).join('/');
    }
    // Otherwise fallback to ID or name
    return model.id;
  }

  // Normalize max_tokens → max_completion_tokens.
  // Newer OpenAI models (o1, o3, o4-mini, gpt-4.5, …) reject max_tokens with a 400.
  private normalizeTokenLimit(req: ChatCompletionRequest): Omit<ChatCompletionRequest, 'max_tokens'> {
    const { max_tokens, max_completion_tokens, ...rest } = req;
    const resolved = max_completion_tokens ?? max_tokens;
    return resolved != null ? { ...rest, max_completion_tokens: resolved } : rest;
  }

  // o-series models (o1, o3, o4-mini, …) support reasoning_effort; GPT-family models do not.
  private isReasoningModel(modelId: string): boolean {
    return /^o\d/.test(modelId);
  }

  // Strip reasoning-model-only params when forwarding to non-o-series models.
  private normalizeForModel(req: ChatCompletionRequest, upstreamModel: string): Record<string, unknown> {
    const { stream: _stream, ...normalized } = this.normalizeTokenLimit(req);
    if (!this.isReasoningModel(upstreamModel)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { reasoning_effort, reasoning_summary, ...safe } = normalized as Record<string, unknown>;
      return safe;
    }
    return normalized as Record<string, unknown>;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);

    // Override the requested model with the actual selected candidate model ID
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: false } as any);

    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const upstreamModel = this.getUpstreamModelId(model);
    const rest = this.normalizeForModel(request, upstreamModel);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, model: upstreamModel, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }
}
