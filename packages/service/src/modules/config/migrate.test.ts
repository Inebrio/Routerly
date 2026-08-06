import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
}));

vi.mock('../../lib/paths.js', () => ({
  CONFIG_PATHS: {
    usage: '/test/data/usage.ndjson',
    usageLegacyJson: '/test/data/usage.json',
  },
}));

import { migrateProjectConfigs, migrateSettings, migrateUsageToNdjson } from './migrate.js';
import { readConfig, writeConfig } from './loader.js';
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockUnlink = vi.mocked(unlink);
const mockAccess = vi.mocked(access);

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

    expect(mockWriteConfig).toHaveBeenCalledWith('projects', expect.any(Array));
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

// ─── migrateUsageToNdjson (RTR-06) ─────────────────────────────────────────────

describe('migrateUsageToNdjson', () => {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

  it('is a no-op when usage.ndjson is already present (EC4)', async () => {
    mockAccess.mockResolvedValue(undefined as any);

    const result = await migrateUsageToNdjson();

    expect(result).toBe(0);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('returns 0 when there is no legacy usage.json (fresh install)', async () => {
    mockAccess.mockRejectedValue(enoent());
    mockReadFile.mockRejectedValue(enoent());

    const result = await migrateUsageToNdjson();

    expect(result).toBe(0);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('migrates an empty legacy file to zero records (EC1)', async () => {
    mockAccess.mockRejectedValue(enoent());
    mockReadFile.mockImplementation(((p: string) => {
      if (p === '/test/data/usage.json') return Promise.resolve('');
      if (String(p).endsWith('.migrate-tmp')) return Promise.resolve('');
      return Promise.reject(new Error(`unexpected readFile path ${p}`));
    }) as any);

    const result = await migrateUsageToNdjson();

    expect(result).toBe(0);
    expect(mockRename).toHaveBeenCalledWith(expect.stringContaining('.migrate-tmp'), '/test/data/usage.ndjson');
    expect(mockRename).toHaveBeenCalledWith('/test/data/usage.json', '/test/data/usage.json.migrated');
  });

  it('throws on a corrupted legacy file instead of silently discarding data (EC2)', async () => {
    mockAccess.mockRejectedValue(enoent());
    mockReadFile.mockImplementation(((p: string) => {
      if (p === '/test/data/usage.json') return Promise.resolve('{not valid json');
      return Promise.reject(new Error(`unexpected readFile path ${p}`));
    }) as any);

    await expect(migrateUsageToNdjson()).rejects.toThrow();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('throws when the legacy file is valid JSON but not an array', async () => {
    mockAccess.mockRejectedValue(enoent());
    mockReadFile.mockImplementation(((p: string) => {
      if (p === '/test/data/usage.json') return Promise.resolve('{"not":"an array"}');
      return Promise.reject(new Error(`unexpected readFile path ${p}`));
    }) as any);

    await expect(migrateUsageToNdjson()).rejects.toThrow('expected a JSON array');
  });

  it('migrates a realistic multi-record fixture with a verified round-trip count (AC5)', async () => {
    mockAccess.mockRejectedValue(enoent());
    const records = Array.from({ length: 250 }, (_, i) => ({
      id: `u${i}`,
      projectId: 'p1',
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      cost: i * 0.01,
    }));
    const legacyJson = JSON.stringify(records);
    let writtenTmpContent = '';
    mockReadFile.mockImplementation(((p: string) => {
      if (p === '/test/data/usage.json') return Promise.resolve(legacyJson);
      if (String(p).endsWith('.migrate-tmp')) return Promise.resolve(writtenTmpContent);
      return Promise.reject(new Error(`unexpected readFile path ${p}`));
    }) as any);
    mockWriteFile.mockImplementation(((p: string, content: string) => {
      if (String(p).endsWith('.migrate-tmp')) writtenTmpContent = content;
      return Promise.resolve(undefined);
    }) as any);

    const result = await migrateUsageToNdjson();

    expect(result).toBe(250);
    const lines = writtenTmpContent.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(250);
    expect(JSON.parse(lines[0]!).id).toBe('u0');
    expect(mockRename).toHaveBeenCalledWith(expect.stringContaining('.migrate-tmp'), '/test/data/usage.ndjson');
    expect(mockRename).toHaveBeenCalledWith('/test/data/usage.json', '/test/data/usage.json.migrated');
  });

  it('throws and cleans up the temp file when the round-trip line count does not match', async () => {
    mockAccess.mockRejectedValue(enoent());
    const records = [{ id: 'u1' }, { id: 'u2' }];
    mockReadFile.mockImplementation(((p: string) => {
      if (p === '/test/data/usage.json') return Promise.resolve(JSON.stringify(records));
      // Simulate a corrupted read-back: fewer lines than were meant to be written.
      if (String(p).endsWith('.migrate-tmp')) return Promise.resolve(`${JSON.stringify(records[0])}\n`);
      return Promise.reject(new Error(`unexpected readFile path ${p}`));
    }) as any);

    await expect(migrateUsageToNdjson()).rejects.toThrow('line-count mismatch');
    expect(mockUnlink).toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });
});
