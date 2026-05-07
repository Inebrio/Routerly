import OpenAI from 'openai';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';
import { anthropicToOpenAIMessages, openAIToAnthropicResponse } from './messages-compat.js';

/**
 * Google Gemini adapter using the OpenAI-compatible endpoint.
 * Gemini supports an OpenAI-compatible API at:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 */
export class GeminiAdapter implements ProviderAdapter {
  private getClient(model: ModelConfig): OpenAI {
    const apiKey = model.apiKey ?? '';
    const baseURL =
      model.endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai/';
    return new OpenAI({ apiKey, baseURL });
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await client.chat.completions.create({ ...rest, stream: false } as any);
    return response as unknown as ChatCompletionResponse;
  }

  async *streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk> {
    const client = this.getClient(model);
    const { stream: _stream, ...rest } = request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await client.chat.completions.create({ ...rest, stream: true } as any);
    for await (const chunk of stream) {
      yield chunk as unknown as StreamChunk;
    }
  }

  async messages(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse> {
    const client = this.getClient(model);
    const upstreamModel = model.id;
    const { messages, system } = anthropicToOpenAIMessages(request);
    const openAIMessages = system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.chat.completions.create({
      messages: openAIMessages,
      model: upstreamModel,
      max_tokens: request.max_tokens,
      stream: false,
    } as any);
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
