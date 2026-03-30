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
    const response = await client.chat.completions.create({ ...normalized, model: upstreamModel, stream: false } as any) as any;
    // Some Qwen3 variants on Ollama (thinking models) put all content in `message.thinking`
    // even when think:false is requested, leaving `message.content` empty.
    // Fall back to thinking content so callers always receive a non-empty response.
    const thinkingEnabled = model.capabilities?.thinking === true;
    if (!thinkingEnabled) {
      const msg = response?.choices?.[0]?.message as any;
      if (msg && !msg.content && msg.thinking) {
        msg.content = msg.thinking;
        delete msg.thinking;
      }
    }
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const normalized = this.normalizeRequest(request, model);
    const upstreamModel = this.getUpstreamModelId(model);
    const thinkingEnabled = model.capabilities?.thinking === true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...normalized, model: upstreamModel, stream: true } as any);
    for await (const chunk of stream) {
      // Same fallback as chatCompletion: remap delta.thinking → delta.content when
      // think:false was requested but the model still emits thinking-only chunks.
      if (!thinkingEnabled) {
        const delta = (chunk as any)?.choices?.[0]?.delta as any;
        if (delta?.thinking && !delta.content) {
          const { thinking, ...deltaRest } = delta;
          yield { ...(chunk as any), choices: [{ ...(chunk as any).choices[0], delta: { ...deltaRest, content: thinking } }, ...(chunk as any).choices.slice(1)] } as unknown as StreamChunk;
          continue;
        }
      }
      yield chunk as unknown as StreamChunk;
    }
  }
}
