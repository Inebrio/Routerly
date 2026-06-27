import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectSecurityTab } from './ProjectSecurityTab';

vi.mock('../../api', () => ({
  getModels: vi.fn(),
  updateProject: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { getModels } from '../../api';
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);

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

const mockProject = {
  id: 'proj-1',
  name: 'Test',
  models: [],
  guardrails: { action: 'block' as const, rules: [] },
  pii: { entities: [], scrubInput: true, scrubOutput: false, outputBufferSize: 30 },
};

function renderTab() {
  function LayoutWrapper() {
    return <Outlet context={{ project: mockProject, setProject: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects/proj-1/security']}>
      <Routes>
        <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
          <Route path="security" element={<ProjectSecurityTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([chatModel, embeddingModel]);
});

afterEach(() => vi.clearAllMocks());

// ── C5: judge dropdowns exclude embedding-only models ─────────────────────────

describe('ProjectSecurityTab — judge model options', () => {
  it('topic rule judge dropdown excludes embedding-only model', async () => {
    renderTab();

    // Wait for models to load, then add a Topic rule via the mocked SearchableSelect
    const addSelect = await waitFor(() =>
      screen.getByTestId('searchable-Add a security policy...')
    ) as HTMLSelectElement;

    await userEvent.selectOptions(addSelect, 'topic');

    // A new RuleCard for topic is rendered; it should contain a judge SearchableSelect
    // The judge select (modelOptions) should have the chat model but not the embedding model
    await waitFor(() => {
      // All selects in the rendered output
      const allSelects = document.querySelectorAll('select');
      // Find a select that has gpt-4o as an option (the judge dropdown)
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
      // The embedding select should have the embedding model
      const embeddingSelect = Array.from(allSelects).find(s =>
        Array.from(s.options).some(o => o.value === 'openai/text-embedding-3-small')
      );
      expect(embeddingSelect).toBeTruthy();
      const vals = Array.from(embeddingSelect!.options).map(o => o.value);
      expect(vals).toContain('openai/text-embedding-3-small');
      // Chat-only model must NOT appear in the embedding dropdown
      expect(vals).not.toContain('openai/gpt-4o');
    });
  });
});
