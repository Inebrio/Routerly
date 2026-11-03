import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_REGISTRY } from '@routerly/shared';

const { mockGetCurrentAccount, mockRequireAccount } = vi.hoisted(() => ({
  mockGetCurrentAccount: vi.fn(),
  mockRequireAccount: vi.fn(),
}));

vi.mock('../store.js', () => ({
  getCurrentAccount: mockGetCurrentAccount,
  requireAccount: mockRequireAccount,
}));

import { makeManualIntegration, MANUAL_CLIENT_IDS } from './manual.js';
import { INTEGRATIONS } from './index.js';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
let fakeHome: string;

const account = {
  alias: 'test',
  serverUrl: 'http://localhost:3000',
  email: 'admin@example.com',
  token: 'jwt-test',
  expiresAt: Date.now() + 3_600_000,
};

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'routerly-manual-test-'));
  process.env.HOME = fakeHome;
  delete process.env.OPENAI_BASE_URL;
  mockGetCurrentAccount.mockReset().mockResolvedValue(account);
  mockRequireAccount.mockReset().mockResolvedValue(account);
});

afterEach(async () => {
  process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_OPENAI_BASE_URL === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = ORIGINAL_OPENAI_BASE_URL;
  await rm(fakeHome, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('registry coverage', () => {
  it('every registry client has an integration registered', () => {
    for (const meta of CLIENT_REGISTRY) {
      expect(INTEGRATIONS[meta.id], `integration for "${meta.id}"`).toBeDefined();
    }
  });

  it('manual integrations carry the registry label and support state', () => {
    for (const id of MANUAL_CLIENT_IDS) {
      const meta = CLIENT_REGISTRY.find((c) => c.id === id)!;
      const integration = INTEGRATIONS[id]!;
      expect(integration.label).toBe(meta.label);
      expect(integration.supportState).toBe(meta.supportState);
      expect(integration.launch).toBeUndefined();
    }
  });
});

describe('detect', () => {
  it('reports installed when the client config file exists in the home directory', async () => {
    await mkdir(join(fakeHome, '.config', 'zed'), { recursive: true });
    await writeFile(join(fakeHome, '.config', 'zed', 'settings.json'), '{}', 'utf-8');

    const result = await makeManualIntegration('zed').detect();
    expect(result).toEqual({
      installed: true,
      configPath: join(fakeHome, '.config', 'zed', 'settings.json'),
      configExists: true,
    });
  });

  it('reports not installed when the config file is absent', async () => {
    const result = await makeManualIntegration('openclaw').detect();
    expect(result.installed).toBe(false);
    expect(result.configPath).toBe(join(fakeHome, '.openclaw', 'openclaw.json'));
  });

  it('a client with no config file at all has a null config path', async () => {
    const result = await makeManualIntegration('cursor').detect();
    expect(result).toEqual({ installed: false, configPath: null, configExists: false });
  });
});

describe('inspect', () => {
  it('flags a config file that already mentions Routerly, without parsing it', async () => {
    await mkdir(join(fakeHome, '.openclaw'), { recursive: true });
    // JSON with a comment: parsing it would throw, the check is textual.
    await writeFile(
      join(fakeHome, '.openclaw', 'openclaw.json'),
      '{\n  // my gateway\n  "models": { "providers": { "routerly": {} } }\n}\n',
      'utf-8'
    );

    const result = await makeManualIntegration('openclaw').inspect();
    expect(result.exists).toBe(true);
    expect(result.routerlyConfigured).toBe(true);
  });

  it('reports a missing config file as not configured', async () => {
    const result = await makeManualIntegration('zed').inspect();
    expect(result).toEqual({
      configPath: join(fakeHome, '.config', 'zed', 'settings.json'),
      exists: false,
      routerlyConfigured: false,
      stale: false,
    });
  });

  it('reads the environment variable for a generic SDK client', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:3000/v1';
    const result = await makeManualIntegration('generic-openai').inspect();
    expect(result).toEqual({
      configPath: 'OPENAI_BASE_URL',
      exists: true,
      routerlyConfigured: true,
      stale: false,
      currentBaseUrl: 'http://localhost:3000/v1',
    });
  });

  it('flags a generic SDK client pointed at another host as stale', async () => {
    process.env.OPENAI_BASE_URL = 'http://other-host:9000/v1';
    const result = await makeManualIntegration('generic-openai').inspect();
    expect(result.stale).toBe(true);
  });

  it('a UI-only client falls back to the registry hint as its config path', async () => {
    const result = await makeManualIntegration('cursor').inspect();
    expect(result.configPath).toBe('Cursor Settings > Models, no file');
    expect(result.routerlyConfigured).toBe(false);
  });
});

describe('plan / apply', () => {
  it('reject with a message naming the client and its docs', async () => {
    const integration = makeManualIntegration('zed');
    const target = { baseUrl: 'http://localhost:3000', token: 'sk-rt-x', wireFormat: 'openai' as const };
    await expect(integration.plan(target)).rejects.toThrow(/Zed is configured by hand/);
    await expect(integration.plan(target)).rejects.toThrow(/integrations\/clients\/zed/);
    await expect(
      integration.apply({ clientId: 'zed', filePath: '/x', before: '', after: '', backupId: 'b' })
    ).rejects.toThrow(/configured by hand/);
  });
});

describe('validate', () => {
  it('reports the service as reachable on a healthy response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await makeManualIntegration('cursor').validate();
    expect(result).toEqual({ ok: true, reachable: true, message: 'Routerly service reachable at http://localhost:3000' });
  });

  it('reports unreachable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await makeManualIntegration('cursor').validate();
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });
});
