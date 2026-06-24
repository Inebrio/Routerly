import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATALOG = [
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: true },
  { id: 'llama3', provider: 'ollama', name: 'Llama 3', contextWindow: 8192, modalities: ['text'], pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 }, local: true, isConfigured: false },
  { id: 'claude-opus-4-5', provider: 'anthropic', name: 'Claude Opus 4.5', contextWindow: 200000, modalities: ['text', 'vision'], pricing: { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 }, isConfigured: false },
];

function captureConsole() {
  const lines: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  return { lines, restore: () => { spyLog.mockRestore(); spyErr.mockRestore(); } };
}

async function run(...args: string[]): Promise<void> {
  const cmd = makeModelCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'model', ...args]);
}

afterEach(() => vi.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('routerly model discover', () => {
  it('prints a table with all catalog entries', async () => {
    mockApi.mockResolvedValue(CATALOG);
    const { lines, restore } = captureConsole();

    await run('discover');

    restore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/models/catalog');
    const out = lines.join('\n');
    expect(out).toContain('gpt-4o');
    expect(out).toContain('ollama');
  });

  it('filters by --provider', async () => {
    mockApi.mockResolvedValue(CATALOG);
    const { lines, restore } = captureConsole();

    await run('discover', '--provider', 'anthropic');

    restore();
    const out = lines.join('\n');
    expect(out).toContain('claude-opus-4-5');
    expect(out).not.toContain('gpt-4o');
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue(CATALOG);
    const { lines, restore } = captureConsole();

    await run('discover', '--json');

    restore();
    const parsed = JSON.parse(lines.join('\n')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it('marks configured models with a star in table output', async () => {
    mockApi.mockResolvedValue(CATALOG);
    const { lines, restore } = captureConsole();

    await run('discover');

    restore();
    const out = lines.join('\n');
    expect(out).toContain('★');
  });

  it('shows local/free label for ollama models in table output', async () => {
    mockApi.mockResolvedValue(CATALOG);
    const { lines, restore } = captureConsole();

    await run('discover');

    restore();
    const out = lines.join('\n');
    expect(out).toContain('local/free');
  });

  it('prints 404-safe message if endpoint is unavailable', async () => {
    mockApi.mockRejectedValue(new ApiError(404, 'Not Found'));
    const { lines, restore } = captureConsole();

    try {
      await run('discover');
    } catch {
      // exitOverride throws on process.exit
    }

    restore();
    const out = lines.join('\n');
    expect(out).toContain('not available');
  });
});
