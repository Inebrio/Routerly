import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mock dependencies before importing the command ────────────────────────────

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: mockApi,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message); this.status = status; this.name = 'ApiError';
    }
  },
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test', serverUrl: 'http://localhost:3000',
    email: 'test@example.com', token: 'jwt-test', expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makePromptCommand } from './prompt.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureConsole() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, spy };
}

async function run(...args: string[]): Promise<void> {
  const cmd = makePromptCommand();
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'prompt', ...args]);
}

const PROMPT: import('./prompt.js').PromptEntry = {
  id: 'p-1', name: 'Test Prompt', activeVersion: 1,
  versions: [{ version: 1, systemPrompt: 'You are helpful.', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u1' }],
};

afterEach(() => vi.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('prompt list', () => {
  it('shows table of prompts', async () => {
    mockApi.mockResolvedValue([PROMPT]);
    const { lines, spy } = captureConsole();
    await run('list');
    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/prompts');
    expect(lines.some(l => l.includes('Test Prompt'))).toBe(true);
  });

  it('outputs JSON with --json flag', async () => {
    mockApi.mockResolvedValue([PROMPT]);
    const { lines, spy } = captureConsole();
    await run('list', '--json');
    spy.mockRestore();
    const parsed = JSON.parse(lines.join('\n'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('p-1');
  });

  it('shows "No prompts" when list is empty', async () => {
    mockApi.mockResolvedValue([]);
    const { lines, spy } = captureConsole();
    await run('list');
    spy.mockRestore();
    expect(lines.some(l => l.includes('No prompts'))).toBe(true);
  });
});

describe('prompt create', () => {
  it('creates a prompt and prints confirmation', async () => {
    mockApi.mockResolvedValue({ ...PROMPT, id: 'p-new' });
    const { lines, spy } = captureConsole();
    await run('create', '--name', 'My Bot', '--system', 'You are a bot.');
    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/prompts', expect.objectContaining({ name: 'My Bot', systemPrompt: 'You are a bot.' }));
    expect(lines.some(l => l.includes('created'))).toBe(true);
  });
});

describe('prompt show', () => {
  it('displays prompt details', async () => {
    mockApi.mockResolvedValue(PROMPT);
    const { lines, spy } = captureConsole();
    await run('show', 'p-1');
    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/prompts/p-1');
    expect(lines.some(l => l.includes('Test Prompt'))).toBe(true);
    expect(lines.some(l => l.includes('You are helpful.'))).toBe(true);
  });
});

describe('prompt activate', () => {
  it('sets active version', async () => {
    mockApi.mockResolvedValue({ ...PROMPT, activeVersion: 2 });
    const { lines, spy } = captureConsole();
    await run('activate', 'p-1', '2');
    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/prompts/p-1/activate/2');
    expect(lines.some(l => l.includes('v2'))).toBe(true);
  });
});

describe('prompt delete', () => {
  it('deletes with --yes flag', async () => {
    mockApi.mockResolvedValue(undefined);
    const { lines, spy } = captureConsole();
    await run('delete', 'p-1', '--yes');
    spy.mockRestore();
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/prompts/p-1');
    expect(lines.some(l => l.includes('deleted'))).toBe(true);
  });
});

// Re-export the type so the test file compiles cleanly
declare module './prompt.js' {
  interface PromptEntry {
    id: string; name: string; description?: string; projectId?: string;
    versions: Array<{ version: number; systemPrompt: string; createdAt: string; createdBy: string; notes?: string }>;
    activeVersion: number;
  }
}
