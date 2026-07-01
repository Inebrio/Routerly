import { describe, it, expect, vi, afterEach } from 'vitest';

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

function captureConsole() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, spy };
}

async function run(...args: string[]): Promise<void> {
  const cmd = makeModelCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'model', ...args]);
}

afterEach(() => {
  vi.clearAllMocks();
});

const catalogFixture = [
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', contextWindow: 128000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 }, isConfigured: true },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Claude Sonnet 4.5', contextWindow: 200000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 }, isConfigured: false },
  { id: 'llama3', provider: 'ollama', name: 'Llama 3', contextWindow: 8192, modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, local: true, isConfigured: false },
];

describe('routerly model discover', () => {
  it('prints a table of all catalog models', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();

    await run('discover');

    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/models/catalog');
    const output = lines.join('\n');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('openai');
    expect(output).toContain('anthropic');
  });

  it('marks configured models with a star', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();

    await run('discover');

    spy.mockRestore();
    const output = lines.join('\n');
    // gpt-4o-mini is configured
    expect(output).toContain('gpt-4o-mini');
    // star character somewhere in output for configured model
    expect(output).toContain('★');
  });

  it('filters by --provider', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();

    await run('discover', '--provider', 'anthropic');

    spy.mockRestore();
    const output = lines.join('\n');
    expect(output).toContain('claude-sonnet-4-5');
    expect(output).not.toContain('gpt-4o');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();

    await run('discover', '--json');

    spy.mockRestore();
    const parsed = JSON.parse(lines.join('\n')) as any[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('isConfigured');
  });

  it('shows free/local label for ollama models', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();

    await run('discover');

    spy.mockRestore();
    const output = lines.join('\n');
    expect(output).toContain('free/local');
  });

  it('labels a zero-priced model free/local even without an explicit local flag', async () => {
    // free model, no `local: true` — must still read as free/local, not "$0".
    mockApi.mockResolvedValue([
      { id: 'free-model', provider: 'custom', name: 'Free', contextWindow: 8192, modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, isConfigured: false },
    ]);
    const { lines, spy } = captureConsole();
    await run('discover');
    spy.mockRestore();
    const output = lines.join('\n');
    expect(output).toContain('free/local');
    expect(output).not.toContain('$0');
  });

  it('shows the dollar price for a paid model', async () => {
    mockApi.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, modalities: ['text'], pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    const { lines, spy } = captureConsole();
    await run('discover');
    spy.mockRestore();
    const output = lines.join('\n');
    expect(output).toContain('$0.005');
    expect(output).not.toContain('free/local');
  });

  it('prints fallback message when catalog returns 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'Not Found'));
    const { lines, spy } = captureConsole();

    await run('discover');

    spy.mockRestore();
    expect(lines.some(l => l.includes('not available'))).toBe(true);
  });

  it('prints error and exits 1 on non-404 error', async () => {
    mockApi.mockRejectedValue(new Error('boom'));
    const errLines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { errLines.push(a.map(String).join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const cmd = makeModelCommand();
    cmd.exitOverride();
    await expect(cmd.parseAsync(['node', 'model', 'discover'])).rejects.toThrow('exit');
    expect(errLines.join(' ')).toContain('boom');
    exitSpy.mockRestore();
  });

  it('prints message when filter yields no results', async () => {
    mockApi.mockResolvedValue(catalogFixture);
    const { lines, spy } = captureConsole();
    await run('discover', '--provider', 'nonexistent');
    spy.mockRestore();
    expect(lines.join('\n')).toContain('No models found');
  });

  it('formats large contextWindow as M', async () => {
    mockApi.mockResolvedValue([
      { id: 'gemini-1.5', provider: 'google', name: 'Gemini 1.5', contextWindow: 2_000_000, modalities: ['text'], pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 }, isConfigured: false },
    ]);
    const { lines, spy } = captureConsole();
    await run('discover');
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/\dM/);
  });
});

// ── model add (new provider options) ─────────────────────────────────────────

describe('routerly model add azure-openai provider', () => {
  it('sends azure fields when provided', async () => {
    mockApi.mockResolvedValue({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(
      'add',
      '--id', 'my-azure-model',
      '--provider', 'azure-openai',
      '--azure-resource', 'my-resource',
      '--azure-deployment', 'dep-123',
      '--azure-api-version', '2024-05-01',
    );
    logSpy.mockRestore();
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['azureResourceName']).toBe('my-resource');
    expect(body['azureDeploymentId']).toBe('dep-123');
    expect(body['azureApiVersion']).toBe('2024-05-01');
  });
});

describe('routerly model add bedrock provider', () => {
  it('sends aws fields when provided', async () => {
    mockApi.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(
      'add',
      '--id', 'my-bedrock-model',
      '--provider', 'bedrock',
      '--aws-region', 'us-east-1',
      '--aws-key-id', 'AKIAIOSFODNN7EXAMPLE',
      '--aws-secret', 'wJalrXUtnFEMI/K7MDENG',
    );
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['awsRegion']).toBe('us-east-1');
    expect(body['awsAccessKeyId']).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(body['awsSecretAccessKey']).toBe('wJalrXUtnFEMI/K7MDENG');
  });
});

describe('routerly model add vertex provider', () => {
  it('sends vertex fields when provided', async () => {
    mockApi.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(
      'add',
      '--id', 'my-vertex-model',
      '--provider', 'vertex',
      '--vertex-project', 'my-gcp-project',
      '--vertex-location', 'us-central1',
    );
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body['vertexProjectId']).toBe('my-gcp-project');
    expect(body['vertexLocation']).toBe('us-central1');
  });

  it('exits 1 when SA key file cannot be read', async () => {
    const errLines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { errLines.push(a.map(String).join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    const cmd = makeModelCommand();
    // Do NOT call exitOverride so process.exit spy works
    await expect(
      cmd.parseAsync(['node', 'model', 'add', '--id', 'v', '--provider', 'vertex', '--vertex-sa-key', '/nonexistent/path.json'])
    ).rejects.toThrow('exit');
    expect(errLines.join(' ')).toContain('Cannot read service account key file');
    exitSpy.mockRestore();
  });
});

