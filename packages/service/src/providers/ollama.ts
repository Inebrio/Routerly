import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';

/**
 * Ollama adapter — uses the OpenAI-compatible endpoint exposed by Ollama.
 * No API key required. Default endpoint: http://localhost:11434/v1
 */
export class OllamaAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const baseURL = model.endpoint || 'http://localhost:11434/v1';
    return new OpenAI({ apiKey: 'ollama', baseURL });
  }

  private getUpstreamModelId(model: ModelConfig): string {
    if (model.id.includes('/')) {
      return model.id.split('/').slice(1).join('/');
    }
    return model.id;
  }

  // Ollama's OpenAI-compat endpoint uses max_tokens (maps to num_predict).
  // It does NOT recognize max_completion_tokens, so we normalize here.
  // Also, Qwen3 and other thinking-capable models on Ollama generate reasoning
  // tokens by default; passing think:false disables it for routing calls.
  private normalizeRequest(req: ChatCompletionRequest, model: ModelConfig): Record<string, unknown> {
    const { stream: _stream, max_completion_tokens, max_tokens, ...rest } = req;
    const resolved = max_tokens ?? max_completion_tokens;
    const thinkingEnabled = model.capabilities?.thinking === true;
    return {
      ...rest,
      ...(resolved != null ? { max_tokens: resolved } : {}),
      // Disable built-in thinking unless explicitly enabled via model capability
      ...(!thinkingEnabled ? { think: false } : {}),
    };
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const normalized = this.normalizeRequest(request, model);
    const upstreamModel = this.getUpstreamModelId(model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...normalized, model: upstreamModel, stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const normalized = this.normalizeRequest(request, model);
    const upstreamModel = this.getUpstreamModelId(model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...normalized, model: upstreamModel, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }
}
