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

  it('enable posts to the enable endpoint and prints the restart hint', async () => {
    mockApi.mockResolvedValue({ id: 'guardrails', enabled: true, restartRequired: true });
    await makeModulesCommand().parseAsync(['enable', 'guardrails'], { from: 'user' });
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/modules/guardrails/enable');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Restart'));
  });

  it('enable does not print the restart hint when restartRequired is false', async () => {
    mockApi.mockResolvedValue({ id: 'guardrails', enabled: true, restartRequired: false });
    await makeModulesCommand().parseAsync(['enable', 'guardrails'], { from: 'user' });
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Restart'));
  });

  it('enable surfaces a server error to stderr and exits 1', async () => {
    mockApi.mockRejectedValue(new Error('Cannot enable "guardrails": depends on disabled reverse-proxy'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await makeModulesCommand().parseAsync(['enable', 'guardrails'], { from: 'user' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('depends on disabled'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('disable posts to the disable endpoint', async () => {
    mockApi.mockResolvedValue({ id: 'guardrails', enabled: false, restartRequired: true });
    await makeModulesCommand().parseAsync(['disable', 'guardrails'], { from: 'user' });
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/modules/guardrails/disable');
  });

  it('disable does not print the restart hint when restartRequired is false', async () => {
    mockApi.mockResolvedValue({ id: 'guardrails', enabled: false, restartRequired: false });
    await makeModulesCommand().parseAsync(['disable', 'guardrails'], { from: 'user' });
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Restart'));
  });

  it('disable surfaces a server error to stderr and exits 1', async () => {
    mockApi.mockRejectedValue(new Error('Cannot disable "config": always-on'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await makeModulesCommand().parseAsync(['disable', 'config'], { from: 'user' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('always-on'));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
