import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@localrouter/shared';

/**
 * Common interface that all provider adapters must implement.
 */
export interface ProviderAdapter {
  /** Non-streaming chat completion */
  chatCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<ChatCompletionResponse>;

  /** Streaming chat completion — yields SSE-formatted chunks */
  streamCompletion(
    request: ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<StreamChunk>;

  /** Anthropic messages endpoint (optional, only for anthropic-compatible providers) */
  messages?(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse>;
}
