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
