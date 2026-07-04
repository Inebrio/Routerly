import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ModelFormPage } from './ModelFormPage';

vi.mock('../api', () => ({
  getModels: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  testOpenAIOAuth: vi.fn(),
  getProviders: vi.fn(),
}));

import { getModels, getProviders } from '../api';
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockGetProviders = vi.mocked(getProviders);

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
function renderPage(path: string, state?: unknown) {
  // Split path into pathname + search so MemoryRouter parses them correctly
  const [pathname = '', search = ''] = path.split('?');
  const entry = state
    ? { pathname, search: search ? `?${search}` : '', state }
    : path;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/dashboard/models/new" element={<ModelFormPage />} />
        <Route path="/dashboard/models/:id" element={<ModelFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([]);
  mockGetProviders.mockResolvedValue({
    openai: {
      endpoint: 'https://api.openai.com/v1',
      models: [
        { id: 'gpt-4o', input: 2.5, output: 10 },
        { id: 'gpt-5.2', input: 1.75, output: 14 },
      ],
    },
    anthropic: {
      endpoint: 'https://api.anthropic.com',
      models: [
        { id: 'claude-fable-5', input: 10, output: 50, contextWindow: 200000 },
        { id: 'claude-sonnet-4-6', input: 3, output: 15 },
      ],
    },
    ollama: {
      endpoint: 'http://localhost:11434/v1',
      models: [],
    },
    custom: {
      endpoint: '',
      models: [],
    },
  } as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
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

  it('unknown modelId with no state sets isCustomModel=true (custom input shows the real id)', async () => {
    // No router state — exercises the no-state fallback added in #81:
    // when modelId is not a preset in PROVIDER_MODELS, isCustomModel is forced true
    // so the editable custom input shows the raw id instead of silently dropping it.
    renderPage('/dashboard/models/new?provider=openai&modelId=some-unknown-id');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const customInput = screen.getByPlaceholderText('e.g. my-fine-tuned-model') as HTMLInputElement;
    expect(customInput.value).toBe('some-unknown-id');
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

// ── Discovery catalogEntry state ───────────────────────────────────────────────

describe('ModelFormPage — navigation state.catalogEntry', () => {
  it('not-a-preset: shows custom input with real id, seeds pricing from catalog (×1000)', async () => {
    const catalogEntry = {
      id: 'ollama/qwen3:4b',
      provider: 'ollama',
      name: 'Qwen3 4B',
      contextWindow: 32768,
      modalities: ['text'],
      pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 },
      local: true,
      isConfigured: false,
    };

    renderPage('/dashboard/models/new?provider=ollama&modelId=ollama%2Fqwen3%3A4b', { catalogEntry });

    // Wait for provider to settle
    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('ollama');
    });

    // Custom text input must be visible and contain the real discovered id
    const customInput = screen.getByPlaceholderText('e.g. my-fine-tuned-model') as HTMLInputElement;
    expect(customInput.value).toBe('ollama/qwen3:4b');

    // Pricing fields are 0 for local/free model
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const inputPrice = spinners.find(i => i.name === 'inputPerMillion' || i.placeholder?.includes('Input'));
    // local free: value is '0'
    const zeroFields = spinners.filter(i => i.value === '0');
    expect(zeroFields.length).toBeGreaterThanOrEqual(2);
  });

  it('is-a-preset: selects preset in dropdown, seeds pricing', async () => {
    const catalogEntry = {
      id: 'claude-fable-5',
      provider: 'anthropic',
      name: 'Claude Fable 5',
      contextWindow: 200000,
      modalities: ['text'],
      pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.03 },
      local: false,
      isConfigured: false,
    };

    renderPage('/dashboard/models/new?provider=anthropic&modelId=claude-fable-5', { catalogEntry });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('anthropic');
    });

    // The model preset select (second combobox) must show claude-fable-5
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const modelSelect = selects.find(s => s.value === 'claude-fable-5');
    expect(modelSelect).toBeTruthy();

    // Pricing must come from the curated preset (providersConf), NOT catalog ×1000.
    // claude-fable-5 preset: input=10, output=50 — catalog entry above has output=30 (×1000), so
    // asserting output=50 will fail if the catalog value is used instead of the preset.
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(spinners.find(i => i.value === '10')).toBeTruthy();  // input $/1M
    expect(spinners.find(i => i.value === '50')).toBeTruthy();  // output $/1M (preset, not catalog×1000)
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
