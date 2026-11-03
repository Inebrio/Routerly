import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OtelIntegration, TraceEntry, WebhookIntegration } from '@routerly/shared';

const { mockFetch, mockReadConfig } = vi.hoisted(() => ({ mockFetch: vi.fn(), mockReadConfig: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);
vi.mock('../config/loader.js', () => ({ readConfig: mockReadConfig }));

import { exportTrace, pushOtelTrace, pushWebhookTrace, resetTraceExportCache } from './traces-export.js';

const otel: OtelIntegration = {
  id: 'o1', type: 'otel', enabled: true,
  endpoint: 'http://collector.local:4318', protocol: 'http',
  headers: { 'X-Env': 'test' },
  traces: { enabled: true },
};

const webhook: WebhookIntegration = {
  id: 'w1', type: 'webhook', enabled: true,
  url: 'http://hook.local/traces', secret: 'shh',
  traces: { enabled: true },
};

const entry = (over: Partial<TraceEntry>): TraceEntry => ({
  panel: 'router-request', message: 'router:intake', details: {}, ...over,
});

const trace = {
  traceId: '3f7b1c2d-4e5a-6b7c-8d9e-0f1a2b3c4d5e',
  routerId: 'proj-1',
  entries: [
    entry({ message: 'pii:scrubbed', phase: 'request.preprocess', module: 'pii', at: 1_000, details: { hits: 2 } }),
    entry({ message: 'router:selected', phase: 'routing.execute', module: 'router', at: 1_040, panel: 'router-response' }),
    entry({ message: 'model:success', phase: 'routing.execute', module: 'model', at: 1_300, panel: 'response' }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetTraceExportCache();
  mockFetch.mockResolvedValue({ ok: true });
});

afterEach(() => resetTraceExportCache());

describe('pushOtelTrace', () => {
  it('POSTs OTLP spans: one root, one per phase, entries as span events', async () => {
    await pushOtelTrace(otel, trace);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://collector.local:4318/v1/traces');
    expect((opts.headers as Record<string, string>)['X-Env']).toBe('test');

    const body = JSON.parse(opts.body as string) as {
      resourceSpans: [{ scopeSpans: [{ spans: Array<Record<string, unknown>> }] }];
    };
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(3); // root + 2 phases

    const [root, preprocess, execute] = spans as [
      Record<string, string>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(root['name']).toBe('routerly.request');
    expect(root['traceId']).toBe('3f7b1c2d4e5a6b7c8d9e0f1a2b3c4d5e'); // UUID minus dashes
    expect(root['startTimeUnixNano']).toBe('1000000000');
    expect(root['endTimeUnixNano']).toBe('1300000000');

    expect(preprocess['name']).toBe('routerly.request.preprocess');
    expect(preprocess['parentSpanId']).toBe(root['spanId']);
    expect(execute['name']).toBe('routerly.routing.execute');

    const events = execute['events'] as Array<{ name: string; attributes: Array<{ key: string }> }>;
    expect(events.map(e => e.name)).toEqual(['router:selected', 'model:success']);

    const piiEvent = (preprocess['events'] as Array<{ attributes: Array<{ key: string; value: { stringValue: string } }> }>)[0]!;
    expect(piiEvent.attributes).toContainEqual({ key: 'routerly.hits', value: { stringValue: '2' } });
    expect(piiEvent.attributes).toContainEqual({ key: 'routerly.module', value: { stringValue: 'pii' } });
  });

  it('hashes a trace id that is not a UUID and caps long attribute values', async () => {
    await pushOtelTrace(otel, {
      traceId: 'not-a-uuid',
      entries: [entry({ message: 'model:request', phase: 'upstream.execute', at: 5, details: { prompt: 'x'.repeat(9_000) } })],
    });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { resourceSpans: [{ scopeSpans: [{ spans: Array<Record<string, unknown>> }] }] };
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans[0]!['traceId']).toMatch(/^[0-9a-f]{32}$/);

    const attrs = (spans[1]!['events'] as Array<{ attributes: Array<{ key: string; value: { stringValue: string } }> }>)[0]!.attributes;
    const prompt = attrs.find(a => a.key === 'routerly.prompt')!;
    expect(prompt.value.stringValue).toHaveLength(4096);
  });

  it('falls back to unknown for entries recorded without a phase', async () => {
    await pushOtelTrace(otel, { traceId: 't', entries: [entry({ message: 'router:intake' })] });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { resourceSpans: [{ scopeSpans: [{ spans: Array<Record<string, unknown>> }] }] };
    expect(body.resourceSpans[0].scopeSpans[0].spans[1]!['name']).toBe('routerly.unknown');
  });

  it('exports captured content as a span event attribute', async () => {
    await pushOtelTrace(otel, {
      traceId: 't',
      entries: [entry({ message: 'model:request', phase: 'upstream.prepare', at: 1, content: { prompt: 'hello' } })],
    });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { resourceSpans: [{ scopeSpans: [{ spans: Array<Record<string, unknown>> }] }] };
    const attrs = (body.resourceSpans[0].scopeSpans[0].spans[1]!['events'] as Array<{ attributes: Array<{ key: string; value: { stringValue: string } }> }>)[0]!.attributes;
    expect(attrs).toContainEqual({ key: 'routerly.content', value: { stringValue: '{"prompt":"hello"}' } });
  });
});

describe('pushWebhookTrace', () => {
  it('POSTs the trace with an HMAC signature', async () => {
    await pushWebhookTrace(webhook, trace);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hook.local/traces');
    expect((opts.headers as Record<string, string>)['X-Routerly-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const body = JSON.parse(opts.body as string) as { type: string; trace: { id: string; routerId: string; entries: unknown[] } };
    expect(body.type).toBe('trace');
    expect(body.trace.id).toBe(trace.traceId);
    expect(body.trace.routerId).toBe('proj-1');
    expect(body.trace.entries).toHaveLength(3);
  });

  it('skips the signature when no secret is set', async () => {
    const { secret: _s, ...noSecret } = webhook;
    await pushWebhookTrace(noSecret, { traceId: 't', entries: trace.entries });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['X-Routerly-Signature']).toBeUndefined();
    expect(JSON.parse(opts.body as string).trace.routerId).toBeUndefined();
  });
});

describe('exportTrace', () => {
  it('ships to every sink that opted in, and to no other integration', async () => {
    mockReadConfig.mockResolvedValue({
      integrations: [
        otel,
        webhook,
        { id: 'o2', type: 'otel', enabled: true, endpoint: 'http://off.local', protocol: 'http' }, // no traces flag
        { id: 'o3', type: 'otel', enabled: false, endpoint: 'http://disabled.local', protocol: 'http', traces: { enabled: true } },
        { id: 'd1', type: 'datadog', enabled: true, apiKey: 'k', site: 'datadoghq.com', traces: { enabled: true } },
      ],
    });

    await exportTrace(trace);

    expect(mockFetch.mock.calls.map(c => c[0])).toEqual([
      'http://collector.local:4318/v1/traces',
      'http://hook.local/traces',
    ]);
  });

  it('reads the settings once per TTL window', async () => {
    mockReadConfig.mockResolvedValue({ integrations: [webhook] });

    await exportTrace(trace);
    await exportTrace(trace);

    expect(mockReadConfig).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('honours the sample rate', async () => {
    mockReadConfig.mockResolvedValue({ integrations: [{ ...webhook, traces: { enabled: true, sampleRate: 0.5 } }] });
    const random = vi.spyOn(Math, 'random');

    random.mockReturnValue(0.9);
    await exportTrace(trace);
    expect(mockFetch).not.toHaveBeenCalled();

    random.mockReturnValue(0.1);
    await exportTrace(trace);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    random.mockRestore();
  });

  it('stays silent when a sink is down, when settings cannot be read, and on an empty trace', async () => {
    mockReadConfig.mockResolvedValue({ integrations: [webhook] });
    mockFetch.mockRejectedValue(new Error('hook down'));
    await expect(exportTrace(trace)).resolves.toBeUndefined();

    resetTraceExportCache();
    mockReadConfig.mockRejectedValue(new Error('no settings'));
    await expect(exportTrace(trace)).resolves.toBeUndefined();

    mockFetch.mockClear();
    await exportTrace({ traceId: 't', entries: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when no integration is configured', async () => {
    mockReadConfig.mockResolvedValue({});

    await exportTrace(trace);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
