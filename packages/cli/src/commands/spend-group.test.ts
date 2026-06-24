import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeSpendGroupCommand } from './spend-group.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

describe('spend-group list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table of groups', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'sg-1', name: 'Team A', limits: [{ metric: 'cost', period: 'monthly', value: 100 }], projectIds: ['p1'] },
    ]);
    const cmd = makeSpendGroupCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/spend-groups');
    expect(console.log).toHaveBeenCalled();
  });

  it('prints message when no groups', async () => {
    mockApi.mockResolvedValueOnce([]);
    const cmd = makeSpendGroupCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No spend groups'));
  });

  it('outputs JSON with --json', async () => {
    const data = [{ id: 'sg-1', name: 'A', limits: [], projectIds: [] }];
    mockApi.mockResolvedValueOnce(data);
    const cmd = makeSpendGroupCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('exits 1 on error', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeSpendGroupCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('spend-group add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates a spend group with limits and projects', async () => {
    mockApi.mockResolvedValueOnce({ id: 'sg-new', name: 'Team B' });
    const cmd = makeSpendGroupCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add',
      '--name', 'Team B',
      '--limit', 'cost:monthly:200',
      '--projects', 'p1,p2',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/spend-groups', {
      name: 'Team B',
      limits: [{ metric: 'cost', period: 'monthly', value: 200 }],
      projectIds: ['p1', 'p2'],
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Team B'));
  });

  it('exits 1 on 409 conflict', async () => {
    const err = new ApiError(409, 'Conflict');
    mockApi.mockRejectedValueOnce(err);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeSpendGroupCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--name', 'Team B'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('spend-group delete', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deletes a group by id', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeSpendGroupCommand();
    await cmd.parseAsync(['node', 'routerly', 'delete', 'sg-1']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/spend-groups/sg-1');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('deleted'));
  });

  it('exits 1 on 404', async () => {
    const err = new ApiError(404, 'Not found');
    mockApi.mockRejectedValueOnce(err);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeSpendGroupCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'delete', 'sg-nope'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
