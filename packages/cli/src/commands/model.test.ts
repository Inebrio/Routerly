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

  it('prints fallback message when catalog returns 404', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'Not Found'));
    const { lines, spy } = captureConsole();

    await run('discover');

    spy.mockRestore();
    expect(lines.some(l => l.includes('not available'))).toBe(true);
  });
});
