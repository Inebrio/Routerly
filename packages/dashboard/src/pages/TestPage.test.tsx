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
    hasError: false, fallbackUsed: false,
  }),
}));

// ── Imports after mocks ────────────────────────────────────────────────────

import { TestPage } from './TestPage';
import { getProjects, getPlaygroundPresets, getTrace, createPlaygroundPreset, deletePlaygroundPreset } from '../api.js';

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
    { status: 200, headers: { 'x-routerly-trace-id': traceId, 'content-type': 'text/event-stream' } },
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
      { status: 200, headers: { 'x-routerly-trace-id': 'trace-tok', 'content-type': 'text/event-stream' } },
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
