/**
 * Shared helpers for adapters that use the OpenAI-compatible SDK
 * but need to expose the Anthropic `messages()` API surface.
 *
 * anthropicToOpenAIMessages  — converts MessagesRequest → OpenAI messages array + system string
 * openAIToAnthropicResponse  — converts an OpenAI chat completion → MessagesResponse
 */

import type { MessagesRequest, MessagesResponse } from '@routerly/shared';

export interface OpenAIMessagesResult {
  messages: any[];
  system: string | undefined;
}

/**
 * Converts an Anthropic MessagesRequest into an OpenAI-compatible messages array.
 * Returns the messages and the extracted system prompt separately so callers
 * can prepend it as a system message or pass it via a dedicated field.
 */
export function anthropicToOpenAIMessages(request: MessagesRequest): OpenAIMessagesResult {
  const openAIMessages: any[] = [];

  for (const m of request.messages) {
    if (typeof m.content === 'string') {
      openAIMessages.push({ role: m.role, content: m.content });
    } else {
      const parts = m.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        }
        // image block
        const src = block.source;
        const url =
          src.type === 'base64'
            ? `data:${src.media_type};base64,${src.data}`
            : src.url!;
        return { type: 'image_url', image_url: { url } };
      });
      openAIMessages.push({ role: m.role, content: parts });
    }
  }

  return { messages: openAIMessages, system: request.system };
}

/**
 * Converts an OpenAI chat completion response into a MessagesResponse
 * (Anthropic format) so the upstream caller always receives a consistent type.
 */
export function openAIToAnthropicResponse(response: any, upstreamModel: string): MessagesResponse {
  const choice = response.choices?.[0];
  const text: string = choice?.message?.content ?? '';
  const finishReason: string = choice?.finish_reason ?? 'stop';

  return {
    id: response.id ?? `msg-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: response.model ?? upstreamModel,
    stop_reason: finishReason === 'length' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
