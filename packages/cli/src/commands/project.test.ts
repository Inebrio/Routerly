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

  it('renders block badge for rule with block:true', async () => {
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
    expect(out).toContain('[block]');
    expect(out).not.toContain('[log]');
  });

  it('renders log badge for rule with log:true only', async () => {
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
    expect(out).toContain('[log]');
    expect(out).not.toContain('[block]');
  });

  it('renders block+log badge for rule with both', async () => {
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
    expect(lines.join('\n')).toContain('[block+log]');
  });

  it('renders judge-response marker when useJudgeResponse:true', async () => {
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
    expect(lines.join('\n')).toContain('[judge-response]');
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

  it('--detect-injection patches with detectInjection:true', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--detect-injection']);
    expect(mockApi).toHaveBeenCalledWith(
      'PATCH', `/api/projects/proj-1/guardrails`,
      expect.objectContaining({ guardrails: expect.objectContaining({ detectInjection: true }) })
    );
  });

  it('--no-detect-injection patches with detectInjection:false', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { detectInjection: true, rules: [] } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--no-detect-injection']);
    expect(mockApi).toHaveBeenCalledWith(
      'PATCH', `/api/projects/proj-1/guardrails`,
      expect.objectContaining({ guardrails: expect.objectContaining({ detectInjection: false }) })
    );
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
    mockApi.mockResolvedValueOnce([{ ...baseProject, guardrails: { rules: [] } }])
           .mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'guardrails', 'my-api', '--detect-injection']);
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
      pii: { policies: [{ name: 'default', enabled: true, target: 'both' as const, entities: ['EMAIL', 'PHONE'] }] },
    };
    mockApi.mockResolvedValueOnce([project]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    await makeCmd().parseAsync(['node', 'project', 'pii', 'list', 'my-api']);
    const out = lines.join('\n');
    expect(out).toContain('default');
    expect(out).toContain('both');
    expect(out).toContain('EMAIL');
  });

  it('outputs raw JSON with --json', async () => {
    const pii = { policies: [{ name: 'p1', enabled: true, target: 'request' as const }] };
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
          .mockResolvedValueOnce({ name: 'gdpr', target: 'both', entities: 'EMAIL,PHONE', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '50' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    expect(patchCall).toBeDefined();
    const payload = patchCall![2] as { pii: { policies: Array<{ name: string; target: string; entities: string[]; outputBufferSize: number }> } };
    expect(payload.pii.policies).toHaveLength(1);
    expect(payload.pii.policies[0]!.name).toBe('gdpr');
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
          .mockResolvedValueOnce({ name: 'pci', target: 'response', entities: 'CREDIT_CARD', customPatterns: '' })
          .mockResolvedValueOnce({ outputBufferSize: '30' }),
      },
    }));

    await makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    const payload = patchCall![2] as { pii: { policies: Array<Record<string, unknown>> } };
    expect(payload.pii.policies[0]).not.toHaveProperty('outputBufferSize');
    vi.doUnmock('inquirer');
  });

  it('exits 1 when policy name already exists', async () => {
    mockApi.mockResolvedValueOnce([{
      ...baseProject,
      pii: { policies: [{ name: 'gdpr', enabled: true, target: 'request' as const }] },
    }]);

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ name: 'gdpr', target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    vi.doUnmock('inquirer');
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));

    vi.doMock('inquirer', () => ({
      default: {
        prompt: vi.fn().mockResolvedValueOnce({ name: 'new-policy', target: 'request', entities: '', customPatterns: '' }),
      },
    }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'add', 'my-api'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
    vi.doUnmock('inquirer');
  });

  it('outputBufferSize validate: rejects out-of-range, accepts valid', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }])
           .mockResolvedValueOnce(undefined);

    // Capture the prompt config so we can call validate directly
    let capturedValidate: ((v: string) => boolean | string) | undefined;
    const promptSpy = vi.fn()
      .mockImplementationOnce(async () => ({ name: 'test', target: 'response', entities: '', customPatterns: '' }))
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
          // target
          .mockResolvedValueOnce({ target: 'request' })
          // block + log
          .mockResolvedValueOnce({ block: false, log: false })
          // judge (topic+block=false skips useJudgeResponse prompt)
          // modelId, allowedTopics, threshold
          .mockResolvedValueOnce({ modelId: 'm1primary', allowedTopics: 'coding', threshold: '0.5' })
          // fallback
          .mockResolvedValueOnce({ fallbackModelIds: 'm2, m3, m1primary' }),
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
          .mockResolvedValueOnce({ target: 'request' })
          .mockResolvedValueOnce({ block: false, log: false })
          .mockResolvedValueOnce({ modelId: 'gpt-4', allowedTopics: 'coding', threshold: '0.5' })
          .mockResolvedValueOnce({ fallbackModelIds: '' }),
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
          .mockResolvedValueOnce({ target: 'request' })
          .mockResolvedValueOnce({ block: false, log: false })
          // modelId + threshold
          .mockResolvedValueOnce({ modelId: 'mod-primary', threshold: '0.5' })
          // fallback
          .mockResolvedValueOnce({ fallbackModelIds: 'mod-b, mod-c' }),
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
          .mockResolvedValueOnce({ target: 'request' })
          .mockResolvedValueOnce({ block: false, log: false })
          // embeddingModelId, examples, threshold
          .mockResolvedValueOnce({ embeddingModelId: 'embed-primary', examples: 'hack the system', threshold: '0.82' })
          // fallback
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

  it('removes an existing policy by name', async () => {
    const project = {
      ...baseProject,
      pii: {
        policies: [
          { name: 'gdpr', enabled: true, target: 'both' as const },
          { name: 'hipaa', enabled: true, target: 'request' as const },
        ],
      },
    };
    mockApi.mockResolvedValueOnce([project]).mockResolvedValueOnce(undefined);
    await makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', 'gdpr']);
    const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
    expect(patchCall).toBeDefined();
    const payload = patchCall![2] as { pii: { policies: Array<{ name: string }> } };
    expect(payload.pii.policies).toHaveLength(1);
    expect(payload.pii.policies[0]!.name).toBe('hipaa');
  });

  it('exits 1 when policy not found', async () => {
    mockApi.mockResolvedValueOnce([{ ...baseProject, pii: { policies: [] } }]);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', 'missing'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('exits 1 on ApiError', async () => {
    const { ApiError } = await import('../api.js');
    mockApi.mockRejectedValueOnce(new ApiError(500, 'server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(makeCmd().parseAsync(['node', 'project', 'pii', 'remove', 'my-api', 'gdpr'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});
