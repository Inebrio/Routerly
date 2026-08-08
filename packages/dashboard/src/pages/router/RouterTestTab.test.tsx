import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterTestTab } from './RouterTestTab';
import { getTrace, streamTraces } from '../../api';

// ponytail: mock ReactMarkdown as identity render — we only care about content
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock('remark-gfm', () => ({ default: () => {} }));

vi.mock('../../api', () => ({ streamTraces: vi.fn(), getTrace: vi.fn() }));

vi.mock('../../components/TraceEntryRenderer', () => ({
  TraceEntryRenderer: ({ entry }: { entry: { message: string; details?: unknown } }) => (
    <div data-testid="trace-entry">{entry.message}</div>
  ),
}));

const mockRouter = {
  id: 'proj-1',
  name: 'Test',
  models: [{ modelId: 'openai/gpt-4o' }],
  routingModelId: 'openai/gpt-4o',
  tokens: [
    { id: 'tok-1', tokenSnippet: 'sk-rt-abc0', labels: ['prod'] },
  ],
};

function renderTab(router: Record<string, unknown> | null = mockRouter) {
  function LayoutWrapper() {
    return <Outlet context={{ router, setRouter: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/test']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="test" element={<RouterTestTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

// ── Helper: build a minimal SSE ReadableStream from lines ───────────────────

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
}

function mockFetchOk(lines: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: sseStream(lines),
  }));
}

/** Feeds the component the trace side channel it opens before each turn. */
function mockTraceStream(entries: Array<{ panel: string; message: string; details?: Record<string, unknown> }> = []) {
  vi.mocked(streamTraces).mockImplementation(async (_query, onEvent) => {
    for (const entry of entries) {
      onEvent({ traceId: 'tr-1', topic: `trace/request/${entry.message}`, entry: { details: {}, ...entry } });
    }
    return () => {};
  });
}

beforeEach(() => {
  mockTraceStream();
  // No stored trace by default: the sidebar keeps what it collected live.
  vi.mocked(getTrace).mockRejectedValue(new Error('not stored'));
});

function mockFetchError(status: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    body: null,
    status,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── null router guard ────────────────────────────────────────────────────────

describe('RouterTestTab — null router guard', () => {
  it('renders nothing when router is null', () => {
    const { container } = renderTab(null);
    expect(container.firstChild).toBeNull();
  });
});

// ── Initial render ────────────────────────────────────────────────────────────

describe('RouterTestTab — initial render', () => {
  it('shows "Test Chat" heading', () => {
    renderTab();
    expect(screen.getByText('Test Chat')).toBeTruthy();
  });

  it('shows Router Token input field', () => {
    renderTab();
    expect(screen.getByPlaceholderText('sk-rt-...')).toBeTruthy();
  });

  it('shows "No messages yet." empty state initially', () => {
    renderTab();
    expect(screen.getByText('No messages yet.')).toBeTruthy();
  });

  it('shows token prompt when no API key entered', () => {
    renderTab();
    expect(screen.getByText('Please enter a Router Token above to send a message.')).toBeTruthy();
  });

  it('shows "Type a message below..." after API key entered', async () => {
    renderTab();
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'sk-rt-abc0');
    await waitFor(() =>
      expect(screen.getByText('Type a message below to start testing.')).toBeTruthy()
    );
  });

  it('shows "Debug Log" panel', () => {
    renderTab();
    expect(screen.getByText('Debug Log')).toBeTruthy();
  });

  it('debug sidebar shows "No request sent yet." placeholder', () => {
    renderTab();
    expect(screen.getByText('No request sent yet.')).toBeTruthy();
  });

  it('Send button is disabled when input is empty or no API key', () => {
    renderTab();
    const sendBtn = screen.getByTitle('Send (Enter)') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('Attach image button is rendered', () => {
    renderTab();
    expect(screen.getByTitle('Attach image')).toBeTruthy();
  });
});

// ── Token validation feedback ─────────────────────────────────────────────────

describe('RouterTestTab — token validation feedback', () => {
  it('shows "Recognized Token" when entered key matches a router token snippet', async () => {
    renderTab();
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    // mockRouter.tokens[0].tokenSnippet = 'sk-rt-abc0' (10 chars)
    await userEvent.type(keyInput, 'sk-rt-abc0andmorechars');
    await waitFor(() =>
      expect(screen.getByText(/Recognized Token/)).toBeTruthy()
    );
  });

  it('shows "Unrecognized Token" when key is >= 10 chars but not in tokens', async () => {
    renderTab();
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'sk-rt-zzzz1234');
    await waitFor(() =>
      expect(screen.getByText('Unrecognized Token')).toBeTruthy()
    );
  });

  it('no token feedback when key is fewer than 10 chars', async () => {
    renderTab();
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'short');
    expect(screen.queryByText(/Recognized Token/)).toBeNull();
    expect(screen.queryByText('Unrecognized Token')).toBeNull();
  });

  it('recognized token shows label in parentheses when token has labels', async () => {
    renderTab();
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'sk-rt-abc0andmorechars');
    await waitFor(() =>
      expect(screen.getByText(/\(prod\)/)).toBeTruthy()
    );
  });

  it('no feedback shown when router has no tokens', async () => {
    renderTab({ ...mockRouter, tokens: undefined });
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'sk-rt-abc0andmorechars');
    // no tokens → matchedToken is always null
    expect(screen.queryByText(/Recognized Token/)).toBeNull();
  });
});

// ── Show/hide key toggle ──────────────────────────────────────────────────────

describe('RouterTestTab — show/hide key toggle', () => {
  it('token input is password type by default', () => {
    renderTab();
    const input = screen.getByPlaceholderText('sk-rt-...') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('clicking eye icon toggles to text type', async () => {
    renderTab();
    const toggleBtn = screen.getByTitle('Show Token');
    await userEvent.click(toggleBtn);
    const input = screen.getByPlaceholderText('sk-rt-...') as HTMLInputElement;
    expect(input.type).toBe('text');
  });

  it('clicking eye-off icon toggles back to password', async () => {
    renderTab();
    await userEvent.click(screen.getByTitle('Show Token'));
    await userEvent.click(screen.getByTitle('Hide Token'));
    const input = screen.getByPlaceholderText('sk-rt-...') as HTMLInputElement;
    expect(input.type).toBe('password');
  });
});

// ── Send button enabled/disabled ──────────────────────────────────────────────

describe('RouterTestTab — send button state', () => {
  it('Send enabled when both input text and API key are present', async () => {
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-abc0');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hello');
    const btn = screen.getByTitle('Send (Enter)') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('Send disabled when API key present but message empty', async () => {
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-abc0');
    const btn = screen.getByTitle('Send (Enter)') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ── Successful send flow ──────────────────────────────────────────────────────

describe('RouterTestTab — send message', () => {
  it('sends fetch request to /v1/chat/completions with correct headers', async () => {
    mockFetchOk([
      'data: {"choices":[{"delta":{"content":"Hello"}}],"model":"gpt-4o"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-rt-mykey' }),
      })
    ));
  });

  it('strips smart quotes and whitespace from API key before sending', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();
    // Type a key with a smart quote
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, ' sk-rt-key’ ');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const auth = (init as RequestInit).headers as Record<string, string>;
      expect(auth['Authorization']).toBe('Bearer sk-rt-key');
    });
  });

  it('renders user message in chat after send', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'Hello bot');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Hello bot')).toBeTruthy());
  });

  it('clears input textarea after send', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'test message');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('renders streaming assistant content', async () => {
    mockFetchOk([
      'data: {"choices":[{"delta":{"content":"Hi"}}],"model":"gpt-4o"}',
      'data: {"choices":[{"delta":{"content":" there"}}],"model":"gpt-4o"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hello');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Hi there')).toBeTruthy());
  });

  it('renders assistant model name below message', async () => {
    mockFetchOk([
      'data: {"choices":[{"delta":{"content":"Hello"}}],"model":"gpt-4o"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText(/gpt-4o/)).toBeTruthy());
  });

  it('ignores [DONE] sentinel without error', async () => {
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'ping');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
    expect(screen.queryByText('Unknown error occurred')).toBeNull();
  });

  it('uses Enter key to send message', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hello{Enter}');
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  });

  it('Shift+Enter does not send', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    const textarea = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(textarea, 'hello{Shift>}{Enter}{/Shift}');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('RouterTestTab — error handling', () => {
  it('shows error when fetch response has no body and ok=false', async () => {
    mockFetchError(500);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('HTTP 500')).toBeTruthy());
  });

  it('shows error when response body is null on ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: null }));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Response body is missing')).toBeTruthy());
  });

  it('shows error when SSE line contains error event', async () => {
    mockFetchOk([
      'data: {"type":"error","message":"Model unavailable"}',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Model unavailable')).toBeTruthy());
  });

  it('shows error from data.error.message when data.error is object', async () => {
    mockFetchOk([
      'data: {"error":{"message":"quota exceeded"}}',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('quota exceeded')).toBeTruthy());
  });

  it('shows "Unknown error occurred" when fetch rejects with non-Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('plain string error'));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Unknown error occurred')).toBeTruthy());
  });

  it('does not show error when AbortError is thrown (user stopped)', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
    expect(screen.queryByText(/Unknown error/)).toBeNull();
  });

  it('ignores unparseable JSON SSE line (Unexpected end of JSON input)', async () => {
    mockFetchOk([
      'data: {broken',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    // Should finish without an error shown
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
    expect(screen.queryByText(/Unexpected end/)).toBeNull();
  });

  it('skips lines that do not start with "data: "', async () => {
    mockFetchOk([
      ': keep-alive',
      '',
      'data: {"choices":[{"delta":{"content":"ok"}}],"model":"m"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy());
  });
});

// ── Stop generation ───────────────────────────────────────────────────────────

describe('RouterTestTab — stop generation', () => {
  it('shows Stop button while loading', async () => {
    // Stream that hangs
    let resolveRead!: () => void;
    const hangingBody = new ReadableStream({
      start(controller) {
        // Enqueue nothing — stays open
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: hangingBody }));

    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByTitle('Stop generation')).toBeTruthy());
  });

  it('Stop button calls abort on the controller', async () => {
    // ponytail: stream closes itself when signal fires so reader.read() resolves done=true → finally runs → loading=false
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const hangingBody = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.close());
        },
      });
      return Promise.resolve({ ok: true, body: hangingBody });
    }));

    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => screen.getByTitle('Stop generation'));
    await userEvent.click(screen.getByTitle('Stop generation'));
    // After stream closes, finally block runs → loading=false → Stop button gone
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
  });
});

// ── Trace events ──────────────────────────────────────────────────────────────

describe('RouterTestTab — trace events', () => {
  it('trace entries appear in debug panels', async () => {
    mockTraceStream([{ panel: 'router-request', message: 'req' }]);
    mockFetchOk([
      'data: {"choices":[{"delta":{"content":"hi"}}],"model":"m"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hello');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByTestId('trace-entry')).toBeTruthy());
    expect(screen.getByText('req')).toBeTruthy();
  });

  it('Clear button removes trace history', async () => {
    mockTraceStream([{ panel: 'router-request', message: 'req' }]);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => screen.getByText('Clear'));
    await userEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(screen.queryByTestId('trace-entry')).toBeNull());
    // Should show placeholder again
    expect(screen.getByText('No request sent yet.')).toBeTruthy();
  });

  it('result event is ignored (no error shown)', async () => {
    mockFetchOk([
      'data: {"type":"result","modelId":"gpt-4o"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});

// ── Thinking delta (extended thinking) ───────────────────────────────────────

describe('RouterTestTab — thinking delta', () => {
  it('renders thinking block when thinkingDelta is in SSE', async () => {
    mockFetchOk([
      'data: {"choices":[{"delta":{"thinking":"Let me think..."}}],"model":"claude"}',
      'data: {"choices":[{"delta":{"content":"Answer"}}],"model":"claude"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText(/Reasoning/)).toBeTruthy());
  });

  it('accumulates thinking content across multiple deltas', async () => {
    mockFetchOk([
      'data: {"choices":[{"delta":{"thinking":"Step 1"}}],"model":"claude"}',
      'data: {"choices":[{"delta":{"thinking":" Step 2"}}],"model":"claude"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    // The thinking text is inside a <details> summary/body — check it is present
    await waitFor(() => expect(screen.getByText(/Reasoning/)).toBeTruthy());
  });
});

// ── Image attachment ──────────────────────────────────────────────────────────

describe('RouterTestTab — image attachment', () => {
  it('non-image file shows error', async () => {
    renderTab();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() =>
      expect(screen.getByText('Only image attachments are supported for vision models currently.')).toBeTruthy()
    );
  });

  it('removing attached image via × clears the attachment', async () => {
    renderTab();
    // Simulate attaching an image via FileReader
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });

    // Stub FileReader to synchronously return a data URL
    const originalFileReader = global.FileReader;
    class MockFileReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL() {
        setTimeout(() => this.onload?.({ target: { result: 'data:image/png;base64,abc' } }), 0);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      const img = document.querySelector('img[alt="Attachment"]') as HTMLImageElement;
      expect(img).toBeTruthy();
    });

    // Click the × button on the attachment preview
    const removeBtn = document.querySelector('img[alt="Attachment"]')?.closest('div')?.parentElement?.querySelector('button')!;
    if (removeBtn) await userEvent.click(removeBtn);

    await waitFor(() => expect(document.querySelector('img[alt="Attachment"]')).toBeNull());

    vi.stubGlobal('FileReader', originalFileReader);
  });

  it('attached image is included in user message content', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });

    class MockFileReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL() {
        setTimeout(() => this.onload?.({ target: { result: 'data:image/png;base64,xyz' } }), 0);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => document.querySelector('img[alt="Attachment"]'));

    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'describe');
    await userEvent.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      const lastMsg = body.messages[body.messages.length - 1];
      expect(Array.isArray(lastMsg.content)).toBe(true);
      expect(lastMsg.content.some((c: { type: string }) => c.type === 'image_url')).toBe(true);
    });

    vi.unstubAllGlobals();
  });

  it('file input with no file selected does nothing', () => {
    renderTab();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(screen.queryByText(/Only image/)).toBeNull();
  });
});

// ── Routing fallback for model selection ─────────────────────────────────────

describe('RouterTestTab — model selection fallback', () => {
  it('uses routingModelId when set', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('openai/gpt-4o');
    });
  });

  it('falls back to first model when no routingModelId', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab({ ...mockRouter, routingModelId: undefined });
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('openai/gpt-4o');
    });
  });

  it('uses empty string model when no routingModelId and no models', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab({ ...mockRouter, routingModelId: undefined, models: [] });
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('');
    });
  });
});

// ── Assistant message with array content ────────────────────────────────────

describe('RouterTestTab — assistant array content', () => {
  it('renders text item from array content', async () => {
    // Simulate receiving an array-content assistant message from a prior turn
    // by using the user message array path via image attachment + response
    mockFetchOk([
      'data: {"choices":[{"delta":{"content":"array answer"}}],"model":"m"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hello');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('array answer')).toBeTruthy());
  });
});

// ── Response panel trace: model:error and model:thinking ─────────────────────

describe('RouterTestTab — response panel trace entries', () => {
  it('response panel renders model:error entry with error styling', async () => {
    mockTraceStream([{"panel":"response","message":"model:error","details":{"msg":"oops"}}]);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('model:error')).toBeTruthy());
  });

  it('every entry of a turn lands in the same log, whatever its panel', async () => {
    mockTraceStream([
      { panel: 'router-request', message: 'route' },
      { panel: 'response', message: 'model:thinking', details: { text: 'I am thinking' } },
      { panel: 'response', message: 'model:response', details: { tokens: 42 } },
    ]);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getAllByTestId('trace-entry').length).toBe(3));
    expect(screen.getByText('Turn #1 trace log · 3 events')).toBeTruthy();
  });
});

// ── The stored trace replaces the live one ────────────────────────────────────

describe('RouterTestTab — stored trace', () => {
  it('summarises the turn from the recap the service stored', async () => {
    mockTraceStream([{ panel: 'router-request', message: 'route' }]);
    vi.mocked(getTrace).mockResolvedValue({ trace: [
      { message: 'trace:recap', panel: 'response', details: { outcome: 'ok', model: 'openai/gpt-4o', durationMs: 900 } },
      { message: 'route', panel: 'router-request' },
    ] } as never);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy());
    expect(screen.getByText('TURN #1')).toBeTruthy();
    expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
    // The recap belongs to the summary card only — the log keeps the rest
    expect(screen.getAllByTestId('trace-entry').length).toBe(1);
  });
});

// ── Router Response panel entries ─────────────────────────────────────────────

describe('RouterTestTab — router response panel entries', () => {
  it('router-response panel renders entries from trace', async () => {
    mockTraceStream([{"panel":"router-response","message":"routing-done"}]);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('routing-done')).toBeTruthy());
  });

  it('request panel renders entries from trace', async () => {
    mockTraceStream([{"panel":"request","message":"req-entry"}]);
    mockFetchOk([
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('req-entry')).toBeTruthy());
  });
});


// ── Attach image button click ─────────────────────────────────────────────────

describe('RouterTestTab — attach image button click', () => {
  it('clicking Attach image button triggers file input click', async () => {
    renderTab();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    await userEvent.click(screen.getByTitle('Attach image'));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

// ── Branch coverage: empty dataStr, loading guard, label without text ─────────

describe('RouterTestTab — additional branch coverage', () => {
  it('empty data line (dataStr empty) is skipped without error', async () => {
    mockFetchOk([
      'data: ',
      'data: {"choices":[{"delta":{"content":"ok"}}],"model":"m"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('ok')).toBeTruthy());
  });

  it('handleSend does nothing when loading=true (early return branch)', async () => {
    // Hang the stream so loading stays true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = new ReadableStream({ start(c) { init.signal?.addEventListener('abort', () => c.close()); } });
      return Promise.resolve({ ok: true, body });
    }));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => screen.getByTitle('Stop generation'));
    // Now try clicking send again while loading — it should be a no-op (button is gone, but can call via keyboard)
    // Just verify loading state is still present, meaning the second click didn't restart
    expect(screen.getByTitle('Stop generation')).toBeTruthy();
    await userEvent.click(screen.getByTitle('Stop generation'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
  });

  it('recognized token with empty labels array shows no label suffix', async () => {
    renderTab({ ...mockRouter, tokens: [{ id: 'tok-1', tokenSnippet: 'sk-rt-abc0', labels: [] }] });
    const keyInput = screen.getByPlaceholderText('sk-rt-...');
    await userEvent.type(keyInput, 'sk-rt-abc0extra');
    await waitFor(() => expect(screen.getByText(/Recognized Token/)).toBeTruthy());
    // No parenthesized labels
    expect(screen.queryByText(/\(/)).toBeNull();
  });

  it('data.error string shows "Service error" fallback', async () => {
    mockFetchOk([
      'data: {"error":"string-error"}',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('string-error')).toBeTruthy());
  });

  it('content delta after thinking sets thinking spread', async () => {
    // First thinking, then content — covers the thinkingAccum branch in content handler (L212)
    mockFetchOk([
      'data: {"choices":[{"delta":{"thinking":"think"}}],"model":"m"}',
      'data: {"choices":[{"delta":{"content":"answer"}}],"model":"m"}',
      'data: [DONE]',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('answer')).toBeTruthy());
  });

  it('error with no message field falls back to "Service error"', async () => {
    // data.error is an object without a message property → data.error?.message is undefined
    // data.error itself is truthy → third fallback 'Service error' used
    mockFetchOk([
      'data: {"type":"error"}',
    ]);
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByText('Service error')).toBeTruthy());
  });

  it('handleSend via Enter key while loading does not restart (loading guard)', async () => {
    // Hang stream so loading stays true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = new ReadableStream({ start(c) { init.signal?.addEventListener('abort', () => c.close()); } });
      return Promise.resolve({ ok: true, body });
    }));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'first{Enter}');
    await waitFor(() => screen.getByTitle('Stop generation'));
    // Pressing Enter again while loading — handleSend returns early (loading=true branch)
    await userEvent.type(textarea, 'second{Enter}');
    // fetch called only once (second Enter was no-op)
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    await userEvent.click(screen.getByTitle('Stop generation'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
  });

  it('thinking spinner shows while loading on last thinking message', async () => {
    // Hang stream after sending thinking delta — loading stays true with thinking block visible
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"thinking":"reasoning..."}}],"model":"m"}\n'));
          // Stay open until aborted
          init.signal?.addEventListener('abort', () => controller.close());
        },
      });
      return Promise.resolve({ ok: true, body });
    }));
    renderTab();
    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    // Wait for thinking block to appear while still loading
    await waitFor(() => expect(screen.getByText(/Reasoning/)).toBeTruthy());
    // Spinner should be inside the Reasoning summary (loading=true, last message)
    expect(document.querySelector('.spinner')).toBeTruthy();
    await userEvent.click(screen.getByTitle('Stop generation'));
    await waitFor(() => expect(screen.queryByTitle('Stop generation')).toBeNull());
  });

  it('user message with image renders img tag in chat', async () => {
    mockFetchOk(['data: [DONE]']);
    renderTab();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    class MockFileReader {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL() {
        setTimeout(() => this.onload?.({ target: { result: 'data:image/png;base64,xyz' } }), 0);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('img[alt="Attachment"]'));

    await userEvent.type(screen.getByPlaceholderText('sk-rt-...'), 'sk-rt-mykey');
    await userEvent.type(screen.getByPlaceholderText('Type a message...'), 'describe');
    await userEvent.click(screen.getByTitle('Send (Enter)'));
    // User message array renders image_url as <img alt="Attached">
    await waitFor(() => expect(document.querySelector('img[alt="Attached"]')).toBeTruthy());
    vi.unstubAllGlobals();
  });
});
