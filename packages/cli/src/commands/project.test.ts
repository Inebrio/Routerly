import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

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

vi.mock('../store.js', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({
    alias: 'test',
    serverUrl: 'http://localhost:3000',
    email: 'admin@example.com',
    token: 'jwt-test',
    expiresAt: Date.now() + 3_600_000,
  }),
}));

import { makeProjectCommand } from './project.js';
import type { GuardrailRule } from '@routerly/shared';

afterEach(() => vi.clearAllMocks());

function makeCmd() {
  const cmd = makeProjectCommand();
  cmd.exitOverride();
  return cmd;
}

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

// ─── rulesSummary (via guardrails show) ──────────────────────────────────────

describe('guardrails show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders rule detail for regex rule with block:true (no block badge — invariant)', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{ type: 'regex' as const, target: 'request' as const, config: { patterns: ['bad'] }, block: true }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    // block/log badges removed from rulesSummary (they are invariants for judged rules)
    expect(out).not.toContain('[block]');
    expect(out).not.toContain('[log]');
    expect(out).toContain('pattern(s)');
    expect(out).toContain('request');
  });

  it('renders rule detail for regex rule with log:true only (no log badge — invariant)', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{ type: 'regex' as const, target: 'request' as const, config: { patterns: ['maybe'] }, log: true }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    // block/log badges removed (invariants)
    expect(out).not.toContain('[log]');
    expect(out).not.toContain('[block]');
    expect(out).toContain('pattern(s)');
  });

  it('renders rule detail for topic rule with block+log (no block+log badge — invariant)', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'topic' as const, target: 'request' as const,
          config: { modelId: 'gpt-4', allowedTopics: 'coding', threshold: 0.5 },
          block: true, log: true,
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    // block/log badges removed (invariants); judge model detail is shown instead
    expect(out).not.toContain('[block+log]');
    expect(out).toContain('gpt-4');
  });

  it('renders rule detail for moderation rule (no judge-response badge — invariant)', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const, target: 'request' as const,
          config: { modelId: 'gpt-4', threshold: 0.5 },
          block: true, useJudgeResponse: true,
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    // judge-response badge removed (invariant); judge model detail is shown
    expect(out).not.toContain('[judge-response]');
    expect(out).toContain('gpt-4');
  });

  it('shows no badge when neither block nor log', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'semantic' as const, target: 'both' as const,
          config: { embeddingModelId: 'text-embed-3', examples: ['hack'], threshold: 0.82 },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    expect(out).not.toContain('[block]');
    expect(out).not.toContain('[log]');
    expect(out).not.toContain('[judge-response]');
  });

  it('outputs raw JSON with --json', async () => {
    const guardrails = { rules: [] };
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(guardrails);
  });

  it('shows empty state when no rules', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('No rules configured');
  });
});

// ─── guardrails update ────────────────────────────────────────────────────────

describe('guardrails update', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('detectInjection is preserved as passthrough in PATCH when value exists in config', async () => {
    // --detect-injection flag was removed; value from existing config is spread into the PATCH body
    const rules: GuardrailRule[] = [
      { type: 'regex', target: 'request', config: { patterns: ['x'] }, block: true },
    ];
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { detectInjection: true, rules } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '0']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: Record<string, unknown> };
    expect(payload.guardrails.detectInjection).toBe(true);
  });

  it('does not accept --detect-injection flag (flag was removed)', async () => {
    await expect(makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--detect-injection'])).rejects.toThrow();
  });

  it('--remove-rule removes the rule at the given index', async () => {
    const rules: GuardrailRule[] = [
      { type: 'regex', target: 'request', config: { patterns: ['a'] }, block: true },
      { type: 'regex', target: 'response', config: { patterns: ['b'] }, log: true },
    ];
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '0']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    expect(payload.guardrails.rules).toHaveLength(1);
    expect((payload.guardrails.rules[0]!.config as { patterns: string[] }).patterns).toEqual(['b']);
  });

  it('--remove-rule out of bounds exits 1', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '5'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('no longer accepts --action flag', async () => {
    // Commander raises an error on unknown options when exitOverride() is active
    await expect(makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--action', 'block'])).rejects.toThrow();
  });

  it('payload has no action or fallbackMessage fields', async () => {
    const rules: GuardrailRule[] = [
      { type: 'regex', target: 'request', config: { patterns: ['test'] }, block: true },
    ];
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '0']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: Record<string, unknown> };
    expect(payload.guardrails).not.toHaveProperty('action');
    expect(payload.guardrails).not.toHaveProperty('fallbackMessage');
  });
});

// ─── pii list ─────────────────────────────────────────────────────────────────

describe('pii list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows table with policies', async () => {
    const project = {
      ...baseProject,
      // ponytail: name field omitted — PiiPolicy.name was removed; table has no Name column
      pii: { policies: [{ enabled: true, target: 'both' as const, entities: ['EMAIL', 'PHONE'] }] },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    const out = lines.join('\n');
    // Table columns: #, Enabled, Target, Entities, Patterns, Buffer — no Name column
    expect(out).toContain('both');
    expect(out).toContain('EMAIL');
    expect(out).not.toContain('Name');
  });

  it('outputs raw JSON with --json', async () => {
    const pii = { policies: [{ enabled: true, target: 'request' as const }] };
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api', '--json']);
    expect(JSON.parse(lines.join('\n'))).toEqual(pii);
  });

  it('shows empty state when no policies', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No PII policies');
  });
});

// ─── pii add ─────────────────────────────────────────────────────────────────

describe('pii add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds a new policy and patches the API with correct shape', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // wizard: target / entities / customPatterns (no name prompt)
          .mockResolvedValueOnce({ target: 'both', entities: 'EMAIL,PHONE', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '50' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    expect(patchCall).toBeDefined();
    const payload = patchCall![2] as { pii: { policies: Array<{ target: string; entities: string[]; outputBufferSize: number }> } };
    expect(payload.pii.policies).toHaveLength(1);
    // name field no longer set — PiiPolicy.name was removed
    expect(payload.pii.policies[0]).not.toHaveProperty('name');
    expect(payload.pii.policies[0]!.target).toBe('both');
    expect(payload.pii.policies[0]!.entities).toEqual(['EMAIL', 'PHONE']);
    expect(payload.pii.policies[0]!.outputBufferSize).toBe(50);
    vi.doUnmock('inquirer');
  });

  it('skips outputBufferSize field when using default (30)', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // no name prompt
          .mockResolvedValueOnce({ target: 'response', entities: 'CREDIT_CARD', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '30' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: Array<Record<string, unknown>> } };
    expect(payload.pii.policies[0]).not.toHaveProperty('outputBufferSize');
    vi.doUnmock('inquirer');
  });

  it('adding a second policy appends it without error (no duplicate-name check)', async () => {
    // Duplicate-name check was removed with PiiPolicy.name. Adding always appends.
    mockApi.mockResolvedValueOnce([{
      ...baseProject,
      pii: { policies: [{ enabled: true, target: 'request' as const }] },
    }]).mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    expect(patchCall).toBeDefined();
    const payload = patchCall![2] as { pii: { policies: unknown[] } };
    // existing policy + new one = 2
    expect(payload.pii.policies).toHaveLength(2);
    vi.doUnmock('inquirer');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    // ApiError at GET (resolveProject) — wizard never runs
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('outputBufferSize validate: rejects out-of-range, accepts valid', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    // Capture the prompt config so we can call validate directly
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    const promptSpy = vi.fn()
      // no name prompt; first call: target/entities/customPatterns
      .mockImplementationOnce(async () => ({ target: 'response', entities: '', customPatterns: '' }))
      .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string; [k: string]: unknown }>) => {
        capturedValidate = questions[0]?.validate;
        return { outputBufferSize: '50' };
      });

    vi.doMock('inquirer', () => ({ default: { prompt: promptSpy } }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);

    expect(capturedValidate).toBeDefined();
    // Out-of-range: below min
    expect(capturedValidate!('5')).toBe('Must be a number between 10 and 500');
    // Out-of-range: above max
    expect(capturedValidate!('1000')).toBe('Must be a number between 10 and 500');
    // Not a number
    expect(capturedValidate!('abc')).toBe('Must be a number between 10 and 500');
    // Valid: lower bound
    expect(capturedValidate!('10')).toBe(true);
    // Valid: upper bound
    expect(capturedValidate!('500')).toBe(true);
    // Valid: mid-range
    expect(capturedValidate!('30')).toBe(true);

    vi.doUnmock('inquirer');
  });
});

// ─── rulesSummary fallback suffix ─────────────────────────────────────────────

describe('rulesSummary fallback suffix', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders (+2 fallback) for a topic rule with 2 fallbacks', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'topic' as const, target: 'request' as const,
          config: { modelId: 'gpt-4', allowedTopics: 'coding', threshold: 0.5, fallbackModelIds: ['m2', 'm3'] },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('(+2 fallback)');
  });

  it('renders (+1 fallback) for a moderation rule with 1 fallback', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const, target: 'both' as const,
          config: { modelId: 'gpt-4', threshold: 0.5, fallbackModelIds: ['gpt-3.5'] },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('(+1 fallback)');
  });

  it('renders (+2 fallback) for a semantic rule with 2 fallbacks', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'semantic' as const, target: 'request' as const,
          config: { embeddingModelId: 'embed-1', examples: ['hack'], threshold: 0.82, fallbackModelIds: ['embed-2', 'embed-3'] },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('(+2 fallback)');
  });

  it('renders no fallback suffix when fallbackModelIds is absent', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'topic' as const, target: 'request' as const,
          config: { modelId: 'gpt-4', allowedTopics: 'coding', threshold: 0.5 },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).not.toContain('fallback');
  });
});

// ─── runAddRuleWizard fallbackModelIds ────────────────────────────────────────

describe('runAddRuleWizard fallbackModelIds', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('topic rule: comma-separated input yields fallbackModelIds with primary filtered, order preserved', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          // type
          .mockResolvedValueOnce({ type: 'topic' })
          // scope checkbox (topic/moderation now uses checkbox, not list; no block/log prompts)
          .mockResolvedValueOnce({ scope: ['request'] })
          // allowedTopics (separate prompt)
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          // judge params + fallback in one call (modelId, threshold, fallbackModelIds)
          .mockResolvedValueOnce({ modelId: 'm1primary', threshold: '0.5', fallbackModelIds: 'm2, m3, m1primary' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const cfg = payload.guardrails.rules[0]!.config as { fallbackModelIds?: string[] };
    expect(cfg.fallbackModelIds).toEqual(['m2', 'm3']);
    vi.doUnmock('inquirer');
  });

  it('topic rule: empty fallback input yields no fallbackModelIds key', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    expect(payload.guardrails.rules[0]!.config).not.toHaveProperty('fallbackModelIds');
    vi.doUnmock('inquirer');
  });

  it('moderation rule: carries fallbackModelIds', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'moderation' })
          // scope checkbox (no block/log prompts)
          .mockResolvedValueOnce({ scope: ['request'] })
          // systemPrompt now required for moderation
          .mockResolvedValueOnce({ systemPrompt: 'block harmful content' })
          // judge params + fallback in one call
          .mockResolvedValueOnce({ modelId: 'mod-primary', threshold: '0.5', fallbackModelIds: 'mod-b, mod-c' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const cfg = payload.guardrails.rules[0]!.config as { fallbackModelIds?: string[] };
    expect(cfg.fallbackModelIds).toEqual(['mod-b', 'mod-c']);
    vi.doUnmock('inquirer');
  });

  it('semantic rule: carries fallbackModelIds', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'semantic' })
          // semantic still uses list prompt for target (not checkbox)
          .mockResolvedValueOnce({ target: 'request' })
          // embeddingModelId, examples, threshold (one call)
          .mockResolvedValueOnce({ embeddingModelId: 'embed-primary', examples: 'hack the system', threshold: '0.82' })
          // fallback (separate call)
          .mockResolvedValueOnce({ fallbackModelIds: 'embed-2, embed-3' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const cfg = payload.guardrails.rules[0]!.config as { fallbackModelIds?: string[] };
    expect(cfg.fallbackModelIds).toEqual(['embed-2', 'embed-3']);
    vi.doUnmock('inquirer');
  });
});

// ─── pii remove ──────────────────────────────────────────────────────────────

describe('pii remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes policy at index 0, leaving the remaining policy', async () => {
    // pii remove is now index-based (0-based), matching the # column in pii list
    const project = {
      ...baseProject,
      pii: {
        policies: [
          { enabled: true, target: 'both' as const },
          { enabled: true, target: 'request' as const },
        ],
      },
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '0']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    expect(patchCall).toBeDefined();
    const payload = patchCall![2] as { pii: { policies: Array<{ target: string }> } };
    expect(payload.pii.policies).toHaveLength(1);
    expect(payload.pii.policies[0]!.target).toBe('request');
  });

  it('exits 1 for out-of-range index', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [{ enabled: true, target: 'both' as const }] } }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '5'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid index'));
  });

  it('exits 1 for non-numeric index', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [{ enabled: true, target: 'both' as const }] } }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', 'foo'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid index'));
  });

  it('exits 1 on ApiError when index is valid', async () => {
    const { ApiError } = await import('../api.js');
    // GET succeeds, PATCH throws
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [{ enabled: true, target: 'both' as const }] } }])
           .mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

// ─── project list ──────────────────────────────────────────────────────────────

describe('project list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows table with projects', async () => {
    const projects = [
      { ...baseProject, id: 'aaaa-bbbb-cccc-1234', tokens: [{ id: 't1' }], members: [{ userId: 'u1', role: 'editor' }] },
    ];
    mockApi.mockResolvedValueOnce(projects);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('my-api');
    expect(out).toContain('5s');
  });

  it('shows empty state when no projects', async () => {
    mockApi.mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'list']);
    expect(lines.join('\n')).toContain('No projects yet');
  });

  it('exits 1 on error', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── project show ──────────────────────────────────────────────────────────────

describe('project show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows project details with members and tokens', async () => {
    const project = {
      ...baseProject,
      routingModelId: 'gpt-4',
      fallbackRoutingModelIds: ['gpt-3.5'],
      policies: [{ type: 'health' as const, enabled: true }],
      models: [{ modelId: 'openai/gpt-4', prompt: 'Use for complex tasks' }],
      tokens: [{ id: 't1', tokenSnippet: 'abc123', createdAt: '2024-01-01T00:00:00Z', labels: ['prod'], models: [{ modelId: 'gpt-4', limits: [{ metric: 'cost' as const, windowType: 'period' as const, period: 'hourly' as const, value: 10 }] }] }],
      members: [{ userId: 'u1', role: 'editor' }],
    };
    mockApi.mockResolvedValueOnce([project])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('my-api');
    expect(out).toContain('gpt-4');
    expect(out).toContain('alice@example.com');
    expect(out).toContain('prod');
    expect(out).toContain('health');
  });

  it('shows empty states for no models/tokens/members', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('(none)');
  });

  it('shows unknown userId as gray snippet when user not found in list', async () => {
    const project = {
      ...baseProject,
      members: [{ userId: 'unknown-user-id', role: 'viewer' }],
    };
    mockApi.mockResolvedValueOnce([project])
           .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    // resolveUserEmail returns a gray snippet when user not found
    expect(out).toContain('unknown-');
  });

  it('shows model with long prompt truncated', async () => {
    const project = {
      ...baseProject,
      models: [{ modelId: 'openai/gpt-4', prompt: 'A'.repeat(80) }],
    };
    mockApi.mockResolvedValueOnce([project])
           .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('…');
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'show', 'no-such-project'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'show', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows no-routing-model and no-fallbacks states', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('(not set)');
    expect(out).toContain('(none');
  });
});

// ─── project create ────────────────────────────────────────────────────────────

describe('project create', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates project with defaults and shows token', async () => {
    const resp = { ...baseProject, token: 'sk-rt-abc123' };
    mockApi.mockResolvedValueOnce(resp);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('my-api');
    expect(out).toContain('sk-rt-abc123');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ name: 'my-api', timeoutMs: 2000, autoRouting: true });
  });

  it('creates project with routing model and custom timeout', async () => {
    mockApi.mockResolvedValueOnce({ ...baseProject });
    await makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api', '--timeout', '10000', '--routing-model', 'gpt-4']);
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ timeoutMs: 10000, routingModelId: 'gpt-4' });
  });

  it('creates project with auto-routing disabled', async () => {
    mockApi.mockResolvedValueOnce({ ...baseProject });
    await makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api', '--no-auto-routing']);
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ autoRouting: false });
  });

  it('shows next steps even when no token in response', async () => {
    mockApi.mockResolvedValueOnce({ ...baseProject });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api']);
    expect(lines.join('\n')).toContain('Next steps');
  });

  it('exits 1 on 409 conflict', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });

  it('exits 1 on other ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

// ─── project edit ──────────────────────────────────────────────────────────────

describe('project edit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 when no flags provided', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'edit', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('at least --name or --timeout'));
  });

  it('updates project name', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'edit', 'my-api', '--name', 'new-name']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ name: 'new-name' });
    expect(lines.join('\n')).toContain('updated');
  });

  it('updates project timeout', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'edit', 'my-api', '--timeout', '10000']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ timeoutMs: 10000 });
  });

  it('exits 1 on 409 conflict', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(409, 'conflict'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'edit', 'my-api', '--name', 'taken'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'edit', 'my-api', '--name', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });

  it('exits 1 on other ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'edit', 'my-api', '--name', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

// ─── project remove ────────────────────────────────────────────────────────────

describe('project remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes a project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'remove', 'my-api']);
    const delCall = mockApi.mock.calls.find(c => c[0] === 'DELETE');
    expect(delCall).toBeDefined();
    expect(lines.join('\n')).toContain('removed');
  });

  it('exits 1 when project not found', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'remove', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'remove', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'remove', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── routing show ──────────────────────────────────────────────────────────────

describe('routing show', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows routing config with policies', async () => {
    const project = {
      ...baseProject,
      routingModelId: 'gpt-4',
      fallbackRoutingModelIds: ['gpt-3.5'],
      policies: [{ type: 'health' as const, enabled: true, config: { param: 1 } }],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('gpt-4');
    expect(out).toContain('gpt-3.5');
    expect(out).toContain('health');
  });

  it('shows no-policies state', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('No routing policies');
  });

  it('shows no-routing-model and empty-fallbacks', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, autoRouting: false }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('(not set)');
    expect(out).toContain('(none)');
    expect(out).toContain('disabled');
  });

  it('exits 1 on error', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('fail'));
    // resolveProject is first, but routing show only calls resolveProject then displays
    // Simulate not-found
    mockApi.mockReset();
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on non-ApiError from resolveProject', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── routing update ────────────────────────────────────────────────────────────

describe('routing update', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('enables auto-routing and sets routing model', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--routing-model', 'gpt-4', '--auto-routing']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ autoRouting: true, routingModelId: 'gpt-4' });
  });

  it('disables auto-routing', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, autoRouting: true }]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--no-auto-routing']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ autoRouting: false });
  });

  it('sets fallback routing models', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--fallback-models', 'gpt-3.5,gpt-4o-mini']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ fallbackRoutingModelIds: ['gpt-3.5', 'gpt-4o-mini'] });
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--auto-routing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--auto-routing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

// ─── routing policy ────────────────────────────────────────────────────────────

describe('routing policy list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows policies table', async () => {
    const project = {
      ...baseProject,
      policies: [
        { type: 'health' as const, enabled: true },
        { type: 'cheapest' as const, enabled: false, config: { param: 1 } },
      ],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('health');
    expect(out).toContain('cheapest');
  });

  it('shows empty state when no policies', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No routing policies');
  });

  it('exits 1 on error', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('network fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network fail'));
  });
});

describe('routing policy enable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds a new policy when not present', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string; enabled: boolean }> };
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]).toMatchObject({ type: 'health', enabled: true });
    expect(lines.join('\n')).toContain('enabled');
  });

  it('enables existing disabled policy', async () => {
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: false }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string; enabled: boolean }> };
    expect(body.policies[0]).toMatchObject({ type: 'health', enabled: true });
  });

  it('enables policy with --config and updates existing config', async () => {
    const project = { ...baseProject, policies: [{ type: 'llm' as const, enabled: true, config: { old: 1 } }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'llm', '--config', '{"memoryCount":3}']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string; config: unknown }> };
    expect(body.policies[0]!.config).toEqual({ memoryCount: 3 });
  });

  it('exits 1 on invalid JSON in --config', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health', '--config', 'not-json'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('routing policy disable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('disables an existing policy', async () => {
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: true }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'disable', 'my-api', 'health']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string; enabled: boolean }> };
    expect(body.policies[0]).toMatchObject({ enabled: false });
    expect(lines.join('\n')).toContain('disabled');
  });

  it('shows warning when policy not configured', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'disable', 'my-api', 'health']);
    expect(lines.join('\n')).toContain('not configured');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: true }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'disable', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: true }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'disable', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('routing policy reorder', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reorders policies per given order, appends unmentioned', async () => {
    const project = {
      ...baseProject,
      policies: [
        { type: 'cheapest' as const, enabled: true },
        { type: 'health' as const, enabled: true },
        { type: 'context' as const, enabled: false },
      ],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'reorder', 'my-api', 'health,cheapest']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string }> };
    expect(body.policies[0]!.type).toBe('health');
    expect(body.policies[1]!.type).toBe('cheapest');
    // context not in order list → appended
    expect(body.policies[2]!.type).toBe('context');
    expect(lines.join('\n')).toContain('reordered');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: true }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'reorder', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    const project = { ...baseProject, policies: [{ type: 'health' as const, enabled: true }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'reorder', 'my-api', 'health'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

// ─── model subcommands ─────────────────────────────────────────────────────────

describe('model list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows models table with prompt truncated at 60 chars', async () => {
    const project = {
      ...baseProject,
      models: [
        { modelId: 'openai/gpt-4', prompt: 'A'.repeat(80) },
        { modelId: 'openai/gpt-3.5' },
      ],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('openai/gpt-4');
    expect(out).toContain('…');
  });

  it('shows empty state when no models', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No models configured');
  });

  it('exits 1 on error', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'list', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('model add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds model without prompt', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'add', 'my-api', 'openai/gpt-4']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toEqual({ modelId: 'openai/gpt-4' });
    expect(lines.join('\n')).toContain('added');
  });

  it('adds model with prompt', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'model', 'add', 'my-api', 'openai/gpt-4', '--prompt', 'Use for fast tasks']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models[0]).toEqual({ modelId: 'openai/gpt-4', prompt: 'Use for fast tasks' });
  });

  it('shows warning when model already in project', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'add', 'my-api', 'openai/gpt-4']);
    expect(lines.join('\n')).toContain('already in project');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'add', 'my-api', 'openai/gpt-4'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'add', 'my-api', 'openai/gpt-4'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('model remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes model from project', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }, { modelId: 'openai/gpt-3.5' }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'remove', 'my-api', 'openai/gpt-4']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string }> };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.modelId).toBe('openai/gpt-3.5');
    expect(lines.join('\n')).toContain('removed');
  });

  it('exits 1 when model not in project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'remove', 'my-api', 'openai/gpt-4'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not in project'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'remove', 'my-api', 'openai/gpt-4'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'remove', 'my-api', 'openai/gpt-4'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('model set-prompt', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sets prompt on a model', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', 'Use for complex tasks']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models[0]).toEqual({ modelId: 'openai/gpt-4', prompt: 'Use for complex tasks' });
    expect(lines.join('\n')).toContain('Prompt updated');
  });

  it('clears prompt when empty string provided', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4', prompt: 'old' }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', '']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models[0]).toEqual({ modelId: 'openai/gpt-4' });
    expect(body.models[0]).not.toHaveProperty('prompt');
  });

  it('exits 1 when model not in project', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not in project'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

// ─── token subcommands ─────────────────────────────────────────────────────────

describe('token list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows tokens table with labels, tags, and per-model limits', async () => {
    const project = {
      ...baseProject,
      tokens: [
        {
          id: 'tok-1',
          tokenSnippet: 'abc123',
          createdAt: '2024-01-15T10:00:00Z',
          labels: ['prod', 'v2'],
          tags: { env: 'production', region: 'us-east' },
          models: [
            { modelId: 'gpt-4', limits: [{ metric: 'cost' as const, windowType: 'period' as const, period: 'hourly' as const, value: 10 }] },
          ],
        },
      ],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('abc123');
    expect(out).toContain('prod');
    expect(out).toContain('env=production');
    expect(out).toContain('gpt-4');
  });

  it('shows token without labels/tags/limits', async () => {
    const project = {
      ...baseProject,
      tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-15T10:00:00Z' }],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('abc');
  });

  it('shows empty state when no tokens', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No tokens');
  });

  it('exits 1 on error', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'list', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('token create', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates token with no options', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce({ token: 'sk-rt-abc', tokenInfo: { id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('sk-rt-abc');
    expect(out).toContain('tok-1');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toEqual({});
  });

  it('creates token with labels', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce({ token: 'sk-rt-xyz', tokenInfo: { id: 'tok-2', tokenSnippet: 'xyz', createdAt: '2024-01-01' } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api', '--labels', 'dev,staging']);
    const out = lines.join('\n');
    expect(out).toContain('dev');
    expect(out).toContain('staging');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ labels: ['dev', 'staging'] });
  });

  it('creates token with scopes', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce({ token: 'sk-rt-scp', tokenInfo: { id: 'tok-s', tokenSnippet: 'scp', createdAt: '2024-01-01' } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api', '--scopes', 'mcp,mcp:write']);
    const out = lines.join('\n');
    expect(out).toContain('mcp');
    expect(out).toContain('mcp:write');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ scopes: ['mcp', 'mcp:write'] });
  });

  it('creates token with tags', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce({ token: 'sk-rt-xyz', tokenInfo: { id: 'tok-3', tokenSnippet: 'xyz', createdAt: '2024-01-01' } });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api', '--tag', 'env=prod', '--tag', 'region=us']);
    const out = lines.join('\n');
    expect(out).toContain('env=prod');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ tags: { env: 'prod', region: 'us' } });
  });

  it('creates token with tag without value (key only)', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce({ token: 'sk-rt-xyz', tokenInfo: { id: 'tok-4', tokenSnippet: 'xyz', createdAt: '2024-01-01' } });
    await makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api', '--tag', 'mykey']);
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ tags: { mykey: '' } });
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'create', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('token edit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const tokenWithLimits = {
    id: 'tok-1',
    tokenSnippet: 'abc',
    createdAt: '2024-01-01',
    labels: ['dev'],
    tags: { env: 'dev' },
    models: [
      {
        modelId: 'openai/gpt-4',
        limits: [
          { metric: 'cost' as const, windowType: 'period' as const, period: 'hourly' as const, value: 10 },
          { metric: 'calls' as const, windowType: 'rolling' as const, rollingAmount: 1, rollingUnit: 'day' as const, value: 100 },
        ],
      },
    ],
  };

  it('adds a period limit to existing token', async () => {
    const project = { ...baseProject, tokens: [{ ...tokenWithLimits, models: [] }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--add-limit', 'openai/gpt-4:cost:period:hourly:10']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; limits?: unknown[] }> };
    expect(body.models[0]!.modelId).toBe('openai/gpt-4');
    expect(body.models[0]!.limits).toHaveLength(1);
    expect(lines.join('\n')).toContain('updated');
  });

  it('adds a rolling limit to existing token', async () => {
    const project = { ...baseProject, tokens: [{ ...tokenWithLimits, models: [] }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--add-limit', 'openai/gpt-4:calls:rolling:1:day:100']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; limits?: unknown[] }> };
    expect(body.models[0]!.limits).toHaveLength(1);
  });

  it('removes a limit from existing token', async () => {
    const project = { ...baseProject, tokens: [tokenWithLimits] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--remove-limit', 'openai/gpt-4:cost:period']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; limits?: unknown[] }> };
    // cost:period removed, rolling:calls remains; but filter removes entries with 0 limits
    // After removing cost, rolling remains → model entry stays
    const model = body.models.find(m => m.modelId === 'openai/gpt-4');
    expect(model).toBeDefined();
    expect(model!.limits).toHaveLength(1);
  });

  it('removes model entry when last limit removed', async () => {
    const project = {
      ...baseProject,
      tokens: [{
        ...tokenWithLimits,
        models: [{ modelId: 'openai/gpt-4', limits: [{ metric: 'cost' as const, windowType: 'period' as const, period: 'hourly' as const, value: 10 }] }],
      }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--remove-limit', 'openai/gpt-4:cost:period']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: unknown[] };
    expect(body.models).toHaveLength(0);
  });

  it('updates labels', async () => {
    const project = { ...baseProject, tokens: [tokenWithLimits] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'prod,v2']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { labels: string[] };
    expect(body.labels).toEqual(['prod', 'v2']);
  });

  it('updates tags', async () => {
    const project = { ...baseProject, tokens: [tokenWithLimits] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--tag', 'env=prod']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { tags: Record<string, string> };
    expect(body.tags).toEqual({ env: 'prod' });
  });

  it('updates scopes', async () => {
    const project = { ...baseProject, tokens: [tokenWithLimits] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--scopes', 'mcp,mcp:write']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { scopes: string[] };
    expect(body.scopes).toEqual(['mcp', 'mcp:write']);
  });

  it('preserves existing scopes when --scopes omitted', async () => {
    const project = { ...baseProject, tokens: [{ ...tokenWithLimits, scopes: ['mcp'] }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'prod']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { scopes: string[] };
    expect(body.scopes).toEqual(['mcp']);
  });

  it('exits 1 when token not found', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-999', '--labels', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on invalid limit spec (too few parts)', async () => {
    const project = { ...baseProject, tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' }] };
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--add-limit', 'gpt-4:cost'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid limit spec'));
  });

  it('exits 1 on unknown windowType in limit spec', async () => {
    const project = { ...baseProject, tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' }] };
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--add-limit', 'gpt-4:cost:unknown:hourly:10'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown windowType'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    const project = { ...baseProject, tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    const project = { ...baseProject, tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' }] };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('token remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes a token', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'remove', 'my-api', 'tok-1']);
    const delCall = mockApi.mock.calls.find(c => c[0] === 'DELETE');
    expect(delCall).toBeDefined();
    expect(lines.join('\n')).toContain('removed');
  });

  it('exits 1 on 404', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(404, 'not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'remove', 'my-api', 'tok-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on other ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'remove', 'my-api', 'tok-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject]).mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'remove', 'my-api', 'tok-1'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

// ─── member subcommands ────────────────────────────────────────────────────────

describe('member list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows members table with email resolved', async () => {
    const project = { ...baseProject, members: [{ userId: 'u1', role: 'editor' }] };
    mockApi.mockResolvedValueOnce([project])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('alice@example.com');
    expect(out).toContain('editor');
  });

  it('shows empty state when no members', async () => {
    mockApi.mockResolvedValueOnce([baseProject]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No members');
  });

  it('exits 1 on error', async () => {
    mockApi.mockResolvedValueOnce([]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'list', 'no-such'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('member add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('adds a member', async () => {
    mockApi.mockResolvedValueOnce([baseProject])                       // resolveProject
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])  // resolveUserId (GET /api/users)
           .mockResolvedValueOnce(undefined);                          // POST members
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'add', 'my-api', '--email', 'alice@example.com', '--role', 'editor']);
    expect(lines.join('\n')).toContain('added');
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ userId: 'u1', role: 'editor' });
  });

  it('exits 1 when user not found', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([]);  // no users
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'add', 'my-api', '--email', 'nobody@example.com', '--role', 'editor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on 409 (already a member)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new ApiError(409, 'conflict'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'add', 'my-api', '--email', 'alice@example.com', '--role', 'editor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('already a member'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'add', 'my-api', '--email', 'alice@example.com', '--role', 'editor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });

  it('exits 1 on other ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'add', 'my-api', '--email', 'alice@example.com', '--role', 'editor'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

describe('member set-role', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('updates member role', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'set-role', 'my-api', '--email', 'alice@example.com', '--role', 'admin']);
    expect(lines.join('\n')).toContain('admin');
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT' && c[1].includes('/members/'));
    expect(putCall![2]).toMatchObject({ role: 'admin' });
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'set-role', 'my-api', '--email', 'alice@example.com', '--role', 'admin'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'set-role', 'my-api', '--email', 'alice@example.com', '--role', 'admin'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

describe('member remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes a member', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'remove', 'my-api', '--email', 'alice@example.com']);
    expect(lines.join('\n')).toContain('removed');
    const delCall = mockApi.mock.calls.find(c => c[0] === 'DELETE' && c[1].includes('/members/'));
    expect(delCall).toBeDefined();
  });

  it('exits 1 on 404', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new ApiError(404, 'not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'remove', 'my-api', '--email', 'alice@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not a member'));
  });

  it('exits 1 on other ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'remove', 'my-api', '--email', 'alice@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('exits 1 on non-ApiError', async () => {
    mockApi.mockResolvedValueOnce([baseProject])
           .mockResolvedValueOnce([{ id: 'u1', email: 'alice@example.com' }])
           .mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'remove', 'my-api', '--email', 'alice@example.com'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

// ─── runAddRuleWizard: regex and inject-only branches ─────────────────────────

describe('runAddRuleWizard additional branches', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('regex rule: creates rule with patterns and target', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'regex' })
          // regex uses list prompt for target
          .mockResolvedValueOnce({ target: 'both' })
          // patterns
          .mockResolvedValueOnce({ patterns: 'bad-word, offensive' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    expect(payload.guardrails.rules[0]!.type).toBe('regex');
    expect(payload.guardrails.rules[0]!.target).toBe('both');
    const config = payload.guardrails.rules[0]!.config as { patterns: string[] };
    expect(config.patterns).toEqual(['bad-word', 'offensive']);
    vi.doUnmock('inquirer');
  });

  it('topic rule inject-only: creates rule with no target, inject=true, no block/log', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          // scope: inject only (no request/response)
          .mockResolvedValueOnce({ scope: ['inject'] })
          // allowedTopics only (no judge params since injectOnly)
          .mockResolvedValueOnce({ allowedTopics: 'coding only' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.type).toBe('topic');
    expect(rule.target).toBeUndefined();
    expect(rule.inject).toBe(true);
    expect(rule.block).toBeUndefined();
    expect(rule.log).toBeUndefined();
    vi.doUnmock('inquirer');
  });

  it('moderation inject-only: creates rule with no target, inject=true, no judge params', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'moderation' })
          // scope: inject only
          .mockResolvedValueOnce({ scope: ['inject'] })
          // systemPrompt required even in inject-only
          .mockResolvedValueOnce({ systemPrompt: 'block harmful content' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.type).toBe('moderation');
    expect(rule.target).toBeUndefined();
    expect(rule.inject).toBe(true);
    expect(rule.block).toBeUndefined();
    vi.doUnmock('inquirer');
  });

  it('topic rule with request+response+inject: target=both, inject=true, block=true, useJudgeResponse=true', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          // all three checked
          .mockResolvedValueOnce({ scope: ['request', 'inject', 'response'] })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.target).toBe('both');
    expect(rule.inject).toBe(true);
    expect(rule.block).toBe(true);
    expect(rule.log).toBe(true);
    expect(rule.useJudgeResponse).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('moderation rule with inject+response: inject=true, target=response, block=true', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'moderation' })
          .mockResolvedValueOnce({ scope: ['inject', 'response'] })
          .mockResolvedValueOnce({ systemPrompt: 'block harmful' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.target).toBe('response');
    expect(rule.inject).toBe(true);
    expect(rule.block).toBe(true);
    vi.doUnmock('inquirer');
  });

  it('topic rule with request only: target=request, no inject', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.target).toBe('request');
    expect(rule.inject).toBeUndefined();
    vi.doUnmock('inquirer');
  });

  it('topic rule with response only: target=response', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockResolvedValueOnce({ scope: ['response'] })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { guardrails: { rules: GuardrailRule[] } };
    const rule = payload.guardrails.rules[0]!;
    expect(rule.target).toBe('response');
    vi.doUnmock('inquirer');
  });

  it('guardrails show: inject-only moderation shows "inject" target column', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          inject: true,
          config: {},
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('inject');
    expect(out).toContain('[inject]');
  });

  it('guardrails show: inject+moderation with modelId shows model in summary', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          target: 'request' as const,
          inject: true,
          config: { modelId: 'gpt-4', threshold: 0.5 },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('gpt-4');
    expect(out).toContain('[inject]');
  });

  it('guardrails update: non-ApiError shows error message', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [{ type: 'regex' as const, target: 'request' as const, config: { patterns: ['x'] } }] } }])
           .mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });

  it('pii list: non-ApiError shows error message', async () => {
    mockApi.mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });

  it('pii add: ApiError shows error message', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockRejectedValueOnce(new ApiError(403, 'forbidden'));

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden'));
    vi.doUnmock('inquirer');
  });

  it('pii remove: non-ApiError shows error message', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [{ enabled: true, target: 'both' as const }] } }])
           .mockRejectedValueOnce(new Error('fail'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
  });
});

// ─── pii add: response/both triggers outputBufferSize prompt ─────────────────

describe('pii add outputBufferSize for response/both targets', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prompts outputBufferSize when target=response', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'response', entities: '', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '100' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: Array<{ outputBufferSize?: number }> } };
    expect(payload.pii.policies[0]!.outputBufferSize).toBe(100);
    vi.doUnmock('inquirer');
  });

  it('prompts outputBufferSize when target=both', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'both', entities: 'EMAIL', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '50' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: Array<{ outputBufferSize?: number }> } };
    expect(payload.pii.policies[0]!.outputBufferSize).toBe(50);
    vi.doUnmock('inquirer');
  });

  it('pii add with customPatterns sets them on policy', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: 'SSN-\\d+, ID-\\d+' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: Array<{ customPatterns?: string[] }> } };
    expect(payload.pii.policies[0]!.customPatterns).toEqual(['SSN-\\d+', 'ID-\\d+']);
    vi.doUnmock('inquirer');
  });
});

// ─── validate callback coverage ───────────────────────────────────────────────
// Capture and invoke the validate functions inside inquirer.prompt configs
// to cover the uncovered function/branch lines (879, 884, and related).

describe('runAddRuleWizard validate callbacks', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('scope checkbox validate: accepts non-empty selection, rejects empty', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedScopeValidate: ((v: readonly string[]) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: readonly string[]) => boolean | string }>) => {
            capturedScopeValidate = questions[0]?.validate;
            return { scope: ['request'] };
          })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedScopeValidate).toBeDefined();
    expect(capturedScopeValidate!([])).toBe('Select at least one');
    expect(capturedScopeValidate!(['request'])).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('regex patterns validate: accepts non-empty, rejects empty', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedPatternsValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'regex' })
          .mockResolvedValueOnce({ target: 'request' })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedPatternsValidate = questions[0]?.validate;
            return { patterns: 'bad-word' };
          }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedPatternsValidate).toBeDefined();
    expect(capturedPatternsValidate!('')).toBe('At least one pattern required');
    expect(capturedPatternsValidate!('   ')).toBe('At least one pattern required');
    expect(capturedPatternsValidate!('pattern')).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('semantic embeddingModelId/examples validates: accepts non-empty, rejects empty', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedEmbedValidate: ((v: string) => boolean | string) | undefined;
    let capturedExamplesValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'semantic' })
          .mockResolvedValueOnce({ target: 'request' })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedEmbedValidate = questions[0]?.validate;
            capturedExamplesValidate = questions[1]?.validate;
            return { embeddingModelId: 'embed-1', examples: 'hack', threshold: '0.82' };
          })
          .mockResolvedValueOnce({ fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedEmbedValidate).toBeDefined();
    expect(capturedEmbedValidate!('')).toBe('Required');
    expect(capturedEmbedValidate!('embed-model')).toBe(true);
    expect(capturedExamplesValidate).toBeDefined();
    expect(capturedExamplesValidate!('')).toBe('At least one example required');
    expect(capturedExamplesValidate!('  ')).toBe('At least one example required');
    expect(capturedExamplesValidate!('example')).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('topic allowedTopics validate: accepts non-empty, rejects empty', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedTopicValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedTopicValidate = questions[0]?.validate;
            return { allowedTopics: 'coding' };
          })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedTopicValidate).toBeDefined();
    expect(capturedTopicValidate!('')).toBe('Required');
    expect(capturedTopicValidate!('  ')).toBe('Required');
    expect(capturedTopicValidate!('coding')).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('topic modelId validate: accepts non-empty, rejects empty', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedModelIdValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'topic' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockResolvedValueOnce({ allowedTopics: 'coding' })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedModelIdValidate = questions[0]?.validate;
            return { modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' };
          }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedModelIdValidate).toBeDefined();
    expect(capturedModelIdValidate!('')).toBe('Required');
    expect(capturedModelIdValidate!('  ')).toBe('Required');
    expect(capturedModelIdValidate!('gpt-4')).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('moderation systemPrompt validate: accepts non-empty, rejects empty (line 879)', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedSystemPromptValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'moderation' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedSystemPromptValidate = questions[0]?.validate;
            return { systemPrompt: 'block harmful' };
          })
          .mockResolvedValueOnce({ modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedSystemPromptValidate).toBeDefined();
    expect(capturedSystemPromptValidate!('')).toBe('Required');
    expect(capturedSystemPromptValidate!('  ')).toBe('Required');
    expect(capturedSystemPromptValidate!('block harmful')).toBe(true);

    vi.doUnmock('inquirer');
  });

  it('moderation judged modelId validate: accepts non-empty, rejects empty (line 884)', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);

    let capturedModJudgeValidate: ((v: string) => boolean | string) | undefined;

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ type: 'moderation' })
          .mockResolvedValueOnce({ scope: ['request'] })
          .mockResolvedValueOnce({ systemPrompt: 'block harmful' })
          .mockImplementationOnce(async (questions: Array<{ validate?: (v: string) => boolean | string }>) => {
            capturedModJudgeValidate = questions[0]?.validate;
            return { modelId: 'gpt-4', threshold: '0.5', fallbackModelIds: '' };
          }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--add-rule']);

    expect(capturedModJudgeValidate).toBeDefined();
    expect(capturedModJudgeValidate!('')).toBe('Required');
    expect(capturedModJudgeValidate!('  ')).toBe('Required');
    expect(capturedModJudgeValidate!('gpt-4')).toBe(true);

    vi.doUnmock('inquirer');
  });
});

// ─── guardrails ApiError branch (line 1201) ───────────────────────────────────

describe('guardrails update ApiError branch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 on ApiError in guardrails patch (else branch line 1201)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi
      .mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [{ type: 'regex' as const, target: 'request' as const, config: { patterns: ['x'] } }] } }])
      .mockRejectedValueOnce(new ApiError(403, 'forbidden guardrails'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--remove-rule', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('forbidden guardrails'));
  });
});

// ─── branch coverage: ?? and ternary defaults ─────────────────────────────────
// Cover the ?: and ?? right-side/false branches not hit by other tests.

describe('branch coverage extras', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // project list: tokens/members absent → ?? [] right side
  it('project list: project without tokens/members/timeoutMs uses defaults', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [] };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'list']);
    const out = lines.join('\n');
    expect(out).toContain('my-api');
    expect(out).toContain('2s'); // timeoutMs ?? DEFAULT_PROJECT_TIMEOUT_MS
  });

  // routing show: policies absent → ?? [] right side; routing show without fallbackRoutingModelIds
  it('routing show: project without policies/fallbackRoutingModelIds uses defaults', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: false };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('No routing policies');
    expect(out).toContain('(none)'); // fallbacks empty
    expect(out).toContain('disabled'); // autoRouting false
  });

  // routing show: policy without config shows gray dash; disabled policy shows gray dash
  it('routing show: disabled policy without config shows both gray branches', async () => {
    const project = {
      id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true,
      fallbackRoutingModelIds: ['gpt-3.5'],
      policies: [{ type: 'cheapest' as const, enabled: false }],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('cheapest');
  });

  // routing policy list: disabled policy without config
  it('routing policy list: disabled policy without config covers both ternary branches', async () => {
    const project = {
      ...baseProject,
      policies: [
        { type: 'health' as const, enabled: false },
        { type: 'cheapest' as const, enabled: true, config: { x: 1 } },
      ],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('health');
    expect(out).toContain('cheapest');
  });

  // routing update: project without fallbackRoutingModelIds (the ?? branch)
  it('routing update: project without fallbackRoutingModelIds uses undefined', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true, policies: [] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'update', 'my-api', '--auto-routing']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    expect(putCall![2]).toMatchObject({ autoRouting: true });
  });

  // routing policy enable/disable: project without policies ?? []
  it('routing policy enable: project without policies field uses []', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'health']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string }> };
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]!.type).toBe('health');
  });

  // routing policy disable: project without policies ?? []
  it('routing policy disable: project without policies field (not configured branch)', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'disable', 'my-api', 'health']);
    expect(lines.join('\n')).toContain('not configured');
  });

  // routing policy reorder: project without policies ?? []
  it('routing policy reorder: project without policies field uses []', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'reorder', 'my-api', 'health']);
    expect(lines.join('\n')).toContain('reordered');
  });

  // token list: tokens absent → ?? []
  it('token list: project without tokens field uses ?? []', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No tokens');
  });

  // member list: members absent → ?? []
  it('member list: project without members field uses ?? []', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'member', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No members');
  });

  // project show: without tokens and members
  it('project show: project without tokens/members/policies/routingModelId uses defaults', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: false };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('(none)'); // no tokens, members
    expect(out).toContain('disabled'); // autoRouting false
    expect(out).toContain('(not set)'); // no routingModelId
  });

  // rulesSummary: semantic with no threshold (uses ?? 0.82)
  it('guardrails show: semantic rule without threshold uses default 0.82', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'semantic' as const, target: 'request' as const,
          config: { embeddingModelId: 'embed-1', examples: ['hack'] },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('0.82');
  });

  // rulesSummary: topic without modelId (inject-only, shows "topics: ...")
  it('guardrails show: topic rule without modelId shows allowedTopics', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'topic' as const,
          inject: true,
          config: { allowedTopics: 'coding only, no politics' },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('topics:');
  });

  // rulesSummary: topic without threshold (uses ?? 0.5)
  it('guardrails show: topic rule without threshold uses default 0.5', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'topic' as const, target: 'request' as const,
          config: { modelId: 'gpt-4', allowedTopics: 'coding' },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('0.5');
  });

  // rulesSummary: moderation without modelId (inject-only, shows "inject-only")
  it('guardrails show: moderation rule without modelId shows inject-only', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          config: {},
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('inject-only');
  });

  // rulesSummary: moderation without threshold (uses ?? 0.5)
  it('guardrails show: moderation rule without threshold uses default 0.5', async () => {
    const project = {
      ...baseProject,
      guardrails: {
        rules: [{
          type: 'moderation' as const, target: 'request' as const,
          config: { modelId: 'gpt-4' },
        }],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('0.5');
  });

  // guardrails show: project without guardrails uses ?? { rules: [] }
  it('guardrails show: project without guardrails field shows empty state', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api']);
    expect(lines.join('\n')).toContain('No rules configured');
  });

  // pii list: policy with enabled:false (dim branch), no entities, has customPatterns, has outputBufferSize
  it('pii list: disabled policy with customPatterns and outputBufferSize covers all ternary branches', async () => {
    const project = {
      ...baseProject,
      pii: {
        policies: [
          { enabled: false, target: 'request' as const, customPatterns: ['\\d+'], outputBufferSize: 100 },
        ],
      },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('request');
    expect(out).toContain('1'); // customPatterns.length
    expect(out).toContain('100'); // outputBufferSize
  });

  // pii list: project without pii field → ?? { policies: [] }
  it('pii list: project without pii field shows empty state', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No PII policies');
  });

  // pii add: project without pii field → ?? { policies: [] }
  it('pii add: project without pii field initializes with empty policies', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: unknown[] } };
    expect(payload.pii.policies).toHaveLength(1);
    vi.doUnmock('inquirer');
  });

  // pii add: non-ApiError in PATCH → line 1293 true branch
  it('pii add: non-ApiError in PATCH shows error message (non-ApiError catch branch)', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]).mockRejectedValueOnce(new Error('patch failed'));

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('patch failed'));
    vi.doUnmock('inquirer');
  });

  // pii remove: project without pii field → ?? { policies: [] } → empty → invalid index
  it('pii remove: project without pii field uses empty policies, invalid index exits 1', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid index'));
  });

  // project show: disabled autoRouting branch
  it('project show: disabled autoRouting shows yellow disabled', async () => {
    const project = {
      ...baseProject,
      autoRouting: false,
      policies: [{ type: 'health' as const, enabled: true }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('disabled'); // autoRouting false branch
    expect(out).toContain('health'); // enabled policy listed
  });

  // ── ApiError catch branches in commands that have if (!(err instanceof ApiError)) without else ──

  // routing show catch: ApiError → no message logged, just exits
  it('routing show: exits 1 on ApiError (no error log, just exit)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'show', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // ApiError: the if-block is false, so console.error is NOT called
    expect(console.error).not.toHaveBeenCalled();
  });

  // routing policy list catch: ApiError (false branch of if)
  it('routing policy list: exits 1 on ApiError (no error log)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  // model list catch: ApiError (false branch of if)
  it('model list: exits 1 on ApiError (no error log)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'model', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  // token list catch: ApiError (false branch of if)
  it('token list: exits 1 on ApiError (no error log)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  // member list catch: ApiError (false branch of if)
  it('member list: exits 1 on ApiError (no error log)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'member', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  // pii list catch: ApiError (false branch of if at line 1245)
  it('pii list: exits 1 on ApiError (no error log)', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  // routing policy enable: new policy with --config (line 226 true branch)
  it('routing policy enable: new policy with --config sets config on new policy', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true, policies: [] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'enable', 'my-api', 'llm', '--config', '{"memoryCount":3}']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { policies: Array<{ type: string; config: unknown }> };
    expect(body.policies[0]).toMatchObject({ type: 'llm', enabled: true, config: { memoryCount: 3 } });
  });

  // routing policy list: project without policies field → ?? []
  it('routing policy list: project without policies field uses ?? []', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'routing', 'policy', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No routing policies');
  });

  // model list: model with short prompt (< 60 chars) → uses m.prompt as-is
  it('model list: model with short prompt shows it as-is without truncation', async () => {
    const project = {
      ...baseProject,
      models: [
        { modelId: 'openai/gpt-4', prompt: 'Short prompt' },
        { modelId: 'openai/gpt-3.5' },
      ],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'model', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('Short prompt');
  });

  // token list: token with models without limits (limits?.length ?? 0)
  it('token list: token models without limits array shows (0)', async () => {
    const project = {
      ...baseProject,
      tokens: [{
        id: 'tok-1',
        tokenSnippet: 'abc',
        createdAt: '2024-01-01T00:00:00Z',
        models: [{ modelId: 'gpt-4' }], // no limits array
      }],
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'token', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('gpt-4(0)');
  });

  // token edit: add limit to entry that already exists but has no limits array (covers line 553 true branch)
  it('token edit: addLimit to existing model entry without limits array initializes it', async () => {
    const project = {
      ...baseProject,
      tokens: [{
        id: 'tok-1',
        tokenSnippet: 'abc',
        createdAt: '2024-01-01',
        models: [{ modelId: 'openai/gpt-4' }], // entry exists but no limits
      }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--add-limit', 'openai/gpt-4:cost:period:hourly:10']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; limits?: unknown[] }> };
    expect(body.models[0]!.limits).toHaveLength(1);
  });

  // token edit: removeLimit for a model that exists but has no limits (entry?.limits is falsy)
  it('token edit: removeLimit for model without limits is a no-op', async () => {
    const project = {
      ...baseProject,
      tokens: [{
        id: 'tok-1',
        tokenSnippet: 'abc',
        createdAt: '2024-01-01',
        models: [{ modelId: 'openai/gpt-4' }], // no limits
      }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--remove-limit', 'openai/gpt-4:cost:period']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: unknown[] };
    // model entry without limits gets filtered out by the models.filter
    expect(body.models).toHaveLength(0);
  });

  // token edit: without --tag flag uses token.tags (line 576 false branch)
  it('token edit: without --tag uses existing token.tags', async () => {
    const project = {
      ...baseProject,
      tokens: [{
        id: 'tok-1',
        tokenSnippet: 'abc',
        createdAt: '2024-01-01',
        tags: { env: 'prod' },
      }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'v1']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { tags: Record<string, string> };
    expect(body.tags).toEqual({ env: 'prod' });
  });

  // token edit: token with no labels and no tags (undefined labels/tags passthroughs)
  it('token edit: token without labels or tags uses undefined (no spread)', async () => {
    const project = {
      ...baseProject,
      tokens: [{ id: 'tok-1', tokenSnippet: 'abc', createdAt: '2024-01-01' }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'v1']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as Record<string, unknown>;
    expect(body.labels).toEqual(['v1']);
    // no tags key since token.tags is undefined
    expect(body).not.toHaveProperty('tags');
  });

  // project show: model without prompt shows empty string
  it('project show: model without prompt shows no prompt in output', async () => {
    const project = {
      ...baseProject,
      models: [
        { modelId: 'openai/gpt-4', prompt: 'A'.repeat(60) }, // exactly 60: no truncation
        { modelId: 'openai/gpt-3.5' },                        // no prompt → ''
      ],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('openai/gpt-3.5'); // no prompt model shown
    expect(out).toContain('openai/gpt-4'); // prompt model shown
  });

  // project show: token without labels and without model overrides (empty string branches)
  it('project show: token without labels or model overrides shows no decoration', async () => {
    const project = {
      ...baseProject,
      tokens: [{ id: 'tok-1', tokenSnippet: 'abc123', createdAt: '2024-01-01T00:00:00Z' }],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('abc123');
  });

  // project show: timeoutMs absent falls back to DEFAULT_PROJECT_TIMEOUT_MS
  it('project show: project without timeoutMs uses the default', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], autoRouting: true };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('2s');
  });

  it('project show: timeoutMs 0 prints "off"', async () => {
    const project = { id: 'proj-1', name: 'my-api', models: [], autoRouting: true, timeoutMs: 0 };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce([]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'show', 'my-api']);
    expect(lines.join('\n')).toContain('off');
  });

  it('project create: --timeout 0 is sent as 0, not replaced by the default', async () => {
    mockApi.mockResolvedValueOnce({ id: 'proj-1', name: 'my-api', token: 'sk-rt-x' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api', '--timeout', '0']);
    const postCall = mockApi.mock.calls.find(c => c[0] === 'POST');
    expect(postCall![2]).toMatchObject({ timeoutMs: 0 });
  });

  it('project create: a negative --timeout is refused', async () => {
    const errs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => errs.push(a.join(' ')));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    await expect(makeCmd().parseAsync(['node', 'project', 'create', '--name', 'my-api', '--timeout', '-1']))
      .rejects.toThrow('exit');
    expect(errs.join('\n')).toContain('non-negative integer');
    exit.mockRestore();
  });

  // pii list: project pii without policies key → ?? []
  it('pii list: pii object without policies key uses ?? []', async () => {
    const project = { ...baseProject, pii: {} };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    expect(lines.join('\n')).toContain('No PII policies');
  });

  // pii add: pii object without policies key → ?? []
  it('pii add: pii object without policies key uses ?? []', async () => {
    const project = { ...baseProject, pii: {} };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn()
          .mockResolvedValueOnce({ target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: unknown[] } };
    expect(payload.pii.policies).toHaveLength(1);
    vi.doUnmock('inquirer');
  });

  // pii remove: project without pii field → pii ?? {policies:[]} → policies ?? []
  it('pii remove: pii without policies key uses ?? []', async () => {
    const project = { ...baseProject, pii: {} };
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', '0'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid index'));
  });

  // model set-prompt: opts.prompt truthy → includes prompt (already tested elsewhere, but line 416 check)
  // This verifies the FALSE branch: opts.prompt is empty string → { modelId } without prompt
  it('model set-prompt: empty prompt string uses { modelId } without prompt property (line 416 false)', async () => {
    const project = { ...baseProject, models: [{ modelId: 'openai/gpt-4', prompt: 'old' }] };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', '']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models[0]).not.toHaveProperty('prompt');
  });

  // model set-prompt: multiple models — only target is updated, others pass through (line 416 false branch = m unchanged)
  it('model set-prompt: non-target models pass through unchanged (line 416 false branch)', async () => {
    const project = {
      ...baseProject,
      models: [
        { modelId: 'openai/gpt-4', prompt: 'old' },
        { modelId: 'openai/gpt-3.5' },
      ],
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'model', 'set-prompt', 'my-api', 'openai/gpt-4', '--prompt', 'new']);
    const putCall = mockApi.mock.calls.find(c => c[0] === 'PUT');
    const body = putCall![2] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(body.models).toHaveLength(2);
    expect(body.models[0]).toEqual({ modelId: 'openai/gpt-4', prompt: 'new' });
    expect(body.models[1]).toEqual({ modelId: 'openai/gpt-3.5' }); // unchanged
  });

  // token edit: project without tokens field → ?? [] for the find (line 540 right side)
  it('token edit: project without tokens field uses ?? [] and exits 1 token not found', async () => {
    // project has no tokens property at all
    const project = { id: 'proj-1', name: 'my-api', models: [], timeoutMs: 5000, autoRouting: true };
    mockApi.mockResolvedValueOnce([project]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'token', 'edit', 'my-api', 'tok-1', '--labels', 'x'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});
