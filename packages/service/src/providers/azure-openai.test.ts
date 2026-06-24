import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ModelConfig } from '@routerly/shared';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1234567890,
  model: 'gpt-4o',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const mockConstructorArgs: Record<string, unknown>[] = [];

vi.mock('openai', () => {
  function MockOpenAI(opts: Record<string, unknown>) {
    mockConstructorArgs.push(opts);
    return {
      chat: { completions: { create: mockCreate } },
    };
  }
  // Make it behave like a class (callable with new)
  MockOpenAI.prototype = {};
  return { default: MockOpenAI };
});

afterEach(() => {
  vi.clearAllMocks();
  mockConstructorArgs.length = 0;
});

const baseModel: ModelConfig = {
  id: 'azure-openai/gpt-4o',
  name: 'Azure GPT-4o',
  provider: 'azure-openai',
  endpoint: '',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
  azureResourceName: 'myresource',
  azureDeploymentId: 'gpt-4o-deploy',
  apiKey: 'az-key-123',
};

describe('AzureOpenAIAdapter', () => {
  it('builds client with correct Azure baseURL', async () => {
    const { AzureOpenAIAdapter } = await import('./azure-openai.js');
    const adapter = new AzureOpenAIAdapter();

    await adapter.chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    );

    expect(mockConstructorArgs.length).toBeGreaterThan(0);
    const callArg = mockConstructorArgs[0]!;
    expect(callArg.baseURL).toBe('https://myresource.openai.azure.com/openai/deployments/gpt-4o-deploy');
    expect(callArg.apiKey).toBe('az-key-123');
    expect((callArg.defaultHeaders as Record<string, string>)['api-key']).toBe('az-key-123');
    expect((callArg.defaultQuery as Record<string, string>)['api-version']).toBe('2024-02-01');
  });

  it('uses custom azureApiVersion when set', async () => {
    const { AzureOpenAIAdapter } = await import('./azure-openai.js');
    const adapter = new AzureOpenAIAdapter();
    const model = { ...baseModel, azureApiVersion: '2025-01-01' };

    await adapter.chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hi' }] } as any,
      model,
    );

    const callArg = mockConstructorArgs[0]!;
    expect((callArg.defaultQuery as Record<string, string>)['api-version']).toBe('2025-01-01');
  });

  it('chatCompletion returns a response', async () => {
    const { AzureOpenAIAdapter } = await import('./azure-openai.js');
    const adapter = new AzureOpenAIAdapter();
    const resp = await adapter.chatCompletion(
      { messages: [{ role: 'user' as const, content: 'Hello' }] } as any,
      baseModel,
    );
    expect(resp.choices[0]!.message.content).toBe('Hello');
    expect(resp.object).toBe('chat.completion');
  });
});
