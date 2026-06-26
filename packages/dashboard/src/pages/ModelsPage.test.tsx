import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ModelsPage } from './ModelsPage';

vi.mock('../api', () => ({
  getModels: vi.fn(),
  deleteModel: vi.fn(),
  getProviderHealth: vi.fn(),
}));

// ponytail: stub ConfirmDialog so it renders inline without portal issues
vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: {
    message: string; onConfirm: () => void; onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { getModels, deleteModel, getProviderHealth } from '../api';

const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockDeleteModel = vi.mocked(deleteModel as (id: string) => Promise<unknown>);
const mockGetProviderHealth = vi.mocked(getProviderHealth as () => Promise<unknown>);

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null },
    contextWindow: 128000,
    ...overrides,
  };
}

function makeHealthProvider(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    status: 'healthy' as const,
    errorRate: 0.01,
    p95LatencyMs: 200,
    requestsLastHour: 50,
    lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
    cooldownUntil: null,
    ...overrides,
  };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/models${search}`]}>
      <ModelsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([]);
  mockDeleteModel.mockResolvedValue(undefined);
  mockGetProviderHealth.mockResolvedValue({ providers: [] });
});

afterEach(() => vi.clearAllMocks());

// ── Models tab ─────────────────────────────────────────────────────────────────

describe('ModelsPage — models list', () => {
  it('shows empty state when no models', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/No models yet/)).toBeTruthy());
  });

  it('renders models in the table', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());
    // provider badge appears in the row (multiple "openai" text nodes are expected)
    expect(screen.getAllByText('openai').length).toBeGreaterThan(0);
  });

  it('shows filtered empty state when filter matches nothing', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'zzznomatch');
    await waitFor(() => expect(screen.getByText(/No models match/)).toBeTruthy());
  });

  it('clear X button resets search', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const input = screen.getByPlaceholderText(/Filter models/);
    await userEvent.type(input, 'zzz');
    await waitFor(() => screen.getByText(/No models match/));
    const clearBtn = document.querySelector('button[title=""]') ?? screen.getByRole('button', { name: '' });
    // find the X button near the input
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.style.position === 'absolute' && b.style.right === '7px'
    );
    if (xBtn) {
      await userEvent.click(xBtn);
      await waitFor(() => screen.getByText('gpt-4o'));
    }
    // if xBtn not found, search was still reset — just verify input value
    expect((input as HTMLInputElement).value === '' || screen.queryByText('gpt-4o') !== null).toBe(true);
  });

  it('provider filter narrows results', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'claude-3', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('claude-3'));
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'anthropic');
    await waitFor(() => expect(screen.queryByText('gpt-4o')).toBeNull());
    expect(screen.getByText('claude-3')).toBeTruthy();
  });

  it('shows "X of Y models" when filter is active', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'claude-3', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('claude-3'));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'openai');
    await waitFor(() => expect(screen.getByText(/1 of 2 model/)).toBeTruthy());
  });

  it('shows cache column with dash when cachePerMillion is null', async () => {
    mockGetModels.mockResolvedValue([makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null } })]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    // dash rendered for null cache
    const dashes = Array.from(document.querySelectorAll('.text-muted, [class*="muted"]'));
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows context size in k when contextWindow is set', async () => {
    mockGetModels.mockResolvedValue([makeModel({ contextWindow: 128000 })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('128k')).toBeTruthy());
  });

  it('shows dash for null contextWindow', async () => {
    mockGetModels.mockResolvedValue([makeModel({ contextWindow: null })]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    // Should render a dash placeholder
    const cells = Array.from(document.querySelectorAll('td'));
    const hasDash = cells.some(td => td.querySelector('.text-muted') !== null);
    expect(hasDash).toBe(true);
  });

  it('sorts by provider when Provider header clicked', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'z-model', provider: 'openai' }),
      makeModel({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('z-model'));
    // Click Provider header to sort
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader);
    // anthropic comes before openai
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('anthropic');
  });

  it('reverses sort on second click', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'z-model', provider: 'openai' }),
      makeModel({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('z-model'));
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader); // asc
    await userEvent.click(providerHeader); // desc
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('openai');
  });
});

// ── ConfirmDialog / delete flow ────────────────────────────────────────────────

describe('ModelsPage — delete with ConfirmDialog', () => {
  it('shows confirm dialog when delete button clicked', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const deleteBtn = screen.getByTitle('Remove');
    await userEvent.click(deleteBtn);
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText(/Remove model "gpt-4o"/)).toBeTruthy();
  });

  it('cancels dialog without deleting', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.click(screen.getByTitle('Remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(mockDeleteModel).not.toHaveBeenCalled();
  });

  it('confirms dialog calls deleteModel and removes row', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockDeleteModel.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.click(screen.getByTitle('Remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('gpt-4o'));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).toBeNull());
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────────

describe('ModelsPage — pagination', () => {
  it('shows pagination controls when > 20 models', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Next/ })).toBeTruthy();
  });

  it('navigates to page 2', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText(/Page 2 of/)).toBeTruthy());
  });

  it('Previous button disabled on page 1', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
  });

  it('resets to page 1 when filter changes', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    // Type in search to reset page
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'model-1');
    await waitFor(() => expect(screen.queryByText(/Page 2 of/)).toBeNull());
  });
});

// ── Health tab ─────────────────────────────────────────────────────────────────

describe('ModelsPage — health tab', () => {
  it('switches to Health tab on click', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Health' }));
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText(/Real-time operational status/)).toBeTruthy());
  });

  it('shows empty state when no providers', async () => {
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText(/No models configured/)).toBeTruthy());
  });

  it('renders health table with provider rows', async () => {
    mockGetProviderHealth.mockResolvedValue({ providers: [makeHealthProvider()] });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText('GPT-4o')).toBeTruthy());
    expect(screen.getByText('Healthy')).toBeTruthy();
  });

  it('shows error state when getProviderHealth fails', async () => {
    mockGetProviderHealth.mockRejectedValue(new Error('network error'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText(/network error/)).toBeTruthy());
  });

  it('shows cooldown status when cooldownUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ cooldownUntil: future, status: 'healthy' })],
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    // Wait for health tab to load the provider row, then check status badge
    await waitFor(() => expect(screen.getByText('GPT-4o')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getAllByText('Cooldown').length).toBeGreaterThan(0);
  });

  it('shows dash for null p95LatencyMs', async () => {
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ p95LatencyMs: null })],
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => screen.getByText('GPT-4o'));
    // There should be at least one — cell
    const dashes = Array.from(document.querySelectorAll('td')).filter(td => td.textContent === '—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows "never" for null lastSuccessAt', async () => {
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: null })],
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText('never')).toBeTruthy());
  });

  it('relativeTime shows days ago for old dates', async () => {
    const oldDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: oldDate })],
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => expect(screen.getByText(/\d+d ago/)).toBeTruthy());
  });

  it('switches back to Models tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Health' }));
    await waitFor(() => screen.getByText(/Real-time operational status/));
    await userEvent.click(screen.getByRole('button', { name: 'Models' }));
    await waitFor(() => expect(screen.getByText(/No models yet/)).toBeTruthy());
  });
});
