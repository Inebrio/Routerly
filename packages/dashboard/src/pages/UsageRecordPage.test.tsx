import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UsageRecordPage } from './UsageRecordPage';

vi.mock('../api', () => ({
  getUsageRecord: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('../components/TraceEntryRenderer', () => ({
  TraceEntryRenderer: ({ entry }: { entry: { message: string } }) => <div>{entry.message}</div>,
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
