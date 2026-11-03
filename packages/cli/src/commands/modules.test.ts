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

import { api } from '../api.js';
import { makeModulesCommand } from './modules.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

describe('modules command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('list --json prints the raw module list', async () => {
    mockApi.mockResolvedValue([
      { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: ['reverse-proxy'] },
    ]);
    await makeModulesCommand().parseAsync(['list', '--json'], { from: 'user' });
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/modules');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"guardrails"'));
  });

  it('list (no --json) renders a table with the module rows', async () => {
    mockApi.mockResolvedValue([
      { id: 'guardrails', version: '0.4.0', enabled: false, alwaysOn: false, dependsOn: ['reverse-proxy'] },
      { id: 'config', version: '0.4.0', enabled: true, alwaysOn: true, dependsOn: [] },
    ]);
    await makeModulesCommand().parseAsync(['list'], { from: 'user' });
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/modules');
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('guardrails');
    expect(output).toContain('reverse-proxy');
    expect(output).toContain('config');
  });

  it('list surfaces a server error to stderr and exits 1', async () => {
    mockApi.mockRejectedValue(new Error('service unreachable'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await makeModulesCommand().parseAsync(['list'], { from: 'user' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('service unreachable'));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
