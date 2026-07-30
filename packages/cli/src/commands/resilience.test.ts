import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from '../api.js';
import { makeResilienceCommand } from './resilience.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

const sampleSnapshot = {
  entries: [
    {
      key: { level: 'provider', id: 'openai' },
      state: 'closed',
      failureCount: 0,
    },
    {
      key: { level: 'connection', id: 'conn-1' },
      state: 'open',
      lastFault: 'rate-limit',
      failureCount: 5,
      openedAt: 1_700_000_000_000,
      cooldownUntil: 1_700_000_060_000,
    },
    {
      key: { level: 'model', id: 'gpt-4' },
      state: 'half-open',
      lastFault: 'server',
      failureCount: 3,
      openedAt: 1_700_000_000_000,
      lockoutUntil: 1_700_000_300_000,
    },
  ],
  generatedAt: 1_700_000_100_000,
};

describe('resilience command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('status', () => {
    it('--json prints the raw snapshot', async () => {
      mockApi.mockResolvedValue(sampleSnapshot);
      await makeResilienceCommand().parseAsync(['status', '--json'], { from: 'user' });
      expect(mockApi).toHaveBeenCalledWith('GET', '/api/resilience');
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.entries).toHaveLength(3);
      expect(parsed.generatedAt).toBe(1_700_000_100_000);
    });

    it('(no --json) renders a per-level table', async () => {
      mockApi.mockResolvedValue(sampleSnapshot);
      await makeResilienceCommand().parseAsync(['status'], { from: 'user' });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('provider');
      expect(output).toContain('openai');
      expect(output).toContain('connection');
      expect(output).toContain('conn-1');
      expect(output).toContain('model');
      expect(output).toContain('gpt-4');
      expect(output).toContain('rate-limit');
      expect(output).toContain('3 entries');
    });

    it('uses the fallback color for an unrecognised state (no crash)', async () => {
      mockApi.mockResolvedValue({
        entries: [{ key: { level: 'provider', id: 'openai' }, state: 'unknown', failureCount: 0 }],
        generatedAt: 1_700_000_100_000,
      });
      await makeResilienceCommand().parseAsync(['status'], { from: 'user' });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('openai');
    });

    it('shows empty message when there are no entries', async () => {
      mockApi.mockResolvedValue({ entries: [], generatedAt: 1_700_000_100_000 });
      await makeResilienceCommand().parseAsync(['status'], { from: 'user' });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No resilience entries recorded yet.');
    });

    it('surfaces an ApiError to stderr and exits 1', async () => {
      mockApi.mockRejectedValue(new ApiError(403, 'forbidden'));
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await makeResilienceCommand().parseAsync(['status'], { from: 'user' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('API error 403: forbidden'));
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('surfaces a generic error to stderr and exits 1', async () => {
      mockApi.mockRejectedValue(new Error('service unreachable'));
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await makeResilienceCommand().parseAsync(['status'], { from: 'user' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('service unreachable'));
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe('reset', () => {
    it('with no flags resets everything', async () => {
      mockApi.mockResolvedValue({ ok: true });
      await makeResilienceCommand().parseAsync(['reset'], { from: 'user' });
      expect(mockApi).toHaveBeenCalledWith('POST', '/api/resilience/reset', {});
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Reset all resilience state.'));
    });

    it('with --level and --id resets a single key', async () => {
      mockApi.mockResolvedValue({ ok: true });
      await makeResilienceCommand().parseAsync(['reset', '--level', 'provider', '--id', 'openai'], { from: 'user' });
      expect(mockApi).toHaveBeenCalledWith('POST', '/api/resilience/reset', { level: 'provider', id: 'openai' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Reset resilience state for provider "openai".'));
    });

    it('surfaces a 400 ApiError (partial level/id) to stderr and exits 1', async () => {
      mockApi.mockRejectedValue(new ApiError(400, 'level and id must both be provided or both omitted'));
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await makeResilienceCommand().parseAsync(['reset', '--level', 'provider'], { from: 'user' });
      expect(mockApi).toHaveBeenCalledWith('POST', '/api/resilience/reset', { level: 'provider' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('API error 400'));
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('surfaces a generic error to stderr and exits 1', async () => {
      mockApi.mockRejectedValue(new Error('service unreachable'));
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await makeResilienceCommand().parseAsync(['reset'], { from: 'user' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('service unreachable'));
      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
