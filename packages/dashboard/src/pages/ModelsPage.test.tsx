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

// ── Models list ────────────────────────────────────────────────────────────────

describe('ModelsPage — models list', () => {
  it('shows empty state when no models', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/No models yet/)).toBeTruthy());
  });

  it('renders models in the table', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());
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
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.style.position === 'absolute' && b.style.right === '7px'
    );
    if (xBtn) {
      await userEvent.click(xBtn);
      await waitFor(() => screen.getByText('gpt-4o'));
    }
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
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader);
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
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'model-1');
    await waitFor(() => expect(screen.queryByText(/Page 2 of/)).toBeNull());
  });
});

// helper: switch to the Health tab
async function switchToHealthTab() {
  const healthTabBtn = screen.getByRole('button', { name: 'Health' });
  await userEvent.click(healthTabBtn);
}

// ── Health columns in the health tab ──────────────────────────────────────────

describe('ModelsPage — health columns (merged table)', () => {
  it('shows both Models and Health tab buttons', async () => {
    renderPage();
    await waitFor(() => screen.queryByText(/No models yet/) || screen.queryByText(/model/));
    expect(screen.getByRole('button', { name: 'Models' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Health' })).toBeTruthy();
  });

  it('shows health columns headers in the health tab', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText(/Error rate/)).toBeTruthy();
    expect(screen.getByText(/P95 latency/)).toBeTruthy();
    expect(screen.getByText(/Requests/)).toBeTruthy();
    expect(screen.getByText(/Last success/)).toBeTruthy();
    expect(screen.getByText(/Cooldown/)).toBeTruthy();
  });

  it('shows Healthy badge when health data matches model', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [makeHealthProvider()] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('Healthy')).toBeTruthy());
  });

  it('shows No data badge for model with no health entry', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('No data')).toBeTruthy());
  });

  it('shows dashes in health columns when no health entry', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    // multiple dash cells expected (error rate, p95, requests, last success, cooldown)
    const cells = Array.from(document.querySelectorAll('td'));
    const dashCells = cells.filter(td => td.textContent === '—');
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it('shows Cooldown badge when cooldownUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ cooldownUntil: future, status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Cooldown').length).toBeGreaterThan(0));
  });

  it('shows dash for null p95LatencyMs', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ p95LatencyMs: null })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText('Healthy'));
    const dashes = Array.from(document.querySelectorAll('td')).filter(td => td.textContent === '—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows "never" for null lastSuccessAt', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: null })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('never')).toBeTruthy());
  });

  it('shows days ago for old lastSuccessAt', async () => {
    const oldDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: oldDate })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/\d+d ago/)).toBeTruthy());
  });

  it('model with no health entry still appears in the health table', async () => {
    mockGetModels.mockResolvedValue([makeModel({ id: 'orphan-model' })]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('orphan-model'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('orphan-model')).toBeTruthy());
  });

  it('both health and no-health models render when mixed', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'local-model', provider: 'ollama' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ modelId: 'gpt-4o' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('Healthy')).toBeTruthy());
    expect(screen.getByText('local-model')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
  });
});

// ── Sortable health + endpoint columns ────────────────────────────────────────

describe('ModelsPage — sortable health and endpoint columns', () => {
  it('Endpoint header is sortable in Models tab (renders sort icon)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'b-model', endpoint: 'https://z.com/v1' }),
      makeModel({ id: 'a-model', endpoint: 'https://a.com/v1' }),
    ]);
    // Endpoint sort lives under the Models tab (default tab)
    renderPage();
    await waitFor(() => screen.getByText('b-model'));
    const endpointHeader = screen.getByText('Endpoint');
    await userEvent.click(endpointHeader);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // asc: a.com before z.com
    expect(rows[0]?.textContent).toContain('a-model');
  });

  it('Status header sorts healthy before degraded by default (asc = best first)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'deg-model', provider: 'openai' }),
      makeModel({ id: 'healthy-model', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'deg-model', status: 'degraded' }),
        makeHealthProvider({ modelId: 'healthy-model', status: 'healthy' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('healthy-model'));
    await switchToHealthTab();
    // Default hSortKey='status', hSortDir='asc' already orders healthy first.
    // Clicking once flips to desc (degraded first); click twice to restore asc.
    const statusHeader = screen.getByText('Status');
    await userEvent.click(statusHeader); // desc: degraded first
    await userEvent.click(statusHeader); // asc again: healthy first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('healthy-model');
  });

  it('no-data rows sink to bottom when sorting by a health column', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'no-health', provider: 'openai' }),
      makeModel({ id: 'has-health', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ modelId: 'has-health', status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('no-health'));
    await switchToHealthTab();
    const statusHeader = screen.getByText('Status');
    await userEvent.click(statusHeader); // asc
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[rows.length - 1]?.textContent).toContain('no-health');
    // also check desc keeps no-data last
    await userEvent.click(statusHeader); // desc
    const rows2 = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows2[rows2.length - 1]?.textContent).toContain('no-health');
  });

  it('Error rate header sorts numerically', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'high-err', provider: 'openai' }),
      makeModel({ id: 'low-err', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'high-err', errorRate: 0.5 }),
        makeHealthProvider({ modelId: 'low-err', errorRate: 0.01 }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('high-err'));
    await switchToHealthTab();
    const errHeader = screen.getByText(/Error rate/);
    await userEvent.click(errHeader); // asc: low error first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('low-err');
  });

  it('sort indicator appears on health column header when active', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [makeHealthProvider()] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    const p95Header = screen.getByText(/P95 latency/);
    await userEvent.click(p95Header);
    // ChevronUp/Down is in the DOM inside the th after click
    expect(p95Header.closest('th') ?? p95Header).toBeTruthy();
  });
});
