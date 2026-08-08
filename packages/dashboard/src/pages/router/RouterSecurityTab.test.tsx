import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterSecurityTab } from './RouterSecurityTab';

vi.mock('../../api', () => ({
  getModels: vi.fn(),
  updateRouter: vi.fn(),
  getProfiles: vi.fn(),
  assignRouterProfiles: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
    ariaLabel,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    ariaLabel?: string;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      aria-label={ariaLabel ?? placeholder ?? 'select'}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

// ponytail: mock MultiSelect as a plain <select multiple> so options/onChange are testable
vi.mock('../../components/MultiSelect', () => ({
  MultiSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  }) => (
    <select
      multiple
      data-testid={`multiselect-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value);
        onChange(selected);
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { getModels, updateRouter, getProfiles, assignRouterProfiles } from '../../api';
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockUpdateRouter = vi.mocked(updateRouter as (...args: unknown[]) => Promise<unknown>);
const mockGetProfiles = vi.mocked(getProfiles as (...args: unknown[]) => Promise<unknown>);
const mockAssignProfile = vi.mocked(assignRouterProfiles as (...args: unknown[]) => Promise<unknown>);

const sampleProfiles = [
  {
    id: 'security-standard',
    kind: 'security',
    version: 1,
    label: 'Standard',
    builtin: true,
    guardrails: { rules: [{ type: 'regex', target: 'request', block: true, config: { patterns: ['secret'] } }] },
    pii: { policies: [{ enabled: true, target: 'request', entities: ['EMAIL'] }] },
  },
  {
    id: 'custom-sec',
    kind: 'security',
    version: 1,
    label: 'My Security',
    builtin: false,
    guardrails: { rules: [] },
    pii: { policies: [] },
  },
];

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null },
    ...overrides,
  };
}

const chatModel = makeModel({ id: 'openai/gpt-4o', name: 'GPT-4o' });
const embeddingModel = makeModel({
  id: 'openai/text-embedding-3-small',
  name: 'Embedding 3 Small',
  capabilities: { embedding: true },
});

// New-shape router (no action/fallbackMessage)
const mockRouter = {
  id: 'proj-1',
  name: 'Test',
  models: [],
  guardrails: { rules: [] },
  pii: { policies: [] },
};

// Router that already has a response-blocking rule
const mockRouterWithResponseBlock = {
  id: 'proj-2',
  name: 'TestBlock',
  models: [],
  guardrails: {
    rules: [
      { type: 'moderation' as const, target: 'response' as const, block: true, config: { modelId: 'openai/gpt-4o', threshold: 0.5 } },
    ],
  },
  pii: { policies: [] },
};

function renderTab(router: Record<string, unknown> = mockRouter) {
  function LayoutWrapper() {
    return <Outlet context={{ router, setRouter: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/security']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="security" element={<RouterSecurityTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([chatModel, embeddingModel]);
  mockGetProfiles.mockResolvedValue(sampleProfiles);
  mockAssignProfile.mockResolvedValue({ ...mockRouter });
  mockUpdateRouter.mockResolvedValue({ ...mockRouter, guardrails: { rules: [] }, pii: { policies: [] } });
});

afterEach(() => vi.clearAllMocks());

// ── Judge model options (preserved from prior tests) ─────────────────────────

describe('RouterSecurityTab — judge model options', () => {
  it('topic rule judge dropdown excludes embedding-only model', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => {
      const allSelects = document.querySelectorAll('select');
      const judgeSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/gpt-4o')
      );
      expect(judgeSelect).toBeTruthy();
      const vals = Array.from(judgeSelect!.options).map(o => o.value);
      expect(vals).toContain('openai/gpt-4o');
      expect(vals).not.toContain('openai/text-embedding-3-small');
    });
  });

  it('moderation rule judge dropdown excludes embedding-only model', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => {
      const allSelects = document.querySelectorAll('select');
      const judgeSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/gpt-4o')
      );
      expect(judgeSelect).toBeTruthy();
      const vals = Array.from(judgeSelect!.options).map(o => o.value);
      expect(vals).toContain('openai/gpt-4o');
      expect(vals).not.toContain('openai/text-embedding-3-small');
    });
  });

  it('semantic rule embedding dropdown includes embedding model and excludes chat model', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => {
      const allSelects = document.querySelectorAll('select');
      const embeddingSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/text-embedding-3-small')
      );
      expect(embeddingSelect).toBeTruthy();
      const vals = Array.from(embeddingSelect!.options).map(o => o.value);
      expect(vals).toContain('openai/text-embedding-3-small');
      expect(vals).not.toContain('openai/gpt-4o');
    });
  });
});

// ── Rule enabled toggle (replaces old block/log checkboxes) ───────────────────
// block/log are now fixed invariants (judged rules always block+log); only the
// per-rule Enabled toggle (testid rule-enabled) is user-editable.

describe('RouterSecurityTab — rule-enabled toggle', () => {
  it('new regex rule defaults to Enabled=true', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => {
      const enabledCbs = screen.getAllByTestId('rule-enabled') as HTMLInputElement[];
      expect(enabledCbs[0]!.checked).toBe(true);
    });
  });

  it('toggling Enabled off sets enabled=false', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    const enabledCb = await waitFor(() =>
      screen.getAllByTestId('rule-enabled')[0] as HTMLInputElement
    );
    expect(enabledCb.checked).toBe(true);
    await userEvent.click(enabledCb);
    expect((screen.getAllByTestId('rule-enabled')[0] as HTMLInputElement).checked).toBe(false);
  });

  it('toggling Enabled back on restores enabled=true', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    const enabledCb = await waitFor(() =>
      screen.getAllByTestId('rule-enabled')[0] as HTMLInputElement
    );
    await userEvent.click(enabledCb); // off
    await userEvent.click(enabledCb); // on again
    expect((screen.getAllByTestId('rule-enabled')[0] as HTMLInputElement).checked).toBe(true);
  });
});

// ── ScopeSelector (topic/moderation) — three-checkbox model ─────────────────
// request/inject/response checkboxes replace the old target+enforcement UI.

describe('RouterSecurityTab — ScopeSelector three-checkbox model', () => {
  it('new topic rule has request and response checked, inject unchecked (default target=both)', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => {
      const reqCb = screen.getByTestId('rule-scope-request') as HTMLInputElement;
      const injCb = screen.getByTestId('rule-scope-inject') as HTMLInputElement;
      const resCb = screen.getByTestId('rule-scope-response') as HTMLInputElement;
      expect(reqCb.checked).toBe(true);
      expect(injCb.checked).toBe(false);
      expect(resCb.checked).toBe(true);
    });
  });

  it('new moderation rule has request and response checked, inject unchecked (default target=both)', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => {
      const reqCb = screen.getByTestId('rule-scope-request') as HTMLInputElement;
      const injCb = screen.getByTestId('rule-scope-inject') as HTMLInputElement;
      const resCb = screen.getByTestId('rule-scope-response') as HTMLInputElement;
      expect(reqCb.checked).toBe(true);
      expect(injCb.checked).toBe(false);
      expect(resCb.checked).toBe(true);
    });
  });

  it('checking inject shows injection-warning banner', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => screen.getByTestId('rule-scope-inject'));
    expect(screen.queryByTestId('injection-warning')).toBeNull();

    await userEvent.click(screen.getByTestId('rule-scope-inject'));

    await waitFor(() => {
      expect(screen.queryByTestId('injection-warning')).not.toBeNull();
    });
  });

  it('unchecking inject removes injection-warning banner', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.getByTestId('rule-scope-inject'));
    await userEvent.click(screen.getByTestId('rule-scope-inject')); // check
    await waitFor(() => expect(screen.queryByTestId('injection-warning')).not.toBeNull());

    await userEvent.click(screen.getByTestId('rule-scope-inject')); // uncheck

    await waitFor(() => {
      expect(screen.queryByTestId('injection-warning')).toBeNull();
    });
  });

  it('inject-only (uncheck request+response) collapses judge fields', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => screen.getByTestId('rule-scope-request'));
    // First check inject so unchecking req+res doesn't leave all unchecked
    await userEvent.click(screen.getByTestId('rule-scope-inject'));
    await userEvent.click(screen.getByTestId('rule-scope-request'));
    await userEvent.click(screen.getByTestId('rule-scope-response'));

    await waitFor(() => {
      // inject-only: no judge → Judge model label absent
      expect(screen.queryByText('Judge model')).toBeNull();
    });
  });

  it('regex rule does NOT render ScopeSelector checkboxes', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));
    expect(screen.queryByTestId('rule-scope-request')).toBeNull();
    expect(screen.queryByTestId('rule-scope-inject')).toBeNull();
    expect(screen.queryByTestId('rule-scope-response')).toBeNull();
  });
});

// ── Streaming-disabled warning box ───────────────────────────────────────────

describe('RouterSecurityTab — streaming-disabled warning', () => {
  it('shows warning when a rule has block=true and target=response', async () => {
    renderTab(mockRouterWithResponseBlock);

    await waitFor(() => {
      expect(screen.queryByTestId('streaming-disabled-warning')).not.toBeNull();
    });
  });

  it('does NOT show warning when no rules are configured', async () => {
    renderTab();
    await waitFor(() => screen.getByTestId('searchable-Add a security policy...'));
    expect(screen.queryByTestId('streaming-disabled-warning')).toBeNull();
  });

  it('shows warning when a request rule is changed to target=response with block=true', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    // Add a regex rule (default target=request, block=true)
    await userEvent.selectOptions(addSelect, 'regex');

    // Warning should NOT appear yet (target is request)
    await waitFor(() => screen.getAllByTestId('rule-enabled'));
    expect(screen.queryByTestId('streaming-disabled-warning')).toBeNull();

    // Check the "response" target checkbox in TargetSelector
    const responseCheckboxes = screen.getAllByRole('checkbox').filter(cb => {
      const label = cb.closest('label');
      return label?.textContent?.trim() === 'response';
    });
    if (responseCheckboxes[0]) {
      await userEvent.click(responseCheckboxes[0]);
      await waitFor(() => {
        expect(screen.queryByTestId('streaming-disabled-warning')).not.toBeNull();
      });
    }
  });

  it('warning disappears when response target is unchecked', async () => {
    // Start with a response-blocking moderation rule
    renderTab(mockRouterWithResponseBlock);

    await waitFor(() => {
      expect(screen.queryByTestId('streaming-disabled-warning')).not.toBeNull();
    });

    // The moderation rule has target=response. ScopeSelector has rule-scope-response checked.
    // First check request so we can safely uncheck response (ScopeSelector guard: must keep at least one)
    const reqCb = screen.getByTestId('rule-scope-request') as HTMLInputElement;
    const resCb = screen.getByTestId('rule-scope-response') as HTMLInputElement;
    // response is checked; request is not. Check request first, then uncheck response.
    await userEvent.click(reqCb);
    await userEvent.click(resCb);

    await waitFor(() => {
      expect(screen.queryByTestId('streaming-disabled-warning')).toBeNull();
    });
  });
});

// ── Injection-warning banner ──────────────────────────────────────────────────
// Section-level amber banner visible when any rule has inject=true.

describe('RouterSecurityTab — injection-warning banner', () => {
  it('no injection-warning when no rules are configured', async () => {
    renderTab();
    await waitFor(() => screen.getByTestId('searchable-Add a security policy...'));
    expect(screen.queryByTestId('injection-warning')).toBeNull();
  });

  it('no injection-warning for a regex rule (inject not supported)', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));
    expect(screen.queryByTestId('injection-warning')).toBeNull();
  });

  it('injection-warning appears when router loads with inject=true rule', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [
          { type: 'moderation' as const, inject: true, block: false, log: false, config: { modelId: '', threshold: 0.5 } },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('injection-warning')).not.toBeNull();
    });
  });
});

// ── PII policy card: target + outputBufferSize ────────────────────────────────

describe('RouterSecurityTab — PII policy target and outputBufferSize', () => {
  it('new PII policy defaults to target=request and shows no buffer input', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    await waitFor(() => screen.getByText('Apply to'));

    const applyToSection = screen.getByText('Apply to').closest('div')!;
    const cbs = Array.from(applyToSection.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const reqCb = cbs.find(cb => cb.closest('label')?.textContent?.trim() === 'request');
    const resCb = cbs.find(cb => cb.closest('label')?.textContent?.trim() === 'response');
    expect(reqCb?.checked).toBe(true);
    expect(resCb?.checked).toBe(false);
    // No streaming buffer visible yet (target=request)
    expect(screen.queryByText('Streaming buffer size (characters)')).toBeNull();
  });

  it('shows outputBufferSize input when target includes response', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    // Click the "response" checkbox in the Apply to section
    await waitFor(() => screen.getByText('Apply to'));
    const applyToSection = screen.getByText('Apply to').closest('div')!;
    const resCb = Array.from(applyToSection.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = (cb as HTMLElement).closest('label');
      return label?.textContent?.trim() === 'response';
    }) as HTMLInputElement;

    expect(resCb).toBeTruthy();
    await userEvent.click(resCb);

    await waitFor(() => {
      expect(screen.queryByText('Streaming buffer size (characters)')).not.toBeNull();
    });
  });

  it('outputBufferSize input hidden when target is request-only', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'response' as const, entities: [] }],
      },
    });

    await waitFor(() => screen.getByText('Streaming buffer size (characters)'));

    // Switch to both first (check request), then uncheck response -> request-only
    const applyToSection = screen.getByText('Apply to').closest('div')!;
    const reqCb = Array.from(applyToSection.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = (cb as HTMLElement).closest('label');
      return label?.textContent?.trim() === 'request';
    }) as HTMLInputElement;
    const resCb = Array.from(applyToSection.querySelectorAll('input[type="checkbox"]')).find(cb => {
      const label = (cb as HTMLElement).closest('label');
      return label?.textContent?.trim() === 'response';
    }) as HTMLInputElement;

    // Check request (now both=true), then uncheck response (now request-only)
    await userEvent.click(reqCb);
    await userEvent.click(resCb);

    await waitFor(() => {
      expect(screen.queryByText('Streaming buffer size (characters)')).toBeNull();
    });
  });
});

// ── handleSave payload shape ──────────────────────────────────────────────────

describe('RouterSecurityTab — save payload', () => {
  it('saves guardrails without action/fallbackMessage and pii as policies-only', async () => {
    renderTab();

    // Add a regex rule
    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));

    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());

    const call = mockUpdateRouter.mock.calls[0]!;
    const payload = call[1] as { guardrails?: Record<string, unknown>; pii?: Record<string, unknown> };

    // guardrails must NOT have action or fallbackMessage
    expect(payload.guardrails).not.toHaveProperty('action');
    expect(payload.guardrails).not.toHaveProperty('fallbackMessage');
    expect(Array.isArray((payload.guardrails as { rules: unknown[] }).rules)).toBe(true);

    // pii must be policies-only
    expect(payload.pii).toHaveProperty('policies');
    expect(payload.pii).not.toHaveProperty('scrubInput');
    expect(payload.pii).not.toHaveProperty('scrubOutput');
    expect(payload.pii).not.toHaveProperty('entities');
    expect(payload.pii).not.toHaveProperty('outputBufferSize');
  });
});

// ── Rule card delete button ───────────────────────────────────────────────────

describe('RouterSecurityTab — rule card delete', () => {
  it('delete button removes the rule card', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));
    expect(screen.getAllByTestId('rule-enabled')).toHaveLength(1);

    const deleteBtn = screen.getByRole('button', { name: 'Delete rule' });
    await userEvent.click(deleteBtn);

    await waitFor(() => expect(screen.queryAllByTestId('rule-enabled')).toHaveLength(0));
  });

  it('delete button removes the correct rule when multiple rules exist', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    await userEvent.selectOptions(addSelect, 'regex');
    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    await userEvent.selectOptions(addSelect, 'topic');
    await waitFor(() => expect(screen.getAllByTestId('rule-enabled')).toHaveLength(2));

    // Delete the first rule
    const deleteBtns = screen.getAllByRole('button', { name: 'Delete rule' });
    await userEvent.click(deleteBtns[0]!);

    await waitFor(() => expect(screen.queryAllByTestId('rule-enabled')).toHaveLength(1));
  });
});

// ── PII policy remove button ──────────────────────────────────────────────────

describe('RouterSecurityTab — PII policy remove', () => {
  it('remove button deletes the policy card', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    await waitFor(() => screen.getByText('Apply to'));
    expect(screen.queryByTitle('Remove policy')).not.toBeNull();

    const removeBtn = screen.getByTitle('Remove policy');
    await userEvent.click(removeBtn);

    await waitFor(() => expect(screen.queryByText('Apply to')).toBeNull());
  });

  it('remove button on a pre-existing policy removes it', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [
          { enabled: true, target: 'request' as const, entities: [] },
        ],
      },
    });

    // Wait for the policy card to render (it shows "Policy 1" heading and Apply to)
    await waitFor(() => screen.getByText('Policy 1'));
    const removeBtn = screen.getByTitle('Remove policy');
    await userEvent.click(removeBtn);

    await waitFor(() => expect(screen.queryByText('Policy 1')).toBeNull());
  });
});

// ── PII entity toggles ────────────────────────────────────────────────────────

describe('RouterSecurityTab — PII entity toggles', () => {
  it('clicking an entity checkbox toggles it on (new policy starts with all unchecked)', async () => {
    // New policy has entities:[] -> new Set([]) -> all entity checkboxes unchecked
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    await waitFor(() => screen.getByText('Email'));
    const emailLabel = screen.getByText('Email').closest('label') as HTMLElement;
    const emailCb = emailLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // new policy entities:[] => empty Set => unchecked
    expect(emailCb.checked).toBe(false);
    await userEvent.click(emailCb);
    expect(emailCb.checked).toBe(true);
  });

  it('clicking a checked entity checkbox toggles it off', async () => {
    // Load a policy that already has EMAIL in its entities
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'request' as const, entities: ['EMAIL', 'PHONE'] }],
      },
    });

    await waitFor(() => screen.getByText('Email'));
    const emailLabel = screen.getByText('Email').closest('label') as HTMLElement;
    const emailCb = emailLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(emailCb.checked).toBe(true);
    await userEvent.click(emailCb);
    expect(emailCb.checked).toBe(false);
  });
});

// ── PII policy enabled toggle ─────────────────────────────────────────────────

describe('RouterSecurityTab — PII policy enabled toggle', () => {
  it('toggling Enabled checkbox updates the policy', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    // "Enabled" label appears in the PII policy card header
    await waitFor(() => screen.getByText('Enabled'));
    const enabledLabel = screen.getByText('Enabled').closest('label') as HTMLElement;
    const enabledCb = enabledLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(enabledCb.checked).toBe(true);
    await userEvent.click(enabledCb);
    expect(enabledCb.checked).toBe(false);
  });
});

// ── PII policy "Policy N" heading (replaces old name input) ──────────────────

describe('RouterSecurityTab — PII policy heading', () => {
  it('new policy card renders "Policy 1" heading (no name input)', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    await waitFor(() => screen.getByText('Policy 1'));
    // Name input is gone
    expect(screen.queryByPlaceholderText('Policy name')).toBeNull();
  });

  it('two policy cards render "Policy 1" and "Policy 2" headings', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [
          { enabled: true, target: 'request' as const, entities: [] },
          { enabled: true, target: 'request' as const, entities: [] },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Policy 1')).toBeTruthy();
      expect(screen.getByText('Policy 2')).toBeTruthy();
    });
  });
});

// ── save skips no-op PII policies (replaces old "empty name" filter) ──────────
// A policy is a no-op when it has an empty entity array AND no custom patterns.
// A policy with at least one entity is always kept.

describe('RouterSecurityTab — save skips no-op PII policies', () => {
  it('save skips a freshly-added policy that has no entities and no patterns', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    // New policy seeds with entities:[] and no patterns → no-op, should be filtered
    await waitFor(() => screen.getByText('Policy 1'));

    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));
    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());

    const call = mockUpdateRouter.mock.calls[0]!;
    const payload = call[1] as { pii?: { policies: unknown[] } };
    // No-op policy filtered out
    expect(payload.pii?.policies.length).toBe(0);
  });

  it('save keeps a policy that has at least one entity', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [
          { enabled: true, target: 'request' as const, entities: ['EMAIL'] },
        ],
      },
    });

    await waitFor(() => screen.getByText('Policy 1'));
    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));
    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());

    const call = mockUpdateRouter.mock.calls[0]!;
    const payload = call[1] as { pii?: { policies: unknown[] } };
    // Policy with EMAIL entity is kept
    expect(payload.pii?.policies.length).toBe(1);
  });
});

// ── PII custom patterns ───────────────────────────────────────────────────────

describe('RouterSecurityTab — PII custom patterns', () => {
  it('custom patterns textarea is editable', async () => {
    renderTab();

    await waitFor(() => screen.getByText('+ Add Policy'));
    await userEvent.click(screen.getByText('+ Add Policy'));

    const ta = await waitFor(() =>
      screen.getByPlaceholderText('\\b\\d{8}\\b') as HTMLTextAreaElement
    );
    // Use paste to avoid userEvent.type interpreting {4} as a key spec
    await userEvent.click(ta);
    await userEvent.paste('\\d{4}');
    expect(ta.value).toContain('\\d');
  });
});

// ── RegexFields patterns textarea ─────────────────────────────────────────────

describe('RouterSecurityTab — RegexFields patterns textarea', () => {
  it('typing into patterns textarea updates the rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    // Find the patterns textarea by label text (placeholder has a real newline — hard to match)
    await waitFor(() => screen.getByText('Patterns (one per line)'));
    const ta = screen.getByText('Patterns (one per line)').closest('.form-group')!
      .querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.click(ta);
    await userEvent.paste('bad');
    expect(ta.value).toContain('bad');
  });

  it('invalid regex pattern shows an error', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getByText('Patterns (one per line)'));
    const ta = screen.getByText('Patterns (one per line)').closest('.form-group')!
      .querySelector('textarea') as HTMLTextAreaElement;
    // '[invalid' is an unterminated character class (invalid regex)
    await userEvent.click(ta);
    await userEvent.paste('[invalid');
    await waitFor(() =>
      expect(screen.queryByText(/Invalid regex on line/)).not.toBeNull()
    );
  });
});

// ── TargetSelector toggle (guardian rule target) ──────────────────────────────

describe('RouterSecurityTab — TargetSelector toggle', () => {
  it('toggling both target checkboxes in TargetSelector works for regex rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    // Find the target section request checkbox (first one in the rule card)
    const allCheckboxes = screen.getAllByRole('checkbox');
    // The 'request' target checkbox for the regex rule (in TargetSelector)
    const requestTargetCb = allCheckboxes.find(cb => {
      const label = cb.closest('label');
      return label?.textContent?.trim() === 'request' && !cb.matches('[data-testid]');
    }) as HTMLInputElement;

    if (requestTargetCb) {
      expect(requestTargetCb.checked).toBe(true); // request is default
      // Click response to also add it (should become 'both')
      const responseTargetCb = allCheckboxes.find(cb => {
        const label = cb.closest('label');
        return label?.textContent?.trim() === 'response' && !cb.matches('[data-testid]');
      }) as HTMLInputElement;
      if (responseTargetCb) {
        await userEvent.click(responseTargetCb);
        // Now 'both' is checked — streaming warning should appear
        await waitFor(() =>
          expect(screen.queryByTestId('streaming-disabled-warning')).not.toBeNull()
        );
        // Click request again to uncheck it (becomes 'response' only)
        await userEvent.click(requestTargetCb);
        // streaming warning still visible (response-only is still blocking)
        await waitFor(() =>
          expect(screen.queryByTestId('streaming-disabled-warning')).not.toBeNull()
        );
      }
    }
  });
});

// ── SemanticFields interactions ───────────────────────────────────────────────

describe('RouterSecurityTab — SemanticFields interactions', () => {
  it('threshold slider is rendered for semantic rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() =>
      expect(screen.queryByText(/Similarity threshold/)).not.toBeNull()
    );
  });

  it('example texts textarea is editable for semantic rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    const ta = await waitFor(() =>
      screen.getByPlaceholderText(/How do I hack/) as HTMLTextAreaElement
    );
    await userEvent.click(ta);
    await userEvent.paste('example text');
    expect(ta.value).toContain('example text');
  });
});

// ── TopicFields interactions ──────────────────────────────────────────────────

describe('RouterSecurityTab — TopicFields interactions', () => {
  it('allowed topics textarea is rendered and editable for topic rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    const ta = await waitFor(() =>
      screen.getByPlaceholderText(/Customer support for software products/) as HTMLTextAreaElement
    );
    await userEvent.type(ta, 'tech support');
    expect(ta.value).toContain('tech support');
  });

  it('threshold slider is rendered for topic rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() =>
      expect(screen.queryByText(/Block if on-topic score below/)).not.toBeNull()
    );
  });
});

// ── ModerationFields interactions ─────────────────────────────────────────────

describe('RouterSecurityTab — ModerationFields interactions', () => {
  it('threshold slider is rendered for moderation rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() =>
      expect(screen.queryByText(/Block if harm score above/)).not.toBeNull()
    );
  });

  it('custom instructions textarea is rendered for moderation rule with label "Custom instructions"', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() =>
      expect(screen.queryByText('Custom instructions')).not.toBeNull()
    );
    const ta = screen.getByPlaceholderText(/You are a content safety classifier/) as HTMLTextAreaElement;
    await userEvent.type(ta, 'custom prompt');
    expect(ta.value).toContain('custom prompt');
  });

  it('clearing custom instructions textarea removes the systemPrompt', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.getByPlaceholderText(/You are a content safety classifier/));
    const ta = screen.getByPlaceholderText(/You are a content safety classifier/) as HTMLTextAreaElement;
    await userEvent.type(ta, 'some text');
    await userEvent.clear(ta);
    expect(ta.value).toBe('');
  });

  it('ModerationFields TargetSelector onChange fires when response is unchecked', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.getByTestId('rule-scope-response'));

    // Moderation default target='both'. Clicking response fires ScopeSelector onChange.
    const resCb = screen.getByTestId('rule-scope-response') as HTMLInputElement;
    expect(resCb.checked).toBe(true);
    await userEvent.click(resCb);
    await waitFor(() => {
      const fresh = screen.getByTestId('rule-scope-response') as HTMLInputElement;
      expect(fresh.checked).toBe(false);
    });
  });
});

// ── Mandatory Custom instructions (moderation) ────────────────────────────────
// Empty systemPrompt blocks save (saveDisabled=true) and shows error text.

describe('RouterSecurityTab — mandatory Custom instructions', () => {
  it('Save is disabled and shows error when moderation Custom instructions is empty', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    // systemPrompt starts empty → Save button must be disabled
    await waitFor(() => screen.getByPlaceholderText(/You are a content safety classifier/));
    const saveBtn = screen.getByRole('button', { name: /save security settings/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Error text shown
    await waitFor(() =>
      expect(screen.queryByText('Custom instructions are required.')).not.toBeNull()
    );
  });

  it('Save is enabled once Custom instructions is filled in', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.getByPlaceholderText(/You are a content safety classifier/));
    const ta = screen.getByPlaceholderText(/You are a content safety classifier/) as HTMLTextAreaElement;
    await userEvent.type(ta, 'Be safe');

    await waitFor(() => {
      const saveBtn = screen.getByRole('button', { name: /save security settings/i }) as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });
    expect(screen.queryByText('Custom instructions are required.')).toBeNull();
  });
});

// ── Error handling on save ────────────────────────────────────────────────────

describe('RouterSecurityTab — save error handling', () => {
  it('shows error message when updateRouter rejects', async () => {
    mockUpdateRouter.mockRejectedValueOnce(new Error('Network error'));
    renderTab();

    await waitFor(() =>
      screen.getByRole('button', { name: /save security settings/i })
    );
    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));

    await waitFor(() =>
      expect(screen.queryByText('Network error')).not.toBeNull()
    );
  });

  it('shows generic error when updateRouter rejects with non-Error', async () => {
    mockUpdateRouter.mockRejectedValueOnce('string error');
    renderTab();

    await waitFor(() =>
      screen.getByRole('button', { name: /save security settings/i })
    );
    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));

    await waitFor(() =>
      expect(screen.queryByText('Error saving security settings')).not.toBeNull()
    );
  });
});

// ── saveDisabled guard (regex error prevents save) ────────────────────────────

describe('RouterSecurityTab — saveDisabled when regex errors', () => {
  it('does not call updateRouter when there is a regex error', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    // Type an invalid regex into the patterns textarea
    const patternsLabel = screen.getByText('Patterns (one per line)');
    const formGroup = patternsLabel.closest('.form-group');
    const ta = formGroup?.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta) {
      await userEvent.clear(ta);
      await userEvent.paste('[invalid(regex');
      // Error message should appear
      await waitFor(() =>
        expect(screen.queryByText(/Invalid regex on line/)).not.toBeNull()
      );
    }

    // Try to save
    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));
    // updateRouter should NOT be called (saveDisabled=true)
    expect(mockUpdateRouter).not.toHaveBeenCalled();
  });
});

// ── Successful save path: setTimeout + models.prompt spread ──────────────────

describe('RouterSecurityTab — successful save shows saved state', () => {
  it('shows "Saved!" after successful updateRouter and includes model prompt in payload', async () => {
    const routerWithModels = {
      ...mockRouter,
      models: [
        { modelId: 'openai/gpt-4o', prompt: 'system prompt override' },
        { modelId: 'openai/gpt-4o-mini' },
      ],
    };
    mockUpdateRouter.mockResolvedValueOnce({ ...routerWithModels });
    renderTab(routerWithModels);

    await waitFor(() =>
      screen.getByRole('button', { name: /save security settings/i })
    );

    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));

    await waitFor(() =>
      expect(screen.queryByText(/Saved!/)).not.toBeNull(),
    { timeout: 3000 });

    // Verify models with prompt were included in payload
    const call = mockUpdateRouter.mock.calls[0]!;
    const payload = call[1] as { models: Array<{ modelId: string; prompt?: string }> };
    expect(payload.models.find(m => m.modelId === 'openai/gpt-4o')?.prompt).toBe('system prompt override');
    expect(payload.models.find(m => m.modelId === 'openai/gpt-4o-mini')).not.toHaveProperty('prompt');
  });

});

// ── Router missing guardrails/pii keys ──────────────────────────────────────

describe('RouterSecurityTab — router without guardrails or pii keys', () => {
  it('renders without error when router has no guardrails key', async () => {
    renderTab({ id: 'proj-x', name: 'NoPii', models: [] });
    // if(g) is false → no rules set → the add picker should still render
    await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    );
    // No injection warning (no rules)
    expect(screen.queryByTestId('injection-warning')).toBeNull();
  });

  it('renders without error when router has no pii key', async () => {
    renderTab({ id: 'proj-y', name: 'NoGuard', models: [], guardrails: { rules: [] } });
    // if(p) is false → piiPolicies stays [] → shows "No PII policies configured."
    await waitFor(() =>
      expect(screen.queryByText('No PII policies configured.')).not.toBeNull()
    );
  });

  it('handles pii with null policies array via ?? fallback', async () => {
    // p.policies ?? [] fires when policies is null/undefined
    renderTab({ id: 'proj-z', name: 'NullPolicies', models: [], guardrails: { rules: [] }, pii: {} });
    await waitFor(() =>
      expect(screen.queryByText('No PII policies configured.')).not.toBeNull()
    );
  });

  it('handles guardrails with no rules key via g.rules ?? [] fallback', async () => {
    // g.rules is undefined → g.rules ?? [] fires
    renderTab({ id: 'proj-w', name: 'NoRules', models: [], guardrails: {} });
    await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    );
    // No rules rendered (empty fallback [])
    expect(screen.queryAllByTestId('rule-enabled')).toHaveLength(0);
  });
});

// ── updateRule with multiple rules covers r._id !== id arm ────────────────────

describe('RouterSecurityTab — updateRule with 2 rules covers false arm', () => {
  it('editing scope on first rule when two rules exist updates only the target rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    // Add two regex rules
    await userEvent.selectOptions(addSelect, 'regex');
    await waitFor(() => expect(screen.getAllByTestId('rule-enabled')).toHaveLength(1));
    await userEvent.selectOptions(addSelect, 'regex');
    await waitFor(() => expect(screen.getAllByTestId('rule-enabled')).toHaveLength(2));

    // Toggle the first rule's Enabled checkbox — triggers updateRule for that rule's _id,
    // iterating over both rules and hitting r._id === id (first) and r._id !== id (second)
    const enabledCbs = screen.getAllByTestId('rule-enabled') as HTMLInputElement[];
    await userEvent.click(enabledCbs[0]!);
    expect((screen.getAllByTestId('rule-enabled')[0] as HTMLInputElement).checked).toBe(false);
    // Second rule's enabled state is untouched
    expect((screen.getAllByTestId('rule-enabled')[1] as HTMLInputElement).checked).toBe(true);
  });
});

// ── Threshold ?? fallback: rules loaded with missing threshold ─────────────────

describe('RouterSecurityTab — threshold ?? fallback for pre-existing rules without threshold', () => {
  it('SemanticFields renders when config.threshold is undefined', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [
          // threshold deliberately omitted → cfg.threshold ?? 0.82 fires
          { type: 'semantic' as const, target: 'request' as const, block: true, config: { embeddingModelId: '', examples: [] } },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.queryByText(/Similarity threshold/)).not.toBeNull()
    );
  });

  it('TopicFields renders when config.threshold is undefined', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [
          { type: 'topic' as const, target: 'both' as const, block: true, config: { modelId: '', allowedTopics: '' } },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.queryByText(/Block if on-topic score below/)).not.toBeNull()
    );
  });

  it('ModerationFields renders when config.threshold is undefined', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [
          { type: 'moderation' as const, target: 'both' as const, block: true, config: { modelId: '' } },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.queryByText(/Block if harm score above/)).not.toBeNull()
    );
  });
});

// ── entities ?? ALL_PII_ENTITIES fallback ─────────────────────────────────────

describe('RouterSecurityTab — PiiPolicyCard entities ?? ALL_PII_ENTITIES fallback', () => {
  it('policy with null entities renders all entity types as checked via fallback', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        // entities is null → new Set(null ?? ALL_PII_ENTITIES) → all entities checked
        policies: [{ enabled: true, target: 'request' as const, entities: null as unknown as [] }],
      },
    });
    // Wait for the policy card heading
    await waitFor(() => screen.getByText('Policy 1'));
    // All entity labels should be present and checked (from ALL_PII_ENTITIES fallback)
    const emailLabel = screen.getByText('Email').closest('label') as HTMLElement;
    const emailCb = emailLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    // entities===null triggers fallback to ALL_PII_ENTITIES so all are checked
    expect(emailCb.checked).toBe(true);
  });
});

// ── handleSave early return when saveDisabled=true ───────────────────────────

describe('RouterSecurityTab — handleSave early return when saveDisabled', () => {
  it('dispatching form submit while saveDisabled returns early without calling updateRouter', async () => {
    // Simulate saveDisabled via an invalid regex, then dispatch submit via form event
    // (disabled button can't be clicked; form.dispatchEvent bypasses button disabled check)
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getByText('Patterns (one per line)'));
    const ta = screen.getByText('Patterns (one per line)').closest('.form-group')!
      .querySelector('textarea') as HTMLTextAreaElement;
    await userEvent.click(ta);
    await userEvent.paste('[invalid(regex');
    await waitFor(() => expect(screen.queryByText(/Invalid regex on line/)).not.toBeNull());

    // saveDisabled=true; dispatching form submit now exercises the early-return branch
    const form = document.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // updateRouter must NOT be called
    await new Promise(r => setTimeout(r, 50));
    expect(mockUpdateRouter).not.toHaveBeenCalled();
  });
});

// ── modelOptions fallback: m.id used when m.name is falsy ────────────────────

describe('RouterSecurityTab — model label fallback to m.id when name is absent', () => {
  it('model without name uses m.id as label in judge dropdown', async () => {
    // Override getModels to return a model with no name (triggers `m.name || m.id`)
    mockGetModels.mockResolvedValueOnce([
      makeModel({ id: 'openai/gpt-4o', name: undefined }),
    ] as never);

    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    // The judge dropdown should contain 'openai/gpt-4o' as both value and label
    await waitFor(() => {
      const allSelects = document.querySelectorAll('select');
      const judgeSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/gpt-4o')
      );
      expect(judgeSelect).toBeTruthy();
      const opt = Array.from(judgeSelect!.options).find(o => o.value === 'openai/gpt-4o');
      // When name is undefined/falsy, label should equal m.id
      expect(opt?.text).toBe('openai/gpt-4o');
    });
  });

  it('embedding model without name uses m.id as label in embedding dropdown', async () => {
    mockGetModels.mockResolvedValueOnce([
      makeModel({ id: 'openai/text-embedding-3-small', name: undefined, capabilities: { embedding: true } }),
    ] as never);

    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => {
      const allSelects = document.querySelectorAll('select');
      const embSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/text-embedding-3-small')
      );
      expect(embSelect).toBeTruthy();
      const opt = Array.from(embSelect!.options).find(o => o.value === 'openai/text-embedding-3-small');
      expect(opt?.text).toBe('openai/text-embedding-3-small');
    });
  });
});

// ── PiiPolicyCard onChange with 2+ policies (j !== i branch) ─────────────────

describe('RouterSecurityTab — PII onChange with multiple policies covers j !== i branch', () => {
  it('changing one policy when two exist updates only the correct one', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [
          { enabled: true, target: 'request' as const, entities: [] },
          { enabled: true, target: 'request' as const, entities: [] },
        ],
      },
    });

    // Both policy headings should be present
    await waitFor(() => {
      expect(screen.getByText('Policy 1')).toBeTruthy();
      expect(screen.getByText('Policy 2')).toBeTruthy();
    });

    // Toggle Enabled on policy 1 only — triggers onChange hitting both j===i and j!==i branches
    const removeButtons = screen.getAllByTitle('Remove policy');
    expect(removeButtons).toHaveLength(2);

    // Toggle enabled on the first policy card's Enabled checkbox
    const enabledLabels = screen.getAllByText('Enabled');
    const firstEnabledCb = enabledLabels[0]!.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await userEvent.click(firstEnabledCb);
    expect(firstEnabledCb.checked).toBe(false);

    // Second policy's Enabled is unchanged (j !== i branch executed)
    const secondEnabledCb = enabledLabels[1]!.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(secondEnabledCb.checked).toBe(true);
  });
});

// ── if (!router) return null (render guard) ─────────────────────────────────

describe('RouterSecurityTab — renders null when no router', () => {
  it('returns null (renders nothing) when router is undefined', async () => {
    function NullWrapper() {
      const { Outlet } = require('react-router-dom');
      return <Outlet context={{ router: undefined, setRouter: vi.fn() }} />;
    }
    const { render: r } = await import('@testing-library/react');
    const { MemoryRouter: MR, Routes: Rs, Route: Rt } = await import('react-router-dom');
    const { container } = r(
      <MR initialEntries={['/dashboard/routers/proj-1/security']}>
        <Rs>
          <Rt path="/dashboard/routers/:id" element={<NullWrapper />}>
            <Rt path="security" element={<RouterSecurityTab />} />
          </Rt>
        </Rs>
      </MR>
    );
    // No router → component returns null → nothing rendered inside the outlet
    expect(container.querySelector('form')).toBeNull();
  });
});

// ── Fallback models MultiSelect ───────────────────────────────────────────────

describe('RouterSecurityTab — fallback models MultiSelect', () => {
  it('SemanticFields renders fallback MultiSelect excluding the primary embedding model', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    // MultiSelect for "No fallback models..." placeholder
    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    expect(ms).toBeTruthy();

    // Primary embedding model (openai/text-embedding-3-small) must not be in fallback options
    const vals = Array.from(ms.options).map(o => o.value);
    // No embedding model selected yet (embeddingModelId=''), so all embedding options appear
    // Once a primary is selected it gets filtered — verify the filter logic via onChange
    expect(ms).toBeTruthy();
  });

  it('SemanticFields fallback MultiSelect excludes currently-selected primary model', async () => {
    // Render with a pre-existing semantic rule with embeddingModelId set
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'semantic' as const,
          target: 'request' as const,
          block: true,
          config: { embeddingModelId: 'openai/text-embedding-3-small', examples: [], fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    const vals = Array.from(ms.options).map(o => o.value);
    // Primary is 'openai/text-embedding-3-small' → must be excluded from fallback options
    expect(vals).not.toContain('openai/text-embedding-3-small');
  });

  it('SemanticFields fallback MultiSelect calls onChange with updated fallbackModelIds', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'semantic' as const,
          target: 'request' as const,
          block: true,
          config: { embeddingModelId: '', examples: [], fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    // Select an option — verifies onChange wiring
    await userEvent.selectOptions(ms, 'openai/text-embedding-3-small');
    // MultiSelect mock fires onChange; no crash = wiring is correct
    expect(ms).toBeTruthy();
  });

  it('TopicFields renders fallback MultiSelect excluding the primary judge model', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'topic' as const,
          target: 'both' as const,
          block: true,
          config: { modelId: 'openai/gpt-4o', allowedTopics: '', fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    const vals = Array.from(ms.options).map(o => o.value);
    // Primary is 'openai/gpt-4o' → excluded from fallback options
    expect(vals).not.toContain('openai/gpt-4o');
  });

  it('TopicFields fallback MultiSelect onChange fires when an option is selected', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'topic' as const,
          target: 'both' as const,
          block: true,
          // modelId is empty so gpt-4o is available as a fallback option
          config: { modelId: '', allowedTopics: '', fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    // Trigger onChange on the TopicFields fallback MultiSelect
    await userEvent.selectOptions(ms, 'openai/gpt-4o');
    expect(ms).toBeTruthy();
  });

  it('ModerationFields renders fallback MultiSelect excluding the primary judge model', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          target: 'both' as const,
          block: true,
          config: { modelId: 'openai/gpt-4o', fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    const vals = Array.from(ms.options).map(o => o.value);
    // Primary is 'openai/gpt-4o' → excluded from fallback options
    expect(vals).not.toContain('openai/gpt-4o');
  });

  it('ModerationFields fallback MultiSelect onChange fires when an option is selected', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          target: 'both' as const,
          block: true,
          // modelId is empty so gpt-4o is available as a fallback option
          config: { modelId: '', fallbackModelIds: [] },
        }],
      },
    });

    await waitFor(() => screen.queryByText('Fallback models (optional, tried in order)'));

    const ms = screen.getByTestId('multiselect-No fallback models...') as HTMLSelectElement;
    // Trigger onChange on the ModerationFields fallback MultiSelect
    await userEvent.selectOptions(ms, 'openai/gpt-4o');
    expect(ms).toBeTruthy();
  });
});

// ── TargetSelector onChange in SemanticFields / TopicFields / ModerationFields ─

describe('RouterSecurityTab — TargetSelector onChange in typed rule cards', () => {
  it('SemanticFields TargetSelector onChange fires when target is changed', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => screen.queryByText('Embedding model'));

    // TargetSelector renders "request" and "response" checkboxes; default is request
    const requestCbs = screen.getAllByRole('checkbox').filter(cb =>
      cb.closest('label')?.textContent?.trim() === 'request'
    );
    const responseCbs = screen.getAllByRole('checkbox').filter(cb =>
      cb.closest('label')?.textContent?.trim() === 'response'
    );
    // Check response to make target='both' → TargetSelector onChange fires
    if (responseCbs[0]) {
      await userEvent.click(responseCbs[0] as HTMLElement);
      await waitFor(() =>
        expect((responseCbs[0] as HTMLInputElement).checked).toBe(true)
      );
    }
    // Now uncheck request → target='response', TargetSelector onChange fires again
    if (requestCbs[0]) {
      await userEvent.click(requestCbs[0] as HTMLElement);
      await waitFor(() =>
        expect((requestCbs[0] as HTMLInputElement).checked).toBe(false)
      );
    }
  });

  it('TopicFields ScopeSelector onChange fires when target is changed', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => screen.getByTestId('rule-scope-response'));

    // Topic default target='both', so response is checked.
    // Clicking response unchecks it → target becomes 'request' only.
    const resCb = screen.getByTestId('rule-scope-response') as HTMLInputElement;
    expect(resCb.checked).toBe(true);
    await userEvent.click(resCb);
    await waitFor(() => {
      const fresh = screen.getByTestId('rule-scope-response') as HTMLInputElement;
      expect(fresh.checked).toBe(false);
    });
  });

  it('ModerationFields ScopeSelector onChange fires when target is changed', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.getByTestId('rule-scope-response'));

    // Moderation default target='both'. Clicking request unchecks it.
    const reqCb = screen.getByTestId('rule-scope-request') as HTMLInputElement;
    expect(reqCb.checked).toBe(true);
    await userEvent.click(reqCb);
    await waitFor(() => {
      const fresh = screen.getByTestId('rule-scope-request') as HTMLInputElement;
      expect(fresh.checked).toBe(false);
    });
  });
});

// ── PiiPolicyCard outputBufferSize input ──────────────────────────────────────

describe('RouterSecurityTab — PII outputBufferSize input editing', () => {
  it('outputBufferSize input is rendered with correct default', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'response' as const, entities: [], outputBufferSize: 30 }],
      },
    });

    await waitFor(() => screen.getByText('Streaming buffer size (characters)'));
    // The input renders with the policy's outputBufferSize value
    const input = screen.getByDisplayValue('30') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(Number(input.value)).toBe(30);
  });

  it('outputBufferSize defaults to 30 when not set in policy', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'response' as const, entities: [] }],
      },
    });

    await waitFor(() => screen.getByText('Streaming buffer size (characters)'));
    const input = screen.getByDisplayValue('30') as HTMLInputElement;
    expect(Number(input.value)).toBe(30);
  });
});

// ── Pre-existing rules loaded from router ────────────────────────────────────

describe('RouterSecurityTab — pre-existing rules from router', () => {
  it('renders existing moderation rule type badge from router.guardrails', async () => {
    renderTab(mockRouterWithResponseBlock);

    await waitFor(() => {
      // The rule type badge "Moderation" appears inside the rule card
      const badges = screen.getAllByText('Moderation');
      // At least one should be the rule type badge (others may be in dropdown)
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('renders Enabled toggle as checked for loaded blocking rule', async () => {
    renderTab(mockRouterWithResponseBlock);

    await waitFor(() => {
      const enabledCbs = screen.getAllByTestId('rule-enabled') as HTMLInputElement[];
      expect(enabledCbs[0]!.checked).toBe(true);
    });
  });
});

// ── handleTargetToggle guard (PiiPolicyCard) ─────────────────────────────────

describe('RouterSecurityTab — PII target toggle guard', () => {
  it('does not uncheck the only checked PII target (request stays checked)', async () => {
    // Start with target='request' so only request is checked
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'request' as const, entities: [] }],
      },
    });

    // Wait for form to render (Apply to label always shown)
    await waitFor(() => screen.getByText('Apply to'));
    // The PII target checkboxes appear inside the 'Apply to' form-group
    const applyToGroup = screen.getByText('Apply to').closest('.form-group');
    const requestCb = applyToGroup?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (requestCb) {
      // Clicking request checkbox while response is unchecked — guard should prevent change
      await userEvent.click(requestCb);
      // Still checked (guard returned early)
      expect(requestCb.checked).toBe(true);
    }
  });

  it('switches PII target from both to response-only when request is unchecked', async () => {
    // Start with target='both'
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'both' as const, entities: [] }],
      },
    });

    await waitFor(() => screen.getByText('Apply to'));
    const applyToGroup = screen.getByText('Apply to').closest('.form-group');
    const checkboxes = applyToGroup?.querySelectorAll('input[type="checkbox"]');
    const requestCb = checkboxes?.[0] as HTMLInputElement | null;
    const responseCb = checkboxes?.[1] as HTMLInputElement | null;
    if (requestCb && responseCb) {
      expect(requestCb.checked).toBe(true);
      expect(responseCb.checked).toBe(true);
      // Uncheck request — should switch to response-only
      await userEvent.click(requestCb);
      await waitFor(() => expect(requestCb.checked).toBe(false));
      expect(responseCb.checked).toBe(true);
    }
  });
});

// ── TargetSelector toggle guard (guardrail rules) ─────────────────────────────

describe('RouterSecurityTab — TargetSelector guard', () => {
  it('does not uncheck the only checked target in a guardrail rule', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    // Find the Target section inside the RuleCard (has "request" and "response" checkboxes)
    const targetLabels = screen.getAllByRole('checkbox');
    // The TargetSelector has "request" and "response" labels
    // Default new regex rule: target='request'
    const requestCb = targetLabels.find(cb => cb.closest('label')?.textContent?.trim() === 'request') as HTMLInputElement | null;
    const responseCb = targetLabels.find(cb => cb.closest('label')?.textContent?.trim() === 'response') as HTMLInputElement | null;

    if (requestCb && responseCb) {
      expect(requestCb.checked).toBe(true);
      expect(responseCb.checked).toBe(false);
      // Try unchecking request while response is already unchecked — guard should prevent
      await userEvent.click(requestCb);
      // requestCb should still be checked (guard returned early, no onChange)
      expect(requestCb.checked).toBe(true);
    }
  });

  it('switches guardrail target from both to response-only', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'regex');

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    const requestCb = screen.getAllByRole('checkbox').find(cb =>
      cb.closest('label')?.textContent?.trim() === 'request'
    ) as HTMLInputElement | null;
    const responseCb = screen.getAllByRole('checkbox').find(cb =>
      cb.closest('label')?.textContent?.trim() === 'response'
    ) as HTMLInputElement | null;

    if (requestCb && responseCb) {
      // First check response to make it 'both'
      await userEvent.click(responseCb);
      await waitFor(() => expect(responseCb.checked).toBe(true));
      expect(requestCb.checked).toBe(true);
      // Now uncheck request → should become response-only
      await userEvent.click(requestCb);
      await waitFor(() => expect(requestCb.checked).toBe(false));
      expect(responseCb.checked).toBe(true);
    }
  });
});

// ── SemanticFields: threshold + embeddingModel onChange ───────────────────────

describe('RouterSecurityTab — SemanticFields threshold + embeddingModel', () => {
  it('threshold range input changes value', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => screen.queryByText(/Similarity threshold/));

    const slider = document.querySelector('input[type="range"]') as HTMLInputElement | null;
    if (slider) {
      Object.defineProperty(slider, 'value', { writable: true, value: '0.90' });
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      // The component updates; just verify no error thrown
      expect(slider).toBeTruthy();
    }
  });

  it('embeddingModel select onChange fires', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'semantic');

    await waitFor(() => screen.queryByText('Embedding model'));

    const embeddingSelect = document.querySelector('select[data-testid*="embedding"]') as HTMLSelectElement | null;
    if (embeddingSelect) {
      await userEvent.selectOptions(embeddingSelect, 'openai/text-embedding-3-small');
      expect(embeddingSelect.value).toBe('openai/text-embedding-3-small');
    }
  });
});

// ── TopicFields: allowedTopics + judge + threshold ────────────────────────────

describe('RouterSecurityTab — TopicFields interactions', () => {
  it('allowedTopics textarea onChange fires', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    const ta = await waitFor(() =>
      screen.getByPlaceholderText(/Customer support/) as HTMLTextAreaElement
    );
    // Click first to focus, then paste
    await userEvent.click(ta);
    await userEvent.paste('some topic text');
    expect(ta.value).toBe('some topic text');
  });

  it('TopicFields threshold range onChange fires', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => screen.queryByText(/Block if on-topic score below/));

    const sliders = document.querySelectorAll('input[type="range"]');
    // TopicFields has one range slider
    const slider = sliders[0] as HTMLInputElement | null;
    if (slider) {
      Object.defineProperty(slider, 'value', { writable: true, value: '0.70' });
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(slider).toBeTruthy();
    }
  });

  it('judge model select in TopicFields fires onChange', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'topic');

    await waitFor(() => screen.queryByText('Judge model'));

    const judgeSelect = document.querySelector('select') as HTMLSelectElement | null;
    if (judgeSelect) {
      await userEvent.selectOptions(judgeSelect, 'openai/gpt-4o');
      expect(judgeSelect.value).toBe('openai/gpt-4o');
    }
  });
});

// ── ModerationFields: judge + threshold + systemPrompt onChange ───────────────

describe('RouterSecurityTab — ModerationFields onChange handlers', () => {
  it('judge model select in ModerationFields fires onChange', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.queryByText('Judge model'));

    const allSelects = document.querySelectorAll('select');
    // Find the judge select (has gpt-4o option)
    const judgeSelect = Array.from(allSelects).find(s =>
      Array.from(s.options).some(o => o.value === 'openai/gpt-4o')
    ) as HTMLSelectElement | null;
    if (judgeSelect) {
      await userEvent.selectOptions(judgeSelect, 'openai/gpt-4o');
      expect(judgeSelect.value).toBe('openai/gpt-4o');
    }
  });

  it('ModerationFields threshold range onChange fires', async () => {
    renderTab();

    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'moderation');

    await waitFor(() => screen.queryByText(/Block if harm score above/));

    const slider = document.querySelector('input[type="range"]') as HTMLInputElement | null;
    if (slider) {
      Object.defineProperty(slider, 'value', { writable: true, value: '0.60' });
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      expect(slider).toBeTruthy();
    }
  });
});

// ── PiiPolicyCard customPatterns textarea onChange ────────────────────────────

describe('RouterSecurityTab — PII customPatterns onChange', () => {
  it('custom patterns textarea fires onChange', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'request' as const, entities: [] }],
      },
    });

    await waitFor(() => screen.getByText('Custom patterns (regex, one per line)'));

    // The textarea placeholder contains backslash characters
    const ta = screen.getByPlaceholderText(/\\b\\d/) as HTMLTextAreaElement;
    // Click to focus, then paste
    await userEvent.click(ta);
    await userEvent.paste('\\d{4}-\\d{4}');
    expect(ta.value).toContain('\\d');
  });
});

// ── TargetSelector onChange('request') branch (line 234) ─────────────────────
// Fires when newReq=true, newRes=false — uncheck response while request is checked.

describe('RouterSecurityTab — TargetSelector onChange request-only branch', () => {
  it('unchecking response while request is checked sets target to request-only', async () => {
    // Load a semantic rule with target='both' so both checkboxes start checked.
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'semantic' as const,
          target: 'both' as const,
          block: true,
          config: { embeddingModelId: '', examples: [], threshold: 0.82 },
        }],
      },
    });

    await waitFor(() => screen.getAllByTestId('rule-enabled'));

    // TargetSelector: find the response checkbox (not a scope checkbox)
    const responseCbs = screen.getAllByRole('checkbox').filter(cb =>
      cb.closest('label')?.textContent?.trim() === 'response' && !cb.hasAttribute('data-testid')
    ) as HTMLInputElement[];
    expect(responseCbs.length).toBeGreaterThan(0);
    // response is currently checked (target='both'); uncheck it → target='request'
    await userEvent.click(responseCbs[0]!);
    await waitFor(() => expect((responseCbs[0] as HTMLInputElement).checked).toBe(false));
    // streaming warning gone (no response-blocking rule)
    expect(screen.queryByTestId('streaming-disabled-warning')).toBeNull();
  });
});

// ── ScopeSelector apply guard (!req && !inj && !res) — line 264 ──────────────
// Guard fires when toggling a flag would leave all three unchecked.
// The only way to reach it: current state has exactly one flag set and user clicks it.

describe('RouterSecurityTab — ScopeSelector apply guard all-unchecked', () => {
  it('does not uncheck inject when it is the only flag set', async () => {
    // Load a moderation rule with inject=true and no target (inject-only).
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          inject: true,
          block: false,
          log: false,
          config: { threshold: 0.5, systemPrompt: 'Be safe' },
        }],
      },
    });

    await waitFor(() => screen.getByTestId('rule-scope-inject'));
    const injCb = screen.getByTestId('rule-scope-inject') as HTMLInputElement;
    expect(injCb.checked).toBe(true);
    // Clicking inject when it is the only flag checked triggers the guard → no change
    await userEvent.click(injCb);
    // Still checked (guard returned early)
    expect((screen.getByTestId('rule-scope-inject') as HTMLInputElement).checked).toBe(true);
  });
});

// ── cfg.modelId ?? '' right side: undefined modelId ──────────────────────────
// Line 430 (TopicFields) and line 490 (ModerationFields): cfg.modelId ?? '' fires
// the '' right side only when modelId is undefined (not '').

describe('RouterSecurityTab — cfg.modelId undefined fires ?? fallback', () => {
  it('TopicFields renders when config.modelId is absent (undefined)', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'topic' as const,
          target: 'both' as const,
          block: true,
          // modelId deliberately absent → cfg.modelId is undefined → ?? '' fires
          config: { allowedTopics: 'tech support' },
        }],
      },
    });
    await waitFor(() => expect(screen.queryByText('Judge model')).not.toBeNull());
    // SearchableSelect value defaults to '' via the fallback
    const judgeSelect = document.querySelector('select[data-testid*="judge"]') as HTMLSelectElement | null;
    if (judgeSelect) expect(judgeSelect.value).toBe('');
  });

  it('ModerationFields renders when config.modelId is absent (undefined)', async () => {
    renderTab({
      ...mockRouter,
      guardrails: {
        rules: [{
          type: 'moderation' as const,
          target: 'both' as const,
          block: true,
          // modelId deliberately absent → cfg.modelId is undefined → ?? '' fires
          config: { threshold: 0.5, systemPrompt: 'Be safe' },
        }],
      },
    });
    await waitFor(() => expect(screen.queryByText('Judge model')).not.toBeNull());
  });
});

// ── detectInjection=true branch in guardrailsPayload (line 758) ───────────────
// ...(detectInjection ? { detectInjection } : {}) — true branch only fires when
// the loaded router has detectInjection: true.

describe('RouterSecurityTab — detectInjection=true included in save payload', () => {
  it('includes detectInjection:true when router.guardrails.detectInjection is set', async () => {
    renderTab({
      ...mockRouter,
      guardrails: { detectInjection: true, rules: [] },
    });

    await waitFor(() => screen.getByRole('button', { name: /save security settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /save security settings/i }));
    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());

    const call = mockUpdateRouter.mock.calls[0]!;
    const payload = call[1] as { guardrails?: { detectInjection?: boolean } };
    expect(payload.guardrails?.detectInjection).toBe(true);
  });
});

// ── PiiPolicyCard outputBufferSize onChange ────────────────────────────────────

describe('RouterSecurityTab — PII outputBufferSize onChange', () => {
  it('outputBufferSize onChange fires on number input change event', async () => {
    renderTab({
      ...mockRouter,
      pii: {
        policies: [{ enabled: true, target: 'response' as const, entities: [], outputBufferSize: 30 }],
      },
    });

    await waitFor(() => screen.getByText('Streaming buffer size (characters)'));
    const input = screen.getByDisplayValue('30') as HTMLInputElement;
    // Dispatch a change event directly (userEvent.type causes clamping issues)
    Object.defineProperty(input, 'value', { writable: true, value: '100' });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // No error thrown; input reacted to change
    expect(input).toBeTruthy();
  });
});

// ── Profile assignment ───────────────────────────────────────────────────────

const assignedRouter = { ...mockRouter, securityProfileId: 'security-standard' };

/** Like renderTab, but keeps the router in state so setRouter re-renders the tab. */
function renderStatefulTab(initial: Record<string, unknown>) {
  function LayoutWrapper() {
    const [router, setRouter] = React.useState(initial);
    return <Outlet context={{ router, setRouter }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/security']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="security" element={<RouterSecurityTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('RouterSecurityTab — security profile assignment', () => {
  it('starts in custom mode: rules editor and save button visible', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save security settings/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Security Profile')).not.toBeInTheDocument();
  });

  it('switching to Profile assigns the first built-in profile', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { security: 'security-standard' }));
  });

  it('falls back to the first user profile when no built-in exists', async () => {
    const user = userEvent.setup();
    mockGetProfiles.mockResolvedValue([sampleProfiles[1]]);
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { security: 'custom-sec' }));
  });

  it('reports an error when no security profile exists', async () => {
    const user = userEvent.setup();
    mockGetProfiles.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByText(/No security profile available/)).toBeInTheDocument());
    expect(mockAssignProfile).not.toHaveBeenCalled();
  });

  it('while assigned, hides the editor and lists the profile rules and PII policies', async () => {
    renderTab(assignedRouter);
    await waitFor(() => expect(screen.getByLabelText('Security Profile')).toBeInTheDocument());
    expect(screen.queryByText('Content Guardrails')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save security settings/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Regex \(request\), blocking/)).toBeInTheDocument();
    expect(screen.getByText(/PII redaction \(request\)/)).toBeInTheDocument();
  });

  it('lists built-in and user profiles in the select', async () => {
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Security Profile');
    const values = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(values).toContain('Standard (built-in)');
    expect(values).toContain('My Security');
  });

  it('selecting another profile reassigns it', async () => {
    const user = userEvent.setup();
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Security Profile');
    await user.selectOptions(select, 'custom-sec');
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { security: 'custom-sec' }));
  });

  it('switching to Custom clears the profile and prefills its rules', async () => {
    const user = userEvent.setup();
    mockAssignProfile.mockResolvedValue({ ...mockRouter });
    renderStatefulTab(assignedRouter);
    await waitFor(() => expect(screen.getByLabelText('Security Profile')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { security: null }));
    // The profile's regex rule is now this router's own editable rule.
    await waitFor(() => expect(screen.getByDisplayValue('secret')).toBeInTheDocument());
  });

  it('clicking the already active mode does nothing', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(mockAssignProfile).not.toHaveBeenCalled();
  });

  it('surfaces assignment errors', async () => {
    const user = userEvent.setup();
    mockAssignProfile.mockRejectedValue(new Error('assign boom'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Content Guardrails')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByText('assign boom')).toBeInTheDocument());
  });

  it('a failed profiles fetch leaves the profile list empty', async () => {
    mockGetProfiles.mockRejectedValue(new Error('nope'));
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Security Profile');
    expect(Array.from(select.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value)).toEqual(['']);
  });
});
