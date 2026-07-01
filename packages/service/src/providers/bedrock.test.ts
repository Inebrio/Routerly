import { describe, it, expect, vi, afterEach } from 'vitest';
import { signRequest, BedrockAdapter } from './bedrock.js';
import type { ModelConfig } from '@routerly/shared';

afterEach(() => vi.clearAllMocks());

const baseModel: ModelConfig = {
  id: 'bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0',
  name: 'Bedrock Claude',
  provider: 'bedrock',
  endpoint: '',
  cost: { inputPerMillion: 3, outputPerMillion: 15 },
  awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  awsSecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  awsRegion: 'us-east-1',
};

describe('signRequest', () => {
  it('produces an Authorization header with AWS4-HMAC-SHA256', () => {
    const headers = signRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet/converse',
      body: JSON.stringify({ messages: [] }),
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });

    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//);
    expect(headers['authorization']).toContain('us-east-1/bedrock/aws4_request');
    expect(headers['authorization']).toContain('SignedHeaders=');
    expect(headers['authorization']).toContain('Signature=');
  });

  it('includes x-amz-security-token when sessionToken is provided', () => {
    const headers = signRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/test/converse',
      body: '{}',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      region: 'us-east-1',
      sessionToken: 'SESSION_TOKEN_VALUE',
    });

    expect(headers['x-amz-security-token']).toBe('SESSION_TOKEN_VALUE');
  });

  it('omits x-amz-security-token when no sessionToken', () => {
    const headers = signRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/test/converse',
      body: '{}',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      region: 'us-east-1',
    });
    expect(headers['x-amz-security-token']).toBeUndefined();
  });

  it('includes required standard headers', () => {
    const headers = signRequest({
      method: 'POST',
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/test/converse',
      body: '{}',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      region: 'us-east-1',
    });
    expect(headers['content-type']).toBe('application/json');
    expect(headers['host']).toBe('bedrock-runtime.us-east-1.amazonaws.com');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });
});

describe('BedrockAdapter', () => {
  it('chatCompletion maps Bedrock Converse response to OpenAI format', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'Hello from Bedrock' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResp,
    }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any,
      baseModel,
    );

    expect(resp.choices[0]!.message.content).toBe('Hello from Bedrock');
    expect(resp.choices[0]!.finish_reason).toBe('stop');
    expect(resp.usage.prompt_tokens).toBe(10);
    expect(resp.usage.completion_tokens).toBe(5);
  });

  it('chatCompletion separates system messages', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 3 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.chatCompletion({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    } as any, baseModel);

    expect(capturedBody['system']).toEqual([{ text: 'You are helpful.' }]);
    expect((capturedBody['messages'] as any[]).every((m: any) => m.role !== 'system')).toBe(true);
  });

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }) as any;

    const adapter = new BedrockAdapter();
    await expect(
      adapter.chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel),
    ).rejects.toThrow('Bedrock error 403');
  });

  it('line 155: sets finish_reason to "length" when stopReason is not end_turn', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'truncated' }] } },
      stopReason: 'max_tokens',
      usage: { inputTokens: 5, outputTokens: 3 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    expect(resp.choices[0]!.finish_reason).toBe('length');
  });

  it('lines 158-160: uses ?? 0 fallbacks when usage fields are missing', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      // no usage field at all
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    expect(resp.usage.prompt_tokens).toBe(0);
    expect(resp.usage.completion_tokens).toBe(0);
  });

  it('line 140: uses ?? [] when output.message.content is missing', async () => {
    const mockResp = {
      output: {}, // no message.content
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    expect(resp.choices[0]!.message.content).toBe('');
  });

  it('line 141-142: filter keeps blocks with .text property and ?? "" fallback', async () => {
    const mockResp = {
      output: { message: { content: [
        { type: 'tool_use', id: 'tc1' },     // no text, no .text — filtered out
        { text: 'from text prop' },            // has .text but not type text — kept
        { type: 'text', text: 'hello' },       // type=text AND text — kept
      ] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 5 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    // filtered: 'from text prop' + 'hello' joined
    expect(resp.choices[0]!.message.content).toContain('hello');
  });

  it('chatCompletion — line 125 false: no system → system not added', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 3, outputTokens: 2 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.chatCompletion(
      // no system message
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    expect(capturedBody['system']).toBeUndefined();
  });

  it('auth: uses empty fallbacks when aws fields are undefined (lines 113-115 ?? branches)', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    // All AWS fields undefined → auth() uses ?? fallbacks
    const noCredsModel = { ...baseModel, awsAccessKeyId: undefined, awsSecretAccessKey: undefined, awsRegion: undefined };
    // Should not throw even with empty credentials
    await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any,
      noCredsModel as any,
    );
    expect(global.fetch).toHaveBeenCalled();
  });

  it('auth: sets sessionToken when awsSessionToken is present (line 117 true branch)', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    let capturedHeaders: Record<string, string> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { headers: Record<string, string> }) => {
      capturedHeaders = opts.headers;
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    const modelWithToken = { ...baseModel, awsSessionToken: 'my-session-token' };
    await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any,
      modelWithToken,
    );
    expect(capturedHeaders['x-amz-security-token']).toBe('my-session-token');
  });

  it('line 142: text ?? "" fallback when content block has type=text but no text field', async () => {
    const mockResp = {
      output: { message: { content: [
        { type: 'text' },  // has type=text but no .text property → b.text = undefined → ?? '' = ''
      ] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResp }) as any;

    const adapter = new BedrockAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    );
    expect(resp.choices[0]!.message.content).toBe('');
  });

  it('chatCompletion — line 126 false: maxTokens=0 → no inferenceConfig', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.chatCompletion(
      { messages: [{ role: 'user', content: 'Hi' }], max_completion_tokens: 0, max_tokens: 0 } as any, baseModel,
    );
    expect(capturedBody['inferenceConfig']).toBeUndefined();
  });
});

// ── Event Stream helpers ──────────────────────────────────────────────────────

function makeEventFrame(eventType: string, payload: object): Buffer {
  const nameBytes  = Buffer.from(':event-type');
  const valueBytes = Buffer.from(eventType);
  // header = nameLen(1) + name + valueType(1, 7=string) + valueLen(2) + value
  const headerBuf  = Buffer.alloc(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  let pos = 0;
  headerBuf[pos++] = nameBytes.length;
  nameBytes.copy(headerBuf, pos); pos += nameBytes.length;
  headerBuf[pos++] = 7; // string
  headerBuf.writeUInt16BE(valueBytes.length, pos); pos += 2;
  valueBytes.copy(headerBuf, pos);

  const payloadBuf = Buffer.from(JSON.stringify(payload));
  // totalLen = prelude(8) + preludeCRC(4) + headers + payload + msgCRC(4)
  const totalLen   = 12 + headerBuf.length + payloadBuf.length + 4;
  const frame      = Buffer.alloc(totalLen, 0);
  frame.writeUInt32BE(totalLen, 0);
  frame.writeUInt32BE(headerBuf.length, 4);
  // offset 8 = prelude CRC — left as 0 (not verified)
  headerBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headerBuf.length);
  // offset totalLen-4 = message CRC — left as 0
  return frame;
}

function makeStreamBody(...frames: Buffer[]): ReadableStream<Uint8Array> {
  const all = Buffer.concat(frames);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(all);
      controller.close();
    },
  });
}

/** Frame with a different header name (no :event-type) — triggers line 220 skip */
function makeFrameNoEventType(payload: object): Buffer {
  const nameBytes  = Buffer.from(':other-header');
  const valueBytes = Buffer.from('something');
  const headerBuf  = Buffer.alloc(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  let pos = 0;
  headerBuf[pos++] = nameBytes.length;
  nameBytes.copy(headerBuf, pos); pos += nameBytes.length;
  headerBuf[pos++] = 7;
  headerBuf.writeUInt16BE(valueBytes.length, pos); pos += 2;
  valueBytes.copy(headerBuf, pos);

  const payloadBuf = Buffer.from(JSON.stringify(payload));
  const totalLen   = 12 + headerBuf.length + payloadBuf.length + 4;
  const frame      = Buffer.alloc(totalLen, 0);
  frame.writeUInt32BE(totalLen, 0);
  frame.writeUInt32BE(headerBuf.length, 4);
  headerBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headerBuf.length);
  return frame;
}

describe('BedrockAdapter streamCompletion', () => {
  it('yields text chunks from contentBlockDelta events', async () => {
    const body = makeStreamBody(
      makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'text', text: 'Hello' } }),
      makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'text', text: ' world' } }),
      makeEventFrame('messageStop', { stopReason: 'end_turn' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    const textChunks = chunks.filter(c => c.choices[0]?.delta?.content);
    expect(textChunks.map((c: any) => c.choices[0].delta.content).join('')).toBe('Hello world');
    const stopChunk = chunks.find(c => c.choices[0]?.finish_reason === 'stop');
    expect(stopChunk).toBeTruthy();
  });

  it('sets finish_reason to length when stopReason is max_tokens', async () => {
    const body = makeStreamBody(
      makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'text', text: 'hi' } }),
      makeEventFrame('messageStop', { stopReason: 'max_tokens' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    const stopChunk = chunks.find(c => c.choices[0]?.finish_reason);
    expect(stopChunk?.choices[0].finish_reason).toBe('length');
  });

  it('handles frames split across multiple read() calls', async () => {
    const frame = makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'text', text: 'ok' } });
    const stop  = makeEventFrame('messageStop', { stopReason: 'end_turn' });
    const all   = Buffer.concat([frame, stop]);
    const half  = Math.floor(all.length / 2);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(all.subarray(0, half));
        controller.enqueue(all.subarray(half));
        controller.close();
      },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    expect(chunks.some(c => c.choices[0]?.delta?.content === 'ok')).toBe(true);
  });

  it('throws on non-ok stream response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'Internal error',
    }) as any;

    const adapter = new BedrockAdapter();
    await expect(async () => {
      for await (const _ of adapter.streamCompletion(
        { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
      )) { /* drain */ }
    }).rejects.toThrow('Bedrock error 500');
  });

  it('hits the converse-stream URL for streaming', async () => {
    const body = makeStreamBody(makeEventFrame('messageStop', { stopReason: 'end_turn' }));
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url as string;
      return { ok: true, body };
    }) as any;

    const adapter = new BedrockAdapter();
    for await (const _ of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) { /* drain */ }

    expect(capturedUrl).toMatch(/\/converse-stream$/);
  });

  it('uses model ID without prefix when no slash', async () => {
    const body = makeStreamBody(makeEventFrame('messageStop', { stopReason: 'end_turn' }));
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url as string;
      return { ok: true, body };
    }) as any;

    const noSlashModel = { ...baseModel, id: 'anthropic.claude-3-5-sonnet-20241022-v2:0' };
    const adapter = new BedrockAdapter();
    for await (const _ of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, noSlashModel,
    )) { /* drain */ }

    expect(capturedUrl).toContain('anthropic.claude-3-5-sonnet-20241022-v2');
  });

  it('skips empty-text contentBlockDelta events (line 228 if-text branch)', async () => {
    // delta with no text → should not yield a content chunk
    const body = makeStreamBody(
      makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'text', text: '' } }),
      makeEventFrame('messageStop', { stopReason: 'end_turn' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    // Only the stop chunk should be present — no content chunk
    expect(chunks.every((c: any) => !c.choices[0]?.delta?.content)).toBe(true);
    expect(chunks.some((c: any) => c.choices[0]?.finish_reason)).toBe(true);
  });
});

describe('BedrockAdapter streamCompletion — edge cases', () => {
  it('skips frames with no :event-type header (line 220 true branch)', async () => {
    const body = makeStreamBody(
      makeFrameNoEventType({ ignored: true }),
      makeEventFrame('messageStop', { stopReason: 'end_turn' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    expect(chunks.some((c: any) => c.choices[0]?.finish_reason)).toBe(true);
    expect(chunks.every((c: any) => !c.choices[0]?.delta?.content)).toBe(true);
  });

  it('ignores unknown event types (line 232 false branch)', async () => {
    const body = makeStreamBody(
      makeEventFrame('response.done', { type: 'done' }), // neither contentBlockDelta nor messageStop
      makeEventFrame('messageStop', { stopReason: 'end_turn' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    expect(chunks.some((c: any) => c.choices[0]?.finish_reason === 'stop')).toBe(true);
  });

  it('covers delta with undefined text (line 227 ?? branch)', async () => {
    // delta without a 'text' property → delta?.['text'] is undefined → ?? '' → text = '' → not yielded
    const body = makeStreamBody(
      makeEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { type: 'image' } }), // no text
      makeEventFrame('messageStop', { stopReason: 'end_turn' }),
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any, baseModel,
    )) chunks.push(c);

    expect(chunks.every((c: any) => !c.choices[0]?.delta?.content)).toBe(true);
  });
});

describe('BedrockAdapter — messages with non-string content', () => {
  it('JSON-stringifies non-string message content (line 249 branch)', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 2 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.messages(
      {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }], // array content
        max_tokens: 50,
      } as any,
      baseModel,
    );

    const msgs = capturedBody['messages'] as { content: { text: string }[] }[];
    // Non-string content is JSON-stringified
    expect(typeof msgs[0]!.content[0]?.text).toBe('string');
  });
});

describe('BedrockAdapter streamCompletion — uncovered branches', () => {
  it('line 169 true: system message is added to stream body', async () => {
    // System message in request → system extracted → if (system) → added to body
    const body = makeStreamBody(makeEventFrame('messageStop', { stopReason: 'end_turn' }));
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, body };
    }) as any;

    const adapter = new BedrockAdapter();
    for await (const _ of adapter.streamCompletion(
      {
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hi' },
        ],
      } as any,
      baseModel,
    )) {}

    expect(capturedBody['system']).toBeDefined();
  });

  it('line 169 false: no system → system not added to body', async () => {
    // Request with no system → system is falsy → bedrockBody.system not set
    const body = makeStreamBody(makeEventFrame('messageStop', { stopReason: 'end_turn' }));
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, body };
    }) as any;

    const adapter = new BedrockAdapter();
    for await (const _ of adapter.streamCompletion(
      // no system_prompt field → system is undefined/falsy
      { messages: [{ role: 'user', content: 'Hi' }] } as any,
      baseModel,
    )) {}

    expect(capturedBody['system']).toBeUndefined();
  });

  it('line 170 false: maxTokens = 0 → inferenceConfig not added to body', async () => {
    // max_completion_tokens=0, max_tokens=0 → maxTokens=0 (falsy) → no inferenceConfig
    const body = makeStreamBody(makeEventFrame('messageStop', { stopReason: 'end_turn' }));
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, body };
    }) as any;

    const adapter = new BedrockAdapter();
    for await (const _ of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }], max_completion_tokens: 0, max_tokens: 0 } as any,
      baseModel,
    )) {}

    expect(capturedBody['inferenceConfig']).toBeUndefined();
  });

  it('line 181: throws when response body is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: null }) as any;

    const adapter = new BedrockAdapter();
    await expect(async () => {
      for await (const _ of adapter.streamCompletion(
        { messages: [{ role: 'user', content: 'Hi' }] } as any,
        baseModel,
      )) {}
    }).rejects.toThrow('Bedrock stream: response body is null');
  });

  it('parseHeaders: vtype !== 7 → header skipped (line 198 false branch)', async () => {
    // Build a frame with vtype=1 (not 7 — an integer type in EventStream format)
    // The header entry with vtype≠7 should be skipped without advancing pos incorrectly
    // Build header: nameLen(1) + name + vtype(1) → only 2 bytes for vtype=1 (no value follows in our simplified test)
    // We just need the parser to not crash and skip it; the :event-type header is absent → frame skipped via continue
    const headerBuf = Buffer.alloc(1 + 13 + 1); // nameLen=13, name=':non-string-h', vtype=1
    let pos = 0;
    const name = Buffer.from(':non-string-h'); // length 13
    headerBuf[pos++] = name.length;
    name.copy(headerBuf, pos); pos += name.length;
    headerBuf[pos++] = 1; // vtype=1 (boolean, not string) → if(vtype===7) is false → skip

    const payloadBuf = Buffer.from(JSON.stringify({ stopReason: 'end_turn' }));
    const totalLen = 12 + headerBuf.length + payloadBuf.length + 4;
    const frame = Buffer.alloc(totalLen, 0);
    frame.writeUInt32BE(totalLen, 0);
    frame.writeUInt32BE(headerBuf.length, 4);
    headerBuf.copy(frame, 12);
    payloadBuf.copy(frame, 12 + headerBuf.length);

    const stopFrame = makeEventFrame('messageStop', { stopReason: 'end_turn' });
    const streamBody = makeStreamBody(frame, stopFrame);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: streamBody }) as any;

    const adapter = new BedrockAdapter();
    const chunks: any[] = [];
    for await (const c of adapter.streamCompletion(
      { messages: [{ role: 'user', content: 'Hi' }] } as any,
      baseModel,
    )) chunks.push(c);

    // The vtype≠7 frame has no :event-type (since it was skipped) → continue
    // The stop frame should still yield the finish_reason chunk
    expect(chunks.some((c: any) => c.choices[0]?.finish_reason === 'stop')).toBe(true);
  });
});

describe('BedrockAdapter — messages', () => {
  it('converts Anthropic messages format and returns MessagesResponse', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'Hi from Bedrock' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 8, outputTokens: 4 },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResp,
    }) as any;

    const adapter = new BedrockAdapter();
    const result = await adapter.messages(
      {
        model: 'bedrock/anthropic.claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      } as any,
      baseModel,
    );

    expect(result).toHaveProperty('type', 'message');
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Hi from Bedrock' });
  });

  it('prepends system when present', async () => {
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 2 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.messages(
      {
        model: 'bedrock/claude',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'Be concise.',
        max_tokens: 50,
      } as any,
      baseModel,
    );

    expect((capturedBody['messages'] as { role: string }[])[0]?.role).toBe('user');
    expect(capturedBody['system']).toEqual([{ text: 'Be concise.' }]);
  });

  it('JSON.stringify system message content when not a string (line 79 inner cond-expr branch=1)', async () => {
    // typeof m.content !== 'string' → JSON.stringify(m.content) branch
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 3, outputTokens: 2 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.chatCompletion({
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Array system content' }] },
        { role: 'user', content: 'Hi' },
      ],
    } as any, baseModel);

    // System message had array content → JSON.stringify used
    const sys = capturedBody['system'] as Array<{ text: string }>;
    expect(sys[0]!.text).toContain('Array system content');
  });

  it('JSON.stringify conv message content when not a string (line 86 cond-expr branch=1)', async () => {
    // typeof m.content !== 'string' for non-system message → JSON.stringify branch
    const mockResp = {
      output: { message: { content: [{ type: 'text', text: 'ok' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 3, outputTokens: 2 },
    };
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => mockResp };
    }) as any;

    const adapter = new BedrockAdapter();
    await adapter.chatCompletion({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    } as any, baseModel);

    const msgs = capturedBody['messages'] as Array<{ role: string; content: Array<{ text: string }> }>;
    // Array content → JSON.stringify → text contains JSON representation
    expect(msgs[0]!.content[0]!.text).toContain('hello');
  });
});
