/**
 * Single translator between the OpenAI Responses wire format and the
 * OpenAI-compatible chat-completions wire format.
 *
 * `/v1/responses` is a different protocol from `/v1/chat/completions`, not a
 * renamed field or two: the request carries typed `input` items instead of chat
 * messages, the response is a `response` object with an `output` item list, and
 * the stream is a typed event sequence (`event:` framed, no `[DONE]` sentinel).
 * Routerly routes on the chat-completions shape internally, so this module maps
 * both directions and every processor in between stays unchanged.
 *
 * Shapes verified against api.openai.com/v1/responses (2026-08-02), not memory.
 *
 * responsesToChatRequest      — ResponsesRequest → ChatCompletionRequest
 * chatToResponsesObject       — OpenAI chat completion → response object
 * openAIChunksToResponsesSSE  — OpenAI stream chunks → Responses SSE event lines
 * emptyResponsesSSE           — a well-formed, empty Responses stream (block path)
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Message,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '@routerly/shared';

/** A single item of the Responses `input` list. Free-form: the API keeps adding item types. */
export type ResponsesInputItem = Record<string, unknown>;

export interface ResponsesRequest {
  model: string;
  input?: string | ResponsesInputItem[];
  instructions?: string | null;
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  parallel_tool_calls?: boolean;
  text?: { format?: Record<string, unknown> };
  previous_response_id?: string | null;
  metadata?: Record<string, string> | null;
  store?: boolean;
  user?: string;
  [key: string]: unknown;
}

/** Renders a Responses content part list as the chat-completions equivalent. */
function partsToChat(content: unknown): string | Message['content'] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = content.map((raw) => {
    const part = raw as Record<string, any>;
    if (part?.type === 'input_image') {
      // Responses carries the URL flat, chat nests it under `image_url.url`.
      const url = typeof part.image_url === 'string' ? part.image_url : (part.image_url?.url ?? '');
      return { type: 'image_url' as const, image_url: { url } };
    }
    return { type: 'text' as const, text: typeof part?.text === 'string' ? part.text : '' };
  });
  // Text-only content collapses to a plain string: some OpenAI-compatible servers
  // reject the parts array for text-only messages (same rule as messages-compat).
  return parts.every((p) => p.type === 'text')
    ? parts.map((p) => (p as { text: string }).text).join('')
    : (parts as Message['content']);
}

/** Responses tool definitions (flat `name`) → chat tool definitions (nested under `function`). */
export function responsesToolsToChat(tools: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const functions = tools.filter((t) => (t as Record<string, unknown>)?.type === 'function');
  if (functions.length === 0) return undefined; // hosted tools (web_search, file_search) have no chat equivalent
  return functions.map((raw) => {
    const tool = raw as Record<string, any>;
    return {
      type: 'function' as const,
      function: {
        name: tool.name ?? '',
        ...(tool.description ? { description: tool.description as string } : {}),
        parameters: (tool.parameters as Record<string, unknown> | undefined) ?? { type: 'object', properties: {} },
      },
    };
  });
}

/** Responses tool_choice → chat tool_choice. Responses names the function flat. */
export function responsesToolChoiceToChat(choice: unknown): unknown {
  if (typeof choice === 'string') return choice; // auto | none | required
  if (choice && typeof choice === 'object') {
    const raw = choice as Record<string, any>;
    if (raw.type === 'function' && raw.name) return { type: 'function', function: { name: raw.name } };
  }
  return undefined;
}

/**
 * Converts a Responses request into the chat-completions request Routerly routes on.
 *
 * Item mapping:
 *   message              → chat message (parts converted, `output_text` included)
 *   function_call        → `tool_calls` on the preceding assistant message, or a new one
 *   function_call_output → `role: 'tool'` message carrying `tool_call_id`
 *
 * `instructions` becomes the leading system message, which is what every
 * OpenAI-compatible provider expects.
 */
export function responsesToChatRequest(body: ResponsesRequest): ChatCompletionRequest {
  const messages: Message[] = [];
  if (typeof body.instructions === 'string' && body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }

  const input = body.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const raw of input) {
      const item = raw as Record<string, any>;
      const type = item?.type;

      if (type === 'function_call') {
        const call: ToolCall = {
          id: String(item.call_id ?? item.id ?? ''),
          type: 'function',
          function: { name: item.name ?? '', arguments: item.arguments ?? '{}' },
        };
        const last = messages[messages.length - 1];
        // Chat requires tool calls to hang off an assistant message; attach to the one
        // this call follows, otherwise open a content-less assistant turn for it.
        if (last?.role === 'assistant') (last.tool_calls ??= []).push(call);
        else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
        continue;
      }

      if (type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: String(item.call_id ?? ''),
          content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
        });
        continue;
      }

      // `type` is optional on message items: a bare { role, content } is valid input.
      if (type === 'message' || (type === undefined && item?.role)) {
        const role = (item.role ?? 'user') as Message['role'];
        messages.push({ role, content: partsToChat(item.content) as Message['content'] });
        continue;
      }
      // Unknown item type (reasoning, hosted tool call, …): no chat equivalent, drop it.
    }
  }

  const tools = responsesToolsToChat(body.tools);
  const toolChoice = responsesToolChoiceToChat(body.tool_choice);
  const format = body.text?.format;

  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    ...(body.max_output_tokens != null ? { max_tokens: body.max_output_tokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    ...(body.parallel_tool_calls != null ? { parallel_tool_calls: body.parallel_tool_calls } : {}),
    ...(body.user ? { user: body.user } : {}),
    ...(tools ? { tools } : {}),
    ...(tools && toolChoice ? { tool_choice: toolChoice } : {}),
    // Responses nests the structured-output schema under `text.format`; chat calls it
    // `response_format` and the payload underneath is identical.
    ...(format && format.type !== 'text' ? { response_format: format } : {}),
  };
}

/** Responses reports `status`/`incomplete_details` where chat reports `finish_reason`. */
function statusFor(finish: string | null | undefined): { status: string; incomplete: unknown } {
  if (finish === 'length') return { status: 'incomplete', incomplete: { reason: 'max_output_tokens' } };
  if (finish === 'content_filter') return { status: 'incomplete', incomplete: { reason: 'content_filter' } };
  return { status: 'completed', incomplete: null };
}

interface ResponsesUsageSource {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

function usageBlock(usage: ResponsesUsageSource | undefined): Record<string, unknown> {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: input + output,
  };
}

/**
 * The invariant scaffolding every `response` object carries, in progress or completed.
 *
 * The API echoes the request settings back on the response, so `req` is threaded
 * through: a client reading `response.tools` or `response.max_output_tokens` must
 * see what it sent, not a default.
 */
function responseEnvelope(
  id: string,
  model: string,
  createdAt: number,
  req?: ResponsesRequest,
): Record<string, unknown> {
  return {
    id,
    object: 'response',
    created_at: createdAt,
    error: null,
    instructions: req?.instructions ?? null,
    max_output_tokens: req?.max_output_tokens ?? null,
    model,
    parallel_tool_calls: req?.parallel_tool_calls ?? true,
    previous_response_id: null,
    store: req?.store ?? false,
    temperature: req?.temperature ?? null,
    text: { format: req?.text?.format ?? { type: 'text' } },
    tool_choice: req?.tool_choice ?? 'auto',
    tools: req?.tools ?? [],
    top_p: req?.top_p ?? null,
    truncation: 'disabled',
    user: req?.user ?? null,
    metadata: req?.metadata ?? {},
  };
}

/** Builds an `output` message item holding assistant text. */
function messageItem(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: 'message',
    status: 'completed',
    content: [{ type: 'output_text', annotations: [], logprobs: [], text }],
    role: 'assistant',
  };
}

/** Builds an `output` function_call item. */
function functionCallItem(id: string, callId: string, name: string, args: string): Record<string, unknown> {
  return { id, type: 'function_call', status: 'completed', arguments: args, call_id: callId, name };
}

/**
 * Converts an OpenAI chat completion into a Responses `response` object.
 *
 * Text and every tool call become separate `output` items, which is how the
 * Responses SDKs read an answer back (`output_text` is derived from them).
 */
export function chatToResponsesObject(
  response: ChatCompletionResponse | undefined,
  requestedModel: string,
  fallbackId: string,
  req?: ResponsesRequest,
): Record<string, unknown> {
  const choice = response?.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const toolCalls: ToolCall[] = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  const id = `resp_${fallbackId}`;

  const output: Array<Record<string, unknown>> = [];
  if (text) output.push(messageItem(`msg_${fallbackId}`, text));
  toolCalls.forEach((call, i) => {
    output.push(functionCallItem(
      `fc_${fallbackId}_${i}`,
      call.id || `call_${fallbackId}_${i}`,
      call.function?.name ?? '',
      call.function?.arguments ?? '{}',
    ));
  });

  const { status, incomplete } = statusFor(choice?.finish_reason);
  return {
    ...responseEnvelope(id, response?.model || requestedModel, response?.created ?? Math.floor(Date.now() / 1000), req),
    status,
    incomplete_details: incomplete,
    output,
    usage: usageBlock(response?.usage),
  };
}

/**
 * Converts OpenAI stream chunks into Responses SSE event lines.
 *
 * Every event is `event:`-framed and numbered with a monotonic `sequence_number`;
 * the stream ends on `response.completed` with NO `[DONE]` sentinel, exactly as
 * api.openai.com does. Text opens a `message` item wrapping one `output_text`
 * content part; each tool call is its own `function_call` item.
 */
export async function* openAIChunksToResponsesSSE(
  chunks: AsyncIterable<StreamChunk>,
  respId: string,
  requestedModel: string,
  req?: ResponsesRequest,
): AsyncGenerator<string> {
  const id = `resp_${respId}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let seq = 0;
  const sse = (type: string, data: Record<string, unknown>): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data, sequence_number: seq++ })}\n\n`;

  let model = requestedModel;
  let started = false;
  let outputIndex = 0;
  const done: Array<Record<string, unknown>> = [];
  let open:
    | { kind: 'text'; itemId: string; index: number; text: string }
    | { kind: 'tool'; itemId: string; index: number; slot: number; callId: string; name: string; args: string }
    | null = null;
  let usage: ResponsesUsageSource | undefined;
  let finish: string | null = null;

  const envelope = (extra: Record<string, unknown>): Record<string, unknown> => ({
    ...responseEnvelope(id, model, createdAt, req),
    ...extra,
  });

  const closeOpen = function* (): Generator<string> {
    if (open === null) return;
    if (open.kind === 'text') {
      const item = messageItem(open.itemId, open.text);
      yield sse('response.output_text.done', { content_index: 0, item_id: open.itemId, logprobs: [], output_index: open.index, text: open.text });
      yield sse('response.content_part.done', { content_index: 0, item_id: open.itemId, output_index: open.index, part: { type: 'output_text', annotations: [], logprobs: [], text: open.text } });
      yield sse('response.output_item.done', { item, output_index: open.index });
      done.push(item);
    } else {
      const item = functionCallItem(open.itemId, open.callId, open.name, open.args);
      yield sse('response.function_call_arguments.done', { arguments: open.args, item_id: open.itemId, output_index: open.index });
      yield sse('response.output_item.done', { item, output_index: open.index });
      done.push(item);
    }
    open = null;
  };

  for await (const chunk of chunks) {
    const chunkAny = chunk as StreamChunk & { usage?: ResponsesUsageSource };
    if (chunk.model) model = chunk.model;
    if (chunkAny.usage) usage = chunkAny.usage;

    if (!started) {
      started = true;
      yield sse('response.created', { response: envelope({ status: 'in_progress', incomplete_details: null, output: [], usage: null }) });
      yield sse('response.in_progress', { response: envelope({ status: 'in_progress', incomplete_details: null, output: [], usage: null }) });
    }

    const delta = chunk.choices?.[0]?.delta;
    const text = delta?.content;
    if (text) {
      if (open?.kind !== 'text') {
        yield* closeOpen();
        const itemId = `msg_${respId}_${outputIndex}`;
        open = { kind: 'text', itemId, index: outputIndex, text: '' };
        yield sse('response.output_item.added', { item: { id: itemId, type: 'message', status: 'in_progress', content: [], role: 'assistant' }, output_index: outputIndex });
        yield sse('response.content_part.added', { content_index: 0, item_id: itemId, output_index: outputIndex, part: { type: 'output_text', annotations: [], logprobs: [], text: '' } });
        outputIndex++;
      }
      open.text += text;
      yield sse('response.output_text.delta', { content_index: 0, delta: text, item_id: open.itemId, logprobs: [], output_index: open.index });
    }

    for (const call of delta?.tool_calls ?? []) {
      const slot = call.index ?? 0;
      if (open?.kind !== 'tool' || open.slot !== slot) {
        yield* closeOpen();
        const itemId = `fc_${respId}_${outputIndex}`;
        const callId: string = call.id || `call_${respId}_${slot}`;
        open = { kind: 'tool', itemId, index: outputIndex, slot, callId, name: call.function?.name ?? '', args: '' };
        yield sse('response.output_item.added', { item: { id: itemId, type: 'function_call', status: 'in_progress', arguments: '', call_id: callId, name: open.name }, output_index: outputIndex });
        outputIndex++;
      } else if (call.function?.name && !open.name) {
        open.name = call.function.name;
      }
      const args = call.function?.arguments;
      if (args) {
        open.args += args;
        yield sse('response.function_call_arguments.delta', { delta: args, item_id: open.itemId, output_index: open.index });
      }
    }

    const chunkFinish = chunk.choices?.[0]?.finish_reason;
    if (chunkFinish) finish = chunkFinish;
  }

  if (!started) {
    // Empty upstream stream: still open and close a well-formed response.
    yield sse('response.created', { response: envelope({ status: 'in_progress', incomplete_details: null, output: [], usage: null }) });
    yield sse('response.in_progress', { response: envelope({ status: 'in_progress', incomplete_details: null, output: [], usage: null }) });
  }
  yield* closeOpen();

  const { status, incomplete } = statusFor(finish);
  yield sse('response.completed', {
    response: envelope({ status, incomplete_details: incomplete, output: done, usage: usageBlock(usage) }),
  });
}

/** A complete, empty Responses stream. Used by the block paths, which have no chunks to convert. */
export async function* emptyResponsesSSE(respId: string, model: string): AsyncGenerator<string> {
  yield* openAIChunksToResponsesSSE((async function* () {})(), respId, model);
}
