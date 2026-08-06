import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import {
  migrateProjectConfigs,
  migrateSettings,
  migrateRouterStorage,
  migrateRolePermissions,
  migrateUsageRouterId,
  migrateNotificationChannelScope,
} from './migrate.js';
import { readConfig, writeConfig } from './loader.js';
import { CONFIG_PATHS } from '../../lib/paths.js';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockReadFile = vi.mocked(readFile);

function enoent(): NodeJS.ErrnoException {
  const err = new Error('not found') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

afterEach(() => vi.clearAllMocks());

// ─── migrateGuardrailAction ────────────────────────────────────────────────────

describe('migrateProjectConfigs — guardrail action mapping', () => {
  it('action=block → rule gets block:true', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].block).toBe(true);
    expect(saved.guardrails.rules[0].log).toBeUndefined();
    expect(saved.guardrails.action).toBeUndefined();
  });

  it('action=log → rule gets log:true', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'log',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].log).toBe(true);
    expect(saved.guardrails.rules[0].block).toBeUndefined();
  });

  it('action=warn → rule gets log:true (warn maps to log)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'warn',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].log).toBe(true);
  });

  it('action=flag → rule gets log:true (flag maps to log)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'flag',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].log).toBe(true);
  });

  it('unknown action → rule gets neither block nor log', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'unknown_action',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].block).toBeUndefined();
    expect(saved.guardrails.rules[0].log).toBeUndefined();
  });
});

// ─── per-rule action override takes precedence over global ─────────────────────

describe('migrateProjectConfigs — per-rule override', () => {
  it('rule already has block=true → global action does NOT overwrite it', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'log',
          rules: [
            { type: 'regex', target: 'request', config: { patterns: ['x'] }, block: true },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    // rule already had block:true → not overwritten with log
    expect(saved.guardrails.rules[0].block).toBe(true);
    expect(saved.guardrails.rules[0].log).toBeUndefined();
  });

  it('rule already has log=true → global block action does NOT overwrite it', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          rules: [
            { type: 'regex', target: 'request', config: { patterns: ['x'] }, log: true },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].log).toBe(true);
    expect(saved.guardrails.rules[0].block).toBeUndefined();
  });
});

// ─── fallbackMessage → per-rule blockMessage ──────────────────────────────────

describe('migrateProjectConfigs — fallbackMessage → blockMessage', () => {
  it('fallbackMessage is copied to blockMessage on blocking rules', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          fallbackMessage: 'Blocked by policy',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].blockMessage).toBe('Blocked by policy');
  });

  it('fallbackMessage is NOT copied when rule has no block:true (log-only rule)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'log',
          fallbackMessage: 'Should not copy',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    // log-only rule: block is not set, so fallbackMessage must not be copied
    expect(saved.guardrails.rules[0].blockMessage).toBeUndefined();
  });

  it('fallbackMessage is NOT copied when rule already has a blockMessage', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          fallbackMessage: 'Global fallback',
          rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] }, blockMessage: 'Existing message' }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules[0].blockMessage).toBe('Existing message');
  });

  it('top-level action and fallbackMessage are removed from result', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          fallbackMessage: 'x',
          rules: [],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.action).toBeUndefined();
    expect(saved.guardrails.fallbackMessage).toBeUndefined();
  });

  it('detectInjection is preserved through migration', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          action: 'block',
          detectInjection: true,
          rules: [],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.detectInjection).toBe(true);
  });
});

// ─── already-migrated guardrails (no-op) ──────────────────────────────────────

describe('migrateProjectConfigs — no-op when already migrated', () => {
  it('does NOT call writeConfig when guardrails are already new-shape (no action/fallbackMessage)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: {
          rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['x'] } }],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('handles guardrails with no rules field (rules ?? [] path)', async () => {
    // rules is undefined → (legacy.rules ?? []) evaluates to [] (true branch of ??)
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        guardrails: { action: 'block' }, // no rules field
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.guardrails.rules).toEqual([]);
  });

  it('does NOT call writeConfig when project has no guardrails or pii', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'p1', name: 'Test', models: [], tokens: [], members: [] },
    ] as any);

    await migrateProjectConfigs();

    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('returns count=0 when nothing was migrated', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'p1', name: 'Test', models: [], tokens: [], members: [] },
    ] as any);

    const count = await migrateProjectConfigs();
    expect(count).toBe(0);
  });
});

// ─── PII flat → policies migration ────────────────────────────────────────────

describe('migrateProjectConfigs — PII flat to policies', () => {
  it('scrubInput=true only → target=request', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true, entities: ['EMAIL'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].target).toBe('request');
    expect(saved.pii.policies[0].entities).toEqual(['EMAIL']);
    expect(saved.pii.scrubInput).toBeUndefined();
  });

  it('scrubOutput=true only → target=response', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubOutput: true, entities: ['PHONE'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].target).toBe('response');
  });

  it('scrubInput=true AND scrubOutput=true → target=both', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true, scrubOutput: true },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].target).toBe('both');
  });

  it('scrubInput=false scrubOutput=false → enabled=false (PII was off; must not silently activate request scrub)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: false, scrubOutput: false, entities: ['EMAIL'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].enabled).toBe(false);
  });

  it('scrubInput=true scrubOutput=false → target=request, enabled NOT set (active policy)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true, scrubOutput: false, entities: ['EMAIL'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].target).toBe('request');
    expect(saved.pii.policies[0].enabled).toBeUndefined();
  });

  it('customPatterns are included in the synthesized policy', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true, customPatterns: ['tok-[a-z]+'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].customPatterns).toEqual(['tok-[a-z]+']);
  });

  it('no entities/customPatterns → synthesized policy has no entities/customPatterns fields', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    const policy = saved.pii.policies[0];
    expect(policy.entities).toBeUndefined();
    expect(policy.customPatterns).toBeUndefined();
    expect(policy.target).toBe('request');
  });
});

// ─── PII legacy policies[] with scrubInput/scrubOutput on entries ──────────────

describe('migrateProjectConfigs — legacy policies[] with per-policy scrubInput/scrubOutput', () => {
  it('migrates policy-level scrubInput/scrubOutput to target', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: {
          policies: [
            { name: 'emails', scrubInput: true, scrubOutput: false, entities: ['EMAIL'] },
            { name: 'both', scrubInput: true, scrubOutput: true, entities: ['PHONE'] },
            { name: 'out', scrubInput: false, scrubOutput: true, entities: ['SSN'] },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].target).toBe('request');
    expect(saved.pii.policies[0].scrubInput).toBeUndefined();
    expect(saved.pii.policies[1].target).toBe('both');
    expect(saved.pii.policies[2].target).toBe('response');
  });

  it('policy-level scrubInput=false scrubOutput=false → enabled=false (must not silently activate request scrub)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: {
          policies: [
            { name: 'p1', scrubInput: false, scrubOutput: false, entities: ['EMAIL'] },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].enabled).toBe(false);
  });

  it('policy has target AND scrubInput → target kept, scrubInput removed (line 108 false branch)', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: {
          policies: [
            { name: 'redundant', target: 'both', scrubInput: true, entities: ['EMAIL'] },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    // target was already defined → kept; scrubInput removed
    expect(saved.pii.policies[0].target).toBe('both');
    expect(saved.pii.policies[0].scrubInput).toBeUndefined();
  });

  it('policy already has target and no scrubInput/scrubOutput → no migration', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: {
          policies: [
            { name: 'clean', target: 'both', entities: ['EMAIL'] },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    // Already migrated — no write
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('flat pii with non-empty policies[] uses those policies (migrated per-item), not flat synthesis', async () => {
    // Has both top-level scrubInput AND policies[] — policies takes precedence in this branch
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: {
          scrubInput: true,
          policies: [
            { name: 'custom', scrubInput: true, entities: ['CREDIT_CARD'] },
          ],
        },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    // policies[] took precedence over flat synthesis
    expect(saved.pii.policies).toHaveLength(1);
    expect(saved.pii.policies[0].name).toBe('custom');
    expect(saved.pii.policies[0].target).toBe('request');
    expect(saved.pii.scrubInput).toBeUndefined();
  });
});

// ─── outputBufferSize carry-over ───────────────────────────────────────────────

describe('migrateProjectConfigs — outputBufferSize carry-over', () => {
  it('is not part of flat PII synthesis (no outputBufferSize at old top level)', async () => {
    // Old flat PII had no outputBufferSize — synthesized policy has none either
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Test', models: [], tokens: [], members: [],
        pii: { scrubInput: true, entities: ['EMAIL'] },
      },
    ] as any);

    await migrateProjectConfigs();

    const saved = (mockWriteConfig.mock.calls[0]![1] as any[])[0];
    expect(saved.pii.policies[0].outputBufferSize).toBeUndefined();
  });
});

// ─── multi-project loop + count ───────────────────────────────────────────────

describe('migrateProjectConfigs — multi-project loop', () => {
  it('migrates multiple projects and returns the number of changed ones', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Alpha', models: [], tokens: [], members: [],
        guardrails: { action: 'block', rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }] },
      },
      {
        id: 'p2', name: 'Beta', models: [], tokens: [], members: [],
        // already migrated — no action
        guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['y'] } }] },
      },
      {
        id: 'p3', name: 'Gamma', models: [], tokens: [], members: [],
        pii: { scrubOutput: true },
      },
    ] as any);

    const count = await migrateProjectConfigs();

    // p1 and p3 changed; p2 was already new-shape
    expect(count).toBe(2);
    expect(mockWriteConfig).toHaveBeenCalledTimes(1);
  });

  it('writeConfig is NOT called when zero projects need migration', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'p1', name: 'Test', models: [], tokens: [], members: [] },
      { id: 'p2', name: 'Test2', models: [], tokens: [], members: [] },
    ] as any);

    const count = await migrateProjectConfigs();
    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('writeConfig is called with the full updated projects array', async () => {
    mockReadConfig.mockResolvedValue([
      {
        id: 'p1', name: 'Alpha', models: [], tokens: [], members: [],
        guardrails: { action: 'log', rules: [] },
      },
    ] as any);

    await migrateProjectConfigs();

    expect(mockWriteConfig).toHaveBeenCalledWith('routers', expect.any(Array));
    const saved = mockWriteConfig.mock.calls[0]![1] as any[];
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('p1');
  });
});

// ─── migrateSettings ───────────────────────────────────────────────────────────

describe('migrateSettings', () => {
  it('drops a removed key and writes settings back', async () => {
    mockReadConfig.mockResolvedValue({ port: 3000, host: '0.0.0.0', defaultTimeoutMs: 30000 } as any);

    const dropped = await migrateSettings();

    expect(dropped).toEqual(['defaultTimeoutMs']);
    expect(mockWriteConfig).toHaveBeenCalledWith('settings', { port: 3000, host: '0.0.0.0' });
  });

  it('writeConfig is NOT called when no removed key is stored', async () => {
    mockReadConfig.mockResolvedValue({ port: 3000, host: '0.0.0.0' } as any);

    const dropped = await migrateSettings();

    expect(dropped).toEqual([]);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});

// ─── migrateRouterStorage (RTR-01: projects.json → routers.json) ─────────────

describe('migrateRouterStorage', () => {
  it('EC1: routers.json already exists → no-op, legacy file never read', async () => {
    mockReadFile.mockResolvedValueOnce('[]');

    const result = await migrateRouterStorage();

    expect(result).toBeUndefined();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith(CONFIG_PATHS.routers, 'utf-8');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('AC2: neither file exists (fresh install) → no-op, no write', async () => {
    mockReadFile.mockRejectedValueOnce(enoent()).mockRejectedValueOnce(enoent());

    const result = await migrateRouterStorage();

    expect(result).toBeUndefined();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('AC1/AC7: projects.json present with entities → migrated to routers.json unchanged, count returned', async () => {
    const legacy = [
      { id: 'p1', name: 'Alpha', models: [], tokens: [{ id: 't1' }], members: [{ userId: 'u1' }] },
      { id: 'p2', name: 'Beta', models: [], tokens: [], members: [] },
    ];
    mockReadFile.mockRejectedValueOnce(enoent()).mockResolvedValueOnce(JSON.stringify(legacy));

    const result = await migrateRouterStorage();

    expect(result).toBe(2);
    expect(mockWriteConfig).toHaveBeenCalledWith('routers', legacy);
  });

  it('EC2: projects.json present but empty array → migrates cleanly, count=0, no error', async () => {
    mockReadFile.mockRejectedValueOnce(enoent()).mockResolvedValueOnce('[]');

    const result = await migrateRouterStorage();

    expect(result).toBe(0);
    expect(mockWriteConfig).toHaveBeenCalledWith('routers', []);
  });

  it('EC3: projects.json present but not valid JSON → throws, no write', async () => {
    mockReadFile.mockRejectedValueOnce(enoent()).mockResolvedValueOnce('{not json');

    await expect(migrateRouterStorage()).rejects.toThrow(/not valid JSON/);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('EC3: projects.json present but not an array → throws, no write', async () => {
    mockReadFile.mockRejectedValueOnce(enoent()).mockResolvedValueOnce('{"id":"p1"}');

    await expect(migrateRouterStorage()).rejects.toThrow(/expected an array/);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('a non-ENOENT read error on routers.json propagates', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    await expect(migrateRouterStorage()).rejects.toThrow('EACCES');
  });
});

// ─── migrateRolePermissions (RTR-01: project:read/write → router:read/write) ─

describe('migrateRolePermissions', () => {
  it('rewrites project:read/project:write on a custom role, writes back', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'r1', name: 'Custom', permissions: ['project:read', 'project:write', 'model:read'] },
      { id: 'r2', name: 'Untouched', permissions: ['model:read'] },
    ] as any);

    const count = await migrateRolePermissions();

    expect(count).toBe(1);
    const saved = (mockWriteConfig.mock.calls[0]![1] as any[]);
    expect(saved[0].permissions).toEqual(['router:read', 'router:write', 'model:read']);
    expect(saved[1].permissions).toEqual(['model:read']);
  });

  it('EC1: no legacy permission strings present → no write, count=0', async () => {
    mockReadConfig.mockResolvedValue([
      { id: 'r1', name: 'Already migrated', permissions: ['router:read', 'router:write'] },
    ] as any);

    const count = await migrateRolePermissions();

    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});

// ─── migrateUsageRouterId (RTR-01: projectId → routerId) ──────────────────────

describe('migrateUsageRouterId', () => {
  it('renames projectId to routerId on every record, writes back', async () => {
    mockReadConfig.mockResolvedValue([
      { projectId: 'p1', modelId: 'm1', tokensIn: 10 },
      { projectId: 'p2', modelId: 'm2', tokensIn: 20 },
    ] as any);

    const count = await migrateUsageRouterId();

    expect(count).toBe(2);
    const saved = (mockWriteConfig.mock.calls[0]![1] as any[]);
    expect(saved[0]).toEqual({ modelId: 'm1', tokensIn: 10, routerId: 'p1' });
    expect(saved[0].projectId).toBeUndefined();
  });

  it('EC1: first record already has no projectId → no-op, no write', async () => {
    mockReadConfig.mockResolvedValue([
      { routerId: 'r1', modelId: 'm1', tokensIn: 10 },
    ] as any);

    const count = await migrateUsageRouterId();

    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('EC2: empty usage array → no-op, no write', async () => {
    mockReadConfig.mockResolvedValue([] as any);

    const count = await migrateUsageRouterId();

    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});

// ─── migrateNotificationChannelScope (RTR-01: projectIds → routerIds) ────────

describe('migrateNotificationChannelScope', () => {
  it('renames projectIds to routerIds on channels that have it, writes settings back', async () => {
    mockReadConfig.mockResolvedValue({
      notifications: {
        channels: [
          { id: 'c1', type: 'slack', projectIds: ['p1', 'p2'] },
          { id: 'c2', type: 'email' },
        ],
      },
    } as any);

    const count = await migrateNotificationChannelScope();

    expect(count).toBe(1);
    const saved = mockWriteConfig.mock.calls[0]![1] as any;
    expect(saved.notifications.channels[0].routerIds).toEqual(['p1', 'p2']);
    expect(saved.notifications.channels[0].projectIds).toBeUndefined();
    expect(saved.notifications.channels[1].routerIds).toBeUndefined();
  });

  it('EC1: no channel has projectIds → no-op, no write', async () => {
    mockReadConfig.mockResolvedValue({
      notifications: { channels: [{ id: 'c1', type: 'email' }] },
    } as any);

    const count = await migrateNotificationChannelScope();

    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('EC2: no channels configured at all → no-op, no write', async () => {
    mockReadConfig.mockResolvedValue({ notifications: {} } as any);

    const count = await migrateNotificationChannelScope();

    expect(count).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});
