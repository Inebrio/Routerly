import { describe, it, expect } from 'vitest';
import type { ChatCompletionResponse, StreamChunk } from '@routerly/shared';
import {
  responsesToChatRequest,
  responsesToolsToChat,
  responsesToolChoiceToChat,
  chatToResponsesObject,
  openAIChunksToResponsesSSE,
} from './responses-compat.js';

/** Collects the generator output and parses each frame into { event, data }. */
async function collect(gen: AsyncGenerator<string>): Promise<Array<{ event: string; data: any }>> {
  const raw: string[] = [];
  for await (const line of gen) raw.push(line);
  return raw.map((frame) => {
    const [eventLine, dataLine] = frame.trimEnd().split('\n');
    return { event: eventLine!.replace('event: ', ''), data: JSON.parse(dataLine!.replace('data: ', '')) };
  });
}

function chunk(delta: StreamChunk['choices'][0]['delta'], finish: StreamChunk['choices'][0]['finish_reason'] = null): StreamChunk {
  return { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices: [{ index: 0, delta, finish_reason: finish }] };
}

async function* stream(...chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('responsesToChatRequest', () => {
  it('maps a plain string input to a user message', () => {
    const chat = responsesToChatRequest({ model: 'm', input: 'hello' });
    expect(chat.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(chat.stream).toBe(false);
  });

  it('turns instructions into the leading system message', () => {
    const chat = responsesToChatRequest({ model: 'm', instructions: 'be terse', input: 'hi' });
    expect(chat.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(chat.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('collapses text-only parts to a string and maps images to image_url', () => {
    const chat = responsesToChatRequest({
      model: 'm',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'and' }, { type: 'input_image', image_url: 'data:image/png;base64,AAA' }] },
      ],
    });
    expect(chat.messages[0]).toEqual({ role: 'user', content: 'look' });
    expect(chat.messages[1]!.content).toEqual([
      { type: 'text', text: 'and' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });

  it('accepts a bare { role, content } item without an explicit type', () => {
    const chat = responsesToChatRequest({ model: 'm', input: [{ role: 'user', content: 'plain' }] });
    expect(chat.messages).toEqual([{ role: 'user', content: 'plain' }]);
  });

  it('attaches a function_call to the assistant turn it follows', () => {
    const chat = responsesToChatRequest({
      model: 'm',
      input: [
        { type: 'message', role: 'user', content: 'weather?' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'checking' }] },
        { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Rome"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'sunny' },
      ],
    });
    expect(chat.messages).toEqual([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'checking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Rome"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
    ]);
  });

  it('opens an assistant turn when a function_call has no message before it', () => {
    const chat = responsesToChatRequest({
      model: 'm',
      input: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }],
    });
    expect(chat.messages[0]).toMatchObject({ role: 'assistant', content: null });
    expect(chat.messages[0]!.tool_calls).toHaveLength(1);
  });

  it('drops item types with no chat equivalent instead of failing', () => {
    const chat = responsesToChatRequest({
      model: 'm',
      input: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'user', content: 'hi' }],
    });
    expect(chat.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('maps max_output_tokens to max_tokens, not the other way round', () => {
    const chat = responsesToChatRequest({ model: 'm', input: 'hi', max_output_tokens: 128 });
    expect(chat.max_tokens).toBe(128);
    expect(chat.max_output_tokens).toBeUndefined();
  });

  it('carries the structured-output schema over from text.format', () => {
    const format = { type: 'json_schema', name: 'x', schema: { type: 'object' } };
    const chat = responsesToChatRequest({ model: 'm', input: 'hi', text: { format } });
    expect(chat.response_format).toEqual(format);
  });

  it('does not set response_format for plain text output', () => {
    const chat = responsesToChatRequest({ model: 'm', input: 'hi', text: { format: { type: 'text' } } });
    expect(chat.response_format).toBeUndefined();
  });
});

describe('responsesToolsToChat / responsesToolChoiceToChat', () => {
  it('nests the flat Responses tool under `function`', () => {
    expect(responsesToolsToChat([{ type: 'function', name: 'f', description: 'd', parameters: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } },
    ]);
  });

  it('ignores hosted tools that have no chat equivalent', () => {
    expect(responsesToolsToChat([{ type: 'web_search' }])).toBeUndefined();
  });

  it('passes string tool_choice through and nests the named form', () => {
    expect(responsesToolChoiceToChat('required')).toBe('required');
    expect(responsesToolChoiceToChat({ type: 'function', name: 'f' })).toEqual({ type: 'function', function: { name: 'f' } });
  });
});

describe('chatToResponsesObject', () => {
  const base: ChatCompletionResponse = {
    id: 'chatcmpl-9', object: 'chat.completion', created: 100, model: 'gpt-test',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };

  it('emits a message output item and the Responses usage block', () => {
    const out = chatToResponsesObject(base, 'requested', 'tid') as any;
    expect(out.object).toBe('response');
    expect(out.id).toBe('resp_tid');
    expect(out.status).toBe('completed');
    expect(out.model).toBe('gpt-test');
    expect(out.output).toEqual([
      { id: 'msg_tid', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], logprobs: [], text: 'hello world' }] },
    ]);
    expect(out.usage).toEqual({
      input_tokens: 12, input_tokens_details: { cached_tokens: 0 },
      output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15,
    });
  });

  it('emits one function_call item per tool call', () => {
    const out = chatToResponsesObject({
      ...base,
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'f', arguments: '{"x":1}' } }] }, finish_reason: 'tool_calls' }],
    }, 'requested', 'tid') as any;
    expect(out.output).toEqual([
      { id: 'fc_tid_0', type: 'function_call', status: 'completed', arguments: '{"x":1}', call_id: 'call_a', name: 'f' },
    ]);
    expect(out.status).toBe('completed');
  });

  it('reports a truncated answer as incomplete', () => {
    const out = chatToResponsesObject({ ...base, choices: [{ ...base.choices[0]!, finish_reason: 'length' }] }, 'requested', 'tid') as any;
    expect(out.status).toBe('incomplete');
    expect(out.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('falls back to the requested model when the provider sends none', () => {
    const out = chatToResponsesObject({ ...base, model: '' }, 'requested', 'tid') as any;
    expect(out.model).toBe('requested');
  });
});

describe('openAIChunksToResponsesSSE', () => {
  it('frames text as message → content_part → deltas → completed, with no [DONE]', async () => {
    const frames = await collect(openAIChunksToResponsesSSE(
      stream(chunk({ content: 'hello' }), chunk({ content: ' world' }, 'stop')),
      'tid', 'requested',
    ));
    expect(frames.map((f) => f.event)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    // The `event:` name and the payload `type` always agree, as on the real API.
    expect(frames.every((f) => f.event === f.data.type)).toBe(true);
    // sequence_number is monotonic from 0.
    expect(frames.map((f) => f.data.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(frames.at(-2)!.data.item.content[0].text).toBe('hello world');
    const completed = frames.at(-1)!.data.response;
    expect(completed.status).toBe('completed');
    expect(completed.output[0].content[0].text).toBe('hello world');
  });

  it('frames a tool call as a function_call item with argument deltas', async () => {
    const frames = await collect(openAIChunksToResponsesSSE(
      stream(
        chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"Rome"}' } }] }, 'tool_calls'),
      ),
      'tid', 'requested',
    ));
    expect(frames.map((f) => f.event)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed',
    ]);
    const added = frames[2]!.data.item;
    expect(added).toMatchObject({ type: 'function_call', call_id: 'call_a', name: 'get_weather', arguments: '' });
    expect(frames[5]!.data.arguments).toBe('{"city":"Rome"}');
    expect(frames.at(-1)!.data.response.output).toEqual([
      { id: added.id, type: 'function_call', status: 'completed', arguments: '{"city":"Rome"}', call_id: 'call_a', name: 'get_weather' },
    ]);
  });

  it('closes the text item before opening a tool item', async () => {
    const frames = await collect(openAIChunksToResponsesSSE(
      stream(
        chunk({ content: 'thinking' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'f', arguments: '{}' } }] }, 'tool_calls'),
      ),
      'tid', 'requested',
    ));
    const events = frames.map((f) => f.event);
    expect(events.indexOf('response.output_item.done')).toBeLessThan(events.lastIndexOf('response.output_item.added'));
    const output = frames.at(-1)!.data.response.output;
    expect(output.map((i: any) => i.type)).toEqual(['message', 'function_call']);
    expect(output[0].content[0].text).toBe('thinking');
  });

  it('reports a truncated stream as incomplete', async () => {
    const frames = await collect(openAIChunksToResponsesSSE(stream(chunk({ content: 'cut' }, 'length')), 'tid', 'requested'));
    const completed = frames.at(-1)!.data.response;
    expect(completed.status).toBe('incomplete');
    expect(completed.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('still emits a well-formed empty response for an empty upstream stream', async () => {
    const frames = await collect(openAIChunksToResponsesSSE(stream(), 'tid', 'requested'));
    expect(frames.map((f) => f.event)).toEqual(['response.created', 'response.in_progress', 'response.completed']);
    expect(frames.at(-1)!.data.response.output).toEqual([]);
    expect(frames.at(-1)!.data.response.model).toBe('requested');
  });

  it('carries usage through from the final chunk', async () => {
    const withUsage = { ...chunk({}, 'stop'), usage: { prompt_tokens: 7, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } } as StreamChunk;
    const frames = await collect(openAIChunksToResponsesSSE(stream(chunk({ content: 'x' }), withUsage), 'tid', 'requested'));
    expect(frames.at(-1)!.data.response.usage).toEqual({
      input_tokens: 7, input_tokens_details: { cached_tokens: 4 },
      output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 9,
    });
  });
});
