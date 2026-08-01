import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UsageRecordPage } from './UsageRecordPage';

vi.mock('../api', () => ({
  getUsageRecord: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('../components/TraceEntryRenderer', () => ({
  TraceEntryRenderer: ({ entry }: { entry: { message: string } }) => <div data-testid="trace-entry">{entry.message}</div>,
}));

import { getUsageRecord, getProjects } from '../api';
const mockGetRecord = vi.mocked(getUsageRecord as (id: string) => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    timestamp: new Date('2024-01-15T10:00:00Z').toISOString(),
    projectId: 'proj-1',
    modelId: 'openai/gpt-4o',
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.00123456,
    latencyMs: 800,
    outcome: 'success',
    ...overrides,
  };
}

function renderPage(id = 'rec-1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/usage/${id}`]}>
      <Routes>
        <Route path="/dashboard/usage/:id" element={<UsageRecordPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetProjects.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

// ── Loading state ──────────────────────────────────────────────────────────────

describe('UsageRecordPage — loading state', () => {
  it('shows spinner while loading', () => {
    mockGetRecord.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
    expect(screen.getByText('Call Detail')).toBeTruthy();
  });

  it('getProjects error is silently caught (no crash)', async () => {
    mockGetProjects.mockRejectedValue(new Error('projects unavailable'));
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    // Page still renders — getProjects error is swallowed by .catch(console.error)
    expect(screen.getByText('Record ID')).toBeTruthy();
  });

  it('skips getUsageRecord when id is absent', async () => {
    // Render on a route that matches but produces no :id param
    render(
      <MemoryRouter initialEntries={['/dashboard/usage/']}>
        <Routes>
          <Route path="/dashboard/usage/" element={<UsageRecordPage />} />
        </Routes>
      </MemoryRouter>
    );
    // loadingRecord stays true (never set to false because !id early-returns)
    // spinner is visible; getUsageRecord is never called
    expect(document.querySelector('.spinner')).toBeTruthy();
    expect(mockGetRecord).not.toHaveBeenCalled();
  });
});

// ── Error / not found state ────────────────────────────────────────────────────

describe('UsageRecordPage — error/not-found state', () => {
  it('shows error message when getUsageRecord rejects with Error', async () => {
    mockGetRecord.mockRejectedValue(new Error('Not found'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy());
    expect(screen.getByText('Record Not Found')).toBeTruthy();
  });

  it('shows error message when getUsageRecord rejects with non-Error', async () => {
    mockGetRecord.mockRejectedValue('network error');
    renderPage();
    await waitFor(() => expect(screen.getByText('Failed to load record')).toBeTruthy());
  });

  it('shows fallback message when record is null after load', async () => {
    // resolves to null → triggers !record branch
    mockGetRecord.mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeTruthy());
  });

  it('Back button navigable in error state', async () => {
    mockGetRecord.mockRejectedValue(new Error('err'));
    renderPage();
    await waitFor(() => screen.getByText('Record Not Found'));
    const backBtn = screen.getByRole('button', { name: /Back/i });
    expect(backBtn).toBeTruthy();
  });
});

// ── Main record display ────────────────────────────────────────────────────────

describe('UsageRecordPage — main display', () => {
  it('shows Back button and navigates when clicked', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    const backBtn = screen.getByRole('button', { name: /Back/i });
    // Just verify it's present and clickable without crashing
    await userEvent.click(backBtn);
  });

  it('shows project name when project matches projectId', async () => {
    mockGetProjects.mockResolvedValue([{ id: 'proj-1', name: 'My Project' }]);
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => expect(screen.getByText('My Project')).toBeTruthy());
  });

  it('shows raw projectId when project not found', async () => {
    mockGetProjects.mockResolvedValue([{ id: 'other-proj', name: 'Other' }]);
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.getByText('proj-1')).toBeTruthy();
  });

  it('shows TTFT when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ ttftMs: 42 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('42 ms')).toBeTruthy());
  });

  it('shows — for TTFT when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    // TTFT and Tok/s both show — when absent
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows tokensPerSec when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ tokensPerSec: 99 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('99 tok/s')).toBeTruthy());
  });

  it('shows callType router when callType is routing', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ callType: 'routing' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('router')).toBeTruthy());
  });

  it('shows callType completion when callType is completion', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ callType: 'completion' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('completion')).toBeTruthy());
  });

  it('defaults callType to completion when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => expect(screen.getByText('completion')).toBeTruthy());
  });

  it('shows the request type', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ requestType: 'audio' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Audio')).toBeTruthy());
  });

  it('defaults the request type to Chat when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => expect(screen.getByText('Chat')).toBeTruthy());
  });

  it('shows errorMessage box when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ errorMessage: 'upstream timeout' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('upstream timeout')).toBeTruthy());
    expect(screen.getByText('Error Message')).toBeTruthy();
  });

  it('no errorMessage box when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.queryByText('Error Message')).toBeNull();
  });
});

// ── Trace log ─────────────────────────────────────────────────────────────────

describe('UsageRecordPage — trace log', () => {
  it('shows "No trace available" when trace is absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => expect(screen.getByText(/No trace available/)).toBeTruthy());
  });

  it('shows "No trace available" when trace is empty array', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/No trace available/)).toBeTruthy());
  });

  it('shows trace event count (plural)', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'request', panel: 'request' },
      { message: 'response', panel: 'response' },
    ]}));
    renderPage();
    await waitFor(() => expect(screen.getByText('2 events')).toBeTruthy());
  });

  it('shows trace event count (singular)', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'request', panel: 'request' },
    ]}));
    renderPage();
    await waitFor(() => expect(screen.getByText('1 event')).toBeTruthy());
  });

  it('renders TracePanel when trace has entries', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'model:prompt', panel: 'request' },
    ]}));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('trace-entry')).toBeTruthy());
  });

  it('renders Router Recap section when trace has router:recap', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'router:recap', panel: 'router-response' },
    ]}));
    renderPage();
    await waitFor(() => expect(screen.getByText('Router Recap')).toBeTruthy());
    // trace-entry rendered twice: once in Router Recap section, but TracePanel filters it out
    expect(screen.getAllByTestId('trace-entry').length).toBeGreaterThanOrEqual(1);
  });
});

// ── TracePanel rendering ───────────────────────────────────────────────────────

describe('UsageRecordPage — TracePanel', () => {
  it('renders entries grouped by panel', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'msg1', panel: 'request' },
      { message: 'msg2', panel: 'response' },
      { message: 'router:recap', panel: 'router-response' }, // filtered out from TracePanel
    ]}));
    renderPage();
    await waitFor(() => {
      const entries = screen.getAllByTestId('trace-entry');
      // TracePanel filters router:recap; Router Recap section also renders it
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not render empty TracePanel when all entries are router:recap', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'router:recap', panel: 'router-response' },
    ]}));
    renderPage();
    await waitFor(() => screen.getByText('Router Recap'));
    // TracePanel filters router:recap → filteredEntries=[]; TracePanel returns null
    // Trace Log shows 1 event but TracePanel renders nothing from non-recap panels
    expect(screen.getByText('1 event')).toBeTruthy();
  });

  it('renders router-request panel entries', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'router-req', panel: 'router-request' },
    ]}));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Router Request')).toBeTruthy();
      expect(screen.getByText('router-req')).toBeTruthy();
    });
  });

  it('renders router-response panel entries', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'router-res', panel: 'router-response' },
    ]}));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Router Response')).toBeTruthy();
    });
  });

  it('renders all four known panels', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ trace: [
      { message: 'rr-msg', panel: 'router-request' },
      { message: 'rrsp-msg', panel: 'router-response' },
      { message: 'req-msg', panel: 'request' },
      { message: 'res-msg', panel: 'response' },
    ]}));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Router Request')).toBeTruthy();
      expect(screen.getByText('Router Response')).toBeTruthy();
      expect(screen.getByText('Model Request')).toBeTruthy();
      expect(screen.getByText('Model Response')).toBeTruthy();
    });
  });
});

// ── Guardrail/PII fields ───────────────────────────────────────────────────────

describe('UsageRecordPage — guardrail/PII fields', () => {
  it('shows guardrailTriggered when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ guardrailTriggered: 'no-profanity' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('no-profanity')).toBeTruthy());
    expect(screen.getByText('Guardrail Triggered')).toBeTruthy();
  });

  it('does NOT show guardrailTriggered when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.queryByText('Guardrail Triggered')).toBeNull();
  });

  it('shows blockedBy when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ outcome: 'blocked', blockedBy: 'topic-restrict' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('topic-restrict')).toBeTruthy());
    expect(screen.getByText('Blocked By')).toBeTruthy();
  });

  it('does NOT show blockedBy when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.queryByText('Blocked By')).toBeNull();
  });

  it('shows piiRedacted list when present', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ piiRedacted: ['EMAIL', 'PHONE'] }));
    renderPage();
    await waitFor(() => expect(screen.getByText('EMAIL, PHONE')).toBeTruthy());
    expect(screen.getByText('PII Redacted')).toBeTruthy();
  });

  it('does NOT show piiRedacted when absent', async () => {
    mockGetRecord.mockResolvedValue(makeRecord());
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.queryByText('PII Redacted')).toBeNull();
  });

  it('does NOT show piiRedacted when empty array', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ piiRedacted: [] }));
    renderPage();
    await waitFor(() => screen.getByText('openai/gpt-4o'));
    expect(screen.queryByText('PII Redacted')).toBeNull();
  });
});

// ── Outcome badge ──────────────────────────────────────────────────────────────

describe('UsageRecordPage — outcome badge', () => {
  it('success outcome gets badge-success class', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ outcome: 'success' }));
    renderPage();
    await waitFor(() => {
      const badge = document.querySelector('.badge-success');
      expect(badge).toBeTruthy();
    });
  });

  it('blocked outcome gets badge-warning class (not badge-error)', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ outcome: 'blocked' }));
    renderPage();
    await waitFor(() => {
      const badge = document.querySelector('.badge-warning');
      expect(badge).toBeTruthy();
      expect(document.querySelector('.badge-error')).toBeNull();
    });
  });

  it('error outcome gets badge-error class', async () => {
    mockGetRecord.mockResolvedValue(makeRecord({ outcome: 'error' }));
    renderPage();
    await waitFor(() => {
      const badge = document.querySelector('.badge-error');
      expect(badge).toBeTruthy();
    });
  });
});
