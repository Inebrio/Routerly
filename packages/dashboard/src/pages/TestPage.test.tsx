/**
 * TestPage — focused tests for BUG-1 additions:
 * - blocked turn shows red error box (request vs response context)
 * - clean turn shows no red box
 * - Clear button resets debug trace history
 *
 * ponytail: we mock fetch + api; full SSE flow is covered by browser verify.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

vi.mock('../api.js', () => ({
  getProjects: vi.fn(),
  getPlaygroundPresets: vi.fn(),
  createPlaygroundPreset: vi.fn(),
  deletePlaygroundPreset: vi.fn(),
  getTrace: vi.fn(),
}));

vi.mock('../components/TraceEntryRenderer.js', () => ({
  TraceEntryRenderer: ({ entry }: { entry: { message: string } }) => (
    <div data-testid="trace-entry">{entry.message}</div>
  ),
}));

vi.mock('../components/MessageStatsCard.js', () => ({
  MessageStatsCard: () => <div data-testid="stats-card" />,
}));

vi.mock('../utils/traceUtils.js', () => ({
  extractMessageStats: vi.fn().mockReturnValue({
    selectedModel: null, routerScore: null, inputTokens: null, outputTokens: null,
    cachedTokens: null, latencyMs: null, ttftMs: null, tokensPerSec: null,
    inputCostUsd: null, outputCostUsd: null, totalCostUsd: null,
    inputPerMillion: null, outputPerMillion: null,
    hasError: false, fallbackUsed: false, cacheHit: false, cacheMiss: false, cacheSimilarity: null,
  }),
}));

// ── Imports after mocks ────────────────────────────────────────────────────

import { TestPage } from './TestPage';
import { getProjects, getPlaygroundPresets, getTrace } from '../api.js';

const FAKE_PROJECT = {
  id: 'proj-1', name: 'Test',
  models: [{ modelId: 'openai/gpt-4o' }],
  tokens: [{ id: 'tok-1', tokenSnippet: 'sk-rt-test', createdAt: '' }],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSSEResponse(finishReason: string, content = '', traceId = 'trace-123') {
  const chunk = JSON.stringify({
    id: 'c1', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  });
  const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }), {
    status: 200,
    headers: { 'x-routerly-trace-id': traceId, 'content-type': 'text/event-stream' },
  });
}

function renderPage() {
  return render(<MemoryRouter><TestPage /></MemoryRouter>);
}

async function setupWithToken() {
  renderPage();
  const tokenInput = screen.getByPlaceholderText('sk-rt-...');
  await userEvent.clear(tokenInput);
  // Token snippet must match FAKE_PROJECT's tokenSnippet prefix
  await userEvent.type(tokenInput, 'sk-rt-testABCDE');
  await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
}

// ── beforeEach ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT] as never);
  vi.mocked(getPlaygroundPresets).mockResolvedValue([]);
  vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TestPage — blocked turn (content_filter)', () => {
  it('shows "Request blocked by guardrail" when target=request', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        { message: 'guardrail:triggered', panel: 'request', details: { rule: 'regex:x', target: 'request', action: 'block', fallbackMessage: 'Blocked.' } },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('content_filter'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'competitor');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/request blocked by guardrail/i)).not.toBeNull(),
    { timeout: 4000 });

    expect(screen.getByText('regex:x')).toBeTruthy();
    expect(screen.getByText('Blocked.')).toBeTruthy();
  });

  it('shows "Response blocked by guardrail" when target=response', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        { message: 'guardrail:triggered', panel: 'response', details: { rule: 'mod:x', target: 'response', action: 'block' } },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('content_filter'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'bad content');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/response blocked by guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

describe('TestPage — clean turn', () => {
  it('does NOT show blocked box for finish_reason=stop', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'The answer is 4.'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, '2+2?');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('The answer is 4.')).not.toBeNull(),
    { timeout: 4000 });

    expect(screen.queryByText(/blocked by guardrail/i)).toBeNull();
  });
});

describe('TestPage — Clear resets debug', () => {
  it('Clear removes messages AND resets debug sidebar', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Hello!'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'Say hi');
    await userEvent.keyboard('{Enter}');

    // Wait for response
    await waitFor(() =>
      expect(screen.queryByText('Hello!')).not.toBeNull(),
    { timeout: 4000 });

    // Debug sidebar should show TURN #1 (via stats-card)
    expect(screen.getAllByTestId('stats-card').length).toBeGreaterThan(0);

    // Click the first Clear button (chat-area; resets both messages and debug)
    const clearBtns = screen.getAllByRole('button', { name: 'Clear' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await userEvent.click(clearBtns[0]!);

    // Messages gone
    expect(screen.queryByText('Hello!')).toBeNull();
    // Debug sidebar back to empty state
    expect(screen.getByText('No debug data yet.')).toBeTruthy();
    expect(screen.queryByTestId('stats-card')).toBeNull();
  });
});
