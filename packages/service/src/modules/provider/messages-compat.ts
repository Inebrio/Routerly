/**
 * Single translator between the Anthropic Messages wire format and the
 * OpenAI-compatible chat-completions wire format.
 *
 * Used by every OpenAI-compatible adapter (openai, ollama, gemini, custom,
 * vertex, bedrock) and by the Anthropic reverse-proxy lane, so a request that
 * enters Routerly as `/v1/messages` reaches a non-Anthropic provider with its
 * tools, tool results and images intact — which is what real Anthropic clients
 * (Claude Code included) need in order to work at all.
 *
 * anthropicToOpenAIMessages  — MessagesRequest → OpenAI messages array + system string
 * anthropicToolsToOpenAI     — Anthropic tool defs → OpenAI tool defs
 * anthropicToChatRequest     — MessagesRequest → ChatCompletionRequest (whitelisted fields)
 * openAIToAnthropicResponse  — OpenAI chat completion → MessagesResponse
 * openAIChunksToAnthropicSSE — OpenAI stream chunks → Anthropic SSE event lines
 */

import type {
  AnthropicContentBlock,
  AnthropicStopReason,
  AnthropicSystem,
  AnthropicToolChoice,
  ChatCompletionRequest,
  MessagesRequest,
  MessagesResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '@routerly/shared';

export interface OpenAIMessagesResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  system: string | undefined;
}

/** Flattens a system prompt (plain string or a list of text blocks) into one string. */
export function flattenSystem(system: AnthropicSystem | undefined): string | undefined {
  if (system == null) return undefined;
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return undefined;
  const text = system
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

/** Renders a tool_result payload (string or block list) as the plain text OpenAI tool messages expect. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // ponytail: text blocks only. An image returned by a tool is dropped here — OpenAI tool
    // messages take text; carrying it would mean synthesizing an extra user message.
    return content
      .map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Converts an Anthropic MessagesRequest into an OpenAI-compatible messages array.
 *
 * Block mapping:
 *   text                     → text part
 *   image                    → image_url part (base64 becomes a data: URL)
 *   tool_use   (assistant)   → assistant message with `tool_calls`
 *   tool_result (user)       → standalone `role: 'tool'` message, emitted before the
 *                              remaining user content so it directly follows the
 *                              assistant turn that requested it (OpenAI ordering rule)
 *
 * Returns the messages and the extracted system prompt separately so callers can
 * prepend it as a system message or pass it via a dedicated field.
 */
export function anthropicToOpenAIMessages(request: MessagesRequest): OpenAIMessagesResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openAIMessages: any[] = [];

  for (const m of request.messages) {
    // Anything that is not a block list is treated as plain text: a string passes
    // through, anything else (number, null, …) becomes empty rather than throwing.
    if (!Array.isArray(m.content)) {
      openAIMessages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
      continue;
    }

    const blocks = m.content as AnthropicContentBlock[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        const src = block.source;
        if (!src) continue; // malformed image block: drop it rather than fail the whole request
        const url = src.type === 'base64' ? `data:${src.media_type};base64,${src.data}` : src.url ?? '';
        parts.push({ type: 'image_url', image_url: { url } });
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      } else if (block.type === 'tool_result') {
        openAIMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: toolResultText(block.content),
        });
      }
    }

    if (toolCalls.length > 0) {
      const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
      openAIMessages.push({ role: m.role, content: text || null, tool_calls: toolCalls });
    } else if (parts.length > 0) {
      // A single text part stays a plain string: some OpenAI-compatible servers
      // (Ollama included) don't accept the parts array for text-only messages.
      const onlyText = parts.every((p) => p.type === 'text');
      openAIMessages.push({
        role: m.role,
        content: onlyText ? parts.map((p) => p.text).join('') : parts,
      });
    }
  }

  return { messages: openAIMessages, system: flattenSystem(request.system) };
}

/** Converts Anthropic tool definitions into OpenAI function-tool definitions. */
export function anthropicToolsToOpenAI(tools: MessagesRequest['tools']): ToolDefinition[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: (tool.input_schema as Record<string, unknown> | undefined) ?? { type: 'object', properties: {} },
    },
  }));
}

/** Maps an Anthropic tool_choice to its OpenAI equivalent. */
export function anthropicToolChoiceToOpenAI(
  choice: AnthropicToolChoice | undefined,
): string | { type: 'function'; function: { name: string } } | undefined {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'none': return 'none';
    case 'tool': return { type: 'function', function: { name: choice.name } };
    default: return undefined;
  }
}

/**
 * Builds the OpenAI chat-completions request for a MessagesRequest.
 *
 * Whitelist, not pass-through: Anthropic-only fields (`thinking`, `betas`,
 * `metadata`, `cache_control`, …) would be rejected by OpenAI-compatible
 * servers, so only fields with a defined counterpart are forwarded.
 */
export function anthropicToChatRequest(body: MessagesRequest): ChatCompletionRequest {
  const { messages, system } = anthropicToOpenAIMessages(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withSystem: any[] = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const tools = anthropicToolsToOpenAI(body.tools);
  const toolChoice = anthropicToolChoiceToOpenAI(body.tool_choice);

  return {
    model: body.model,
    messages: withSystem as ChatCompletionRequest['messages'],
    max_tokens: body.max_tokens,
    stream: body.stream ?? false,
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    ...(body.stop_sequences?.length ? { stop: body.stop_sequences } : {}),
    ...(tools ? { tools } : {}),
    ...(tools && toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

/** Maps an OpenAI finish_reason to the Anthropic stop_reason it corresponds to. */
export function finishReasonToStopReason(finish: string | null | undefined): AnthropicStopReason {
  switch ((finish ?? '').toLowerCase()) {
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'content_filter': return 'refusal';
    default: return 'end_turn';
  }
}

/** Parses tool-call arguments, tolerating the empty/invalid JSON some providers emit. */
function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Converts an OpenAI chat completion into a MessagesResponse (Anthropic format),
 * including `tool_use` blocks for any tool calls the model produced.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openAIToAnthropicResponse(response: any, upstreamModel: string, fallbackId?: string): MessagesResponse {
  const choice = response?.choices?.[0];
  const text: string = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const toolCalls: ToolCall[] = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];

  const content: AnthropicContentBlock[] = [];
  if (text) content.push({ type: 'text', text });
  for (const call of toolCalls) {
    content.push({
      type: 'tool_use',
      id: call.id || `toolu_${Math.random().toString(36).slice(2)}`,
      name: call.function?.name ?? '',
      input: parseToolArguments(call.function?.arguments),
    });
  }
  // An empty content array is invalid for Anthropic clients: keep one empty text block.
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    // `||`, not `??`: providers that answer with an empty id/model must still yield
    // a usable message id and the model the client asked for.
    id: response?.id || fallbackId || `msg-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: response?.model || upstreamModel,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : finishReasonToStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response?.usage?.prompt_tokens ?? 0,
      output_tokens: response?.usage?.completion_tokens ?? 0,
      ...(response?.usage?.prompt_tokens_details?.cached_tokens
        ? { cache_read_input_tokens: response.usage.prompt_tokens_details.cached_tokens }
        : {}),
    },
  };
}

/**
 * Converts OpenAI stream chunks into Anthropic SSE event lines.
 *
 * Text and tool calls each occupy their own content block, numbered in the order
 * they are opened, exactly as Anthropic streams them: a tool call emits
 * content_block_start(tool_use) → input_json_delta* → content_block_stop.
 */
export async function* openAIChunksToAnthropicSSE(
  chunks: AsyncIterable<StreamChunk>,
  msgId: string,
  requestedModel: string,
): AsyncGenerator<string> {
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  let started = false
  let nextIndex = 0
  // Anthropic content blocks never interleave: at most one is open at a time.
  let open: { index: number; kind: 'text' | 'tool'; slot?: number } | null = null
  let sawToolCall = false
  let anyBlock = false
  let finish: string | null = null
  let outputTokens = 0

  const closeBlock = function* (): Generator<string> {
    if (open !== null) {
      yield sse('content_block_stop', { type: 'content_block_stop', index: open.index })
      open = null
    }
  }

  for await (const chunk of chunks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunkAny = chunk as any
    if (!started) {
      started = true
      yield sse('message_start', {
        type: 'message_start',
        message: {
          id: msgId, type: 'message', role: 'assistant', content: [],
          stop_reason: null, stop_sequence: null,
          model: chunk.model || requestedModel,
          usage: { input_tokens: chunkAny.usage?.prompt_tokens ?? 0, output_tokens: 0 },
        },
      })
      yield sse('ping', { type: 'ping' })
    }

    if (chunkAny.usage?.completion_tokens) outputTokens = chunkAny.usage.completion_tokens

    const delta = chunk.choices?.[0]?.delta
    const text = delta?.content
    if (text) {
      if (open?.kind !== 'text') {
        yield* closeBlock()
        open = { index: nextIndex++, kind: 'text' }
        anyBlock = true
        yield sse('content_block_start', { type: 'content_block_start', index: open.index, content_block: { type: 'text', text: '' } })
      }
      yield sse('content_block_delta', { type: 'content_block_delta', index: open.index, delta: { type: 'text_delta', text } })
    }

    for (const call of delta?.tool_calls ?? []) {
      sawToolCall = true
      const slot = call.index ?? 0
      if (open?.kind !== 'tool' || open.slot !== slot) {
        yield* closeBlock()
        open = { index: nextIndex++, kind: 'tool', slot }
        anyBlock = true
        yield sse('content_block_start', {
          type: 'content_block_start',
          index: open.index,
          content_block: { type: 'tool_use', id: call.id || `toolu_${msgId}_${slot}`, name: call.function?.name ?? '', input: {} },
        })
      }
      const args = call.function?.arguments
      if (args) {
        yield sse('content_block_delta', { type: 'content_block_delta', index: open.index, delta: { type: 'input_json_delta', partial_json: args } })
      }
    }

    const chunkFinish = chunk.choices?.[0]?.finish_reason
    if (chunkFinish) finish = chunkFinish
  }

  if (!started) {
    // Empty upstream stream: still emit a well-formed, empty Anthropic message.
    yield sse('message_start', {
      type: 'message_start',
      message: { id: msgId, type: 'message', role: 'assistant', content: [], stop_reason: null, stop_sequence: null, model: requestedModel, usage: { input_tokens: 0, output_tokens: 0 } },
    })
    yield sse('ping', { type: 'ping' })
  }

  yield* closeBlock()
  if (!anyBlock) {
    // No content at all: Anthropic clients still expect one (empty) block.
    yield sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    yield sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  }

  const stopReason = sawToolCall ? 'tool_use' : finishReasonToStopReason(finish)
  yield sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })
  yield sse('message_stop', { type: 'message_stop' })
}
