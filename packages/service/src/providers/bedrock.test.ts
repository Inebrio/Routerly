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
});
