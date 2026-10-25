import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { ChatCompletionRequest, ModelConfig, StreamChunk } from '@routerly/shared';
// @ts-expect-error plain ESM tool, no typings
import { startMocks } from '../tools/provider-mocks/index.mjs';
import { AnthropicWebAdapter } from '../packages/service/src/modules/provider/anthropic-web.js';
import { OpenAIWebAdapter } from '../packages/service/src/modules/provider/openai-web.js';
import { AzureOpenAIAdapter } from '../packages/service/src/modules/provider/azure-openai.js';
import { BedrockAdapter } from '../packages/service/src/modules/provider/bedrock.js';
import { VertexAdapter } from '../packages/service/src/modules/provider/vertex.js';
import type { ProviderAdapter } from '../packages/service/src/modules/provider/types.js';

const TEXT = 'Hello from the provider mock';
const req: ChatCompletionRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

let mocks: { url: string; close: () => Promise<void>; requests: Array<{ path: string }> };
beforeAll(async () => { mocks = await startMocks(); });
afterAll(async () => { await mocks.close(); });
beforeEach(() => { mocks.requests.length = 0; });

type Case = { name: string; adapter: ProviderAdapter; model: (cred: string) => ModelConfig };
const base = { cost: { inputPerMillion: 0, outputPerMillion: 0 } };
const cases: Case[] = [
  { name: 'anthropic-web', adapter: new AnthropicWebAdapter(),
    model: c => ({ ...base, id: 'anthropic-web/claude-mock', name: 'x', provider: 'anthropic-web', endpoint: mocks.url, apiKey: c }) as ModelConfig },
  { name: 'openai-web', adapter: new OpenAIWebAdapter(),
    model: c => ({ ...base, id: 'openai-web/gpt-mock', name: 'x', provider: 'openai-web', endpoint: mocks.url, apiKey: c }) as ModelConfig },
  { name: 'azure-openai', adapter: new AzureOpenAIAdapter(),
    model: c => ({ ...base, id: 'azure-openai/gpt', name: 'x', provider: 'azure-openai', endpoint: mocks.url, apiKey: c, azureResourceName: 'r', azureDeploymentId: 'dep', azureApiVersion: '2024-10-21' }) as ModelConfig },
  { name: 'bedrock', adapter: new BedrockAdapter(),
    model: c => ({ ...base, id: 'bedrock/anthropic.claude-mock-v1:0', name: 'x', provider: 'bedrock', endpoint: mocks.url, awsAccessKeyId: c, awsSecretAccessKey: 's', awsRegion: 'eu-west-1' }) as ModelConfig },
  { name: 'vertex', adapter: new VertexAdapter(),
    model: c => ({ ...base, id: 'vertex/google/gemini-mock', name: 'x', provider: 'vertex', endpoint: mocks.url, apiKey: c, vertexProjectId: 'p', vertexLocation: 'europe-west1' }) as ModelConfig },
];

async function collect(it: AsyncIterable<StreamChunk>): Promise<string> {
  let out = '';
  for await (const c of it) out += (c.choices[0]?.delta?.content as string | undefined) ?? '';
  return out;
}

describe.each(cases)('provider mock: $name', ({ adapter, model }) => {
  it('non-stream returns the canned reply', async () => {
    const r = await adapter.chatCompletion(req, model('mock-ok'));
    expect(r.choices[0]!.message.content).toBe(TEXT);
  });

  it('stream returns the canned reply in several chunks', async () => {
    expect(await collect(adapter.streamCompletion(req, model('mock-ok')))).toBe(TEXT);
  });

  it('401 for a credential that is not a mock one', async () => {
    await expect(adapter.chatCompletion(req, model('sk-real-looking'))).rejects.toThrow(/401|403|auth|key|token|security/i);
  });

  it('rate limit (429) surfaces as an error', async () => {
    await expect(adapter.chatCompletion(req, model('mock-429'))).rejects.toThrow(/429/);
  });

  it('interrupted stream (mock-cut) fails or ends early, never the full reply', async () => {
    const got = await collect(adapter.streamCompletion(req, model('mock-cut'))).catch(() => '<error>');
    expect(got).not.toBe(TEXT);
  });
});

describe('provider mock: web-specific errors', () => {
  it('claude.ai 429 carries Retry-After', async () => {
    const [{ adapter, model }] = cases;
    await expect(adapter.chatCompletion(req, model('mock-429'))).rejects.toThrow(/429.*retry after 30s/s);
  });

  it('chatgpt.com 403 is the Cloudflare challenge page', async () => {
    const { adapter, model } = cases[1]!;
    await expect(adapter.chatCompletion(req, model('mock-403'))).rejects.toThrow(/403.*Cloudflare/s);
  });

  it('claude.ai conversation is deleted after the call', async () => {
    const { adapter, model } = cases[0]!;
    await adapter.chatCompletion(req, model('mock-ok'));
    const raw = await (await fetch(`${mocks.url}/__mock/requests`)).json() as Array<{ method: string }>;
    expect(raw.map(r => r.method)).toContain('DELETE');
  });
});

describe('provider mock: cloud-specific errors', () => {
  it('bedrock 403 AccessDenied and 429 Throttling', async () => {
    const { adapter, model } = cases[3]!;
    await expect(adapter.chatCompletion(req, model('mock-403'))).rejects.toThrow(/AccessDenied|access to the model/);
    await expect(adapter.chatCompletion(req, model('mock-429'))).rejects.toThrow(/Throttl|Too many/);
  });

  it('request secrets are masked in the request log', async () => {
    const { adapter, model } = cases[2]!;
    await adapter.chatCompletion(req, model('mock-secret-value-123'));
    const raw = JSON.stringify(await (await fetch(`${mocks.url}/__mock/requests`)).json());
    expect(raw).not.toContain('mock-secret-value-123');
  });
});

describe('adapters honour the connection endpoint only when set', () => {
  it('azure: default host without endpoint', () => {
    const client = (new AzureOpenAIAdapter() as unknown as { getClient(m: ModelConfig): { baseURL: string } })
      .getClient({ ...cases[2]!.model('k'), endpoint: '' });
    expect(client.baseURL).toBe('https://r.openai.azure.com/openai/deployments/dep');
  });

  it('bedrock: default host without endpoint', () => {
    const url = (new BedrockAdapter() as unknown as { buildUrl(m: ModelConfig, s: boolean): string })
      .buildUrl({ ...cases[3]!.model('k'), endpoint: '' }, false);
    expect(url).toBe('https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-mock-v1%3A0/converse');
  });

  it('requests reach the mock paths', async () => {
    await cases[3]!.adapter.chatCompletion(req, cases[3]!.model('mock-ok'));
    await cases[4]!.adapter.chatCompletion(req, cases[4]!.model('mock-ok'));
    const paths = mocks.requests.map(r => r.path);
    expect(paths).toContain('/model/anthropic.claude-mock-v1%3A0/converse');
    expect(paths).toContain('/v1beta1/projects/p/locations/europe-west1/endpoints/openapi/chat/completions');
  });
});
