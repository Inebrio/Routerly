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

import { makePermissionsCommand } from './permissions.js';

afterEach(() => vi.clearAllMocks());

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.map(String).join(' ')));
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.map(String).join(' ')));
  return { out, err, logSpy, errSpy };
}

const safeStatus = { blocked: false, bypassActive: false, unsafe: [] };

const unsafeStatus = {
  blocked: false,
  bypassActive: false,
  unsafe: [
    { file: 'settings.json', path: '/home/.routerly/config/settings.json', mode: '644', severity: 'general' },
    { file: 'models.json', path: '/home/.routerly/config/models.json', mode: '644', severity: 'secret' },
  ],
};

describe('permissions fix', () => {
  it('reports all safe and exits 0 when nothing unsafe', async () => {
    mockApi.mockResolvedValueOnce(safeStatus);
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix']);
    expect(out.join('\n')).toContain('safe');
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/system/permissions');
  });

  it('--json prints empty unsafe/fixed arrays when nothing unsafe', async () => {
    mockApi.mockResolvedValueOnce(safeStatus);
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix', '--json']);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed).toEqual({ unsafe: [], fixed: [] });
  });

  it('lists unsafe files and fixes them with --yes (no prompt)', async () => {
    mockApi.mockResolvedValueOnce(unsafeStatus);
    mockApi.mockResolvedValueOnce({ fixed: ['settings.json', 'models.json'] });
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix', '--yes']);
    expect(out.join('\n')).toContain('settings.json');
    expect(out.join('\n')).toContain('models.json');
    expect(out.join('\n')).toContain('Fixed permissions on');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'POST', '/api/system/permissions/fix', { confirm: true });
  });

  it('prompts for confirmation when --yes is absent, fixes on confirm', async () => {
    mockApi.mockResolvedValueOnce(unsafeStatus);
    mockApi.mockResolvedValueOnce({ fixed: ['settings.json', 'models.json'] });
    vi.doMock('inquirer', () => ({
      default: { prompt: vi.fn().mockResolvedValueOnce({ confirm: true }) },
    }));
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix']);
    expect(out.join('\n')).toContain('Fixed permissions on');
    vi.doUnmock('inquirer');
  });

  it('aborts without fixing when confirmation is declined', async () => {
    mockApi.mockResolvedValueOnce(unsafeStatus);
    vi.doMock('inquirer', () => ({
      default: { prompt: vi.fn().mockResolvedValueOnce({ confirm: false }) },
    }));
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix']);
    expect(out.join('\n')).toContain('Aborted');
    expect(mockApi).toHaveBeenCalledTimes(1);
    vi.doUnmock('inquirer');
  });

  it('--json without --yes exits 1 and never fixes (no interactive prompt in JSON mode)', async () => {
    mockApi.mockResolvedValueOnce(unsafeStatus);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const { err } = captureConsole();
    await expect(makePermissionsCommand().parseAsync(['node', 'permissions', 'fix', '--json'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err.join('\n')).toContain('confirmation_required');
    expect(mockApi).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
  });

  it('--json --yes fixes and prints the raw fix response', async () => {
    mockApi.mockResolvedValueOnce(unsafeStatus);
    mockApi.mockResolvedValueOnce({ fixed: ['settings.json', 'models.json'] });
    const { out } = captureConsole();
    await makePermissionsCommand().parseAsync(['node', 'permissions', 'fix', '--json', '--yes']);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed).toEqual({ fixed: ['settings.json', 'models.json'] });
  });

  it('exits 1 with an error message when the GET call fails', async () => {
    mockApi.mockRejectedValueOnce(new Error('network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const { err } = captureConsole();
    await expect(makePermissionsCommand().parseAsync(['node', 'permissions', 'fix'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err.join('\n')).toContain('network error');
    exitSpy.mockRestore();
  });
});
