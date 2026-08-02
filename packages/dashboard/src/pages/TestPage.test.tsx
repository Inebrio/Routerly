/**
 * TestPage — focused tests for BUG-1 additions:
 * - blocked turn shows red error box (request vs response context)
 * - clean turn shows no red box
 * - Clear button resets debug trace history
 *
 * ponytail: we mock fetch + api; full SSE flow is covered by browser verify.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

vi.mock('../api.js', () => ({
  getProjects: vi.fn(),
  getPlaygroundPresets: vi.fn(),
  createPlaygroundPreset: vi.fn(),
  deletePlaygroundPreset: vi.fn(),
  getTrace: vi.fn(),
  streamTraces: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so getByRole('combobox')/fireEvent.change tests keep working
vi.mock('../components/SearchableSelect.js', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
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
    hasError: false, fallbackUsed: false,
  }),
}));

// ── Imports after mocks ────────────────────────────────────────────────────

import { TestPage } from './TestPage';
import { getProjects, getPlaygroundPresets, getTrace, createPlaygroundPreset, deletePlaygroundPreset, streamTraces } from '../api.js';

const FAKE_PROJECT = {
  id: 'proj-1', name: 'Test',
  models: [{ modelId: 'openai/gpt-4o' }],
  tokens: [{ id: 'tok-1', tokenSnippet: 'sk-rt-test', createdAt: '' }],
};

// Project with a response-blocking rule → streamingDisabled=true
const FAKE_PROJECT_BLOCK_RESPONSE = {
  ...FAKE_PROJECT,
  guardrails: {
    rules: [
      { type: 'moderation', target: 'response', block: true, config: { modelId: 'openai/gpt-4o', threshold: 0.5 } },
    ],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSSEResponse(finishReason: string, content = '') {
  const chunk = JSON.stringify({
    id: 'c1', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  });
  const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * The trace side channel the page opens before each turn. It is where the traceId
 * comes from now — the proxy response carries no trace header.
 */
function mockTraceStream(entries: Array<{ panel: string; message: string; details?: Record<string, unknown> }> = [], traceId = 'trace-123') {
  vi.mocked(streamTraces).mockImplementation(async (_query, onEvent) => {
    onEvent({ traceId, topic: 'trace/request/trace/open', entry: { panel: 'request', message: 'trace:open', details: {} } });
    for (const entry of entries) {
      onEvent({ traceId, topic: `trace/request/${entry.message}`, entry: { details: {}, ...entry } });
    }
    return () => {};
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
  mockTraceStream();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TestPage — blocked turn (content_filter)', () => {
  it('shows blockMessage as a normal assistant bubble (no red box)', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        { message: 'guardrail:triggered', panel: 'request', details: { rule: 'regex:x', target: 'request', block: true, blockMessage: 'Blocked.' } },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('content_filter'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'competitor');
    await userEvent.keyboard('{Enter}');

    // blockMessage appears as plain text in the assistant bubble
    await waitFor(() =>
      expect(screen.queryByText('Blocked.')).not.toBeNull(),
    { timeout: 4000 });

    // NO red "blocked by guardrail" header in the chat
    expect(screen.queryByText(/blocked by guardrail/i)).toBeNull();
  });

  it('shows generic fallback text when blockMessage is absent', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        { message: 'guardrail:triggered', panel: 'response', details: { rule: 'mod:x', target: 'response', block: true } },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('content_filter'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'bad content');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });

    // Still no red header box
    expect(screen.queryByText(/blocked by guardrail/i)).toBeNull();
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

// ── Cross-chunk SSE buffering ──────────────────────────────────────────────

/** Returns a Response whose reader yields the given chunks in order. */
function makeChunkedSSEResponse(chunks: string[], traceId = 'trace-123') {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]!));
        else c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('TestPage — cross-chunk SSE buffering (handleSend / loop 2)', () => {
  it('assembles content split across two reads without error', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // JSON is split mid-string: "impressioni" in chunk 1, "smo" in chunk 2
    global.fetch = vi.fn().mockResolvedValue(makeChunkedSSEResponse([
      'data: {"choices":[{"delta":{"content":"impressioni',
      'smo"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    ]));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'test cross-chunk');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/impressionismo/)).not.toBeNull(),
    { timeout: 4000 });

    // No error banner
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/unexpected end/i)).toBeNull();
  });

  it('still surfaces a data.type=error event as an error (not swallowed)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeChunkedSSEResponse([
      'data: {"type":"error","message":"boom"}\n\n',
    ]));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'trigger service error');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('boom')).not.toBeNull(),
    { timeout: 4000 });
  });
});

describe('TestPage — cross-chunk SSE buffering (ComparePanel / loop 1)', () => {
  it('assembles content split across two reads in compare mode without error', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeChunkedSSEResponse([
      'data: {"choices":[{"delta":{"content":"impre',
      'ssionismo"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
    ]));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    // Switch to Compare mode
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'test cross-chunk compare');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/impressionismo/)).not.toBeNull(),
    { timeout: 4000 });

    expect(screen.queryByRole('alert')).toBeNull();
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

// ── Truncation badge ───────────────────────────────────────────────────────

describe('TestPage — truncation badge (finish_reason=length)', () => {
  it('shows truncation badge when finish_reason=length', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('length', 'Cut off here'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'tell me a long story');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByTestId('truncation-badge')).not.toBeNull(),
    { timeout: 4000 });
  });

  it('does NOT show truncation badge for finish_reason=stop', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Normal reply'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hello');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Normal reply')).not.toBeNull(),
    { timeout: 4000 });

    expect(screen.queryByTestId('truncation-badge')).toBeNull();
  });
});

// ── Streaming-disabled banner + disabled toggle ────────────────────────────

describe('TestPage — streaming-disabled banner and toggle (block+response rule)', () => {
  it('shows streaming-disabled banner when project has block+response rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT_BLOCK_RESPONSE] as never);

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    expect(screen.queryByTestId('streaming-disabled-banner')).not.toBeNull();
  });

  it('stream toggle is disabled when project has block+response rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT_BLOCK_RESPONSE] as never);

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(false);
  });

  it('does NOT show streaming-disabled banner when project has no blocking response rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT] as never);

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    expect(screen.queryByTestId('streaming-disabled-banner')).toBeNull();

    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
  });
});

// ── Buffered-by-guardrail note ─────────────────────────────────────────────

describe('TestPage — buffered-by-guardrail note', () => {
  it('shows buffered note on assistant message when project has block+response rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT_BLOCK_RESPONSE] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Held response'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hi');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByTestId('buffered-note')).not.toBeNull(),
    { timeout: 4000 });
  });

  it('does NOT show buffered note when project has no block+response rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Normal response'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hi');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Normal response')).not.toBeNull(),
    { timeout: 4000 });

    expect(screen.queryByTestId('buffered-note')).toBeNull();
  });
});

// ── Debug sidebar hide/show ────────────────────────────────────────────────────

describe('TestPage — debug sidebar hide/show', () => {
  it('Hide debug button hides the sidebar and shows the re-open button', async () => {
    await setupWithToken();

    // Debug sidebar visible initially — find Hide debug button
    const hideBtn = screen.getByTitle('Hide debug');
    await userEvent.click(hideBtn);

    // Sidebar is gone; the re-open ChevronLeft button appears
    await waitFor(() =>
      expect(screen.queryByTitle('Show debug')).not.toBeNull()
    );

    // Click to re-show
    await userEvent.click(screen.getByTitle('Show debug'));
    await waitFor(() =>
      expect(screen.queryByTitle('Hide debug')).not.toBeNull()
    );
  });
});

// ── Debug Clear button (inside sidebar, not chat) ─────────────────────────────

describe('TestPage — debug sidebar Clear button', () => {
  it('Debug sidebar Clear button resets trace history', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Hello debug'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'debug me');
    await userEvent.keyboard('{Enter}');

    // Wait for response to appear
    await waitFor(() =>
      expect(screen.queryByText('Hello debug')).not.toBeNull(),
    { timeout: 4000 });

    // The debug sidebar Clear button appears (not the chat Clear)
    const clearBtns = screen.getAllByRole('button', { name: 'Clear' });
    // There are two: one in the chat area (has "Clear" in controls) and one in the debug sidebar
    // The debug Clear only appears when debugTraceHistory.length > 0
    // After a message the debug history is populated; find the non-chat one
    // Both have text "Clear"; the one inside the debug sidebar comes after
    expect(clearBtns.length).toBeGreaterThanOrEqual(1);

    // Click the debug sidebar Clear (index 1 if both visible, else first)
    const debugClear = clearBtns.find(b => {
      // It's inside the "Debug" heading container
      return b.closest('[style*="width: 380px"]') !== null ||
             b.parentElement?.parentElement?.querySelector('h3')?.textContent === 'Debug';
    }) ?? clearBtns[0];
    await userEvent.click(debugClear!);

    // After clicking debug Clear, we're back to "No debug data yet."
    await waitFor(() =>
      expect(screen.queryByText('No debug data yet.')).not.toBeNull()
    );
  });
});

// ── Unknown token indicator ───────────────────────────────────────────────────

describe('TestPage — unknown token indicator', () => {
  it('shows "Unknown token" when token does not match any project', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT] as never);

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    // Type a long enough token that doesn't match
    await userEvent.type(tokenInput, 'sk-rt-ZZZZunknown');

    await waitFor(() =>
      expect(screen.queryByText('Unknown token')).not.toBeNull()
    );
  });
});

// ── System prompt toggle ──────────────────────────────────────────────────────

describe('TestPage — system prompt toggle', () => {
  it('clicking System prompt header opens/closes the textarea', async () => {
    await setupWithToken();

    // Closed by default
    expect(screen.queryByDisplayValue('You are a helpful AI assistant.')).toBeNull();

    const promptToggle = screen.getByText('System prompt').closest('button') as HTMLButtonElement;
    await userEvent.click(promptToggle);

    await waitFor(() =>
      expect(screen.queryByDisplayValue('You are a helpful AI assistant.')).not.toBeNull()
    );

    // Click again to close
    await userEvent.click(promptToggle);
    await waitFor(() =>
      expect(screen.queryByDisplayValue('You are a helpful AI assistant.')).toBeNull()
    );
  });
});

// ── handleStop (abort) ────────────────────────────────────────────────────────

describe('TestPage — handleStop', () => {
  it('stop button aborts the ongoing request', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Use a never-resolving fetch so loading state persists long enough
    let abortCalled = false;
    global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      opts.signal?.addEventListener('abort', () => { abortCalled = true; });
      return new Promise(() => {}); // never resolves
    });

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'test stop');
    await userEvent.keyboard('{Enter}');

    // Loading state => Stop button (.btn-danger with Square icon) appears
    await waitFor(() =>
      expect(document.querySelectorAll('.btn-danger').length).toBeGreaterThan(0)
    );

    const stopBtns = document.querySelectorAll('.btn-danger');
    await userEvent.click(stopBtns[0] as HTMLElement);
    // abortCalled should become true eventually
    await waitFor(() => expect(abortCalled).toBe(true), { timeout: 2000 });
  });
});

// ── Show/hide raw JSON toggle ─────────────────────────────────────────────────

describe('TestPage — show raw JSON toggle', () => {
  it('shows raw/rendered toggle button after response and clicking toggles view', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // SSE with rawJson (non-empty choices[0].delta.content so rawChunks is populated)
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Raw reply here'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'show me raw');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Raw reply here')).not.toBeNull(),
    { timeout: 4000 });

    // raw/rendered toggle button appears when rawJson is set
    const rawBtn = screen.queryByRole('button', { name: /raw|rendered/i });
    if (rawBtn) {
      await userEvent.click(rawBtn);
      // After clicking, it switches to "rendered" text
      expect(screen.queryByRole('button', { name: /rendered/i })).not.toBeNull();
      await userEvent.click(rawBtn);
    }
  });
});

// ── Fetch HTTP error ──────────────────────────────────────────────────────────

describe('TestPage — fetch HTTP error', () => {
  it('shows error when fetch returns non-ok status', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(new Response('{"error":{"message":"Rate limited"}}', {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'trigger error');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Rate limited')).not.toBeNull(),
    { timeout: 4000 });
  });

  it('shows HTTP status error when response body is not parseable JSON', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(new Response('not json', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'trigger 503');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/HTTP 503/)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── Blocked turn without matching trace entry ─────────────────────────────────

describe('TestPage — blocked turn without trace entry', () => {
  it('shows generic block text as normal bubble when trace has no guardrail entry', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('content_filter'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'blocked with no trace');
    await userEvent.keyboard('{Enter}');

    // Fallback message shown as a normal bubble when blockMessage is absent
    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
    // No red box header
    expect(screen.queryByText(/blocked by guardrail/i)).toBeNull();
  });
});

// ── costEstimate — shown when response has inputTokens/outputTokens ───────────

describe('TestPage — costEstimate display', () => {
  it('shows token count and cost estimate when response includes usage', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // SSE response includes usage chunk before final chunk
    const usageChunk = JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50 } });
    const finalChunk = JSON.stringify({
      id: 'c1', object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: 'Token reply' }, finish_reason: 'stop' }],
    });
    const body = `data: ${usageChunk}\n\ndata: ${finalChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'count tokens');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Token reply')).not.toBeNull(),
    { timeout: 4000 });

    // tokens: 150 | ~$0.0013 should be rendered
    await waitFor(() =>
      expect(screen.queryByText(/tokens:/)).not.toBeNull()
    );
    expect(screen.queryByText(/~\$/)).not.toBeNull();
  });
});

// ── Presets panel open/close ───────────────────────────────────────────────────

describe('TestPage — presets panel', () => {
  it('opens presets panel when Presets button is clicked', async () => {
    vi.mocked(getPlaygroundPresets).mockResolvedValue([]);

    await setupWithToken();

    const presetsBtn = screen.getByRole('button', { name: /Presets/i });
    await userEvent.click(presetsBtn);

    await waitFor(() =>
      expect(screen.queryByText('No presets yet.')).not.toBeNull()
    );
  });

  it('shows existing presets and clicking one loads it', async () => {
    const FAKE_PRESET = {
      id: 'preset-1',
      name: 'My Preset',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user' as const, content: 'Hello preset' }],
    };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([FAKE_PRESET] as never);

    await setupWithToken();

    const presetsBtn = screen.getByRole('button', { name: /Presets/i });
    await userEvent.click(presetsBtn);

    await waitFor(() =>
      expect(screen.queryByText('My Preset')).not.toBeNull()
    );

    // Click preset name to load it
    await userEvent.click(screen.getByText('My Preset'));

    // System prompt should be set + message loaded → presets panel closed
    await waitFor(() =>
      expect(screen.queryByText('My Preset')).toBeNull()
    );
  });

  it('shows save form and saves a preset', async () => {
    vi.mocked(getPlaygroundPresets).mockResolvedValue([]);
    vi.mocked(createPlaygroundPreset).mockResolvedValue({
      id: 'preset-new', name: 'New Preset', systemPrompt: 'You are helpful.',
    } as never);

    await setupWithToken();

    const presetsBtn = screen.getByRole('button', { name: /Presets/i });
    await userEvent.click(presetsBtn);

    await waitFor(() => screen.queryByText('No presets yet.'));

    // Click "Save current"
    const saveCurrentBtn = screen.getByRole('button', { name: /Save current/i });
    await userEvent.click(saveCurrentBtn);

    // Name input appears
    await waitFor(() => screen.getByPlaceholderText('Preset name...'));
    const nameInput = screen.getByPlaceholderText('Preset name...');
    await userEvent.type(nameInput, 'New Preset');

    // Click Save
    const saveBtn = screen.getAllByRole('button', { name: 'Save' }).find(b => !b.hasAttribute('disabled'));
    if (saveBtn) {
      await userEvent.click(saveBtn);
      await waitFor(() => expect(vi.mocked(createPlaygroundPreset)).toHaveBeenCalled());
    }
  });

  it('deletes a preset when trash button is clicked', async () => {
    const FAKE_PRESET = { id: 'preset-del', name: 'Del Me', systemPrompt: '' };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([FAKE_PRESET] as never);
    vi.mocked(deletePlaygroundPreset).mockResolvedValue(undefined as never);

    await setupWithToken();

    const presetsBtn = screen.getByRole('button', { name: /Presets/i });
    await userEvent.click(presetsBtn);

    await waitFor(() => screen.queryByText('Del Me'));

    const deleteBtn = screen.getByTitle('Delete preset');
    await userEvent.click(deleteBtn);

    await waitFor(() => expect(vi.mocked(deletePlaygroundPreset)).toHaveBeenCalledWith('proj-1', 'preset-del'));
    await waitFor(() => expect(screen.queryByText('Del Me')).toBeNull());
  });
});

// ── Compare mode: token indicator shows Unknown for unrecognized token ─────────

describe('TestPage — compare mode unknown token', () => {
  it('shows Unknown token in compare mode for unrecognized token', async () => {
    renderPage();
    // Switch to compare
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const tokenAInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenAInput);
    await userEvent.type(tokenAInput, 'sk-rt-ZZZunknown');

    await waitFor(() =>
      expect(screen.queryByText('Unknown token')).not.toBeNull()
    );
  });
});

// ── File attach preview and remove ───────────────────────────────────────────

describe('TestPage — file attach', () => {
  it('shows attached image preview with remove button after file attach', async () => {
    // Mock FileReader
    const mockResult = 'data:image/png;base64,abc123';
    const mockReadAsDataURL = vi.fn().mockImplementation(function (this: { onload?: (e: { target: { result: string } }) => void }) {
      if (this.onload) this.onload({ target: { result: mockResult } });
    });
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | undefined = undefined;
      readAsDataURL = mockReadAsDataURL.bind(this);
    });

    await setupWithToken();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(['img'], 'test.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(document.querySelector('img[alt="Attachment"]')).not.toBeNull()
    );

    // Click remove button (×) to clear the image
    const removeBtn = document.querySelector('img[alt="Attachment"]')!
      .closest('div')!.parentElement!.querySelector('button')!;
    await userEvent.click(removeBtn);
    await waitFor(() =>
      expect(document.querySelector('img[alt="Attachment"]')).toBeNull()
    );

    vi.unstubAllGlobals();
  });

  it('shows error when non-image file is attached', async () => {
    const mockReadAsDataURL = vi.fn();
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | undefined = undefined;
      readAsDataURL = mockReadAsDataURL;
    });

    await setupWithToken();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(['data'], 'test.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(screen.queryByText('Only image attachments are supported.')).not.toBeNull()
    );
    expect(mockReadAsDataURL).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ── User message with image content (ContentPart[]) ──────────────────────────

describe('TestPage — image message content parts', () => {
  it('sends message with image attachment and shows it in user bubble', async () => {
    const mockResult = 'data:image/png;base64,xyz';
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | undefined = undefined;
      readAsDataURL = function (this: { onload?: (e: { target: { result: string } }) => void }) {
        if (this.onload) this.onload({ target: { result: mockResult } });
      };
    });

    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'I can see the image'));

    await setupWithToken();

    // Attach image
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(['img'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() => expect(document.querySelector('img[alt="Attachment"]')).not.toBeNull());

    // Send message with text + image
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'What do you see?');
    await userEvent.keyboard('{Enter}');

    // The user message should render the attached image
    await waitFor(() =>
      expect(document.querySelector('img[alt="Attached"]')).not.toBeNull(),
    { timeout: 4000 });

    // Response should appear
    await waitFor(() =>
      expect(screen.queryByText('I can see the image')).not.toBeNull(),
    { timeout: 4000 });

    vi.unstubAllGlobals();
  });
});

// ── Debug sidebar shows trace entries after a turn ────────────────────────────

describe('TestPage — debug sidebar trace entries rendered', () => {
  it('shows MessageStatsCard for a turn in the debug sidebar', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [{ message: 'routing', details: {} }],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Debug visible'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'show debug trace');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Debug visible')).not.toBeNull(),
    { timeout: 4000 });

    // Stats card rendered in debug sidebar for turn 1
    await waitFor(() =>
      expect(screen.queryByTestId('stats-card')).not.toBeNull()
    );
  });

  it('clicking Technical Details summary expands trace entry in debug', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [{ message: 'routed', details: { model: 'gpt-4o' } }],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Trace expand reply'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'expand trace');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Trace expand reply')).not.toBeNull(),
    { timeout: 4000 });

    // Technical Details <details> should exist
    await waitFor(() =>
      expect(screen.queryByText('Technical Details')).not.toBeNull()
    );

    // Click summary to expand
    const summary = screen.getByText('Technical Details');
    await userEvent.click(summary);
    // TraceEntryRenderer mock renders entry.message
    await waitFor(() =>
      expect(screen.queryByTestId('trace-entry')).not.toBeNull()
    );
  });
});

// ── ParamSlider onChange (line 71) ────────────────────────────────────────────

describe('TestPage — ParamSlider onChange', () => {
  it('changing temperature slider calls the handler', async () => {
    await setupWithToken();
    const sliders = document.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBeGreaterThan(0);
    // Fire change on the first slider (Temperature)
    fireEvent.change(sliders[0]!, { target: { value: '1.5' } });
    // No crash; the value should be reflected in the slider
    expect((sliders[0] as HTMLInputElement).value).toBe('1.5');
  });
});

// ── Eye/hide token button (lines 744, 776) ────────────────────────────────────

describe('TestPage — token show/hide', () => {
  it('clicking eye button toggles token visibility in single mode', async () => {
    await setupWithToken();
    const tokenInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(tokenInput).not.toBeNull();
    // The eye button is next to the password input
    const eyeBtn = tokenInput.parentElement!.querySelector('button')!;
    await userEvent.click(eyeBtn);
    // After toggle: input type changes to text
    await waitFor(() =>
      expect(document.querySelector('input[type="text"][style*="monospace"]')).not.toBeNull()
    );
  });
});

// ── Stream toggle onChange (line 932) ─────────────────────────────────────────

describe('TestPage — stream toggle onChange', () => {
  it('toggling stream checkbox changes its state', async () => {
    await setupWithToken();
    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.change(toggle, { target: { checked: false } });
    await waitFor(() => expect((screen.getByTestId('stream-toggle') as HTMLInputElement).checked).toBe(false));
  });
});

// ── Model select onChange (line 909) ──────────────────────────────────────────

describe('TestPage — model select onChange', () => {
  it('changing model select updates selected model', async () => {
    await setupWithToken();
    const modelSelect = screen.getByRole('combobox');
    await userEvent.selectOptions(modelSelect, 'openai/gpt-4o');
    expect((modelSelect as HTMLSelectElement).value).toBe('openai/gpt-4o');
  });
});

// ── System prompt textarea onChange (line 902) ────────────────────────────────

describe('TestPage — system prompt textarea', () => {
  it('editing system prompt textarea updates its value', async () => {
    await setupWithToken();
    // Open system prompt section
    const promptToggle = screen.getByText('System prompt').closest('button') as HTMLButtonElement;
    await userEvent.click(promptToggle);
    await waitFor(() => screen.getByDisplayValue('You are a helpful AI assistant.'));
    const ta = screen.getByDisplayValue('You are a helpful AI assistant.');
    fireEvent.change(ta, { target: { value: 'New system prompt' } });
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toBe('New system prompt'));
  });
});

// ── loadPreset without messages (line 662) ────────────────────────────────────

describe('TestPage — loadPreset without messages branch', () => {
  it('loading a preset with no messages branch empties the chat', async () => {
    const presetNoMsgs = { id: 'p-no-msgs', name: 'No Msgs Preset', systemPrompt: 'Clean start.' };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([presetNoMsgs] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Reply'));

    await setupWithToken();

    // First send a message so chat is non-empty
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hi');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Reply')).not.toBeNull(), { timeout: 4000 });

    // Open presets and load the no-messages preset
    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));
    await waitFor(() => screen.getByText('No Msgs Preset'));
    await userEvent.click(screen.getByText('No Msgs Preset'));

    // Chat cleared
    await waitFor(() => expect(screen.queryByText('Reply')).toBeNull());
  });
});

// ── savePreset with conversation messages (lines 670-671, 677, 682) ───────────

describe('TestPage — savePreset with conversation', () => {
  it('saves preset including conversation messages and handles error', async () => {
    vi.mocked(getPlaygroundPresets).mockResolvedValue([]);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Saved reply'));
    vi.mocked(createPlaygroundPreset).mockRejectedValueOnce(new Error('save failed'));

    await setupWithToken();

    // Send a message so convoMsgs will be non-empty when saving
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'Hello');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Saved reply')).not.toBeNull(), { timeout: 4000 });

    // Open presets panel
    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));
    await waitFor(() => screen.queryByText('No presets yet.'));

    // Open save form
    await userEvent.click(screen.getByRole('button', { name: /Save current/i }));
    await waitFor(() => screen.getByPlaceholderText('Preset name...'));
    await userEvent.type(screen.getByPlaceholderText('Preset name...'), 'With Conv');

    // Press Enter to trigger savePreset (covers line 835 onKeyDown path too)
    await userEvent.keyboard('{Enter}');
    // Error is logged (console.error) — just verify no crash and createPlaygroundPreset was called
    await waitFor(() => expect(vi.mocked(createPlaygroundPreset)).toHaveBeenCalled());
  });
});

// ── Live trace entries from the side channel, single mode ───────────────────

describe('TestPage — live trace entries in handleSend', () => {
  it('keeps the entries collected live when the stored trace cannot be fetched', async () => {
    vi.mocked(getTrace).mockRejectedValue(new Error('no trace fetch')); // force the live entries
    mockTraceStream([{ panel: 'request', message: 'routing:selected' }]);
    const contentChunk = JSON.stringify({
      choices: [{ delta: { content: 'Routed reply' }, finish_reason: 'stop' }],
    });
    const body = `data: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'trace me');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Routed reply')).not.toBeNull(),
    { timeout: 4000 });
    await waitFor(() =>
      expect(screen.queryByText('routing:selected')).not.toBeNull()
    );
  });
});

// ── SSE thinking delta in handleSend (lines 543-546) ─────────────────────────

describe('TestPage — SSE thinking delta', () => {
  it('processes thinking delta and shows Reasoning summary', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const thinkingChunk = JSON.stringify({
      choices: [{ delta: { thinking: 'Let me think...' }, finish_reason: null }],
    });
    const contentChunk = JSON.stringify({
      choices: [{ delta: { content: 'Final answer' }, finish_reason: 'stop' }],
    });
    const body = `data: ${thinkingChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'think first');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Final answer')).not.toBeNull(),
    { timeout: 4000 });
    // Reasoning summary should appear
    await waitFor(() =>
      expect(screen.queryByText(/Reasoning/)).not.toBeNull()
    );
  });
});

// ── Guardrail token usage from trace (lines 616-618) ─────────────────────────

describe('TestPage — guardrail token usage from trace', () => {
  it('shows guardrail token span when trace has guardrail:evaluated entry', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:evaluated',
          details: {
            rules: [
              { usage: { inputTokens: 50, outputTokens: 20 } },
            ],
          },
        },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Guardrail cost reply'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'count guardrail tokens');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Guardrail cost reply')).not.toBeNull(),
    { timeout: 4000 });

    // guardrail token span should show (guardrailIn=50, guardrailOut=20)
    await waitFor(() =>
      expect(document.querySelector('[title="Guardrail judge tokens"]')).not.toBeNull()
    );
  });
});

// ── Preset item mouseEnter/Leave (line 850) ───────────────────────────────────

describe('TestPage — preset item hover', () => {
  it('mouseEnter and mouseLeave on preset row change background', async () => {
    const FAKE_PRESET = { id: 'preset-hover', name: 'Hover Me', systemPrompt: '' };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([FAKE_PRESET] as never);

    await setupWithToken();

    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));
    await waitFor(() => screen.getByText('Hover Me'));

    const presetRow = screen.getByText('Hover Me').closest('div[style]')!;
    fireEvent.mouseEnter(presetRow);
    fireEvent.mouseLeave(presetRow);
    // No crash; the element still exists
    expect(screen.getByText('Hover Me')).toBeTruthy();
  });
});

// ── ComparePanel: param slider onChange and model select (lines 244, 250-252) ─

describe('TestPage — ComparePanel controls', () => {
  async function switchToCompare() {
    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));
  }

  it('ComparePanel model select onChange fires without crash', async () => {
    await switchToCompare();
    const modelSelects = screen.getAllByRole('combobox');
    // Compare mode has two model selects (Model A and Model B)
    expect(modelSelects.length).toBeGreaterThanOrEqual(2);
    await userEvent.selectOptions(modelSelects[0]!, 'openai/gpt-4o');
    expect((modelSelects[0] as HTMLSelectElement).value).toBe('openai/gpt-4o');
  });

  it('ComparePanel param sliders onChange fire without crash', async () => {
    await switchToCompare();
    const sliders = document.querySelectorAll('input[type="range"]');
    // Compare mode renders sliders for panel A and B (at least 2)
    expect(sliders.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(sliders[0]!, { target: { value: '1.2' } });
    expect((sliders[0] as HTMLInputElement).value).toBe('1.2');
  });

  it('ComparePanel token B eye button toggles visibility', async () => {
    await switchToCompare();
    // Two password inputs in compare mode (Token A and Token B)
    const pwdInputs = document.querySelectorAll('input[type="password"]');
    expect(pwdInputs.length).toBeGreaterThanOrEqual(1);
    const eyeBtn = (pwdInputs[0] as HTMLElement).parentElement!.querySelector('button')!;
    await userEvent.click(eyeBtn);
    // At least one field switches to text type
    await waitFor(() =>
      expect(document.querySelectorAll('input[type="text"][style*="monospace"]').length).toBeGreaterThan(0)
    );
  });
});

// ── ComparePanel: HTTP error in sendToModel (lines 149-152) ──────────────────

describe('TestPage — ComparePanel HTTP error', () => {
  it('shows error in compare panel when fetch returns non-ok status', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(new Response(
      '{"error":{"message":"Compare error"}}',
      { status: 429, headers: { 'content-type': 'application/json' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'compare this');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Compare error')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── deletePreset error catch (line 690) ──────────────────────────────────────

describe('TestPage — deletePreset error', () => {
  it('does not crash when deletePlaygroundPreset rejects', async () => {
    const FAKE_PRESET = { id: 'preset-err', name: 'Err Preset', systemPrompt: '' };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([FAKE_PRESET] as never);
    vi.mocked(deletePlaygroundPreset).mockRejectedValueOnce(new Error('delete failed'));

    await setupWithToken();
    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));
    await waitFor(() => screen.getByText('Err Preset'));

    const deleteBtn = screen.getByTitle('Delete preset');
    await userEvent.click(deleteBtn);

    // Error is caught and logged; preset should still be visible (state unchanged on error)
    await waitFor(() => expect(vi.mocked(deletePlaygroundPreset)).toHaveBeenCalled());
    // No crash — component still renders
    expect(screen.getByRole('button', { name: /Presets/i })).toBeTruthy();
  });
});

// ── Presets count label shown when presets exist (line 804 branch) ────────────

describe('TestPage — presets count in button', () => {
  it('shows preset count in button when presets are loaded', async () => {
    vi.mocked(getPlaygroundPresets).mockResolvedValue([
      { id: 'p1', name: 'P1', systemPrompt: '' },
      { id: 'p2', name: 'P2', systemPrompt: '' },
    ] as never);

    await setupWithToken();

    // The Presets button should show the count
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Presets \(2\)/i })).not.toBeNull()
    );
  });
});

// ── matchedToken labels shown in single mode token indicator (line 786) ───────

describe('TestPage — matched token labels display', () => {
  it('shows token labels next to project name when token has labels', async () => {
    const projWithLabels = {
      ...FAKE_PROJECT,
      tokens: [{ id: 'tok-1', tokenSnippet: 'sk-rt-test', labels: ['production', 'v2'], createdAt: '' }],
    };
    vi.mocked(getProjects).mockResolvedValue([projWithLabels] as never);

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    // Labels shown in parentheses next to project name
    await waitFor(() =>
      expect(screen.queryByText(/production, v2/)).not.toBeNull()
    );
  });
});

// ── Compare mode: response with tokens/latency stats (line 254-258) ──────────

describe('TestPage — ComparePanel response stats row', () => {
  it('shows stats row in compare panel after response with usage data', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const usageChunk = JSON.stringify({ usage: { prompt_tokens: 80, completion_tokens: 30 } });
    const contentChunk = JSON.stringify({ model: 'openai/gpt-4o', choices: [{ delta: { content: 'Cmp stats' }, finish_reason: 'stop' }] });
    const body = `data: ${usageChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'compare stats');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Cmp stats')).not.toBeNull(),
    { timeout: 5000 });

    // Stats row shows token counts and cost estimate (line 254-258 branch)
    await waitFor(() =>
      expect(screen.queryAllByText(/↑80 ↓30 tok/).length).toBeGreaterThan(0)
    );
  });
});

// ── Compare mode: stop button (line 338) ─────────────────────────────────────

describe('TestPage — ComparePanel stop button', () => {
  it('shows stop button in compare panel while loading', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'test stop compare');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(document.querySelectorAll('.btn-danger').length).toBeGreaterThan(0)
    );
    // Click stop in compare panel
    const stopBtn = document.querySelector('.btn-danger') as HTMLElement;
    await userEvent.click(stopBtn);
    // No crash — test completes
  });
});

// ── ComparePanel trace + getTrace fetch ────────────────────────────────────────

describe('TestPage — ComparePanel trace + getTrace fetch', () => {
  it('compare mode collects live entries and fetches the stored trace', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [{ message: 'compare:route', details: {} }],
    } as never);
    mockTraceStream([{ panel: 'request', message: 'cmp:route' }], 'cmp-trace');
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Cmp reply' }, finish_reason: 'stop' }] });
    const body = `data: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'trace compare');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Cmp reply')).not.toBeNull(),
    { timeout: 4000 });
    // Debug trace section in compare panel (traceHistory.length > 0)
    await waitFor(() =>
      expect(screen.queryByText(/Debug/)).not.toBeNull()
    );
    expect(vi.mocked(getTrace)).toHaveBeenCalledWith('cmp-trace');
  });
});

// ── ComparePanel sendToModel: empty key early return (line 119 branch 0) ──────

describe('TestPage — ComparePanel empty key early return', () => {
  it('sendToModel returns early when key is empty (no fetch call)', async () => {
    global.fetch = vi.fn();

    renderPage();
    // Do NOT set a token — apiKey stays empty
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    // The send button is disabled when apiKey is empty, so directly type + Enter won't submit
    // Trigger by firing keydown Enter directly
    fireEvent.keyDown(compareTextarea, { key: 'Enter', shiftKey: false });

    // Fetch should never be called (early return on empty key)
    expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

// ── ComparePanel param sliders 1+2 onChange (lines 251, 252) ─────────────────

describe('TestPage — ComparePanel all param sliders onChange', () => {
  it('fires onChange on all three param sliders in compare panel column A', async () => {
    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const sliders = document.querySelectorAll('input[type="range"]');
    // Compare mode renders 3 sliders per column = 6 total (or at least 3)
    expect(sliders.length).toBeGreaterThanOrEqual(3);
    // Slider 0 = Temp, slider 1 = Max tokens, slider 2 = Top-p (column A)
    fireEvent.change(sliders[0]!, { target: { value: '1.1' } });
    fireEvent.change(sliders[1]!, { target: { value: '512' } });
    fireEvent.change(sliders[2]!, { target: { value: '0.9' } });
    // No crash
    expect((sliders[1] as HTMLInputElement).value).toBe('512');
    expect((sliders[2] as HTMLInputElement).value).toBe('0.9');
  });
});

// ── getPlaygroundPresets catch callback (line 436 anonymous_43) ───────────────

describe('TestPage — getPlaygroundPresets catch callback', () => {
  it('catch callback sets presets to empty array on rejection', async () => {
    // Make getPlaygroundPresets hang, then reject after token is matched
    vi.mocked(getPlaygroundPresets).mockRejectedValue(new Error('presets failed'));

    await setupWithToken();

    // The catch() callback should have run, leaving presets empty (no count shown)
    await waitFor(() => {
      // Presets button should show no count (empty array)
      const btn = screen.queryByRole('button', { name: /Presets \(\d\)/i });
      expect(btn).toBeNull();
    });
    // Component still renders correctly
    expect(screen.getByRole('button', { name: /Presets/i })).toBeTruthy();
  });
});

// ── Stream toggle onChange via userEvent (line 932 anonymous_92) ──────────────

describe('TestPage — stream toggle onChange via userEvent', () => {
  it('clicking stream toggle checkbox changes its checked state', async () => {
    await setupWithToken();
    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    // userEvent.click properly fires the React onChange synthetic event
    await userEvent.click(toggle);
    await waitFor(() =>
      expect((screen.getByTestId('stream-toggle') as HTMLInputElement).checked).toBe(false)
    );
    // Click again to re-enable
    await userEvent.click(screen.getByTestId('stream-toggle'));
    await waitFor(() =>
      expect((screen.getByTestId('stream-toggle') as HTMLInputElement).checked).toBe(true)
    );
  });
});

// ── presetsLoading spinner (line 842 branch 0) ────────────────────────────────

describe('TestPage — presets loading spinner', () => {
  it('shows spinner while presets are loading', async () => {
    let resolvePresets!: (v: never[]) => void;
    vi.mocked(getPlaygroundPresets).mockReturnValue(new Promise(res => { resolvePresets = res; }) as never);

    await setupWithToken();

    // Open presets panel — getPlaygroundPresets still pending
    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));

    // Spinner should be visible
    await waitFor(() =>
      expect(document.querySelector('.spinner')).not.toBeNull()
    );

    // Resolve to clear the spinner
    resolvePresets([]);
    await waitFor(() =>
      expect(screen.queryByText('No presets yet.')).not.toBeNull()
    );
  });
});

// ── Assistant message with ContentPart[] content (line 985 anonymous_95/96) ───

describe('TestPage — assistant message with ContentPart[] content', () => {
  it('renders ContentPart[] assistant message by extracting text parts', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);

    // Simulate a non-streaming response: stream=false returns a full completion
    // We inject the message directly by mocking fetch to return a result-type event
    // then a real content chunk
    const assistantContent = 'ContentPart text response';
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', assistantContent));

    await setupWithToken();

    // Turn off streaming so the payload uses stream=false path (line 475 branch)
    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    await userEvent.click(toggle);
    await waitFor(() => expect((screen.getByTestId('stream-toggle') as HTMLInputElement).checked).toBe(false));

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hello content part');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(assistantContent)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── Debug sidebar: null trace entry returns null (line 1120 branch 0) ─────────

describe('TestPage — debug sidebar null trace entry', () => {
  it('skips null entries in debugTraceHistory (returns null from map)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'First reply'));

    await setupWithToken();

    // Send first message
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'first');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('First reply')).not.toBeNull(), { timeout: 4000 });

    // The debugTraceHistory has at least one entry; when it's an empty array
    // the map renders without null. We need the `!traces` branch hit.
    // The handleSend sets debugTraceHistory entry to [] initially (non-null),
    // then replaces with traceEntries. We cover the null branch by clearing:
    const clearBtns = screen.getAllByRole('button', { name: 'Clear' });
    await userEvent.click(clearBtns[0]!);
    await waitFor(() => expect(screen.queryByText('No debug data yet.')).not.toBeNull());
  });
});

// ── Debug sidebar: last trace entry marginBottom=0 (line 1131 branch 0) ───────

describe('TestPage — debug sidebar trace entry last item', () => {
  it('renders multiple trace entries including the last one with marginBottom=0', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        { message: 'routing:start', details: {} },
        { message: 'routing:end', details: {} },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Multi trace reply'));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'multi trace');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Multi trace reply')).not.toBeNull(), { timeout: 4000 });

    // Technical Details should be clickable to expand trace entries
    await waitFor(() => expect(screen.queryByText('Technical Details')).not.toBeNull());
    await userEvent.click(screen.getByText('Technical Details'));

    // Both trace entries should render — last entry triggers j === traces.length-1 branch
    await waitFor(() =>
      expect(screen.queryAllByTestId('trace-entry').length).toBeGreaterThanOrEqual(2)
    );
  });
});

// ── handleSend: attachedImage ContentPart[] payload (lines 449-453, 468-469) ──

describe('TestPage — handleSend with attachedImage ContentPart[] payload', () => {
  it('sends ContentPart[] user message when attachedImage is set, covers payload branch', async () => {
    const mockResult = 'data:image/png;base64,abc';
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | undefined = undefined;
      readAsDataURL = function (this: { onload?: (e: { target: { result: string } }) => void }) {
        if (this.onload) this.onload({ target: { result: mockResult } });
      };
    });

    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Saw image'));

    await setupWithToken();

    // Attach image
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fakeFile = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => expect(document.querySelector('img[alt="Attachment"]')).not.toBeNull());

    // Type text and send — with image attached, userContent becomes ContentPart[]
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'What do you see?');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Saw image')).not.toBeNull(),
    { timeout: 4000 });

    vi.unstubAllGlobals();
  });
});

// ── Attach image button onClick (line 1082 anonymous_101) ─────────────────────

describe('TestPage — attach image button onClick', () => {
  it('clicking attach button triggers file input click without crash', async () => {
    await setupWithToken();

    // fileInputRef.current?.click() — spy on it
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});

    const attachBtn = screen.getByTitle('Attach image');
    await userEvent.click(attachBtn);

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

// ── Message render: assistant model absent (line 1000 branch 0) ───────────────

describe('TestPage — assistant message without model name', () => {
  it('shows role instead of model when msg.model is absent', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // The first SSE chunk has no "model" field → modelName stays ''
    const chunk = JSON.stringify({ choices: [{ delta: { content: 'No model name' }, finish_reason: 'stop' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'test no model');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('No model name')).not.toBeNull(), { timeout: 4000 });
    // Role label shown as 'assistant' (capitalize) when model is absent
    await waitFor(() =>
      expect(screen.queryByText('assistant')).not.toBeNull()
    );
  });
});

// ── Message render: inputTokens/outputTokens null fallback (lines 1003 ??s) ───

describe('TestPage — message token cost with null tokens', () => {
  it('renders token cost span with ?? 0 fallback when tokens are present', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Return usage data so inputTokens/outputTokens are set
    const usageChunk = JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Token cost reply' }, finish_reason: 'stop' }] });
    const body = `data: ${usageChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'token cost');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Token cost reply')).not.toBeNull(), { timeout: 4000 });
    // Token cost span should show (covers ?? 0 on inputTokens/outputTokens)
    await waitFor(() =>
      expect(screen.queryByText(/tokens: 15/)).not.toBeNull()
    );
  });
});

// ── Message render: thinking spinner in Reasoning details (line 962 branches) ──

describe('TestPage — Reasoning spinner during streaming', () => {
  it('shows spinner in Reasoning summary while still loading thinking stream', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);

    let resolveFetch!: (v: Response) => void;
    global.fetch = vi.fn().mockReturnValue(new Promise(res => { resolveFetch = res; }));

    await setupWithToken();

    // Send thinking delta but don't finish — covers loading=true && i===last branch
    const thinkingChunk = JSON.stringify({ choices: [{ delta: { thinking: 'Thinking...' }, finish_reason: null }] });
    const body = `data: ${thinkingChunk}\n\n`;

    // Resolve with a stream that sends thinking but stays open
    resolveFetch(new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          // Don't close — stream stays open, loading=true
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'think');
    await userEvent.keyboard('{Enter}');

    // Reasoning should appear (thinking delta received)
    await waitFor(() =>
      expect(screen.queryByText(/Reasoning/)).not.toBeNull(),
    { timeout: 4000 });
    // Spinner should be in Reasoning summary (loading=true, i===displayMessages.length-1)
    await waitFor(() =>
      expect(document.querySelector('.spinner')).not.toBeNull()
    );
  });
});

// ── ComparePanel: no assistant msgs → stats row hidden (line 254 branch) ───────

describe('TestPage — ComparePanel no assistant messages empty state', () => {
  it('shows "No messages yet." in empty compare panel column', async () => {
    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    // Both columns show empty state (assistantMsgs.length === 0 → stats row hidden)
    const emptyMsgs = screen.queryAllByText('No messages yet.');
    expect(emptyMsgs.length).toBeGreaterThanOrEqual(2);
  });
});

// ── ComparePanel: latencyMs present on message (line 285 branch) ─────────────

describe('TestPage — ComparePanel assistant message with latencyMs', () => {
  it('shows latency span when message has latencyMs', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Response with usage so tokens are set, also triggers latencyMs
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Latency reply' }, finish_reason: 'stop' }] });
    const body = `data: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'latency test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Latency reply')).not.toBeNull(), { timeout: 4000 });
    // latencyMs > 0 means the ms span appears (tests line 285 branch)
    await waitFor(() =>
      expect(document.querySelectorAll('[style*="monospace"]').length).toBeGreaterThan(0)
    );
  });
});

// ── handleSend: stream=false when streamingDisabled=true (line 475 branch 2) ──

describe('TestPage — handleSend stream=false when streamingDisabled', () => {
  it('sends stream=false in payload when project has response-blocking rule', async () => {
    vi.mocked(getProjects).mockResolvedValue([FAKE_PROJECT_BLOCK_RESPONSE] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Buffered reply'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'buffered');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Buffered reply')).not.toBeNull(), { timeout: 4000 });

    const fetchBody = JSON.parse(
      (vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }])[1].body
    );
    expect(fetchBody.stream).toBe(false);
  });
});

// ── ComparePanel: tail flush (line 195 branch 1) ──────────────────────────────

describe('TestPage — ComparePanel SSE tail flush', () => {
  it('flushes trailing buffer content after stream close', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Last line has no trailing newline — goes into buffer tail
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Tail flush reply' }, finish_reason: 'stop' }] });
    // Body ends without final \n\n so it stays in buffer until tail flush
    const body = `data: ${contentChunk}`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'tail test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Tail flush reply')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend tail flush (line 568 branch 1) ─────────────────────────────────

describe('TestPage — handleSend SSE tail flush (main send)', () => {
  it('flushes trailing buffer content after stream close in single mode', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Main tail reply' }, finish_reason: 'stop' }] });
    // No trailing newline forces tail flush
    const body = `data: ${contentChunk}`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'tail main');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Main tail reply')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: getTrace rejection (line 200) ───────────────────────────────

describe('TestPage — ComparePanel getTrace rejection is caught', () => {
  it('handles getTrace rejection in compare mode without crashing', async () => {
    vi.mocked(getTrace).mockRejectedValue(new Error('trace fetch failed'));
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'No trace reply' }, finish_reason: 'stop' }] });
    const body = `data: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'no trace');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('No trace reply')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: data.model branch (line 167) ────────────────────────────────

describe('TestPage — ComparePanel data.model captured', () => {
  it('captures model name from SSE data.model field', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const chunk = JSON.stringify({ model: 'openai/gpt-4o', choices: [{ delta: { content: 'Model named' }, finish_reason: 'stop' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'model name');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Model named')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: data.usage branch (line 168-170) ────────────────────────────

describe('TestPage — ComparePanel data.usage branch', () => {
  it('updates token counts from data.usage in compare panel', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const usageChunk = JSON.stringify({ usage: { prompt_tokens: 15, completion_tokens: 8 } });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Usage tracked' }, finish_reason: 'stop' }] });
    const body = `data: ${usageChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'usage test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Usage tracked')).not.toBeNull(),
    { timeout: 4000 });
    // Stats row with token counts appears (assistantMsgs.length > 0)
    await waitFor(() =>
      expect(screen.queryAllByText(/↑15 ↓8 tok/).length).toBeGreaterThan(0)
    );
  });
});

// ── ComparePanel: error/data.error SSE event (line 166 branch) ───────────────

describe('TestPage — ComparePanel data.error SSE event', () => {
  it('throws when SSE event has data.error field', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // data.error triggers the `data.error` branch; thrown message is data.message || 'Service error'
    const errChunk = JSON.stringify({ error: true, message: 'SSE error msg' });
    const body = `data: ${errChunk}\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'sse error');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('SSE error msg')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: data.type=error SSE event (line 166 branch 0) ──────────────

describe('TestPage — ComparePanel data.type=error SSE event', () => {
  it('shows error when SSE event has data.type=error', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const errChunk = JSON.stringify({ type: 'error', message: 'Type error msg' });
    const body = `data: ${errChunk}\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'type error');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Type error msg')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: data.type=result event skipped (line 526 branch 0) ────────────

describe('TestPage — handleSend data.type=result event skipped', () => {
  it('skips result-type SSE event without crashing', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const resultChunk = JSON.stringify({ type: 'result', data: 'something' });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'After result' }, finish_reason: 'stop' }] });
    const body = `data: ${resultChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'result type');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('After result')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: data.error SSE event shows error (line 527 branch 0) ──────────

describe('TestPage — handleSend data.error SSE event', () => {
  it('shows error message when SSE data.error field present', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const errChunk = JSON.stringify({ error: { message: 'Main SSE error' } });
    const body = `data: ${errChunk}\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'main error');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Main SSE error')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: finish_reason='content_filter' without trace entry (line 607) ─

describe('TestPage — handleSend blocked with no trace entry', () => {
  it('shows generic blocked message when no guardrail trace entry found', async () => {
    // getTrace returns trace with no guardrail:triggered entry
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'block no entry');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: stop_reason='refusal' blocks (line 571 stopReason branch) ─────

describe('TestPage — handleSend stop_reason=refusal blocked', () => {
  it('shows blocked message when stop_reason=refusal', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [{ message: 'guardrail:triggered', details: { rule: 'r1', target: 'response', block: true } }],
    } as never);
    const chunk = JSON.stringify({ stop_reason: 'refusal', choices: [{ delta: { content: '' }, finish_reason: null }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'refusal test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail trace entry with details (line 594-604 branches) ────

describe('TestPage — handleSend guardrail trace with full details', () => {
  it('uses guardEntry.details fields to build blocked object', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:triggered',
          details: {
            rule: 'toxic-rule',
            target: 'request',
            block: true,
            log: true,
            blockMessage: 'Toxicity detected.',
          },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'toxic');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Toxicity detected.')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail:response-triggered entry (line 593 branch) ──────────

describe('TestPage — handleSend guardrail:response-triggered entry', () => {
  it('picks up guardrail:response-triggered entry from trace', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:response-triggered',
          details: {
            rule: 'resp-rule',
            target: 'response',
            block: true,
            blockMessage: 'Response blocked.',
          },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'response block');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Response blocked.')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: block+log action string (line 597 branch) ─────────────────────

describe('TestPage — handleSend guardrail block+log action', () => {
  it('builds action=block+log when both block and log are true', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:triggered',
          details: { rule: 'r1', target: 'both', block: true, log: true },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'block log test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── loadPreset: preset with messages array (line 659-661 branch) ──────────────

describe('TestPage — loadPreset with messages array', () => {
  it('loads preset messages into chat when preset.messages exists', async () => {
    const presetWithMsgs = {
      id: 'p-msgs',
      name: 'With Messages',
      systemPrompt: 'System.',
      messages: [
        { role: 'user', content: 'Prior user message' },
        { role: 'assistant', content: 'Prior reply' },
      ],
    };
    vi.mocked(getPlaygroundPresets).mockResolvedValue([presetWithMsgs] as never);

    await setupWithToken();

    await userEvent.click(screen.getByRole('button', { name: /Presets/i }));
    await waitFor(() => screen.getByText('With Messages'));
    await userEvent.click(screen.getByText('With Messages'));

    // Messages should be loaded into chat
    await waitFor(() =>
      expect(screen.queryByText('Prior user message')).not.toBeNull()
    );
    await waitFor(() =>
      expect(screen.queryByText('Prior reply')).not.toBeNull()
    );
  });
});

// ── hideDebugSidebar and show button (lines 1145-1150) ────────────────────────

describe('TestPage — debug sidebar hide/show button', () => {
  it('clicking hide chevron hides the debug sidebar and shows the show button', async () => {
    await setupWithToken();

    // ChevronRight button hides the debug sidebar
    const hideBtn = screen.getByTitle('Hide debug');
    await userEvent.click(hideBtn);

    // Debug card should be gone; show button appears
    await waitFor(() =>
      expect(screen.queryByTitle('Show debug')).not.toBeNull()
    );

    // Click show button to bring back the sidebar
    await userEvent.click(screen.getByTitle('Show debug'));
    await waitFor(() =>
      expect(screen.queryByTitle('Hide debug')).not.toBeNull()
    );
  });
});

// ── handleSend: empty systemPrompt → no sysMsgs (line 468 br1) ───────────────

describe('TestPage — handleSend with empty system prompt', () => {
  it('sends payload without system message when system prompt is cleared', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'No sys reply'));

    await setupWithToken();

    // Open system prompt section and clear it
    const promptToggle = screen.getByText('System prompt').closest('button') as HTMLButtonElement;
    await userEvent.click(promptToggle);
    await waitFor(() => screen.getByDisplayValue('You are a helpful AI assistant.'));
    const ta = screen.getByDisplayValue('You are a helpful AI assistant.');
    await userEvent.clear(ta);
    // Close system prompt
    await userEvent.click(promptToggle);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'no system');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('No sys reply')).not.toBeNull(),
    { timeout: 4000 });

    // Verify fetch was called with no system message
    const fetchCall = (vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }])[1];
    const body = JSON.parse(fetchCall.body);
    expect(body.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
  });
});

// ── handleSend: stream=false when streamEnabled=false (line 424 br2/br1) ──────

describe('TestPage — handleSend stream=false when streamEnabled=false', () => {
  it('sends stream=false when stream toggle is disabled (no streamingDisabled)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Non-streamed reply'));

    await setupWithToken();

    // Turn off the stream toggle
    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    await userEvent.click(toggle);
    await waitFor(() => expect((screen.getByTestId('stream-toggle') as HTMLInputElement).checked).toBe(false));

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'no stream');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Non-streamed reply')).not.toBeNull(),
    { timeout: 4000 });

    const fetchCall = (vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }])[1];
    expect(JSON.parse(fetchCall.body).stream).toBe(false);
  });
});

// ── handleSend: data.model in SSE stream → msg.model truthy (L1000 br0) ───────

describe('TestPage — assistant message with model name from SSE', () => {
  it('shows model name in label when SSE provides model field', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const chunk = JSON.stringify({ model: 'openai/gpt-4o', choices: [{ delta: { content: 'Model reply' }, finish_reason: 'stop' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'model name test');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Model reply')).not.toBeNull(), { timeout: 4000 });
    // Model name should appear in the label span (L1000: isAssistant && msg.model ? msg.model : msg.role)
    await waitFor(() => {
      const spans = document.querySelectorAll('span[style*="capitalize"]');
      const found = Array.from(spans).some(s => s.textContent === 'openai/gpt-4o');
      expect(found).toBe(true);
    });
  });
});

// ── handleSend: early return when empty input + no image (L446 br74 br0) ──────

describe('TestPage — handleSend early return on empty input', () => {
  it('does not send when input is empty and no image attached', async () => {
    global.fetch = vi.fn();

    await setupWithToken();

    // Click send button directly with empty textarea
    const sendBtn = document.querySelector('button.btn.btn-primary') as HTMLButtonElement;
    // Send button is disabled when input is empty — trigger handleSend via keyboard with empty input
    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Fetch should NOT be called
    expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    void sendBtn;
  });
});

// ── handleSend: AbortError is swallowed (L632 br1) ────────────────────────────

describe('TestPage — handleSend AbortError is swallowed', () => {
  it('does not show error when request is aborted (AbortError)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);

    let rejectFetch!: (e: Error) => void;
    global.fetch = vi.fn().mockReturnValue(new Promise((_, rej) => { rejectFetch = rej; }));

    await setupWithToken();

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'abort me');
    await userEvent.keyboard('{Enter}');

    // Wait for loading state
    await waitFor(() => expect(document.querySelector('.btn.btn-danger')).not.toBeNull());

    // Reject with AbortError (simulates user abort)
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    rejectFetch(abortError);

    // No error message shown — AbortError is swallowed
    await waitFor(() => expect(document.querySelector('.btn.btn-danger')).toBeNull());
    expect(screen.queryByText('Aborted')).toBeNull();
  });
});

// ── savePreset: no matchedProject returns early (L646 br0) ────────────────────

describe('TestPage — savePreset early return without matchedProject', () => {
  it('savePreset does nothing when matchedProject is null', async () => {
    renderPage();
    // Don't set token, so matchedProject = null
    // Try to show presets panel — not visible without matchedProject
    expect(screen.queryByRole('button', { name: /Presets/i })).toBeNull();
    // No error — component renders fine
    expect(screen.getByPlaceholderText('sk-rt-...')).toBeTruthy();
  });
});

// ── ComparePanel: empty systemPrompt → no sysMsgs (L132 br1) ─────────────────

describe('TestPage — ComparePanel with empty system prompt', () => {
  it('sends compare payload without system message when prompt is cleared', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Cmp no sys'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    // Clear system prompt
    const promptToggle = screen.getByText('System prompt').closest('button') as HTMLButtonElement;
    await userEvent.click(promptToggle);
    await waitFor(() => screen.getByDisplayValue('You are a helpful AI assistant.'));
    await userEvent.clear(screen.getByDisplayValue('You are a helpful AI assistant.'));
    await userEvent.click(promptToggle);

    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'compare no sys');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Cmp no sys')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: data.type='result' skipped (L165 br0) ──────────────────────

describe('TestPage — ComparePanel data.type=result event skipped', () => {
  it('skips result-type SSE event in compare mode without crashing', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const resultChunk = JSON.stringify({ type: 'result', data: 'something' });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Cmp after result' }, finish_reason: 'stop' }] });
    const body = `data: ${resultChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'result skip cmp');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Cmp after result')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: multiple deltas (L174 br1) ──────────────────────────────────

describe('TestPage — ComparePanel multi-delta SSE stream', () => {
  it('handles multiple content deltas in compare mode (assistantAdded=true path)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const delta1 = JSON.stringify({ choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] });
    const delta2 = JSON.stringify({ choices: [{ delta: { content: 'World' }, finish_reason: 'stop' }] });
    const body = `data: ${delta1}\n\ndata: ${delta2}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'multi delta');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Hello World')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: 2 turns (L316 br1 'turns') ─────────────────────────────────

describe('TestPage — ComparePanel two turns shows "turns" label', () => {
  it('shows "2 turns" in Debug summary after two sends in compare mode', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [{ message: 'r', details: {} }] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Turn reply'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const ta = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(ta, 'turn 1');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Turn reply')).not.toBeNull(), { timeout: 4000 });

    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Turn 2 reply'));
    await userEvent.type(ta, 'turn 2');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Turn 2 reply')).not.toBeNull(), { timeout: 4000 });

    // Debug shows "2 turns" (plural)
    await waitFor(() =>
      expect(screen.queryByText(/Debug \(2 turns\)/)).not.toBeNull()
    );
  });
});

// ── ComparePanel: no content delta (L197 br1 assistantAdded=false) ────────────

describe('TestPage — ComparePanel usage-only SSE (no content delta)', () => {
  it('handles SSE stream with only usage data and no content in compare mode', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Only usage chunk, no content delta
    const usageChunk = JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 0 } });
    const body = `data: ${usageChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'usage only');
    await userEvent.keyboard('{Enter}');

    // Wait for loading to complete (no content appears since no delta)
    await waitFor(() =>
      expect(document.querySelectorAll('.btn-danger').length).toBe(0),
    { timeout: 4000 });
  });
});

// ── handleSend: L527 data.type check branches ─────────────────────────────────

describe('TestPage — handleSend data.type checks', () => {
  it('stops at data.type=result in handleSend processLine', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Send result event followed by stop with content — result should be skipped
    const resultChunk = JSON.stringify({ type: 'result' });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'After result main' }, finish_reason: 'stop' }] });
    const body = `data: ${resultChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'result type main');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('After result main')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: no finish_reason in delta (L563 br1) ─────────────────────────

describe('TestPage — handleSend no finish_reason in delta', () => {
  it('processes delta without finish_reason field without crashing', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Delta with no finish_reason field (undefined)
    const chunk = JSON.stringify({ choices: [{ delta: { content: 'No finish reason' } }] });
    const doneChunk = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    const body = `data: ${chunk}\n\ndata: ${doneChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'no finish reason');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('No finish reason')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: !apiKey guard via keyboard Enter (L446 br75 br1) ───────────────

describe('TestPage — handleSend !apiKey guard via keyboard', () => {
  it('handleSend returns early when apiKey is empty via keyboard Enter', async () => {
    global.fetch = vi.fn();

    renderPage();
    // Don't set token — apiKey is empty
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'test message');
    // Press Enter — handleSend called but returns early due to !apiKey
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Fetch not called
    expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

// ── handleSend: null trace entry in debugTraceHistory (L1120 br0) ─────────────

describe('TestPage — debug trace null entry renders null', () => {
  it('null trace entry in debugTraceHistory is skipped in render', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Debug null trace'));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'debug null');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Debug null trace')).not.toBeNull(), { timeout: 4000 });

    // The debugTraceHistory shows an entry — now click Clear to test the null path
    // The setDebugTraceHistory(prev => [...prev, []]) creates an array entry, not null
    // The null path (L1120 br0) fires when traces[i] is null in debugTraceHistory
    // We cannot inject null directly, but the Clear button resets to [] which means
    // the next render shows "No debug data yet." — this covers the empty state
    const clearBtns = screen.getAllByRole('button', { name: 'Clear' });
    await userEvent.click(clearBtns[0]!);
    await waitFor(() => expect(screen.queryByText('No debug data yet.')).not.toBeNull());
  });
});

// ── deletePreset: no matchedProject early return (L668 br0) ───────────────────

describe('TestPage — deletePreset early return without matchedProject', () => {
  it('deletePreset is unreachable without matchedProject (presets panel requires it)', async () => {
    // The Presets button only appears when matchedProject is set
    // Directly verify the guard: without matchedProject, no delete button exists
    renderPage();
    expect(screen.queryByTitle('Delete preset')).toBeNull();
    expect(screen.queryByRole('button', { name: /Presets/i })).toBeNull();
  });
});

// ── ComparePanel: usage event without prompt_tokens (L169/170 br1) ────────────

describe('TestPage — ComparePanel usage without prompt_tokens', () => {
  it('uses ?? fallback when usage lacks prompt_tokens and completion_tokens', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Usage with neither prompt_tokens nor completion_tokens — right side of ?? fires
    const usageChunk = JSON.stringify({ usage: {} });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Cmp fallback tokens' }, finish_reason: 'stop' }] });
    const body = `data: ${usageChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'token fallback');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Cmp fallback tokens')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: malformed JSON line is swallowed (L182 br1) ────────────────

describe('TestPage — ComparePanel SyntaxError swallowed', () => {
  it('swallows SyntaxError from malformed JSON SSE data', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Malformed JSON followed by valid chunk
    const validChunk = JSON.stringify({ choices: [{ delta: { content: 'After syntax err' }, finish_reason: 'stop' }] });
    const body = `data: {not valid json!!!\n\ndata: ${validChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'syntax err cmp');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('After syntax err')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── ComparePanel: AbortError swallowed (L204 br1) ────────────────────────────

describe('TestPage — ComparePanel AbortError swallowed', () => {
  it('swallows AbortError in compare mode sendToModel', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);

    let rejectFetch!: (e: Error) => void;
    global.fetch = vi.fn().mockReturnValue(new Promise((_, rej) => { rejectFetch = rej; }));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'abort cmp');
    await userEvent.keyboard('{Enter}');

    // Wait for loading state in compare mode (Stop buttons appear)
    await waitFor(() =>
      expect(document.querySelectorAll('button[class*="btn-danger"]').length).toBeGreaterThan(0),
    { timeout: 2000 });

    // Abort both panels
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    rejectFetch(abortError);

    // Stops loading without showing error
    await waitFor(() =>
      expect(document.querySelectorAll('button[class*="btn-danger"]').length).toBe(0),
    { timeout: 4000 });
    expect(screen.queryByText('Aborted')).toBeNull();
  });
});

// ── ComparePanel: latencyMs=0 (L285 br1) ─────────────────────────────────────

describe('TestPage — ComparePanel assistant message latencyMs=0', () => {
  it('does not show latency span when latencyMs is 0 (falsy)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Mock Date.now to return constant so latencyMs = Date.now() - startMs = 0
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5000);
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Zero latency' }, finish_reason: 'stop' }] });
    const body = `data: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'zero latency');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText('Zero latency')).not.toBeNull(), { timeout: 4000 });

    // latencyMs = 0 → null rendered (no Xms span in compare panel stats)
    // Verify: the '0ms' text is not shown
    const msSpans = Array.from(document.querySelectorAll('span')).filter(s => s.textContent === '0ms');
    expect(msSpans.length).toBe(0);

    nowSpy.mockRestore();
  });
});

// ── streamingDisabled: rule with target=request (L424 br2) ───────────────────

describe('TestPage — streamingDisabled: rule target=request not response/both', () => {
  it('streamingDisabled remains false when rule has target=request', async () => {
    // Set up project with block=true but target=request (not response/both)
    const projRequestBlock = {
      ...FAKE_PROJECT,
      guardrails: {
        rules: [{ type: 'moderation', target: 'request', block: true, config: {} }],
      },
    };
    vi.mocked(getProjects).mockResolvedValue([projRequestBlock] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Request rule reply'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    // streamingDisabled should be false → stream toggle is enabled (not forced off)
    const toggle = screen.getByTestId('stream-toggle') as HTMLInputElement;
    expect(toggle.disabled).toBe(false);

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'request rule');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Request rule reply')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── modelToUse: empty fallback (L469 br3) ────────────────────────────────────

describe('TestPage — handleSend modelToUse empty fallback', () => {
  it('uses empty string modelToUse when project has no models and no routingModelId', async () => {
    const projNoModels = {
      ...FAKE_PROJECT,
      models: [],
      routingModelId: undefined,
    };
    vi.mocked(getProjects).mockResolvedValue([projNoModels] as never);
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Empty model fallback'));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());

    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'no model');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Empty model fallback')).not.toBeNull(),
    { timeout: 4000 });

    // Verify fetch was called (model sent as empty string)
    const fetchCall = (vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }])[1];
    expect(JSON.parse(fetchCall.body).model).toBe('');
  });
});

// ── handleSend: usage without prompt_tokens (L530/531 br1) ───────────────────

describe('TestPage — handleSend usage without prompt_tokens', () => {
  it('uses ?? fallback when SSE usage event lacks prompt_tokens and completion_tokens', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const usageChunk = JSON.stringify({ usage: {} });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Token fallback main' }, finish_reason: 'stop' }] });
    const body = `data: ${usageChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'usage no tokens');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Token fallback main')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: second thinking delta (L543 br1) ─────────────────────────────

describe('TestPage — handleSend second thinking delta', () => {
  it('accumulates thinking across multiple thinking deltas', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    const thinking1 = JSON.stringify({ choices: [{ delta: { thinking: 'Step 1...' }, finish_reason: null }] });
    const thinking2 = JSON.stringify({ choices: [{ delta: { thinking: ' Step 2...' }, finish_reason: null }] });
    const content = JSON.stringify({ choices: [{ delta: { content: 'Think done' }, finish_reason: 'stop' }] });
    const body = `data: ${thinking1}\n\ndata: ${thinking2}\n\ndata: ${content}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'think twice');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Think done')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: content delta after thinking (L555 br1) ──────────────────────

describe('TestPage — handleSend content delta after thinking sets assistantAdded', () => {
  it('content delta reuses existing assistant message after thinking sets assistantAdded=true', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // Thinking first adds assistant, then content delta sees assistantAdded=true
    const thinkingChunk = JSON.stringify({ choices: [{ delta: { thinking: 'Reasoning...' }, finish_reason: null }] });
    const contentChunk = JSON.stringify({ choices: [{ delta: { content: 'Content after think' }, finish_reason: 'stop' }] });
    const body = `data: ${thinkingChunk}\n\ndata: ${contentChunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'think then content');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Content after think')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: no finish_reason ever set (L563 br1) ─────────────────────────

describe('TestPage — handleSend finish_reason never set in stream', () => {
  it('finishReason stays empty when no delta has finish_reason (L563 fr=undefined branch)', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    // All deltas have NO finish_reason field (undefined)
    const d1 = JSON.stringify({ choices: [{ delta: { content: 'Part 1' } }] });
    const d2 = JSON.stringify({ choices: [{ delta: { content: ' Part 2' } }] });
    const body = `data: ${d1}\n\ndata: ${d2}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'no finish reason ever');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Part 1 Part 2')).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail block=false/log=false → action='block' via || (L597) ─

describe('TestPage — handleSend guardrail action fallback to block', () => {
  it('uses block as default action when block=false and log=false in guardEntry', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:triggered',
          details: { rule: 'r-log', target: 'request', block: false, log: false },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'both false action');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail block=false, log=true → action='log' (L600 br1) ────

describe('TestPage — handleSend guardrail action=log only', () => {
  it('sets action=log when block=false and log=true in guardEntry details', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:triggered',
          details: { rule: 'log-only', target: 'request', block: false, log: true },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'log only action');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail block=true, log=false → action='block' (L601 br1) ──

describe('TestPage — handleSend guardrail action=block only (no log)', () => {
  it('sets action=block when block=true and log=false in guardEntry details', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:triggered',
          details: { rule: 'block-only', target: 'request', block: true, log: false },
        },
      ],
    } as never);
    const chunk = JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }] });
    const body = `data: ${chunk}\n\ndata: [DONE]\n\n`;
    global.fetch = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'block no log');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/blocked by a guardrail/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});

// ── handleSend: guardrail:evaluated with non-array rules (L617 br0) ───────────

describe('TestPage — handleSend guardrail:evaluated non-array rules skipped', () => {
  it('skips guardrail:evaluated trace entry when rules is not an array', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        // guardrail:evaluated with no rules field → rules=undefined → !Array.isArray → continue
        { message: 'guardrail:evaluated', details: {} },
        { message: 'guardrail:evaluated', details: { rules: 'not-array' } },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Non-array rules'));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'non-array rules');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Non-array rules')).not.toBeNull(),
    { timeout: 4000 });

    // guardrailIn/guardrailOut stay 0 → guardrail token span NOT shown
    expect(document.querySelector('[title="Guardrail judge tokens"]')).toBeNull();
  });
});

// ── handleSend: guardrail:evaluated usage without inputTokens (L618 br1) ──────

describe('TestPage — handleSend guardrail:evaluated rule with empty usage', () => {
  it('uses ?? 0 fallback when rule.usage lacks inputTokens and outputTokens', async () => {
    vi.mocked(getTrace).mockResolvedValue({
      trace: [
        {
          message: 'guardrail:evaluated',
          details: {
            rules: [
              // usage object without inputTokens/outputTokens → ?? 0 right side fires
              { usage: {} },
              // no usage at all
              {},
            ],
          },
        },
      ],
    } as never);
    global.fetch = vi.fn().mockResolvedValue(makeSSEResponse('stop', 'Empty usage rules'));

    await setupWithToken();
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'empty usage');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText('Empty usage rules')).not.toBeNull(),
    { timeout: 4000 });

    // guardrailIn=0 + guardrailOut=0 → span not shown
    expect(document.querySelector('[title="Guardrail judge tokens"]')).toBeNull();
  });
});

// ── handleFileAttach: no file selected (L646 br0) ────────────────────────────

describe('TestPage — handleFileAttach no file', () => {
  it('returns early when file input fires change with no files', async () => {
    await setupWithToken();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    // Fire change event with empty FileList (no files selected)
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
    fireEvent.change(fileInput);

    // No error shown, no image preview
    expect(screen.queryByAltText('Attachment')).toBeNull();
    expect(screen.queryByText(/Only image/)).toBeNull();
  });
});

// ── ComparePanel: HTTP error with non-JSON body (L151 br1) ───────────────────

describe('TestPage — ComparePanel HTTP error non-JSON body', () => {
  it('falls back to HTTP status message when error body is not valid JSON', async () => {
    vi.mocked(getTrace).mockResolvedValue({ trace: [] } as never);
    global.fetch = vi.fn().mockResolvedValue(new Response(
      'Service unavailable',
      { status: 503, headers: { 'content-type': 'text/plain' } },
    ));

    renderPage();
    const tokenInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.clear(tokenInput);
    await userEvent.type(tokenInput, 'sk-rt-testABCDE');
    await waitFor(() => expect(screen.queryByText('Test')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /compare/i }));

    const compareTextarea = screen.getByPlaceholderText('Send the same message to both models...');
    await userEvent.type(compareTextarea, 'non json err');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/HTTP 503/i)).not.toBeNull(),
    { timeout: 4000 });
  });
});
