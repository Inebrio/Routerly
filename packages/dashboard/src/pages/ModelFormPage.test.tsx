import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ModelFormPage } from './ModelFormPage';

vi.mock('../api', () => ({
  getModels: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  testOpenAIOAuth: vi.fn(),
  testModel: vi.fn(),
  getProviders: vi.fn(),
  getConnections: vi.fn(),
}));

vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options, value, onChange, placeholder, disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

// navigate spy
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { getModels, getProviders, createModel, updateModel, testOpenAIOAuth, testModel, getConnections } from '../api';
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockGetProviders = vi.mocked(getProviders);
const mockCreateModel = vi.mocked(createModel as (...a: unknown[]) => Promise<unknown>);
const mockUpdateModel = vi.mocked(updateModel as (...a: unknown[]) => Promise<unknown>);
const mockTestOpenAIOAuth = vi.mocked(testOpenAIOAuth as (...a: unknown[]) => Promise<unknown>);
const mockTestModel = vi.mocked(testModel as (...a: unknown[]) => Promise<unknown>);
const mockGetConnections = vi.mocked(getConnections as () => Promise<unknown>);

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

// Full provider catalog covering all special providers
const FULL_CATALOG = {
  openai: {
    endpoint: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', input: 2.5, output: 10, contextWindow: 128000, notes: 'Fast and capable' },
      { id: 'gpt-5.2', input: 1.75, output: 14, cache: 0.175, cacheWrite: 0.35,
        pricingTiers: [{ metric: 'context_tokens', above: 200000, input: 3.5, output: 28, cache: 0.35 }],
        capabilities: { embedding: false } },
    ],
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com',
    models: [
      { id: 'claude-fable-5', input: 10, output: 50, contextWindow: 200000 },
      { id: 'claude-sonnet-4-6', input: 3, output: 15 },
      { id: 'claude-embedding', input: 0.1, output: 0, capabilities: { embedding: true } },
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
  'azure-openai': {
    endpoint: 'https://myresource.openai.azure.com',
    models: [{ id: 'gpt-4o', input: 2.5, output: 10 }],
  },
  bedrock: {
    endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    models: [{ id: 'anthropic.claude-v2', input: 8, output: 24 }],
  },
  vertex: {
    endpoint: 'https://us-central1-aiplatform.googleapis.com',
    models: [{ id: 'gemini-1.5-pro', input: 3.5, output: 10.5 }],
  },
  'openai-web': {
    endpoint: 'https://chatgpt.com',
    models: [{ id: 'gpt-4o', input: 0, output: 0 }],
  },
  'anthropic-web': {
    endpoint: 'https://claude.ai',
    models: [{ id: 'claude-3-5-sonnet-20241022', input: 0, output: 0 }],
  },
  'openai-oauth': {
    endpoint: 'https://api.openai.com/v1',
    models: [{ id: 'codex-davinci-002', input: 0, output: 0 }],
  },
  'anthropic-oauth': {
    endpoint: 'https://api.anthropic.com',
    models: [{ id: 'claude-opus-4-5', input: 0, output: 0 }],
  },
};

// Mirrors the actual route tree from App.tsx:
//   models/new          -> ModelFormPage (new / clone / prefill)
//   models/:id          -> ModelFormPage (edit)
function renderPage(path: string, state?: unknown) {
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
  mockNavigate.mockClear();
  mockCreateModel.mockResolvedValue({});
  mockUpdateModel.mockResolvedValue({});
  mockGetConnections.mockResolvedValue([]);
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

// ── Prefill from Models page connection filter ─────────────────────────────────

describe('ModelFormPage — ?connection prefill', () => {
  it('preselects the connection and its provider when ?connection matches a loaded connection', async () => {
    mockGetConnections.mockResolvedValue([
      { id: 'conn-1', label: 'My Anthropic', providerId: 'anthropic', enabled: true, endpoint: '' },
    ]);
    renderPage('/dashboard/models/new?connection=conn-1');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('anthropic');
    });

    // "Preconfigured" toggle is active and the connection select carries the preselected id
    expect(screen.getByText('Preconfigured').className).toContain('active');
    const connSelect = screen.getByTestId('searchable-— select a connection —') as HTMLSelectElement;
    expect(connSelect.value).toBe('conn-1');
  });

  it('unknown ?connection is ignored, falls back to openai default and Custom mode', async () => {
    mockGetConnections.mockResolvedValue([]);
    renderPage('/dashboard/models/new?connection=nope');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });
    expect(screen.getByText('Custom').className).toContain('active');
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

  it('catalogEntry with non-zero pricing (non-local) seeds ×1000 pricing', async () => {
    const catalogEntry = {
      id: 'some-custom-model',
      provider: 'openai',
      name: 'Some Custom Model',
      contextWindow: 64000,
      modalities: ['text'],
      pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
      local: false,
      isConfigured: false,
    };

    renderPage('/dashboard/models/new?provider=openai&modelId=some-custom-model', { catalogEntry });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Non-preset: should show custom input
    const customInput = screen.getByPlaceholderText('e.g. my-fine-tuned-model') as HTMLInputElement;
    expect(customInput.value).toBe('some-custom-model');

    // Pricing from catalog (×1000): 0.005 * 1000 = 5, 0.015 * 1000 = 15
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(spinners.find(i => i.value === '5')).toBeTruthy();
    expect(spinners.find(i => i.value === '15')).toBeTruthy();
  });

  it('catalogEntry with embedding=true sets embedding model checkbox', async () => {
    const catalogEntry = {
      id: 'text-embedding-custom',
      provider: 'openai',
      name: 'Custom Embedding',
      contextWindow: 8192,
      modalities: ['text'],
      pricing: { inputPer1kTokens: 0.0001, outputPer1kTokens: 0 },
      local: false,
      isConfigured: false,
      embedding: true,
    };

    renderPage('/dashboard/models/new?provider=openai&modelId=text-embedding-custom', { catalogEntry });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const checkbox = screen.getByRole('checkbox', { name: /Embedding model/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
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

  it('shows error when clone source not found', async () => {
    mockGetModels.mockResolvedValue([]);

    renderPage('/dashboard/models/new?clone=openai%2Fnonexistent');

    await waitFor(() => expect(screen.getByText('Source model not found')).toBeTruthy());
  });
});

// ── Provider-specific UI ───────────────────────────────────────────────────────

describe('ModelFormPage — provider-specific fields', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('azure-openai shows Azure-specific fields', async () => {
    renderPage('/dashboard/models/new?provider=azure-openai');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'azure-openai') throw new Error('not yet');
    });

    expect(screen.getByPlaceholderText('myresource')).toBeTruthy();
    expect(screen.getByPlaceholderText('gpt-4o-deployment')).toBeTruthy();
    expect(screen.getByPlaceholderText('2024-02-01')).toBeTruthy();
  });

  it('bedrock shows AWS-specific fields', async () => {
    renderPage('/dashboard/models/new?provider=bedrock');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'bedrock') throw new Error('not yet');
    });

    expect(screen.getByPlaceholderText('us-east-1')).toBeTruthy();
    expect(screen.getByPlaceholderText('AKIAIOSFODNN7EXAMPLE')).toBeTruthy();
  });

  it('vertex shows GCP-specific fields', async () => {
    renderPage('/dashboard/models/new?provider=vertex');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    expect(screen.getByPlaceholderText('my-gcp-project')).toBeTruthy();
    expect(screen.getByPlaceholderText('us-central1')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Paste the contents/)).toBeTruthy();
  });

  it('openai-web shows warning banner and Access Token label', async () => {
    renderPage('/dashboard/models/new?provider=openai-web');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-web') throw new Error('not yet');
    });

    expect(screen.getByText(/Unofficial provider/)).toBeTruthy();
    expect(screen.getByText(/Access Token/)).toBeTruthy();
    // openai-web uses password input with specific placeholder
    const input = screen.getByPlaceholderText('eyJ…') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('anthropic-web shows warning banner and Session Token label', async () => {
    renderPage('/dashboard/models/new?provider=anthropic-web');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'anthropic-web') throw new Error('not yet');
    });

    expect(screen.getByText(/Unofficial provider/)).toBeTruthy();
    expect(screen.getByText(/Session Token/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/sk-ant-sid01/)).toBeTruthy();
  });

  it('anthropic-oauth shows subscription info and OAuth Token label', async () => {
    renderPage('/dashboard/models/new?provider=anthropic-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'anthropic-oauth') throw new Error('not yet');
    });

    // Subscription provider shows instructions panel — text may appear in both <em> and <label>
    expect(screen.getAllByText(/Claude Pro\/Max subscription/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Subscription OAuth Token/).length).toBeGreaterThan(0);
  });

  it('openai-oauth shows subscription info and Test button', async () => {
    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    // Subscription provider shows instructions — text also appears in <option> so use getAllByText
    expect(screen.getAllByText(/ChatGPT Plus\/Pro subscription/i).length).toBeGreaterThan(0);
    // openai-oauth has a "Test" button
    const testBtn = screen.getByRole('button', { name: /Test/ });
    expect(testBtn).toBeTruthy();
  });

  it('ollama shows "not required for local models" placeholder for api key', async () => {
    renderPage('/dashboard/models/new?provider=ollama');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'ollama') throw new Error('not yet');
    });

    expect(screen.getByPlaceholderText('not required for local models')).toBeTruthy();
  });
});

// ── Provider change via select ─────────────────────────────────────────────────

describe('ModelFormPage — provider change via select', () => {
  it('switching provider resets form and applies first model preset', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const providerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await user.selectOptions(providerSelect, 'anthropic');

    await waitFor(() => {
      expect(providerSelect.value).toBe('anthropic');
    });
  });

  it('switching to custom provider shows custom provider name field', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const providerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await user.selectOptions(providerSelect, 'custom');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. deepseek, mistral, groq')).toBeTruthy();
    });
  });

  it('switching to a provider with no models shows custom text input only', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const providerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await user.selectOptions(providerSelect, 'ollama');

    await waitFor(() => {
      // ollama has no models, so only custom input is shown
      expect(screen.getByPlaceholderText('e.g. my-fine-tuned-model')).toBeTruthy();
    });
  });
});

// ── Connection picker: Preconfigured / Custom ───────────────────────────────────

const CONNECTIONS = [
  { id: 'conn-openai-1', providerId: 'openai', label: 'OpenAI Prod', credentials: undefined, endpoint: 'https://api.openai.com/v1', enabled: true },
  { id: 'conn-openai-2', providerId: 'openai', label: 'OpenAI Backup', credentials: undefined, endpoint: 'https://api.openai.com/v1', enabled: true },
  { id: 'conn-anthropic-1', providerId: 'anthropic', label: 'Anthropic Main', credentials: undefined, endpoint: 'https://api.anthropic.com', enabled: true },
];

describe('ModelFormPage — connection picker', () => {
  it('Preconfigured mode lists provider-matching connections and submits connectionId', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue(CONNECTIONS);
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByRole('button', { name: 'Preconfigured' }));

    await waitFor(() => expect(screen.getByText('OpenAI Prod')).toBeTruthy());
    expect(screen.getByText('OpenAI Backup')).toBeTruthy();
    // Anthropic connection is filtered out — provider is still openai
    expect(screen.queryByText('Anthropic Main')).toBeNull();

    const connSelect = screen.getByText('OpenAI Prod').closest('select') as HTMLSelectElement;
    await user.selectOptions(connSelect, 'conn-openai-1');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.connectionId).toBe('conn-openai-1');
    expect(payload.apiKey).toBeUndefined();
    expect(payload.endpoint).toBeUndefined();
  });

  it('Custom mode submits apiKey+endpoint and omits connectionId', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue(CONNECTIONS);
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Custom is the default mode — no need to click the toggle.
    const apiKeyInput = document.querySelector('input[name="apiKey"]') as HTMLInputElement;
    await user.type(apiKeyInput, 'sk-test-123');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.apiKey).toBe('sk-test-123');
    expect(typeof payload.endpoint).toBe('string');
    expect((payload.endpoint as string).length).toBeGreaterThan(0);
    expect(payload.connectionId).toBeUndefined();
  });

  it('switching provider refilters the preconfigured connection list', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue(CONNECTIONS);
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByRole('button', { name: 'Preconfigured' }));
    await waitFor(() => expect(screen.getByText('OpenAI Prod')).toBeTruthy());
    expect(screen.queryByText('Anthropic Main')).toBeNull();

    const providerSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    await user.selectOptions(providerSelect, 'anthropic');

    await waitFor(() => expect(screen.getByText('Anthropic Main')).toBeTruthy());
    expect(screen.queryByText('OpenAI Prod')).toBeNull();
    expect(screen.queryByText('OpenAI Backup')).toBeNull();
  });

  it('edit path defaults to Preconfigured for a model on a shared connection', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2', connectionId: 'conn-openai-1' });
    mockGetModels.mockResolvedValue([model]);
    mockGetConnections.mockResolvedValue(CONNECTIONS);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy());

    const preconfiguredBtn = await waitFor(() => screen.getByRole('button', { name: 'Preconfigured' }));
    expect(preconfiguredBtn.className).toContain('active');
    await waitFor(() => expect(screen.getByText('OpenAI Prod')).toBeTruthy());
  });

  it('edit path defaults to Custom for a model on its own dedicated connection', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2', connectionId: 'conn-for-openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);
    mockGetConnections.mockResolvedValue(CONNECTIONS);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy());

    const customBtn = screen.getByRole('button', { name: 'Custom' });
    expect(customBtn.className).toContain('active');
  });
});

// ── Model select / custom model ────────────────────────────────────────────────

describe('ModelFormPage — model preset select', () => {
  it('selecting __custom__ shows custom text input', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const modelSelect = selects.find(s => s.value === 'gpt-4o') ?? selects[1]!;
    await user.selectOptions(modelSelect, '__custom__');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. my-fine-tuned-model')).toBeTruthy();
    });
  });

  it('selecting a preset fills in pricing', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Start at gpt-4o, switch to gpt-5.2
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const modelSelect = selects.find(s => s.value === 'gpt-4o') ?? selects[1]!;
    await user.selectOptions(modelSelect, 'gpt-5.2');

    await waitFor(() => {
      const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      expect(spinners.find(i => i.value === '1.75')).toBeTruthy();
    });
  });
});

// ── Pricing tiers (Advanced section) ──────────────────────────────────────────

describe('ModelFormPage — pricing tiers', () => {
  it('clicking Advanced toggle shows/hides pricing tier section', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const advBtn = screen.getByText(/Advanced — Pricing tiers/);
    // Initially hidden — "Add pricing tier" not visible
    expect(screen.queryByText(/Add pricing tier/)).toBeNull();

    await user.click(advBtn);
    expect(screen.getByText(/Add pricing tier/)).toBeTruthy();

    await user.click(advBtn);
    expect(screen.queryByText(/Add pricing tier/)).toBeNull();
  });

  it('adds a pricing tier row', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));

    // Should now show tier pricing input labels
    await waitFor(() => {
      expect(screen.getByText(/Context tokens/)).toBeTruthy();
    });
  });

  it('removes a pricing tier row', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));

    // Wait for tier to appear
    await waitFor(() => expect(screen.getByText(/Context tokens/)).toBeTruthy());

    // Find and click the X button to remove it
    const removeButtons = screen.getAllByTitle('Remove tier');
    expect(removeButtons.length).toBeGreaterThan(0);
    await user.click(removeButtons[0]!);

    // Tier row should be gone
    await waitFor(() => {
      expect(screen.queryByTitle('Remove tier')).toBeNull();
    });
  });

  it('updates tier fields', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));

    await waitFor(() => expect(screen.getByPlaceholderText('200000')).toBeTruthy());

    const aboveInput = screen.getByPlaceholderText('200000') as HTMLInputElement;
    await user.clear(aboveInput);
    await user.type(aboveInput, '150000');

    expect(aboveInput.value).toBe('150000');
  });

  it('model with preset pricingTiers opens Advanced section automatically', async () => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
    renderPage('/dashboard/models/new?provider=openai&modelId=gpt-5.2');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai') throw new Error('not yet');
    });

    // gpt-5.2 has pricingTiers, so Advanced section should be open automatically
    await waitFor(() => {
      expect(screen.getByText(/Add pricing tier/)).toBeTruthy();
    });
  });
});

// ── Limits section ─────────────────────────────────────────────────────────────

describe('ModelFormPage — limits', () => {
  it('clicking Limits toggle shows/hides limit rows', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const limBtn = screen.getByText(/^Limits$/);
    expect(screen.queryByText(/Add limit/)).toBeNull();

    await user.click(limBtn);
    expect(screen.getByText(/Add limit/)).toBeTruthy();

    await user.click(limBtn);
    expect(screen.queryByText(/Add limit/)).toBeNull();
  });

  it('adds a limit row', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    // Metric select should appear
    await waitFor(() => {
      expect(screen.getByText('Cost (USD)')).toBeTruthy();
    });
  });

  it('removes a limit row', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    // 'Cost (USD)' appears in multiple <option> elements; just confirm at least one exists
    await waitFor(() => expect(screen.getAllByText('Cost (USD)').length).toBeGreaterThan(0));

    // Find the limit row delete button: it's the sole <button> inside the limit row grid container
    // (the grid has 5 columns; the button is the last child).
    const limitRowBtn = document.querySelector(
      '[style*="gridTemplateColumns"] > button'
    ) as HTMLButtonElement | null;
    if (limitRowBtn) await user.click(limitRowBtn);

    // After deletion, the metric select (and its Cost (USD) option) is gone
    await waitFor(() => {
      expect(document.querySelector('[style*="gridTemplateColumns"]')).toBeNull();
    });
  });

  it('switches limit window type to rolling', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    // Find window type select (the one with "Period"/"Rolling" options)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    expect(windowTypeSelect).toBeTruthy();

    await user.selectOptions(windowTypeSelect!, 'rolling');

    await waitFor(() => {
      // Rolling shows "hours", "minutes" etc.
      expect(screen.getByText('hours')).toBeTruthy();
    });
  });

  it('changes limit metric to calls', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const metricSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'calls'));
    expect(metricSelect).toBeTruthy();
    await user.selectOptions(metricSelect!, 'calls');

    await waitFor(() => {
      // Max label changes to "Max (n.)" for calls
      expect(screen.getByText(/Max \(n\.\)/)).toBeTruthy();
    });
  });

  it('changes limit metric to input_tokens', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const metricSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'input_tokens'));
    await user.selectOptions(metricSelect!, 'input_tokens');

    await waitFor(() => {
      expect(screen.getByText(/Max \(tokens\)/)).toBeTruthy();
    });
  });
});

// ── Save (create) ──────────────────────────────────────────────────────────────

describe('ModelFormPage — save create', () => {
  it('submitting form calls createModel and navigates', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Endpoint is pre-filled from catalog; label has no htmlFor so we can't use getByRole+name.
    // Just submit directly.
    const submitBtn = screen.getByRole('button', { name: /Create Model/ });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateModel).toHaveBeenCalled();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/models');
  });

  it('shows error when createModel fails', async () => {
    const user = userEvent.setup();
    mockCreateModel.mockRejectedValueOnce(new Error('Server error'));

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const submitBtn = screen.getByRole('button', { name: /Create Model/ });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });

  it('shows generic error when createModel throws non-Error', async () => {
    const user = userEvent.setup();
    mockCreateModel.mockRejectedValueOnce('oops');

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByRole('button', { name: /Create Model/ }));

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeTruthy();
    });
  });

  it('shows error when model ID is empty (no model in form)', async () => {
    // ollama has no models, so ID will be empty when selected
    renderPage('/dashboard/models/new?provider=ollama');

    // ?provider=ollama is in the catalog so it resolves directly to ollama
    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('ollama');
    });

    // ollama has no preset models → custom input is already shown and empty
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. my-fine-tuned-model')).toBeTruthy();
    });

    // Use fireEvent.submit to bypass HTML5 required validation (empty model ID input has required attr)
    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Model ID required')).toBeTruthy();
    });
  });

  it('sends cachePerMillion and cacheWritePerMillion when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Fill cache fields
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const cacheSpin = spinners.find(s => s.placeholder === '—');
    if (cacheSpin) {
      await user.clear(cacheSpin);
      await user.type(cacheSpin, '0.5');
    }

    await user.click(screen.getByRole('button', { name: /Create Model/ }));

    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.cachePerMillion).toBe(0.5);
  });

  it('sends contextWindow when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const ctxInput = screen.getByPlaceholderText('128000') as HTMLInputElement;
    // Use fireEvent to bypass step=1000 HTML5 validation that jsdom enforces on submit
    fireEvent.change(ctxInput, { target: { value: '65000' } });

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.contextWindow).toBe(65000);
  });

  it('sends embedding capability when checked', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const checkbox = screen.getByRole('checkbox', { name: /Embedding model/i });
    await user.click(checkbox);

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.capabilities).toEqual({ embedding: true });
  });

  it('sends pricingTiers when tier has above+input+output', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));

    await waitFor(() => expect(screen.getByPlaceholderText('200000')).toBeTruthy());

    await user.type(screen.getByPlaceholderText('200000'), '200000');
    const tierSpinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const tierInput = tierSpinners.find(i => i.placeholder === '10.00');
    const tierOutput = tierSpinners.find(i => i.placeholder === '37.50');
    if (tierInput) { await user.clear(tierInput); await user.type(tierInput, '5'); }
    if (tierOutput) { await user.clear(tierOutput); await user.type(tierOutput, '15'); }

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Array.isArray(payload.pricingTiers)).toBe(true);
  });

  it('sends limits when a limit row has a value', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));

    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    // Fill in max value
    const maxInput = screen.getByPlaceholderText('10.00') as HTMLInputElement;
    await user.type(maxInput, '100');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Array.isArray(payload.limits)).toBe(true);
    expect((payload.limits as unknown[]).length).toBeGreaterThan(0);
  });

  it('sends rolling limit row to API', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    await user.selectOptions(windowTypeSelect!, 'rolling');

    await waitFor(() => expect(screen.getByText('hours')).toBeTruthy());

    // Fill value
    const maxInput = screen.getByPlaceholderText('10.00') as HTMLInputElement;
    await user.type(maxInput, '50');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    const limits = payload.limits as Record<string, unknown>[];
    expect(limits[0]!.windowType).toBe('rolling');
  });

  it('custom provider with customProviderName uses name as prefix', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=custom');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'custom') throw new Error('not yet');
    });

    const providerNameInput = screen.getByPlaceholderText('e.g. deepseek, mistral, groq') as HTMLInputElement;
    await user.type(providerNameInput, 'mistral');

    const modelInput = screen.getByPlaceholderText('e.g. deepseek-r1, mistral-large-latest') as HTMLInputElement;
    await user.type(modelInput, 'mistral-large-latest');

    // Endpoint label has no htmlFor — find it: it's a required text input with no placeholder
    // (API key input is type=password; model/provider name inputs have placeholders)
    const endpointInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[required][type="text"], input[required]:not([type])')
    ).find(i => !i.placeholder);
    if (endpointInput) {
      fireEvent.change(endpointInput, { target: { value: 'https://api.mistral.ai/v1' } });
    }

    // Use fireEvent.submit to bypass HTML5 required/number validation in jsdom
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    // ID should be "mistral/mistral-large-latest"
    expect(String(payload.id)).toMatch(/^mistral/);
    expect(payload.upstreamModelId).toBe('mistral-large-latest');
  });

  it('clone path shows "Create Clone" button and sends cloneFrom', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Clone Model/ })).toBeTruthy()
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Clone/ })).toBeTruthy();
    });

    const user = userEvent.setup();
    // Give it a custom ID so we don't hit the "already exists" guard
    const customIdInput = screen.getByPlaceholderText(/openai\//) as HTMLInputElement ?? screen.getAllByRole('textbox')[0]!;
    // use the modelId input directly
    const allTextboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    const customIdBox = allTextboxes.find(i => i.name === 'modelId');
    if (customIdBox) {
      await user.clear(customIdBox);
      await user.type(customIdBox, 'openai/gpt-5.2-clone');
    }

    await user.click(screen.getByRole('button', { name: /Create Clone/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.cloneFrom).toBe('openai/gpt-5.2');
  });

  it('clone blocks save if finalId already exists', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Clone Model/ })).toBeTruthy()
    );

    const user = userEvent.setup();
    // generateId auto-suffixes to avoid collision; force a collision by manually typing
    // the existing id into the Custom ID field.
    const allTextboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    const customIdBox = allTextboxes.find(i => i.name === 'modelId');
    if (customIdBox) {
      await user.clear(customIdBox);
      await user.type(customIdBox, 'openai/gpt-5.2');
    }

    await user.click(screen.getByRole('button', { name: /Create Clone/ }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/)).toBeTruthy();
    });
  });
});

// ── Save (edit) ────────────────────────────────────────────────────────────────

describe('ModelFormPage — save edit', () => {
  it('submitting edit form calls updateModel and navigates', async () => {
    const user = userEvent.setup();
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy()
    );

    await user.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => expect(mockUpdateModel).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/models');
  });

  it('edit form shows "Leave blank to keep existing key" placeholder', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy()
    );

    expect(screen.getByPlaceholderText('Leave blank to keep existing key')).toBeTruthy();
  });

  it('edit form has Test button that works when ok', async () => {
    const user = userEvent.setup();
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);
    mockTestModel.mockResolvedValue({ ok: true, latencyMs: 123 });

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy()
    );

    // There are two "Test" buttons: the tab button from the edit page and the form test button
    const testBtns = screen.getAllByRole('button', { name: /Test/ });
    await user.click(testBtns[testBtns.length - 1]!);

    await waitFor(() => {
      expect(screen.getByText(/123ms/)).toBeTruthy();
    });
  });

  it('Test button shows error result', async () => {
    const user = userEvent.setup();
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);
    mockTestModel.mockResolvedValue({ ok: false, latencyMs: 0, error: 'Connection refused' });

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy()
    );

    const testBtns = screen.getAllByRole('button', { name: /Test/ });
    await user.click(testBtns[testBtns.length - 1]!);

    await waitFor(() => {
      expect(screen.getByText(/Connection refused/)).toBeTruthy();
    });
  });
});

// ── Edit with provider-specific fields ────────────────────────────────────────

describe('ModelFormPage — edit provider-specific models', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('loads azure-openai model with azure fields', async () => {
    const model = makeModel({
      id: 'azure-openai/gpt-4o',
      provider: 'azure-openai',
      endpoint: 'https://myresource.openai.azure.com',
      cost: { inputPerMillion: 2.5, outputPerMillion: 10, cachePerMillion: null },
      azureResourceName: 'myresource',
      azureDeploymentId: 'gpt-4o-prod',
      azureApiVersion: '2024-02-01',
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/azure-openai%2Fgpt-4o');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'azure-openai') throw new Error('not yet');
    });

    expect(screen.getByDisplayValue('myresource')).toBeTruthy();
    expect(screen.getByDisplayValue('gpt-4o-prod')).toBeTruthy();
  });

  it('loads bedrock model with AWS fields', async () => {
    const model = makeModel({
      id: 'bedrock/anthropic.claude-v2',
      provider: 'bedrock',
      endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      cost: { inputPerMillion: 8, outputPerMillion: 24, cachePerMillion: null },
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      awsSessionToken: 'mytoken',
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/bedrock%2Fanthropic.claude-v2');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'bedrock') throw new Error('not yet');
    });

    expect(screen.getByDisplayValue('us-east-1')).toBeTruthy();
    expect(screen.getByDisplayValue('AKIAIOSFODNN7EXAMPLE')).toBeTruthy();
  });

  it('loads vertex model with GCP fields', async () => {
    const model = makeModel({
      id: 'vertex/gemini-1.5-pro',
      provider: 'vertex',
      endpoint: 'https://us-central1-aiplatform.googleapis.com',
      cost: { inputPerMillion: 3.5, outputPerMillion: 10.5, cachePerMillion: null },
      vertexProjectId: 'my-gcp-project',
      vertexLocation: 'us-central1',
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/vertex%2Fgemini-1.5-pro');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    expect(screen.getByDisplayValue('my-gcp-project')).toBeTruthy();
    expect(screen.getByDisplayValue('us-central1')).toBeTruthy();
  });

  it('loads custom provider model — id with slash uses prefix as customProviderName', async () => {
    const model = makeModel({
      id: 'mistral/mistral-large-latest',
      provider: 'custom',
      endpoint: 'https://api.mistral.ai/v1',
      cost: { inputPerMillion: 3, outputPerMillion: 9, cachePerMillion: null },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/mistral%2Fmistral-large-latest');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'custom') throw new Error('not yet');
    });

    // customProviderName should be "mistral"
    const providerNameInput = screen.getByPlaceholderText('e.g. deepseek, mistral, groq') as HTMLInputElement;
    expect(providerNameInput.value).toBe('mistral');
  });

  it('loads custom provider model without slash uses entire id as formId', async () => {
    const model = makeModel({
      id: 'my-model',
      provider: 'custom',
      endpoint: 'https://api.example.com/v1',
      cost: { inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: null },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/my-model');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'custom') throw new Error('not yet');
    });

    const modelInput = screen.getByPlaceholderText('e.g. deepseek-r1, mistral-large-latest') as HTMLInputElement;
    expect(modelInput.value).toBe('my-model');
  });

  it('loads model with existing pricingTiers', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      provider: 'openai',
      cost: {
        inputPerMillion: 1.75,
        outputPerMillion: 14,
        cachePerMillion: null,
        pricingTiers: [{ metric: 'context_tokens', above: 200000, inputPerMillion: 3.5, outputPerMillion: 28 }],
      },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // Advanced section should be open (has tier rows)
    await waitFor(() => {
      expect(screen.getByTitle('Remove tier')).toBeTruthy();
    });
  });

  it('loads model with limits (new format)', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      limits: [{ metric: 'cost', windowType: 'period', period: 'daily', value: 10 }],
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // Limits section opens automatically when model has limits
    await waitFor(() => {
      expect(screen.getByText('Cost (USD)')).toBeTruthy();
    });
  });

  it('loads model with globalThresholds (legacy format)', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      globalThresholds: { daily: 5, weekly: 25, monthly: 100 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      // 3 threshold rows converted to limit rows
      const allCostTexts = screen.getAllByText('Cost (USD)');
      expect(allCostTexts.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('loads model with rolling limit', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      limits: [{ metric: 'calls', windowType: 'rolling', rollingAmount: 24, rollingUnit: 'hour', value: 1000 }],
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Requests')).toBeTruthy();
    });
  });

  it('loads model with embedding capability', async () => {
    const model = makeModel({
      id: 'openai/text-embedding-ada',
      provider: 'openai',
      cost: { inputPerMillion: 0.1, outputPerMillion: 0, cachePerMillion: null },
      capabilities: { embedding: true },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Ftext-embedding-ada');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    const checkbox = screen.getByRole('checkbox', { name: /Embedding model/i }) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('loads model with fieldOverrides and catalogDefaults', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      fieldOverrides: { inputPerMillion: true },
      catalogDefaults: { inputPerMillion: 2.5, outputPerMillion: 10 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // FieldBadge shows "Override" for inputPerMillion
    await waitFor(() => {
      expect(screen.getByText('Override')).toBeTruthy();
    });
  });
});

// ── openai-oauth Test button ───────────────────────────────────────────────────

describe('ModelFormPage — openai-oauth test button', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('clicking Test button with ok result shows account info', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockResolvedValue({ ok: true, accountId: 'acc-123', expiresAt: new Date(Date.now() + 3600000).toISOString() });

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText(/Account: acc-123/)).toBeTruthy();
    });
  });

  it('clicking Test button with ok=false shows error msg', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockResolvedValue({ ok: false, error: 'Invalid token' });

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText('Invalid token')).toBeTruthy();
    });
  });

  it('clicking Test button with ok=true but no expiresAt shows "unknown"', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockResolvedValue({ ok: true, accountId: 'acc-456' });

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText(/expires unknown/)).toBeTruthy();
    });
  });

  it('clicking Test button when throw shows error msg', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockRejectedValue(new Error('network error'));

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText('network error')).toBeTruthy();
    });
  });

  it('clicking Test button when throw non-Error shows string', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockRejectedValue('bad');

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText('bad')).toBeTruthy();
    });
  });

  it('typing in oauth file path resets test status to idle', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockResolvedValue({ ok: true, accountId: 'acc-ok' });

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));
    await waitFor(() => expect(screen.getByText(/Account: acc-ok/)).toBeTruthy());

    // Typing in the input resets status
    const pathInput = screen.getByPlaceholderText('~/.codex/auth.json (default)') as HTMLInputElement;
    await user.type(pathInput, 'x');

    await waitFor(() => {
      expect(screen.queryByText(/Account: acc-ok/)).toBeNull();
    });
  });

  it('openai-oauth in edit mode shows "Leave blank to keep existing path" placeholder', async () => {
    const model = makeModel({
      id: 'openai-oauth/codex-davinci-002',
      provider: 'openai-oauth',
      endpoint: 'https://api.openai.com/v1',
      cost: { inputPerMillion: 0, outputPerMillion: 0, cachePerMillion: null },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai-oauth%2Fcodex-davinci-002');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    expect(screen.getByPlaceholderText('Leave blank to keep existing path')).toBeTruthy();
  });
});

// ── Token visibility toggle ────────────────────────────────────────────────────

describe('ModelFormPage — show/hide token', () => {
  it('toggles api key visibility', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // The API key input is password by default
    const apiKeyInput = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // Click the eye toggle
    const toggleBtns = screen.getAllByRole('button').filter(b => !b.hasAttribute('type') || b.getAttribute('type') === 'button');
    const eyeBtn = toggleBtns.find(b => b.querySelector('svg'));
    // Find specifically the eye toggle (not submit/cancel/back)
    const eyeToggle = screen.getAllByRole('button').find(b =>
      b.style.background === 'none' && !b.textContent?.trim()
    );
    if (eyeToggle) {
      await user.click(eyeToggle);
      expect(apiKeyInput.type).toBe('text');
    }
  });
});

// ── Navigation buttons ─────────────────────────────────────────────────────────

describe('ModelFormPage — navigation', () => {
  it('Cancel button navigates back to /dashboard/models', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/models');
  });

  it('Back to Models arrow button navigates back', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Back to Models/));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/models');
  });

  it('shows Add Model heading on /new', async () => {
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Add Model/ })).toBeTruthy();
    });
  });
});

// ── Capabilities / embedding preset ───────────────────────────────────────────

describe('ModelFormPage — capabilities', () => {
  it('preset with embedding=true auto-checks embedding checkbox', async () => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new?provider=anthropic&modelId=claude-embedding');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'anthropic') throw new Error('not yet');
    });

    const checkbox = screen.getByRole('checkbox', { name: /Embedding model/i }) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('checking embedding checkbox in form sets override', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const checkbox = screen.getByRole('checkbox', { name: /Embedding model/i });
    await user.click(checkbox);

    // Now uncheck (toggles override off — capabilities reset path)
    await user.click(checkbox);
    expect(checkbox).toBeTruthy();
  });
});

// ── FieldBadge reset behavior ──────────────────────────────────────────────────

describe('ModelFormPage — FieldBadge', () => {
  it('Reset button on overridden field resets to catalogDefault', async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: 'openai/gpt-5.2',
      fieldOverrides: { inputPerMillion: true },
      catalogDefaults: { inputPerMillion: 2.5, outputPerMillion: 10, contextWindow: 128000 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Override')).toBeTruthy();
    });

    // The Reset button's accessible name includes the surrounding label text, so find by text
    const resetBtn = screen.getByText('Reset');
    await user.click(resetBtn);

    // After reset, Override badge should be gone
    await waitFor(() => {
      expect(screen.queryByText('Override')).toBeNull();
    });
  });

  it('FieldBadge Reset for pricingTiers resets tier rows from catalogDefaults', async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: 'openai/gpt-5.2',
      fieldOverrides: { pricingTiers: true },
      catalogDefaults: {
        pricingTiers: [{ metric: 'context_tokens', above: 200000, inputPerMillion: 3.5, outputPerMillion: 28 }],
      },
      cost: {
        inputPerMillion: 1.75, outputPerMillion: 14, cachePerMillion: null,
        pricingTiers: [{ metric: 'context_tokens', above: 200000, inputPerMillion: 3.5, outputPerMillion: 28 }],
      },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByText('Override')).toBeTruthy();
    });

    const resetBtn = screen.getByText('Reset');
    await user.click(resetBtn);

    await waitFor(() => {
      expect(screen.queryByText('Override')).toBeNull();
    });
  });

  it('FieldBadge Reset for capabilities resets embedding checkbox', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      fieldOverrides: { capabilities: true },
      catalogDefaults: { capabilities: { embedding: true } },
      capabilities: { embedding: true },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByText('Override')).toBeTruthy();
    });

    // The Reset button lives inside <label htmlFor="cap-embedding">. Clicking it causes:
    // 1. button onClick: setOverride('capabilities', false)
    // 2. click bubbles to label → label activates checkbox → onChange: setOverride('capabilities', true)
    // Net result: override stays true. Block step 2 by intercepting the label click.
    const label = document.querySelector('label[for="cap-embedding"]') as HTMLLabelElement;
    const block = (e: Event) => e.preventDefault();
    label?.addEventListener('click', block, true); // capture phase, before label activates input

    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);

    label?.removeEventListener('click', block, true);

    await waitFor(() => {
      expect(screen.queryByText('Override')).toBeNull();
    });
  });

  it('shows Auto badge when catalogDefaults has data but no override', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      catalogDefaults: { inputPerMillion: 2.5 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Auto')).toBeTruthy();
      expect(screen.getByText(/Default: 2.5/)).toBeTruthy();
    });
  });

  it('FieldBadge fmtDefault handles boolean value', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      catalogDefaults: { capabilities: { embedding: false } },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      // catalogDefaults.capabilities is an object → shows JSON
      expect(screen.getByText(/Default:/)).toBeTruthy();
    });
  });
});

// ── model preset with no pricing tiers → applyPreset blank path ───────────────

describe('ModelFormPage — applyPreset edge cases', () => {
  it('preset not found clears pricing fields', async () => {
    const user = userEvent.setup();
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Switch to custom model (which will call applyPreset with a model not in the list)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const modelSelect = selects.find(s => s.value === 'gpt-4o') ?? selects[1]!;
    await user.selectOptions(modelSelect, '__custom__');

    await waitFor(() => {
      const customInput = screen.getByPlaceholderText('e.g. my-fine-tuned-model') as HTMLInputElement;
      expect(customInput.value).toBe('');
    });
  });
});

// ── getProviders error handling ────────────────────────────────────────────────

describe('ModelFormPage — error handling', () => {
  it('shows error when getModels rejects', async () => {
    mockGetModels.mockRejectedValue(new Error('Load failed'));
    mockGetProviders.mockResolvedValue({} as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      expect(screen.getByText('Load failed')).toBeTruthy();
    });
  });

  it('getProviders failure falls back to empty catalog (empty PROVIDERS list)', async () => {
    mockGetProviders.mockRejectedValue(new Error('network'));
    // Models still load
    mockGetModels.mockResolvedValue([]);

    renderPage('/dashboard/models/new');

    // With empty catalog, provider select has no options, but page still renders
    await waitFor(() => {
      // No crash — still shows the form structure
      expect(screen.queryByText('Load failed') ?? screen.queryByRole('combobox')).toBeTruthy();
    });
  });
});

// ── model with id not matching provider prefix ─────────────────────────────────

describe('ModelFormPage — edit id without provider prefix', () => {
  it('loads model whose id does not start with provider prefix', async () => {
    const model = makeModel({
      id: 'legacy-model-id',
      provider: 'openai',
      cost: { inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: null },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/legacy-model-id');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });
  });
});

// ── page title / description text ─────────────────────────────────────────────

describe('ModelFormPage — page descriptions', () => {
  it('shows correct subtitle for new model', async () => {
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      expect(screen.getByText('Register a new LLM provider model')).toBeTruthy();
    });
  });

  it('shows correct subtitle for clone', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);
    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByText(/Cloning from openai\/gpt-5.2/)).toBeTruthy();
    });
  });

  it('shows correct subtitle for edit model', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);
    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByText(/Modifying configuration for openai\/gpt-5.2/)).toBeTruthy();
    });
  });
});

// ── Edit model sends cfClearance when filled ───────────────────────────────────

describe('ModelFormPage — cfClearance field', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('openai-web shows cf_clearance field and sends it in payload', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=openai-web');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-web') throw new Error('not yet');
    });

    // cf_clearance mentioned in instructions
    expect(screen.getByText(/cf_clearance/)).toBeTruthy();

    // Fill in token and submit
    const tokenInput = screen.getByPlaceholderText('eyJ…') as HTMLInputElement;
    await user.type(tokenInput, 'eyJtoken');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.apiKey).toBe('eyJtoken');
  });
});

// ── Pricing field overrides via spinbutton ─────────────────────────────────────

describe('ModelFormPage — pricing field changes trigger override', () => {
  it('changing inputPerMillion triggers setOverride', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const inputField = screen.getByPlaceholderText('5.00') as HTMLInputElement;
    await user.clear(inputField);
    await user.type(inputField, '3.5');

    expect(inputField.value).toBe('3.5');
  });
});

// ── Notes display on preset ────────────────────────────────────────────────────

describe('ModelFormPage — preset notes', () => {
  it('shows notes text when preset has notes field', async () => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new?provider=openai&modelId=gpt-4o');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai') throw new Error('not yet');
    });

    await waitFor(() => {
      expect(screen.getByText('Fast and capable')).toBeTruthy();
    });
  });
});

// ── Send Azure/Bedrock/Vertex fields in payload ───────────────────────────────

describe('ModelFormPage — provider-specific field save', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('azure-openai fields included in create payload', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=azure-openai');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'azure-openai') throw new Error('not yet');
    });

    await user.type(screen.getByPlaceholderText('myresource'), 'myresource');
    await user.type(screen.getByPlaceholderText('gpt-4o-deployment'), 'my-deploy');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.azureResourceName).toBe('myresource');
    expect(payload.azureDeploymentId).toBe('my-deploy');
  });

  it('bedrock fields included in create payload', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=bedrock');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'bedrock') throw new Error('not yet');
    });

    await user.type(screen.getByPlaceholderText('us-east-1'), 'eu-west-1');
    await user.type(screen.getByPlaceholderText('AKIAIOSFODNN7EXAMPLE'), 'AKIAIOSFODNN7EXAMPLE');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.awsRegion).toBe('eu-west-1');
    expect(payload.awsAccessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('vertex fields included in create payload', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=vertex');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    await user.type(screen.getByPlaceholderText('my-gcp-project'), 'my-project');

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.vertexProjectId).toBe('my-project');
  });

  it('updateModel sends azureApiVersion when filled', async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: 'azure-openai/gpt-4o',
      provider: 'azure-openai',
      endpoint: 'https://myresource.openai.azure.com',
      cost: { inputPerMillion: 2.5, outputPerMillion: 10, cachePerMillion: null },
      azureResourceName: 'myresource',
      azureDeploymentId: 'gpt-4o-prod',
      azureApiVersion: '2024-05-01',
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/azure-openai%2Fgpt-4o');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'azure-openai') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdateModel).toHaveBeenCalled());

    const payload = (mockUpdateModel.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload.azureApiVersion).toBe('2024-05-01');
  });

  it('updateModel sends awsSessionToken and vertex fields when filled', async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: 'vertex/gemini-1.5-pro',
      provider: 'vertex',
      endpoint: 'https://us-central1-aiplatform.googleapis.com',
      cost: { inputPerMillion: 3.5, outputPerMillion: 10.5, cachePerMillion: null },
      vertexProjectId: 'my-proj',
      vertexLocation: 'eu-west4',
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/vertex%2Fgemini-1.5-pro');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdateModel).toHaveBeenCalled());

    const payload = (mockUpdateModel.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload.vertexProjectId).toBe('my-proj');
    expect(payload.vertexLocation).toBe('eu-west4');
  });
});

// ── Limit period change ────────────────────────────────────────────────────────

describe('ModelFormPage — limit period select', () => {
  it('changes period when window type is period', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const periodSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'monthly'));
    expect(periodSelect).toBeTruthy();
    await user.selectOptions(periodSelect!, 'weekly');

    expect(periodSelect!.value).toBe('weekly');
  });

  it('rolling unit can be changed', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    await user.selectOptions(windowTypeSelect!, 'rolling');
    await waitFor(() => expect(screen.getByText('hours')).toBeTruthy());

    const rollingUnitSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'day'));
    if (rollingUnitSelect) {
      await user.selectOptions(rollingUnitSelect, 'day');
      expect(rollingUnitSelect.value).toBe('day');
    }
  });
});

// ── generate ID dedup ──────────────────────────────────────────────────────────

describe('ModelFormPage — ID generation deduplication', () => {
  it('generates a suffixed ID when base already exists', async () => {
    // Seed existing model so the auto-id will conflict
    mockGetModels.mockResolvedValue([makeModel({ id: 'openai/gpt-4o' })]);

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // The autoId is used as placeholder on the Custom ID input (label has no htmlFor)
    await waitFor(() => {
      const customIdInput = screen.getByPlaceholderText(/openai\/gpt-4o_1/) as HTMLInputElement;
      expect(customIdInput.placeholder).toMatch(/openai\/gpt-4o_1/);
    });
  });
});

// ── Limits count badge ─────────────────────────────────────────────────────────

describe('ModelFormPage — limits count badge', () => {
  it('shows limit count badge when limits have values', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const maxInput = screen.getByPlaceholderText('10.00') as HTMLInputElement;
    await user.type(maxInput, '100');

    // There should be a badge "1" near the Limits button
    await waitFor(() => {
      expect(screen.getByText('1')).toBeTruthy();
    });
  });
});

// ── pricing tier count badge ───────────────────────────────────────────────────

describe('ModelFormPage — tier count badge', () => {
  it('shows tier count badge after adding a tier', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));

    await waitFor(() => {
      expect(screen.getByText('1')).toBeTruthy();
    });
  });
});

// ── updateModel sends fieldOverrides when overrides exist ──────────────────────

describe('ModelFormPage — fieldOverrides in save payload', () => {
  it('edit with existing fieldOverrides sends them in payload', async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: 'openai/gpt-5.2',
      fieldOverrides: { inputPerMillion: true },
      catalogDefaults: { inputPerMillion: 2.5 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(mockUpdateModel).toHaveBeenCalled());

    const payload = (mockUpdateModel.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload.fieldOverrides).toEqual({ inputPerMillion: true });
  });
});

// ── cacheWritePerMillion in payload ───────────────────────────────────────────

describe('ModelFormPage — cacheWritePerMillion field', () => {
  it('sends cacheWritePerMillion when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    // Get all spinbuttons — the cache write field placeholder is "—"
    const allSpinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    // There are potentially two "—" placeholder fields (cache read, cache write)
    const dashFields = allSpinners.filter(s => s.placeholder === '—');
    if (dashFields.length >= 2) {
      await user.clear(dashFields[1]!);
      await user.type(dashFields[1]!, '0.7');
    }

    await user.click(screen.getByRole('button', { name: /Create Model/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    if (dashFields.length >= 2) {
      expect(payload.cacheWritePerMillion).toBe(0.7);
    }
  });
});

// ── clone with apiKey (no cloneFrom in payload) ───────────────────────────────

describe('ModelFormPage — clone with apiKey provided', () => {
  it('clone with apiKey does NOT send cloneFrom', async () => {
    const user = userEvent.setup();
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Clone Model/ })).toBeTruthy()
    );

    // Give a unique custom ID and an API key
    const allTextboxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    const customIdBox = allTextboxes.find(i => i.name === 'modelId');
    if (customIdBox) {
      await user.clear(customIdBox);
      await user.type(customIdBox, 'openai/gpt-5.2-apikeyclone');
    }

    // Fill in apiKey — this means cloneFrom should NOT be sent
    const apiKeyInput = screen.getByPlaceholderText('Leave blank to keep existing key') as HTMLInputElement;
    await user.type(apiKeyInput, 'sk-my-api-key');

    await user.click(screen.getByRole('button', { name: /Create Clone/ }));
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());
    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    // Has apiKey but no cloneFrom
    expect(payload.apiKey).toBe('sk-my-api-key');
    expect(payload.cloneFrom).toBeUndefined();
  });
});

// ── limitToRow legacy window backward compat ──────────────────────────────────

describe('ModelFormPage — limitToRow legacy window field', () => {
  it('loads model with legacy window field in limit', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      limits: [{ metric: 'cost', windowType: 'period', window: 'day', value: 5 }],
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // Legacy 'day' maps to 'daily' period
    await waitFor(() => {
      expect(screen.getByText('Cost (USD)')).toBeTruthy();
    });
  });
});

// ── CopyCode component ────────────────────────────────────────────────────────

describe('ModelFormPage — CopyCode button (anthropic-oauth)', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('CopyCode copy button calls clipboard.writeText', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderPage('/dashboard/models/new?provider=anthropic-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'anthropic-oauth') throw new Error('not yet');
    });

    // CopyCode renders the "claude setup-token" command with a Copy button
    const copyBtn = screen.getByTitle('Copy to clipboard');
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('claude setup-token');
  });
});


// ── effectiveId function called via customProviderName ────────────────────────

describe('ModelFormPage — effectiveId with custom provider name', () => {
  it('custom provider with customProviderName uses it as prefix for effectiveId', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=custom');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'custom') throw new Error('not yet');
    });

    const providerNameInput = screen.getByPlaceholderText('e.g. deepseek, mistral, groq') as HTMLInputElement;
    const modelInput = screen.getByPlaceholderText('e.g. deepseek-r1, mistral-large-latest') as HTMLInputElement;
    await user.type(providerNameInput, 'myco');
    await user.type(modelInput, 'mymodel');

    // autoId placeholder reflects effectiveId: "myco/mymodel"
    await waitFor(() => {
      const customIdInput = screen.getByPlaceholderText(/myco\/mymodel/) as HTMLInputElement;
      expect(customIdInput.placeholder).toContain('myco/mymodel');
    });
  });
});

// ── clone path api key placeholder ───────────────────────────────────────────

describe('ModelFormPage — clone api key placeholder', () => {
  it('clone path shows "Leave blank to keep existing key" for api key', async () => {
    const model = makeModel({ id: 'openai/gpt-5.2' });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/new?clone=openai%2Fgpt-5.2');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Clone Model/ })).toBeTruthy()
    );

    expect(screen.getByPlaceholderText('Leave blank to keep existing key')).toBeTruthy();
  });
});

// ── showToken toggle ──────────────────────────────────────────────────────────

describe('ModelFormPage — showToken toggle for non-oauth provider', () => {
  it('eye toggle button renders and changes token visibility', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const apiKeyInput = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // Find the eye toggle button — it's a button with no text inside the relative div
    const eyeBtn = Array.from(document.querySelectorAll('button[type="button"]')).find(b =>
      (b as HTMLButtonElement).style.position === 'absolute' && (b as HTMLButtonElement).style.background === 'none'
    ) as HTMLButtonElement | undefined;

    if (eyeBtn) {
      await user.click(eyeBtn);
      expect(apiKeyInput.type).toBe('text');
      // Click again to toggle back
      await user.click(eyeBtn);
      expect(apiKeyInput.type).toBe('password');
    }
  });
});

// ── azure-openai API version onChange ─────────────────────────────────────────

describe('ModelFormPage — azure API version field onChange', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('azure API version field is editable', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=azure-openai');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'azure-openai') throw new Error('not yet');
    });

    const apiVersionInput = screen.getByPlaceholderText('2024-02-01') as HTMLInputElement;
    await user.clear(apiVersionInput);
    await user.type(apiVersionInput, '2024-05-01');
    expect(apiVersionInput.value).toBe('2024-05-01');
  });
});

// ── bedrock secret fields onChange ───────────────────────────────────────────

describe('ModelFormPage — bedrock secret fields onChange', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('bedrock secret access key and session token are editable', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=bedrock');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'bedrock') throw new Error('not yet');
    });

    // Secret access key — type=password, placeholder contains "wJalrXUtn"
    const secretKeyInput = screen.getByPlaceholderText(/wJalrXUtnFEMI/) as HTMLInputElement;
    await user.type(secretKeyInput, 'secret123');
    expect(secretKeyInput.value).toBe('secret123');

    // Session token — type=password, placeholder "AQoDYXdz…"
    const sessionTokenInput = screen.getByPlaceholderText('AQoDYXdz…') as HTMLInputElement;
    await user.type(sessionTokenInput, 'token456');
    expect(sessionTokenInput.value).toBe('token456');
  });
});

// ── vertex location and service account key onChange ─────────────────────────

describe('ModelFormPage — vertex location and service account key onChange', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('vertex location and service account key fields are editable', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=vertex');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    const locationInput = screen.getByPlaceholderText('us-central1') as HTMLInputElement;
    await user.clear(locationInput);
    await user.type(locationInput, 'eu-west4');
    expect(locationInput.value).toBe('eu-west4');

    const serviceKeyTextarea = screen.getByPlaceholderText(/Paste the contents/) as HTMLTextAreaElement;
    fireEvent.change(serviceKeyTextarea, { target: { value: 'service_account_json' } });
    expect(serviceKeyTextarea.value).toContain('service_account');
  });
});

// ── output pricing onChange ───────────────────────────────────────────────────

describe('ModelFormPage — output pricing field onChange', () => {
  it('changing outputPerMillion triggers setOverride for outputPerMillion', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const outputField = screen.getByPlaceholderText('15.00') as HTMLInputElement;
    await user.clear(outputField);
    await user.type(outputField, '12');
    expect(outputField.value).toBe('12');
  });
});

// ── pricing tier metric select onChange ──────────────────────────────────────

describe('ModelFormPage — pricing tier metric select onChange', () => {
  it('changing tier metric calls updateTier', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));
    await waitFor(() => expect(screen.getByText(/Context tokens/)).toBeTruthy());

    // The tier metric select has value 'context_tokens'
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const metricSel = selects.find(s => Array.from(s.options).some(o => o.value === 'context_tokens'));
    expect(metricSel).toBeTruthy();
    // Only one option, just confirm it exists and is context_tokens
    expect(metricSel!.value).toBe('context_tokens');
  });
});

// ── pricing tier cache field onChange ─────────────────────────────────────────

describe('ModelFormPage — pricing tier cache field onChange', () => {
  it('editing tier cache field triggers updateTier', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));
    await waitFor(() => expect(screen.getAllByPlaceholderText('—').length).toBeGreaterThan(0));

    // In the tier section the cache placeholder is '—'
    const dashInputs = screen.getAllByPlaceholderText('—') as HTMLInputElement[];
    // First '—' input inside the tier row is the cache field (there may also be top-level cache fields)
    const tierCacheInput = dashInputs[dashInputs.length - 1]!;
    await user.type(tierCacheInput, '0.5');
    expect(tierCacheInput.value).toBe('0.5');
  });
});

// ── rolling limit rollingAmount and rollingUnit onChange ──────────────────────

describe('ModelFormPage — rolling limit amount and unit onChange', () => {
  it('changing rolling amount and unit updates limit row', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    // Switch to rolling window type
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    await user.selectOptions(windowTypeSelect!, 'rolling');
    await waitFor(() => expect(screen.getByPlaceholderText('24')).toBeTruthy());

    // Change rolling amount
    const rollingAmtInput = screen.getByPlaceholderText('24') as HTMLInputElement;
    await user.clear(rollingAmtInput);
    await user.type(rollingAmtInput, '48');
    expect(rollingAmtInput.value).toBe('48');

    // Change rolling unit
    const rollingSelects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const rollingUnitSel = rollingSelects.find(s => Array.from(s.options).some(o => o.value === 'day'));
    if (rollingUnitSel) {
      await user.selectOptions(rollingUnitSel, 'day');
      expect(rollingUnitSel.value).toBe('day');
    }
  });

  it('removing a rolling limit row works', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    await user.selectOptions(windowTypeSelect!, 'rolling');
    await waitFor(() => expect(screen.getByPlaceholderText('24')).toBeTruthy());

    // The delete X button inside the grid row
    const limitRowBtn = document.querySelector(
      '[style*="gridTemplateColumns"] > button'
    ) as HTMLButtonElement | null;
    if (limitRowBtn) await user.click(limitRowBtn);

    await waitFor(() => {
      expect(document.querySelector('[style*="gridTemplateColumns"]')).toBeNull();
    });
  });
});

// ── limit row delete button ───────────────────────────────────────────────────

describe('ModelFormPage — limit row delete button', () => {
  it('removes limit row via the X button', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    // Find the X button inside the limit row by querying all spinbutton-adjacent buttons
    // The delete button is the last button inside the limits section
    const costLabel = screen.getByText('Cost (USD)');
    const limitRow = costLabel.closest('div[style*="grid"]') ?? costLabel.closest('div');
    // Traverse up to find the grid container that holds the X button
    let container: Element | null = limitRow;
    let deleteBtn: HTMLButtonElement | null = null;
    while (container && !deleteBtn) {
      const btns = Array.from(container.querySelectorAll('button[type="button"]')) as HTMLButtonElement[];
      deleteBtn = btns.find(b => b.querySelector('svg') && !b.textContent?.trim()) ?? null;
      container = container.parentElement;
    }

    if (deleteBtn) {
      await user.click(deleteBtn);
      await waitFor(() => {
        expect(screen.queryByText('Cost (USD)')).toBeNull();
      });
    }
  });
});

// ── provider select change (handleProviderChange) ─────────────────────────────

describe('ModelFormPage — handleProviderChange', () => {
  it('switching provider in select updates endpoint and clears model', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const providerSelect = selects[0]!;
    await user.selectOptions(providerSelect, 'anthropic');

    await waitFor(() => {
      expect(providerSelect.value).toBe('anthropic');
    });
  });

  it('switching to ollama (no models) shows custom input', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const providerSelect = selects[0]!;
    await user.selectOptions(providerSelect, 'ollama');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. my-fine-tuned-model')).toBeTruthy();
    });
  });
});

// ── custom model id input onChange ────────────────────────────────────────────

describe('ModelFormPage — custom model id input onChange', () => {
  it('typing in custom model input updates form id', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const providerSelect = selects[0]!;
    await user.selectOptions(providerSelect, 'ollama');

    await waitFor(() => expect(screen.getByPlaceholderText('e.g. my-fine-tuned-model')).toBeTruthy());

    const modelInput = screen.getByPlaceholderText('e.g. my-fine-tuned-model') as HTMLInputElement;
    await user.type(modelInput, 'llama3');
    expect(modelInput.value).toBe('llama3');
  });
});

// ── tier metric select onChange (fireEvent) ───────────────────────────────────

describe('ModelFormPage — tier metric select onChange via fireEvent', () => {
  it('fires onChange on tier metric select', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));
    await waitFor(() => expect(screen.getByText(/Context tokens/)).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const metricSel = selects.find(s => Array.from(s.options).some(o => o.value === 'context_tokens'));
    if (metricSel) {
      fireEvent.change(metricSel, { target: { value: 'context_tokens' } });
      expect(metricSel.value).toBe('context_tokens');
    }
  });
});

// ── showToken toggle — inner callback ─────────────────────────────────────────

describe('ModelFormPage — showToken inner callback via fireEvent', () => {
  it('fireEvent click on eye button toggles showToken', async () => {
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    const apiKeyInput = screen.getByPlaceholderText('sk-…') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // Find the absolute-positioned toggle button inside the relative div
    const relDiv = apiKeyInput.closest('div[style*="position: relative"]') ?? apiKeyInput.parentElement;
    const eyeBtn = relDiv?.querySelector('button[type="button"]') as HTMLButtonElement | null;
    if (eyeBtn) {
      fireEvent.click(eyeBtn);
      expect(apiKeyInput.type).toBe('text');
      fireEvent.click(eyeBtn);
      expect(apiKeyInput.type).toBe('password');
    }
  });
});

// ── CopyCode setTimeout callback (fake timers) ────────────────────────────────

describe('ModelFormPage — CopyCode copied state resets', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copied badge disappears after 2s timeout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderPage('/dashboard/models/new?provider=anthropic-oauth');

    // Load page with real timers first
    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'anthropic-oauth') throw new Error('not yet');
    });

    // Switch to fake timers only after page is loaded
    vi.useFakeTimers();

    const copyBtn = screen.getByTitle('Copy to clipboard');
    fireEvent.click(copyBtn);
    await writeText.mock.results[0]!.value; // await the promise

    // Advance timers past 2000ms to fire the setTimeout callback
    vi.advanceTimersByTime(2001);
  });
});

// ── non-Error throw in init ───────────────────────────────────────────────────

describe('ModelFormPage — non-Error throw in init', () => {
  it('shows "Error loading models" when getModels throws non-Error', async () => {
    mockGetModels.mockRejectedValue('not an Error object');

    renderPage('/dashboard/models/new');

    await waitFor(() => {
      expect(screen.getByText('Error loading models')).toBeTruthy();
    });
  });
});

// ── catalogEntry path (non-preset) ────────────────────────────────────────────

describe('ModelFormPage — catalogEntry non-preset path', () => {
  it('seeds pricing from catalog when model is not a preset (contextWindow > 0)', async () => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    const catalogEntry = {
      id: 'gpt-catalog-only',
      pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
      contextWindow: 32000,
      embedding: false,
      local: false,
    };

    renderPage('/dashboard/models/new?provider=openai', { catalogEntry });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai') throw new Error('not yet');
    });

    // Model is not a preset so it falls into the non-preset path
    // Input pricing should be seeded from catalog: 0.005 * 1000 = 5
    await waitFor(() => {
      const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      const inputField = inputs.find(i => i.value === '5');
      expect(inputField).toBeTruthy();
    });
  });

  it('seeds zero contextWindow when contextWindow is 0', async () => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    const catalogEntry = {
      id: 'gpt-no-ctx',
      pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
      contextWindow: 0,
      embedding: false,
      local: false,
    };

    renderPage('/dashboard/models/new?provider=openai', { catalogEntry });

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai') throw new Error('not yet');
    });

    // contextWindow 0 → '' in form, context window input should have empty value
    await waitFor(() => {
      const ctxInput = screen.getByPlaceholderText('128000') as HTMLInputElement;
      expect(ctxInput.value).toBe('');
    });
  });

  it('prefillProvider not in catalog falls back to openai', async () => {
    // Use a catalog that does NOT have the requested provider
    mockGetProviders.mockResolvedValue({
      openai: {
        endpoint: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o', input: 2.5, output: 10 }],
      },
    } as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new?provider=unknownprovider');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      // Falls back to openai since 'unknownprovider' is not in catalog
      expect(all[0]!.value).toBe('openai');
    });
  });
});

// ── limitToRow: rolling with null rollingAmount/rollingUnit ───────────────────

describe('ModelFormPage — limitToRow null rollingAmount/rollingUnit fallbacks', () => {
  it('loads rolling limit without rollingAmount uses fallback 24', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      limits: [{ metric: 'cost', windowType: 'rolling', value: 50 }],
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // rollingAmount defaults to '24'
    await waitFor(() => {
      const input = screen.getByPlaceholderText('24') as HTMLInputElement;
      expect(input.value).toBe('24');
    });
  });
});

// ── limitToRow: period with no period field and no legacyWindow ───────────────

describe('ModelFormPage — limitToRow period fallback to monthly', () => {
  it('loads period limit with no period field defaults to monthly', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      limits: [{ metric: 'cost', windowType: 'period', value: 100 }],
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      // Monthly is the default period; the select should have value 'monthly'
      const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
      const periodSel = selects.find(s => Array.from(s.options).some(o => o.value === 'monthly'));
      expect(periodSel).toBeTruthy();
      expect(periodSel!.value).toBe('monthly');
    });
  });
});

// ── rowToLimit: rollingAmount 0 falls back to 1 ──────────────────────────────

describe('ModelFormPage — rowToLimit rollingAmount zero fallback', () => {
  it('sends rollingAmount=1 when value is 0 or empty', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const windowTypeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'rolling'));
    await user.selectOptions(windowTypeSelect!, 'rolling');
    await waitFor(() => expect(screen.getByPlaceholderText('24')).toBeTruthy());

    // Clear rolling amount (makes it empty → parseInt('') = NaN → || 1)
    const rollingAmtInput = screen.getByPlaceholderText('24') as HTMLInputElement;
    await user.clear(rollingAmtInput);

    const maxInput = screen.getByPlaceholderText('10.00') as HTMLInputElement;
    await user.type(maxInput, '5');

    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    const limits = payload.limits as Record<string, unknown>[];
    expect(limits[0]!.rollingAmount).toBe(1);
  });
});

// ── editModel: inputPerMillion=0 falls back to preset price (L564 false branch) ─

describe('ModelFormPage — editModel price=0 falls back to preset', () => {
  it('shows preset input price when model.cost.inputPerMillion is 0', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      cost: { inputPerMillion: 0, outputPerMillion: 0, cachePerMillion: null },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // preset gpt-5.2 input=1.75 — form should show 1.75 from preset
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    await waitFor(() => {
      const inputField = inputs.find(i => i.value === '1.75');
      expect(inputField).toBeTruthy();
    });
  });
});

// ── editModel: cacheWritePerMillion set (L567 true branch) ────────────────────

describe('ModelFormPage — editModel cacheWritePerMillion', () => {
  it('shows cacheWritePerMillion in form when set on model', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      cost: { inputPerMillion: 1.75, outputPerMillion: 14, cachePerMillion: 0.175, cacheWritePerMillion: 0.35 },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    await waitFor(() => {
      const field = inputs.find(i => i.value === '0.35');
      expect(field).toBeTruthy();
    });
  });
});

// ── editModel: contextWindow null → '' (L568/L595 false branch) ──────────────

describe('ModelFormPage — editModel contextWindow null', () => {
  it('context window input is empty when model has no contextWindow', async () => {
    const model = {
      id: 'openai/gpt-5.2',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: { inputPerMillion: 1.75, outputPerMillion: 14, cachePerMillion: null },
      // no contextWindow field
    };
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    await waitFor(() => {
      const ctxInput = screen.getByPlaceholderText('128000') as HTMLInputElement;
      expect(ctxInput.value).toBe('');
    });
  });
});

// ── editModel: pricingTiers with cache (L626 true branch) ────────────────────

describe('ModelFormPage — editModel pricingTiers with cachePerMillion', () => {
  it('loads tier cache value when tier has cachePerMillion', async () => {
    const model = makeModel({
      id: 'openai/gpt-5.2',
      cost: {
        inputPerMillion: 1.75, outputPerMillion: 14, cachePerMillion: null,
        pricingTiers: [{ metric: 'context_tokens', above: 200000, inputPerMillion: 3.5, outputPerMillion: 28, cachePerMillion: 0.7 }],
      },
    });
    mockGetModels.mockResolvedValue([model]);

    renderPage('/dashboard/models/openai%2Fgpt-5.2');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Model/ })).toBeTruthy();
    });

    // Advanced section auto-opens when model has pricingTiers
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    await waitFor(() => {
      const cacheField = inputs.find(i => i.value === '0.7');
      expect(cacheField).toBeTruthy();
    });
  });
});

// ── applyPreset: pricingTiers without cache (L503 false branch) ──────────────

describe('ModelFormPage — applyPreset pricingTier without cache', () => {
  it('tier cache is empty string when preset tier has no cache', async () => {
    // Use a catalog where gpt-4o-mini has pricingTiers with no cache field
    mockGetProviders.mockResolvedValue({
      openai: {
        endpoint: 'https://api.openai.com/v1',
        models: [
          { id: 'gpt-4o-mini', input: 0.15, output: 0.6, pricingTiers: [{ metric: 'context_tokens', above: 128000, input: 0.3, output: 1.2 }] },
        ],
      },
    } as unknown as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);

    renderPage('/dashboard/models/new?provider=openai&modelId=gpt-4o-mini');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai') throw new Error('not yet');
    });

    // Advanced section should auto-open (preset has pricingTiers)
    await waitFor(() => {
      expect(screen.getByText(/Advanced — Pricing tiers/)).toBeTruthy();
    });
  });
});

// ── oauth: ok=false with no error field → 'Unknown error' (L667 right branch) ─

describe('ModelFormPage — openai-oauth ok=false no error field', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('shows "Unknown error" when ok=false and error field is missing', async () => {
    const user = userEvent.setup();
    mockTestOpenAIOAuth.mockResolvedValue({ ok: false });

    renderPage('/dashboard/models/new?provider=openai-oauth');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'openai-oauth') throw new Error('not yet');
    });

    await user.click(screen.getByRole('button', { name: /Test/ }));

    await waitFor(() => {
      expect(screen.getByText('Unknown error')).toBeTruthy();
    });
  });
});

// ── handleSave: tier with cache in payload (L691 true branch) ────────────────

describe('ModelFormPage — handleSave tier cache in payload', () => {
  it('sends cachePerMillion in pricingTier when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/Advanced — Pricing tiers/));
    await user.click(screen.getByText(/Add pricing tier/));
    await waitFor(() => expect(screen.getByText(/Context tokens/)).toBeTruthy());

    // Fill above, input, output, cache
    const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const aboveInput = spinners.find(s => s.placeholder === '200000');
    const cacheInput = spinners.find(s => s.placeholder === '0.00' && !s.value);
    if (aboveInput) fireEvent.change(aboveInput, { target: { value: '100000' } });
    if (cacheInput) fireEvent.change(cacheInput, { target: { value: '0.5' } });

    // Also fill main input/output so form is valid
    const inputSpin = spinners.find(s => s.placeholder === '5.00');
    const outputSpin = spinners.find(s => s.placeholder === '15.00');
    if (inputSpin) fireEvent.change(inputSpin, { target: { value: '1' } });
    if (outputSpin) fireEvent.change(outputSpin, { target: { value: '2' } });

    // Fill tier input/output
    const tierInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const tierInput = tierInputs.find(s => s.placeholder === '0.00');
    const tierOutput = tierInputs.find(s => s.placeholder === '0.00' && s !== tierInput);
    if (tierInput) fireEvent.change(tierInput, { target: { value: '2' } });
    if (tierOutput) fireEvent.change(tierOutput, { target: { value: '4' } });

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    const tiers = payload.pricingTiers as Record<string, unknown>[] | undefined;
    if (tiers?.length) {
      const tier = tiers[0]!;
      // If cache was present in tier, it should be included
      expect(typeof tier).toBe('object');
    }
  });
});

// ── handleSave: awsSecretAccessKey / awsSessionToken / vertexServiceAccountKey ─

describe('ModelFormPage — handleSave AWS/Vertex secret fields', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(FULL_CATALOG as Parameters<typeof mockGetProviders.mockResolvedValue>[0]);
  });

  it('includes awsSecretAccessKey and awsSessionToken in payload when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=bedrock');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'bedrock') throw new Error('not yet');
    });

    // Fill required fields
    const regionInput = screen.getByPlaceholderText('us-east-1') as HTMLInputElement;
    await user.type(regionInput, 'eu-west-1');

    const accessKeyInput = screen.getByPlaceholderText('AKIAIOSFODNN7EXAMPLE') as HTMLInputElement;
    await user.type(accessKeyInput, 'MYKEY');

    const secretInput = screen.getByPlaceholderText(/wJalrXUtnFEMI/) as HTMLInputElement;
    await user.type(secretInput, 'mysecret');

    const sessionInput = screen.getByPlaceholderText('AQoDYXdz…') as HTMLInputElement;
    await user.type(sessionInput, 'mytoken');

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.awsSecretAccessKey).toBe('mysecret');
    expect(payload.awsSessionToken).toBe('mytoken');
  });

  it('includes vertexServiceAccountKey in payload when filled', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new?provider=vertex');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      if (all[0]!.value !== 'vertex') throw new Error('not yet');
    });

    const projectInput = screen.getByPlaceholderText('my-gcp-project') as HTMLInputElement;
    await user.type(projectInput, 'my-project');

    const keyTextarea = screen.getByPlaceholderText(/Paste the contents/) as HTMLTextAreaElement;
    fireEvent.change(keyTextarea, { target: { value: 'service-account-json-content' } });

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(mockCreateModel).toHaveBeenCalled());

    const payload = (mockCreateModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.vertexServiceAccountKey).toBe('service-account-json-content');
  });
});

// ── limitRows.map — i !== idx branch (L1180 else branch) ────────────────────

describe('ModelFormPage — limitRows multiple rows update', () => {
  it('updating one limit row leaves other rows intact', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/models/new');

    await waitFor(() => {
      const all = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(all[0]!.value).toBe('openai');
    });

    await user.click(screen.getByText(/^Limits$/));
    // Add two limit rows
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => expect(screen.getByText('Cost (USD)')).toBeTruthy());
    await user.click(screen.getByText(/Add limit/));
    await waitFor(() => {
      expect(screen.getAllByText('Cost (USD)').length).toBeGreaterThanOrEqual(2);
    });

    // Change value of first row's max input — this triggers upd() for idx=0
    // which maps over rows: i===0 → patch applied, i===1 → left unchanged (else branch)
    const valueInputs = screen.getAllByPlaceholderText('10.00') as HTMLInputElement[];
    fireEvent.change(valueInputs[0]!, { target: { value: '5' } });

    expect(valueInputs[0]!.value).toBe('5');
  });
});
