import type { ChatCompletionRequest, Message, ChatCompletionResponse, ModelCapabilities, StreamChunk } from '@routerly/shared';

/** Request without the model id: the invoker binds it. */
export type ConformanceRequest = { messages: Message[]; [key: string]: unknown };

/** Calls the model under test through the same path as live traffic. */
export interface Invoker {
  chat(request: ConformanceRequest): Promise<ChatCompletionResponse>;
  stream(request: ConformanceRequest): AsyncIterable<StreamChunk>;
}

export type ConformanceCapability = keyof Pick<ModelCapabilities, 'thinking' | 'vision' | 'functionCalling' | 'json'> | 'streaming' | 'base';

export interface ConformanceCase {
  id: string;
  /** Capability proven by a pass; `base` cases only gate the overall status. */
  capability: ConformanceCapability;
  /** Skipped (not failed) when the model does not declare the capability. */
  requires?: (caps: ModelCapabilities | undefined) => boolean;
  /** Throws on a non-conformant behaviour. */
  run(invoker: Invoker): Promise<void>;
}

const user = (content: ChatCompletionRequest['messages'][number]['content']) => ({ role: 'user' as const, content });

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const text = (r: ChatCompletionResponse): string => {
  const c = r.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
};

// Tool schema using keywords that some providers reject (pattern, format, $ref/$defs, additionalProperties).
const lookupTool = {
  type: 'function' as const,
  function: {
    name: 'lookup',
    description: 'Look up a record by code.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z]{3}$', description: 'Three capital letters' },
        when: { type: 'string', format: 'date-time' },
        opts: { $ref: '#/$defs/opts' },
      },
      required: ['code'],
      additionalProperties: false,
      $defs: { opts: { type: 'object', properties: { verbose: { type: 'boolean' } } } },
    },
  },
};

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const CORPUS: ConformanceCase[] = [
  {
    id: 'basic-chat', capability: 'base',
    async run(i) {
      const r = await i.chat({ messages: [user('Reply with the single word: ok')], max_tokens: 64 });
      expect(text(r).length > 0, 'empty assistant content');
    },
  },
  {
    id: 'system-messages-multiple', capability: 'base',
    async run(i) {
      const r = await i.chat({
        messages: [{ role: 'system', content: 'Be brief.' }, { role: 'system', content: 'Answer in English.' }, user('Say hi')],
        max_tokens: 64,
      });
      expect(text(r).length > 0, 'empty assistant content with two system messages');
    },
  },
  {
    id: 'streaming', capability: 'streaming',
    async run(i) {
      let content = ''; let finish: unknown;
      for await (const c of i.stream({ messages: [user('Count: 1 2 3')], max_tokens: 64 })) {
        for (const ch of c.choices ?? []) {
          if (typeof ch.delta?.content === 'string') content += ch.delta.content;
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
      expect(content.length > 0, 'stream produced no content');
      expect(finish, 'stream ended without finish_reason');
    },
  },
  {
    id: 'tool-call', capability: 'functionCalling',
    requires: caps => caps?.functionCalling !== false,
    async run(i) {
      const r = await i.chat({
        messages: [user('Look up the record with code ABC using the tool.')],
        tools: [lookupTool], tool_choice: 'auto', max_tokens: 256,
      });
      const calls = r.choices?.[0]?.message?.tool_calls;
      expect(calls && calls.length > 0, 'no tool call returned');
      JSON.parse(calls[0]!.function.arguments);
    },
  },
  {
    id: 'tool-result-continuation', capability: 'functionCalling',
    requires: caps => caps?.functionCalling !== false,
    async run(i) {
      const first = await i.chat({
        messages: [user('Look up the record with code ABC using the tool.')],
        tools: [lookupTool], tool_choice: 'auto', max_tokens: 256,
      });
      const msg = first.choices?.[0]?.message;
      const call = msg?.tool_calls?.[0];
      expect(call, 'no tool call returned to continue from');
      // Replay the assistant message exactly as returned (reasoning fields included), then the tool result.
      const r = await i.chat({
        messages: [
          user('Look up the record with code ABC using the tool.'),
          msg as ChatCompletionRequest['messages'][number],
          { role: 'tool', tool_call_id: call.id, content: '{"name":"Alpha"}' },
        ],
        tools: [lookupTool], max_tokens: 256,
      });
      expect(r.choices?.length > 0, 'continuation returned no choices');
    },
  },
  {
    id: 'tool-result-continuation-client-stripped', capability: 'functionCalling',
    requires: caps => caps?.functionCalling !== false,
    async run(i) {
      // A client that drops provider-specific fields from the assistant message must still work.
      const r = await i.chat({
        messages: [
          user('Look up the record with code ABC using the tool.'),
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"code":"ABC"}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: '{"name":"Alpha"}' },
        ],
        tools: [lookupTool], max_tokens: 256,
      });
      expect(r.choices?.length > 0, 'continuation returned no choices');
    },
  },
  {
    id: 'json-mode', capability: 'json',
    requires: caps => caps?.json !== false,
    async run(i) {
      const r = await i.chat({
        messages: [user('Return a JSON object with key "a" set to 1.')],
        response_format: { type: 'json_object' }, max_tokens: 128,
      });
      JSON.parse(text(r));
    },
  },
  {
    id: 'vision', capability: 'vision',
    requires: caps => caps?.vision === true,
    async run(i) {
      const r = await i.chat({
        messages: [user([{ type: 'text', text: 'Describe this image in one word.' }, { type: 'image_url', image_url: { url: PNG } }])],
        max_tokens: 64,
      });
      expect(text(r).length > 0, 'empty content for an image input');
    },
  },
  {
    id: 'thinking', capability: 'thinking',
    requires: caps => caps?.thinking === true,
    async run(i) {
      const r = await i.chat({ messages: [user('What is 17 * 3?')], max_tokens: 1024 });
      expect(text(r).length > 0, 'empty content on a thinking model');
    },
  },
];
