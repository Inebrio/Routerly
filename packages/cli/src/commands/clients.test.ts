import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ConfigPlan, ApplyResult, ValidateResult, DetectResult, InspectResult } from '../clients/types.js';

const {
  mockApi,
  mockRequireAccount,
  mockAcquireToken,
  mockRestoreBackup,
  mockListBackups,
  claudeCodeMock,
  clineMock,
  claudeDesktopMock,
} = vi.hoisted(() => {
  const claudeCodeMock = {
    id: 'claude-code',
    label: 'Claude Code',
    supportState: 'auto-configurable' as const,
    detect: vi.fn(),
    inspect: vi.fn(),
    plan: vi.fn(),
    apply: vi.fn(),
    validate: vi.fn(),
    rollback: vi.fn(),
    launch: vi.fn(),
  };
  const clineMock = {
    id: 'cline',
    label: 'Cline',
    supportState: 'documented' as const,
    detect: vi.fn(),
    inspect: vi.fn(),
    plan: vi.fn(),
    apply: vi.fn(),
    validate: vi.fn(),
    rollback: vi.fn(),
  };
  const claudeDesktopMock = {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    supportState: 'documented' as const,
    detect: vi.fn(),
    inspect: vi.fn(),
    plan: vi.fn(),
    apply: vi.fn(),
    validate: vi.fn(),
    rollback: vi.fn(),
  };
  return {
    mockApi: vi.fn(),
    mockRequireAccount: vi.fn(),
    mockAcquireToken: vi.fn(),
    mockRestoreBackup: vi.fn(),
    mockListBackups: vi.fn(),
    claudeCodeMock,
    clineMock,
    claudeDesktopMock,
  };
});

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
  requireAccount: mockRequireAccount,
}));

vi.mock('../lib/safe-file.js', () => ({
  restoreBackup: mockRestoreBackup,
  listBackups: mockListBackups,
}));

vi.mock('../clients/index.js', () => ({
  INTEGRATIONS: { 'claude-code': claudeCodeMock, cline: clineMock, 'claude-desktop': claudeDesktopMock },
  acquireToken: mockAcquireToken,
}));

import { makeClientsCommand } from './clients.js';
import { ApiError } from '../api.js';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeClientsCommand();
  cmd.exitOverride();
  return cmd;
}

const account = {
  alias: 'test',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: 'jwt-test',
  expiresAt: Date.now() + 3_600_000,
};

const baseProject = {
  id: 'proj-1',
  name: 'my-api',
  models: [],
  timeoutMs: 5000,
  autoRouting: true,
  tokens: [],
  members: [],
  policies: [],
};

const fakePlan: ConfigPlan = {
  clientId: 'claude-code',
  filePath: '/home/user/.claude/settings.json',
  before: '',
  after: '{\n  "env": {}\n}\n',
  backupId: 'backup-1',
};

const fakeApply: ApplyResult = {
  backupId: 'backup-1',
  filePath: '/home/user/.claude/settings.json',
  ok: true,
};

const fakeValidate: ValidateResult = {
  ok: true,
  reachable: true,
  message: 'Routerly service reachable at http://localhost:3000',
};

const fakeDetect: DetectResult = {
  installed: true,
  configPath: '/home/user/.claude/settings.json',
  configExists: true,
  version: '1.2.3',
};

const fakeInspect: InspectResult = {
  configPath: '/home/user/.claude/settings.json',
  exists: true,
  routerlyConfigured: true,
  currentBaseUrl: 'http://localhost:3000',
  stale: false,
};

function collectLog() {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
  return lines;
}

// ─── clients list ──────────────────────────────────────────────────────────

describe('clients list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints a table with id/label/support-state', async () => {
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('claude-code');
    expect(out).toContain('Claude Code');
    expect(out).toContain('auto-configurable');
    expect(out).toContain('cline');
    expect(out).toContain('documented');
  });

  it('outputs parseable JSON with --json', async () => {
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'list', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed).toEqual([
      { id: 'claude-code', label: 'Claude Code', supportState: 'auto-configurable', modes: ['llm', 'mcp'] },
      { id: 'claude-desktop', label: 'Claude Desktop', supportState: 'documented', modes: ['mcp'] },
      { id: 'cline', label: 'Cline', supportState: 'documented', modes: ['llm'] },
    ]);
  });
});

// ─── clients inspect ───────────────────────────────────────────────────────

describe('clients inspect', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints detect + inspect results', async () => {
    claudeCodeMock.detect.mockResolvedValueOnce(fakeDetect);
    claudeCodeMock.inspect.mockResolvedValueOnce(fakeInspect);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'inspect', 'claude-code']);
    const out = lines.join('\n');
    expect(out).toContain('Claude Code');
    expect(out).toContain('/home/user/.claude/settings.json');
    expect(out).toContain('http://localhost:3000');
  });

  it('outputs parseable JSON with --json', async () => {
    claudeCodeMock.detect.mockResolvedValueOnce(fakeDetect);
    claudeCodeMock.inspect.mockResolvedValueOnce(fakeInspect);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'inspect', 'claude-code', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.detect).toEqual(fakeDetect);
    expect(parsed.inspect).toEqual(fakeInspect);
  });

  it('unknown id -> stderr + exit 1, no detect/inspect calls', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'inspect', 'no-such-client'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown client'));
    expect(claudeCodeMock.detect).not.toHaveBeenCalled();
  });

  it('detect() failure -> stderr + exit 1', async () => {
    claudeCodeMock.detect.mockRejectedValueOnce(new Error('boom'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'inspect', 'claude-code'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

// ─── clients doctor ────────────────────────────────────────────────────────

describe('clients doctor', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports reachable + module enabled', async () => {
    mockApi
      .mockResolvedValueOnce({ version: '0.5.0' })
      .mockResolvedValueOnce({ enabled: true, clients: [{ id: 'claude-code' }], advertisedAddresses: [] });
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'doctor']);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'GET', '/api/system/info');
    expect(mockApi).toHaveBeenNthCalledWith(2, 'GET', '/api/clients');
    const out = lines.join('\n');
    expect(out).toContain('reachable');
    expect(out).toContain('enabled');
  });

  it('reports reachable + module disabled (404) without failing', async () => {
    mockApi
      .mockResolvedValueOnce({ version: '0.5.0' })
      .mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'doctor']);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('disabled');
  });

  it('exits 1 when the service is unreachable', async () => {
    mockApi
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ enabled: true, clients: [], advertisedAddresses: [] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'doctor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
  });

  it('exits 1 on a non-404 error checking module status', async () => {
    mockApi
      .mockResolvedValueOnce({ version: '0.5.0' })
      .mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'doctor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── clients undo ──────────────────────────────────────────────────────────

describe('clients undo', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('restores a known backup', async () => {
    mockListBackups.mockResolvedValueOnce([
      { backupId: 'backup-1', clientId: 'claude-code', originalPath: '/home/user/.claude/settings.json', checksum: 'abc', existedBefore: true, createdAt: '2026-07-30T00:00:00.000Z' },
    ]);
    mockRestoreBackup.mockResolvedValueOnce(undefined);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'undo', 'backup-1']);
    expect(mockRestoreBackup).toHaveBeenCalledWith('backup-1');
    expect(lines.join('\n')).toContain('/home/user/.claude/settings.json');
  });

  it('unknown backup id -> stderr + exit 1, restoreBackup not called', async () => {
    mockListBackups.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'undo', 'no-such-backup'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });

  it('restoreBackup failure -> stderr + exit 1', async () => {
    mockListBackups.mockResolvedValueOnce([
      { backupId: 'backup-1', clientId: 'claude-code', originalPath: '/x', checksum: 'abc', existedBefore: true, createdAt: '2026-07-30T00:00:00.000Z' },
    ]);
    mockRestoreBackup.mockRejectedValueOnce(new Error('checksum mismatch'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'undo', 'backup-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('checksum mismatch'));
  });
});

// ─── clients launch ────────────────────────────────────────────────────────

describe('clients launch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('launches an integration that supports it', async () => {
    claudeCodeMock.launch.mockResolvedValueOnce(undefined);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'launch', 'claude-code']);
    expect(claudeCodeMock.launch).toHaveBeenCalled();
    expect(lines.join('\n')).toContain('exited');
  });

  it('errors clearly when the integration has no launch()', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'launch', 'cline'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('does not support launch'));
  });

  it('propagates launch() failure to stderr + exit 1', async () => {
    claudeCodeMock.launch.mockRejectedValueOnce(new Error('claude CLI not installed'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'launch', 'claude-code'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('claude CLI not installed'));
  });
});

// ─── clients configure ─────────────────────────────────────────────────────

describe('clients configure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('unknown client id -> stderr + exit 1 before any project lookup', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'clients', 'configure', 'no-such-client'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('--project not found -> stderr + exit 1', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'no-such-project', '--yes'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('no projects at all -> stderr + exit 1', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(
      makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--yes'])
    ).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No projects found'));
  });

  it('prompts for project selection when --project is omitted', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('minted-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ projectId: 'proj-1' }),
      },
    }));
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--yes']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1', explicitToken: undefined });
    vi.doUnmock('inquirer');
  });

  it('prompts for consent before minting unless --token/--yes is given, proceeds on confirm', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('minted-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ proceed: true }),
      },
    }));
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1', explicitToken: undefined });
    expect(lines.join('\n')).toContain('configured');
    vi.doUnmock('inquirer');
  });

  it('aborts without minting or applying when consent is declined', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ proceed: false }),
      },
    }));
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api']);
    expect(mockAcquireToken).not.toHaveBeenCalled();
    expect(claudeCodeMock.plan).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('Aborted');
    vi.doUnmock('inquirer');
  });

  it('--token supplied skips the consent prompt entirely', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('explicit-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api', '--token', 'explicit-token']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1', explicitToken: 'explicit-token' });
  });

  it('--yes supplied skips the consent prompt without a token', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('minted-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api', '--yes']);
    expect(mockAcquireToken).toHaveBeenCalledWith({ projectId: 'proj-1', explicitToken: undefined });
  });

  it('shows the plan before/after diff, then applies and validates', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('minted-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api', '--yes']);
    expect(claudeCodeMock.plan).toHaveBeenCalledWith({ baseUrl: account.serverUrl, token: 'minted-token', wireFormat: 'anthropic' });
    expect(claudeCodeMock.apply).toHaveBeenCalledWith(fakePlan);
    expect(claudeCodeMock.validate).toHaveBeenCalled();
    const out = lines.join('\n');
    expect(out).toContain(fakePlan.filePath);
    expect(out).toContain(fakePlan.after);
    expect(out).toContain('configured');
    expect(out).toContain(fakeValidate.message);
  });

  it('outputs a parseable JSON result with --json', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('minted-token');
    claudeCodeMock.plan.mockResolvedValueOnce(fakePlan);
    claudeCodeMock.apply.mockResolvedValueOnce(fakeApply);
    claudeCodeMock.validate.mockResolvedValueOnce(fakeValidate);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-code', '--project', 'my-api', '--yes', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.plan).toEqual(fakePlan);
    expect(parsed.applied).toEqual(fakeApply);
    expect(parsed.validated).toEqual(fakeValidate);
  });

  it('prints manual steps with the real token for a documented client, without calling plan()', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('sk-rt-minted');
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'cline', '--project', 'my-api', '--yes']);
    const out = lines.join('\n');
    expect(clineMock.plan).not.toHaveBeenCalled();
    expect(clineMock.apply).not.toHaveBeenCalled();
    expect(out).toContain('API Provider: OpenAI Compatible');
    expect(out).toContain('http://localhost:3000/v1');
    expect(out).toContain('sk-rt-minted');
    expect(out).toContain('integrations/clients/cline');
  });

  it('documented client with --json emits a parseable manual result', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    mockRequireAccount.mockResolvedValueOnce(account);
    mockAcquireToken.mockResolvedValueOnce('sk-rt-minted');
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'cline', '--project', 'my-api', '--yes', '--json']);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed).toMatchObject({ id: 'cline', manual: true, mode: 'llm' });
    expect(parsed.steps).toContain('http://localhost:3000/v1');
  });

  it('MCP-only client prints the MCP wiring and never mints a project token', async () => {
    mockRequireAccount.mockResolvedValueOnce(account);
    const lines = collectLog();
    await makeCmd().parseAsync(['node', 'clients', 'configure', 'claude-desktop', '--yes']);
    const out = lines.join('\n');
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockAcquireToken).not.toHaveBeenCalled();
    expect(out).toContain('<YOUR_MCP_TOKEN>');
    expect(out).toContain('mcpServers');
    expect(out).toContain('routerly mcp token create');
  });
});
