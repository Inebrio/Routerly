import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: mockApi,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'test@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makeModelCommand } from './model.js';
import { ApiError } from '../api.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCmd() {
  const cmd = makeModelCommand();
  cmd.exitOverride();
  return cmd;
}

async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy   = vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.map(String).join(' ')); });
  const errSpy   = vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.map(String).join(' ')); });
  const exitSpy  = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
  try {
    await makeCmd().parseAsync(['node', 'model', ...args]);
  } catch {
    // swallow commander exits and process.exit throws
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { out, err };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const baseModel = {
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
};

const fullModel = {
  ...baseModel,
  contextWindow: 128_000,
  capabilities: { vision: true, functionCalling: true, streaming: false },
  cost: {
    inputPerMillion: 5,
    outputPerMillion: 15,
    cachePerMillion: 0.5,
    cacheWritePerMillion: 1,
  },
  catalogDefaults: { inputPerMillion: 5, outputPerMillion: 15 },
  fieldOverrides: { inputPerMillion: true, outputPerMillion: false },
};

const catalogFixture = [
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', contextWindow: 128000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 }, isConfigured: true },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Claude Sonnet 4.5', contextWindow: 200000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 }, isConfigured: false },
  { id: 'llama3', provider: 'ollama', name: 'Llama 3', contextWindow: 8192, modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, local: true, isConfigured: false },
];

// ── model list ────────────────────────────────────────────────────────────────

describe('routerly model list', () => {
  it('prints a table of models', async () => {
    mockApi.mockResolvedValue([baseModel]);
    const { out } = await run('list');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/models');
    expect(out.join('\n')).toContain('gpt-4o');
    expect(out.join('\n')).toContain('openai');
  });

  it('prints empty message when no models', async () => {
    mockApi.mockResolvedValue([]);
    const { out } = await run('list');
    expect(out.join(' ')).toContain('No models registered yet');
  });

  it('shows catalog label for model with catalogDefaults', async () => {
    mockApi.mockResolvedValue([{ ...baseModel, catalogDefaults: { inputPerMillion: 5 } }]);
    const { out } = await run('list');
    expect(out.join('\n')).toContain('catalog');
  });

  it('shows partial override label when fieldOverrides has a truthy value', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      catalogDefaults: { inputPerMillion: 5 },
      fieldOverrides: { inputPerMillion: true },
    }]);
    const { out } = await run('list');
    expect(out.join('\n')).toContain('partial override');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('network error'));
    const { err } = await run('list');
    expect(err.join(' ')).toContain('network error');
  });
});

// ── model show ────────────────────────────────────────────────────────────────

describe('routerly model show', () => {
  it('prints detail view for a model', async () => {
    mockApi.mockResolvedValue([baseModel]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('gpt-4o');
    expect(out.join('\n')).toContain('openai');
    expect(out.join('\n')).toContain('Pricing');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue([baseModel]);
    const { out } = await run('show', 'gpt-4o', '--json');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.id).toBe('gpt-4o');
    expect(parsed.provider).toBe('openai');
  });

  it('exits 1 when model not found', async () => {
    mockApi.mockResolvedValue([baseModel]);
    const { err } = await run('show', 'nonexistent');
    expect(err.join(' ')).toContain('not found');
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const { err } = await run('show', 'gpt-4o');
    expect(err.join(' ')).toContain('boom');
  });

  it('shows contextWindow when present', async () => {
    mockApi.mockResolvedValue([{ ...baseModel, contextWindow: 128000 }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('128');
  });

  it('shows capabilities when present', async () => {
    mockApi.mockResolvedValue([{ ...baseModel, capabilities: { vision: true, functionCalling: false } }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('vision');
  });

  it('does not crash when capabilities object has no truthy values', async () => {
    mockApi.mockResolvedValue([{ ...baseModel, capabilities: { vision: false } }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('gpt-4o');
  });

  it('shows cache pricing when present', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.5, cacheWritePerMillion: 1 },
    }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('Cache read');
    expect(out.join('\n')).toContain('Cache write');
  });

  it('shows overridden fields with catalog default dollar values for pricing fields', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      catalogDefaults: { inputPerMillion: 5, outputPerMillion: 15 },
      fieldOverrides: { inputPerMillion: true, outputPerMillion: true },
    }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('Override');
    expect(out.join('\n')).toContain('catalog default');
    expect(out.join('\n')).toContain('$5');
  });

  it('shows override without a catalog default value when catalogDefaults lacks the field', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      catalogDefaults: {},
      fieldOverrides: { inputPerMillion: true },
    }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('Override');
  });

  it('shows non-pricing overridden field (e.g. contextWindow) as plain string', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      catalogDefaults: { contextWindow: 128000 },
      fieldOverrides: { contextWindow: true },
    }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('Override');
    expect(out.join('\n')).toContain('128000');
  });

  it('shows auto-synced label when catalogDefaults present but no overrides', async () => {
    mockApi.mockResolvedValue([{
      ...baseModel,
      catalogDefaults: { inputPerMillion: 5 },
      fieldOverrides: {},
    }]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('auto-synced');
  });

  it('shows no catalog tracking when neither catalogDefaults nor fieldOverrides present', async () => {
    mockApi.mockResolvedValue([baseModel]);
    const { out } = await run('show', 'gpt-4o');
    expect(out.join('\n')).toContain('no catalog tracking');
  });
});

// ── model add ─────────────────────────────────────────────────────────────────

describe('routerly model add', () => {
  it('registers a model with minimal flags', async () => {
    mockApi.mockResolvedValue(baseModel);
    const { out } = await run('add', '--id', 'gpt-4o', '--provider', 'openai');
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/models', expect.objectContaining({ id: 'gpt-4o', provider: 'openai' }));
    expect(out.join(' ')).toContain('registered');
  });

  it('uses preset pricing when id matches known preset', async () => {
    mockApi.mockResolvedValue(baseModel);
    const { out } = await run('add', '--id', 'gpt-4o', '--provider', 'openai');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const cost = body['cost'] as { inputPerMillion: number; outputPerMillion: number };
    expect(cost.inputPerMillion).toBe(5);
    expect(cost.outputPerMillion).toBe(15);
    expect(out.join(' ')).toContain('pricing from preset');
  });

  it('does not show preset note for unknown model id', async () => {
    mockApi.mockResolvedValue({});
    const { out } = await run('add', '--id', 'my-custom-model', '--provider', 'custom', '--input-price', '1', '--output-price', '3');
    expect(out.join(' ')).not.toContain('preset');
  });

  it('uses explicit --input-price and --output-price over preset', async () => {
    mockApi.mockResolvedValue(baseModel);
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--input-price', '2.5', '--output-price', '10');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const cost = body['cost'] as { inputPerMillion: number; outputPerMillion: number };
    expect(cost.inputPerMillion).toBe(2.5);
    expect(cost.outputPerMillion).toBe(10);
  });

  it('uses provider default endpoint for openai', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gpt-4o', '--provider', 'openai');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toBe('https://api.openai.com/v1');
  });

  it('uses provider default endpoint for anthropic', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'claude-3-opus', '--provider', 'anthropic', '--api-key', 'sk-ant');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toBe('https://api.anthropic.com');
  });

  it('uses provider default endpoint for anthropic-oauth', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'claude-model', '--provider', 'anthropic-oauth');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toBe('https://api.anthropic.com');
  });

  it('uses provider default endpoint for gemini', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gemini-pro', '--provider', 'gemini');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toContain('googleapis.com');
  });

  it('uses provider default endpoint for ollama', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'llama3', '--provider', 'ollama', '--input-price', '0', '--output-price', '0');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toContain('11434');
  });

  it('uses custom --endpoint when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-model', '--provider', 'custom', '--endpoint', 'https://custom.example.com/v1');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['endpoint']).toBe('https://custom.example.com/v1');
  });

  it('sends --api-key when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--api-key', 'sk-test-key');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['apiKey']).toBe('sk-test-key');
  });

  it('adds daily budget as a limit', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--daily-budget', '10');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const limits = body['limits'] as Array<{ period: string; value: number }>;
    expect(limits).toEqual(expect.arrayContaining([expect.objectContaining({ period: 'daily', value: 10 })]));
  });

  it('adds monthly budget as a limit', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--monthly-budget', '100');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const limits = body['limits'] as Array<{ period: string; value: number }>;
    expect(limits).toEqual(expect.arrayContaining([expect.objectContaining({ period: 'monthly', value: 100 })]));
  });

  it('adds both daily and monthly budgets together', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--daily-budget', '10', '--monthly-budget', '100');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const limits = body['limits'] as unknown[];
    expect(limits).toHaveLength(2);
  });

  it('parses --limits-json and includes in body', async () => {
    mockApi.mockResolvedValue({});
    const limitsJson = JSON.stringify([{ metric: 'calls', windowType: 'rolling', rollingAmount: 1, rollingUnit: 'minute', value: 60 }]);
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--limits-json', limitsJson);
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['limits']).toHaveLength(1);
  });

  it('exits 1 when --limits-json is invalid JSON', async () => {
    const { err } = await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--limits-json', 'not-json');
    expect(err.join(' ')).toContain('invalid JSON');
  });

  it('parses --pricing-tiers-json and attaches to cost', async () => {
    mockApi.mockResolvedValue({});
    const tiers = JSON.stringify([{ metric: 'context_tokens', above: 200000, inputPerMillion: 7.5, outputPerMillion: 22.5 }]);
    await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--pricing-tiers-json', tiers);
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const cost = body['cost'] as { pricingTiers?: unknown[] };
    expect(cost.pricingTiers).toHaveLength(1);
  });

  it('exits 1 when --pricing-tiers-json is invalid JSON', async () => {
    const { err } = await run('add', '--id', 'gpt-4o', '--provider', 'openai', '--pricing-tiers-json', '{bad}');
    expect(err.join(' ')).toContain('invalid JSON');
  });

  it('exits 1 with 409 conflict error', async () => {
    mockApi.mockRejectedValue(new ApiError(409, 'Conflict'));
    const { err } = await run('add', '--id', 'gpt-4o', '--provider', 'openai');
    expect(err.join(' ')).toContain('already exists');
  });

  it('exits 1 with generic error', async () => {
    mockApi.mockRejectedValue(new Error('server error'));
    const { err } = await run('add', '--id', 'gpt-4o', '--provider', 'openai');
    expect(err.join(' ')).toContain('server error');
  });

  it('sends azure fields when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-azure-model', '--provider', 'azure-openai', '--azure-resource', 'my-resource', '--azure-deployment', 'dep-123', '--azure-api-version', '2024-05-01');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['azureResourceName']).toBe('my-resource');
    expect(body['azureDeploymentId']).toBe('dep-123');
    expect(body['azureApiVersion']).toBe('2024-05-01');
  });

  it('sends aws fields when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-bedrock', '--provider', 'bedrock', '--aws-region', 'us-east-1', '--aws-key-id', 'AKID', '--aws-secret', 'secret');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['awsRegion']).toBe('us-east-1');
    expect(body['awsAccessKeyId']).toBe('AKID');
    expect(body['awsSecretAccessKey']).toBe('secret');
  });

  it('sends vertex fields when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-vertex', '--provider', 'vertex', '--vertex-project', 'my-gcp', '--vertex-location', 'us-central1');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['vertexProjectId']).toBe('my-gcp');
    expect(body['vertexLocation']).toBe('us-central1');
  });

  it('exits 1 when SA key file cannot be read', async () => {
    const { err } = await run('add', '--id', 'v', '--provider', 'vertex', '--vertex-sa-key', '/nonexistent/path.json');
    expect(err.join(' ')).toContain('Cannot read service account key file');
  });

  it('sends cf-clearance when provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'chatgpt-web', '--provider', 'openai', '--cf-clearance', 'cf-token-123');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['cfClearance']).toBe('cf-token-123');
  });

  it('does not include limits key when neither budget nor limits-json provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-model', '--provider', 'custom');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('limits');
  });

  it('does not include cost.pricingTiers when pricingTiersJson not provided', async () => {
    mockApi.mockResolvedValue({});
    await run('add', '--id', 'my-model', '--provider', 'custom');
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const cost = body['cost'] as { pricingTiers?: unknown };
    expect(cost.pricingTiers).toBeUndefined();
  });

  it('reads SA key file content when vertex-sa-key is a real file', async () => {
    const { writeFile, unlink, mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const os = await import('node:os');
    const dir = await mkdtemp(join(os.tmpdir(), 'model-test-'));
    const keyPath = join(dir, 'sa.json');
    const keyContent = JSON.stringify({ type: 'service_account', project_id: 'my-gcp' });
    await writeFile(keyPath, keyContent);

    mockApi.mockResolvedValue({});
    await run('add', '--id', 'v', '--provider', 'vertex', '--vertex-sa-key', keyPath);
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['vertexServiceAccountKey']).toBe(keyContent);

    await unlink(keyPath);
  });
});

// ── model remove ──────────────────────────────────────────────────────────────

describe('routerly model remove', () => {
  it('removes a model by id', async () => {
    mockApi.mockResolvedValue(undefined);
    const { out } = await run('remove', 'gpt-4o');
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/models/gpt-4o');
    expect(out.join(' ')).toContain('removed');
  });

  it('URL-encodes the model id in the path', async () => {
    mockApi.mockResolvedValue(undefined);
    await run('remove', 'model/with spaces');
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/models/model%2Fwith%20spaces');
  });

  it('exits 1 with 404 error', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'Not Found'));
    const { err } = await run('remove', 'nonexistent');
    expect(err.join(' ')).toContain('not found');
  });

  it('exits 1 with generic error', async () => {
    mockApi.mockRejectedValue(new Error('server error'));
    const { err } = await run('remove', 'gpt-4o');
    expect(err.join(' ')).toContain('server error');
  });
});

// ── model edit ────────────────────────────────────────────────────────────────

describe('routerly model edit', () => {
  it('updates a model successfully', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce(baseModel);
    const { out } = await run('edit', 'gpt-4o', '--input-price', '3.0');
    expect(mockApi).toHaveBeenCalledWith('PUT', `/api/models/${encodeURIComponent('gpt-4o')}`, expect.any(Object));
    expect(out.join(' ')).toContain('updated');
  });

  it('shows original id in success message when no --new-id', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce(baseModel);
    const { out } = await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    expect(out.join(' ')).toContain('gpt-4o');
    expect(out.join(' ')).toContain('updated');
  });

  it('shows new id in success message when --new-id provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    const { out } = await run('edit', 'gpt-4o', '--new-id', 'gpt-4o-v2');
    expect(out.join(' ')).toContain('gpt-4o-v2');
  });

  it('exits 1 when model not found in list', async () => {
    mockApi.mockResolvedValueOnce([baseModel]);
    const { err } = await run('edit', 'nonexistent');
    expect(err.join(' ')).toContain('not found');
  });

  it('exits 1 on API error fetching models', async () => {
    mockApi.mockRejectedValueOnce(new Error('fetch error'));
    const { err } = await run('edit', 'gpt-4o');
    expect(err.join(' ')).toContain('fetch error');
  });

  it('exits 1 with 404 on PUT', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    const { err } = await run('edit', 'gpt-4o', '--input-price', '3');
    expect(err.join(' ')).toContain('not found');
  });

  it('exits 1 with 409 on PUT (id conflict)', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockRejectedValueOnce(new ApiError(409, 'Conflict'));
    const { err } = await run('edit', 'gpt-4o', '--new-id', 'existing-model');
    expect(err.join(' ')).toContain('already exists');
  });

  it('exits 1 with generic error on PUT', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockRejectedValueOnce(new Error('server down'));
    const { err } = await run('edit', 'gpt-4o', '--input-price', '3');
    expect(err.join(' ')).toContain('server down');
  });

  it('preserves existing input/output price when not provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { inputPerMillion: number; outputPerMillion: number };
    expect(cost.inputPerMillion).toBe(5);
    expect(cost.outputPerMillion).toBe(15);
  });

  it('sends updated input price when --input-price provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--input-price', '2.5');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { inputPerMillion: number };
    expect(cost.inputPerMillion).toBe(2.5);
  });

  it('sends cache price when --cache-price provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--cache-price', '0.5');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { cachePerMillion?: number };
    expect(cost.cachePerMillion).toBe(0.5);
  });

  it('preserves existing cache price when not provided and existing has it', async () => {
    mockApi.mockResolvedValueOnce([{
      ...baseModel,
      cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.5 },
    }]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--output-price', '20');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { cachePerMillion?: number };
    expect(cost.cachePerMillion).toBe(0.5);
  });

  it('sends context window when --context-window provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--context-window', '200000');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['contextWindow']).toBe(200000);
  });

  it('sends provider when --provider provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--provider', 'anthropic');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['provider']).toBe('anthropic');
  });

  it('preserves existing provider when not provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['provider']).toBe('openai');
  });

  it('sends endpoint when --endpoint provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--endpoint', 'https://new.example.com/v1');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['endpoint']).toBe('https://new.example.com/v1');
  });

  it('sends new-id in body when --new-id provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--new-id', 'gpt-4o-v2');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['id']).toBe('gpt-4o-v2');
  });

  it('sends api key in body when --api-key provided', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new-key');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['apiKey']).toBe('sk-new-key');
  });

  it('parses --limits-json and includes in body', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    const limitsJson = JSON.stringify([{ metric: 'cost', windowType: 'period', period: 'monthly', value: 200 }]);
    await run('edit', 'gpt-4o', '--limits-json', limitsJson);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody['limits']).toHaveLength(1);
  });

  it('exits 1 when --limits-json is invalid JSON', async () => {
    mockApi.mockResolvedValueOnce([baseModel]);
    const { err } = await run('edit', 'gpt-4o', '--limits-json', '{invalid}');
    expect(err.join(' ')).toContain('invalid JSON');
  });

  it('parses --pricing-tiers-json and includes in cost', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    const tiers = JSON.stringify([{ metric: 'context_tokens', above: 100000, inputPerMillion: 7.5, outputPerMillion: 22.5 }]);
    await run('edit', 'gpt-4o', '--pricing-tiers-json', tiers);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { pricingTiers?: unknown[] };
    expect(cost.pricingTiers).toHaveLength(1);
  });

  it('exits 1 when --pricing-tiers-json is invalid JSON', async () => {
    mockApi.mockResolvedValueOnce([baseModel]);
    const { err } = await run('edit', 'gpt-4o', '--pricing-tiers-json', 'bad');
    expect(err.join(' ')).toContain('invalid JSON');
  });

  it('preserves existing pricingTiers when not provided', async () => {
    const existingTiers = [{ metric: 'context_tokens', above: 200000, inputPerMillion: 7.5, outputPerMillion: 22.5 }];
    mockApi.mockResolvedValueOnce([{
      ...baseModel,
      cost: { inputPerMillion: 5, outputPerMillion: 15, pricingTiers: existingTiers },
    }]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { pricingTiers?: unknown[] };
    expect(cost.pricingTiers).toHaveLength(1);
  });

  it('sends undefined limits when not provided (no limits key)', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    expect(putBody).not.toHaveProperty('limits');
  });

  it('falls back to 0 for inputPerMillion/outputPerMillion when existing.cost is missing (lines 482-483)', async () => {
    // A model with no cost field to hit the ?? 0 branches
    const noCostModel = { id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', endpoint: 'https://api.openai.com/v1' };
    mockApi.mockResolvedValueOnce([noCostModel]).mockResolvedValueOnce({});
    await run('edit', 'gpt-4o', '--api-key', 'sk-new');
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { inputPerMillion: number; outputPerMillion: number };
    expect(cost.inputPerMillion).toBe(0);
    expect(cost.outputPerMillion).toBe(0);
  });

  it('URL-encodes the model id in the PUT path', async () => {
    const encodedModel = { ...baseModel, id: 'model/v2', endpoint: 'https://api.openai.com/v1' };
    mockApi.mockResolvedValueOnce([encodedModel]).mockResolvedValueOnce({});
    await run('edit', 'model/v2', '--api-key', 'sk-new');
    expect(mockApi).toHaveBeenCalledWith('PUT', '/api/models/model%2Fv2', expect.any(Object));
  });
});

// ── model edit --interactive (promptLimits + promptPricingTiers) ──────────────

describe('routerly model edit --interactive', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs promptLimits and promptPricingTiers via wizard (done immediately)', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // promptLimits: action = done
          .mockResolvedValueOnce({ action: 'done' })
          // promptPricingTiers: action = done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    expect(mockApi).toHaveBeenCalledWith('PUT', expect.stringContaining('gpt-4o'), expect.any(Object));
    vi.doUnmock('inquirer');
  });

  it('promptLimits: add period limit then done', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // promptLimits: action = add
          .mockResolvedValueOnce({ action: 'add' })
          // metric + windowType
          .mockResolvedValueOnce({ metric: 'cost', windowType: 'period' })
          // period
          .mockResolvedValueOnce({ period: 'monthly' })
          // value
          .mockResolvedValueOnce({ value: '100' })
          // action = done
          .mockResolvedValueOnce({ action: 'done' })
          // promptPricingTiers: action = done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const limits = putBody['limits'] as Array<{ period: string; value: number }>;
    expect(limits).toEqual(expect.arrayContaining([expect.objectContaining({ period: 'monthly', value: 100 })]));
    vi.doUnmock('inquirer');
  });

  it('promptLimits: add rolling limit then done', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // add
          .mockResolvedValueOnce({ action: 'add' })
          // metric + windowType = rolling
          .mockResolvedValueOnce({ metric: 'calls', windowType: 'rolling' })
          // rollingAmount + rollingUnit + value
          .mockResolvedValueOnce({ rollingAmount: '1', rollingUnit: 'minute', value: '60' })
          // done
          .mockResolvedValueOnce({ action: 'done' })
          // pricing tiers done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const limits = putBody['limits'] as Array<{ rollingUnit: string; value: number }>;
    expect(limits).toEqual(expect.arrayContaining([expect.objectContaining({ rollingUnit: 'minute', value: 60 })]));
    vi.doUnmock('inquirer');
  });

  it('promptLimits: add then remove limit then done', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // add
          .mockResolvedValueOnce({ action: 'add' })
          // metric + windowType = period
          .mockResolvedValueOnce({ metric: 'cost', windowType: 'period' })
          // period
          .mockResolvedValueOnce({ period: 'daily' })
          // value
          .mockResolvedValueOnce({ value: '50' })
          // remove
          .mockResolvedValueOnce({ action: 'remove' })
          // which to remove
          .mockResolvedValueOnce({ idx: 0 })
          // done
          .mockResolvedValueOnce({ action: 'done' })
          // pricing tiers done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const limits = putBody['limits'] as unknown[];
    expect(limits).toHaveLength(0);
    vi.doUnmock('inquirer');
  });

  it('promptLimits: remove choices label uses rolling branch (line 36)', async () => {
    // Add a rolling limit, then remove it — the choices map hits the rolling branch for the label
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // add rolling limit
          .mockResolvedValueOnce({ action: 'add' })
          .mockResolvedValueOnce({ metric: 'calls', windowType: 'rolling' })
          .mockResolvedValueOnce({ rollingAmount: '5', rollingUnit: 'minute', value: '100' })
          // remove it (choices mapping hits rolling branch)
          .mockResolvedValueOnce({ action: 'remove' })
          .mockResolvedValueOnce({ idx: 0 })
          // done
          .mockResolvedValueOnce({ action: 'done' })
          // pricing tiers done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const limits = putBody['limits'] as unknown[];
    expect(limits).toHaveLength(0);
    vi.doUnmock('inquirer');
  });

  it('promptPricingTiers: add tier then done', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // limits done
          .mockResolvedValueOnce({ action: 'done' })
          // tiers: add
          .mockResolvedValueOnce({ action: 'add' })
          // tier details
          .mockResolvedValueOnce({ metric: 'context_tokens', above: '200000', inputPerMillion: '7.5', outputPerMillion: '22.5' })
          // done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { pricingTiers?: unknown[] };
    expect(cost.pricingTiers).toHaveLength(1);
    vi.doUnmock('inquirer');
  });

  it('promptPricingTiers: add then remove tier then done', async () => {
    mockApi.mockResolvedValueOnce([baseModel]).mockResolvedValueOnce({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // limits done
          .mockResolvedValueOnce({ action: 'done' })
          // tiers: add
          .mockResolvedValueOnce({ action: 'add' })
          // tier details
          .mockResolvedValueOnce({ metric: 'context_tokens', above: '100000', inputPerMillion: '6', outputPerMillion: '18' })
          // remove
          .mockResolvedValueOnce({ action: 'remove' })
          // which to remove
          .mockResolvedValueOnce({ idx: 0 })
          // done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'edit', 'gpt-4o', '--interactive']);
    const putBody = mockApi.mock.calls[1]![2] as Record<string, unknown>;
    const cost = putBody['cost'] as { pricingTiers?: unknown[] };
    // empty array → pricingTiers key omitted because tiers.length is 0
    expect(cost.pricingTiers).toBeUndefined();
    vi.doUnmock('inquirer');
  });
});

// ── model add --interactive ───────────────────────────────────────────────────

describe('routerly model add --interactive', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs promptLimits and promptPricingTiers (both done immediately)', async () => {
    mockApi.mockResolvedValue({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // limits done
          .mockResolvedValueOnce({ action: 'done' })
          // tiers done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/models', expect.any(Object));
    vi.doUnmock('inquirer');
  });

  it('promptLimits: add period limit then done', async () => {
    mockApi.mockResolvedValue({});
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ action: 'add' })
          .mockResolvedValueOnce({ metric: 'cost', windowType: 'period' })
          .mockResolvedValueOnce({ period: 'weekly' })
          .mockResolvedValueOnce({ value: '20' })
          .mockResolvedValueOnce({ action: 'done' })
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    const limits = body['limits'] as Array<{ period: string; value: number }>;
    expect(limits).toHaveLength(1);
    expect(limits[0]!.period).toBe('weekly');
    vi.doUnmock('inquirer');
  });

  it('promptLimits validate: rejects non-number value for period limit', async () => {
    mockApi.mockResolvedValue({});
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ action: 'add' })
          .mockResolvedValueOnce({ metric: 'cost', windowType: 'period' })
          .mockResolvedValueOnce({ period: 'monthly' })
          .mockImplementationOnce(async (qs: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedValidate = qs[0]?.validate;
            return { value: '100' };
          })
          .mockResolvedValueOnce({ action: 'done' })
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!('abc')).not.toBe(true);
    expect(capturedValidate!('50')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('promptLimits validate: rejects non-integer for rollingAmount', async () => {
    mockApi.mockResolvedValue({});
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ action: 'add' })
          .mockResolvedValueOnce({ metric: 'calls', windowType: 'rolling' })
          .mockImplementationOnce(async (qs: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedValidate = qs[0]?.validate;
            return { rollingAmount: '1', rollingUnit: 'hour', value: '100' };
          })
          .mockResolvedValueOnce({ action: 'done' })
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!('not-int')).not.toBe(true);
    expect(capturedValidate!('5')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('promptPricingTiers validate: rejects non-number for above', async () => {
    mockApi.mockResolvedValue({});
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // limits done
          .mockResolvedValueOnce({ action: 'done' })
          // tiers: add
          .mockResolvedValueOnce({ action: 'add' })
          // tier details — capture validate on 'above'
          .mockImplementationOnce(async (qs: Array<{ name: string; validate?: (v: string) => boolean | string }>) => {
            const aboveQ = qs.find(q => q.name === 'above');
            capturedValidate = aboveQ?.validate;
            return { metric: 'context_tokens', above: '200000', inputPerMillion: '7', outputPerMillion: '20' };
          })
          // done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!('bad')).not.toBe(true);
    expect(capturedValidate!('200000')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('promptPricingTiers validate: covers inputPerMillion and outputPerMillion validates', async () => {
    mockApi.mockResolvedValue({});
    const capturedValidates: Array<{ name: string; fn: (v: string) => boolean | string }> = [];
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // limits done
          .mockResolvedValueOnce({ action: 'done' })
          // tiers: add
          .mockResolvedValueOnce({ action: 'add' })
          // capture all validates in tier details prompt
          .mockImplementationOnce(async (qs: Array<{ name: string; validate?: (v: string) => boolean | string }>) => {
            for (const q of qs) {
              if (q.validate) capturedValidates.push({ name: q.name, fn: q.validate });
            }
            return { metric: 'context_tokens', above: '100000', inputPerMillion: '6', outputPerMillion: '18' };
          })
          // done
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    // 3 validates: above, inputPerMillion, outputPerMillion
    expect(capturedValidates.length).toBe(3);
    const inputV = capturedValidates.find(v => v.name === 'inputPerMillion')!;
    const outputV = capturedValidates.find(v => v.name === 'outputPerMillion')!;
    expect(inputV.fn('bad')).not.toBe(true);
    expect(inputV.fn('6.5')).toBe(true);
    expect(outputV.fn('not-num')).not.toBe(true);
    expect(outputV.fn('18')).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('promptLimits validate: rolling value validate (line 60) — rejects non-number', async () => {
    mockApi.mockResolvedValue({});
    const capturedValidates: Array<{ fn: (v: string) => boolean | string }> = [];
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ action: 'add' })
          .mockResolvedValueOnce({ metric: 'cost', windowType: 'rolling' })
          // rolling prompt: rollingAmount (validate: isNaN(parseInt)), rollingUnit (list, no validate), value (validate: isNaN(parseFloat))
          .mockImplementationOnce(async (qs: Array<{ validate?: (v: string) => boolean | string }>) => {
            for (const q of qs) if (q.validate) capturedValidates.push({ fn: q.validate });
            return { rollingAmount: '1', rollingUnit: 'day', value: '50' };
          })
          .mockResolvedValueOnce({ action: 'done' })
          .mockResolvedValueOnce({ action: 'done' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'model', 'add', '--id', 'gpt-4o', '--provider', 'openai', '--interactive']);
    // 2 validates: rollingAmount + value
    expect(capturedValidates.length).toBe(2);
    const valueValidate = capturedValidates[1]!;
    expect(valueValidate.fn('abc')).not.toBe(true);
    expect(valueValidate.fn('50.5')).toBe(true);
    vi.doUnmock('inquirer');
  });
});

// ── model discover ────────────────────────────────────────────────────────────

describe('routerly model discover', () => {
  it('prints a table of all catalog models', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover');
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/models/catalog');
    expect(out.join('\n')).toContain('gpt-4o');
    expect(out.join('\n')).toContain('openai');
    expect(out.join('\n')).toContain('anthropic');
  });

  it('marks configured models with a star', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover');
    expect(out.join('\n')).toContain('★');
  });

  it('filters by --provider', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover', '--provider', 'anthropic');
    expect(out.join('\n')).toContain('claude-sonnet-4-5');
    expect(out.join('\n')).not.toContain('gpt-4o');
  });

  it('filter is case-insensitive', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover', '--provider', 'ANTHROPIC');
    expect(out.join('\n')).toContain('claude-sonnet-4-5');
    expect(out.join('\n')).not.toContain('gpt-4o');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover', '--json');
    const parsed = JSON.parse(out.join('\n')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('shows free/local label for ollama models', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover');
    expect(out.join('\n')).toContain('free/local');
  });

  it('labels a zero-priced model free/local even without explicit local flag', async () => {
    mockApi.mockResolvedValue([{
      id: 'free-model', provider: 'custom', name: 'Free', contextWindow: 8192,
      modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, isConfigured: false,
    }]);
    const { out } = await run('discover');
    expect(out.join('\n')).toContain('free/local');
  });

  it('shows dollar price for paid models', async () => {
    mockApi.mockResolvedValue([{
      id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000,
      modalities: ['text'], pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false,
    }]);
    const { out } = await run('discover');
    expect(out.join('\n')).toContain('$0.005');
  });

  it('prints fallback message when catalog returns 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'Not Found'));
    const { out } = await run('discover');
    expect(out.join(' ')).toContain('not available');
  });

  it('exits 1 on non-404 error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const { err } = await run('discover');
    expect(err.join(' ')).toContain('boom');
  });

  it('prints no-models message when filter yields no results', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover', '--provider', 'nonexistent');
    expect(out.join(' ')).toContain('No models found');
  });

  it('formats large contextWindow as M', async () => {
    mockApi.mockResolvedValue([{
      id: 'gemini-1.5', provider: 'google', name: 'Gemini 1.5', contextWindow: 2_000_000,
      modalities: ['text'], pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 }, isConfigured: false,
    }]);
    const { out } = await run('discover');
    expect(out.join('\n')).toMatch(/\dM/);
  });

  it('formats contextWindow below 1M as k', async () => {
    mockApi.mockResolvedValue([{
      id: 'small-model', provider: 'ollama', name: 'Small', contextWindow: 8192,
      modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, local: true, isConfigured: false,
    }]);
    const { out } = await run('discover');
    expect(out.join('\n')).toMatch(/\dk/);
  });

  it('prints count footer', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { out } = await run('discover');
    expect(out.join('\n')).toContain('models shown');
  });

  it('uses singular "model" for a single result', async () => {
    mockApi.mockResolvedValue([catalogFixture[0]]);
    const { out } = await run('discover');
    // singular: "1 model shown"
    expect(out.join('\n')).toMatch(/1 model shown/);
  });
});
