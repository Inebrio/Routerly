import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ModelFormPage } from './ModelFormPage';

vi.mock('../api', () => ({
  getModels: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  testOpenAIOAuth: vi.fn(),
}));

import { getModels } from '../api';
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'openai/gpt-5.2',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1.75, outputPerMillion: 14, cachePerMillion: 0.175 },
    contextWindow: 128000,
    ...overrides,
  };
}

// Mirrors the actual route tree from App.tsx:
//   models/new          -> ModelFormPage (new / clone / prefill)
//   models/:id          -> ModelFormPage (edit)
function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/models/new" element={<ModelFormPage />} />
        <Route path="/dashboard/models/:id" element={<ModelFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

// ── Prefill from discovery ─────────────────────────────────────────────────────

describe('ModelFormPage — ?provider + ?modelId prefill', () => {
  it('prefills anthropic provider and a known preset model id + pricing', async () => {
    renderPage('/dashboard/models/new?provider=anthropic&modelId=claude-fable-5');

    // Wait for async init to complete — provider select must settle on anthropic
    const selects = await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      const providerSel = all[0]!;
      if (providerSel.value !== 'anthropic') throw new Error('not yet');
      return all;
    });

    // Provider dropdown (first select) shows anthropic
    expect(selects[0]!.value).toBe('anthropic');

    // Model preset select (second select) shows the requested model
    const modelSelect = selects.find(s => s.value === 'claude-fable-5');
    expect(modelSelect).toBeTruthy();

    // Pricing is seeded (claude-fable-5 input = 10 $/1M)
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const inputPriceField = inputs.find(i => i.value === '10');
    expect(inputPriceField).toBeTruthy();
  });

  it('?provider=custom sets custom provider', async () => {
    renderPage('/dashboard/models/new?provider=custom');

    const selects = await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      const providerSel = all[0]!;
      if (providerSel.value !== 'custom') throw new Error('not yet');
      return all;
    });

    expect(selects[0]!.value).toBe('custom');
    // custom provider shows upstream provider name text input
    expect(screen.getByPlaceholderText('e.g. deepseek, mistral, groq')).toBeTruthy();
  });

  it('invalid ?provider falls back to openai default', async () => {
    renderPage('/dashboard/models/new?provider=nope');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });
  });

  it('no query params defaults to openai first model', async () => {
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });
  });
});

// ── Edit path ──────────────────────────────────────────────────────────────────

describe('ModelFormPage — edit path', () => {
  it('loads an existing model into the form', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2', provider: 'openai' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // h1 says "Edit Model"
    expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
  });

  it('shows error when editing unknown id', async () => {
    mockGetModels.mockResolvedValue([]);

    renderPage('/dashboard/models/nonexistent');

    await waitFor(() => expect(screen.getByText('Model not found')).toBeTruthy());
  });
});

// ── Clone path ─────────────────────────────────────────────────────────────────

describe('ModelFormPage — clone path', () => {
  it('loads clone source and shows Clone Model heading', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Clone Model/ })).toBeTruthy()
    );

    // customId input is empty (cleared after clone)
    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });
  });
});
