/**
 * Trace export.
 *
 * The trace module publishes a finished trace on `traces/completed`; this file is
 * the subscriber that ships it to the integrations that asked for traces. Only the
 * two sinks that can carry a per-request payload are eligible: OTLP (native spans)
 * and webhook (structured JSON). Datadog, Grafana and InfluxDB are metric-only
 * write paths here, so they keep receiving the 60s metric push and nothing else.
 *
 * Export is opt-in per integration and sampled, because unlike the metric push it
 * costs one outbound request per proxied request.
 */
import { createHash, createHmac } from 'node:crypto';
import type { OtelIntegration, TraceEntry, WebhookIntegration } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { toAttrs } from './otel.js';
import { SERVICE_VERSION } from '../telemetry/telemetry.js';
import type { TraceCompletedEvent } from '../trace/publish.js';

type TraceSink = OtelIntegration | WebhookIntegration;

/** A settings read per proxied request would be an fs hit on the hot path. */
const SETTINGS_TTL_MS = 30_000;
let cache: { at: number; sinks: TraceSink[] } | null = null;

async function traceSinks(): Promise<TraceSink[]> {
  if (!cache || Date.now() - cache.at > SETTINGS_TTL_MS) {
    const settings = await readConfig('settings');
    const sinks = (settings.integrations ?? []).filter(
      (i): i is TraceSink => (i.type === 'otel' || i.type === 'webhook') && i.enabled && i.traces?.enabled === true,
    );
    cache = { at: Date.now(), sinks };
  }
  return cache.sinks;
}

/** Test seam, and the way a settings write takes effect before the TTL runs out. */
export function resetTraceExportCache(): void {
  cache = null;
}

function sampled(sink: TraceSink): boolean {
  const rate = sink.traces?.sampleRate;
  return rate == null || rate >= 1 || Math.random() < rate;
}

/**
 * Ship one finished trace. Never throws and never rejects: a sink that is down
 * must not affect the request that produced the trace.
 */
export async function exportTrace(trace: TraceCompletedEvent): Promise<void> {
  try {
    if (trace.entries.length === 0) return;
    const sinks = (await traceSinks()).filter(sampled);
    await Promise.allSettled(
      sinks.map(async (sink) => {
        try {
          if (sink.type === 'otel') await pushOtelTrace(sink, trace);
          else await pushWebhookTrace(sink, trace);
        } catch (_) { /* ponytail: silent — export failures must not surface on the proxy path */ }
      }),
    );
  } catch (_) { /* ponytail: silent — unreadable settings just mean no export */ }
}

const ns = (ms: number): string => String(BigInt(Math.round(ms)) * 1_000_000n);

const hashHex = (seed: string, len: number): string => createHash('sha256').update(seed).digest('hex').slice(0, len);

/** OTLP wants 32 hex chars: a Routerly trace id is a UUID, so dropping the dashes is enough. */
function otlpTraceId(traceId: string): string {
  const raw = traceId.replaceAll('-', '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(raw) ? raw : hashHex(traceId, 32);
}

/** Attribute values are strings on the wire; anything structured goes as JSON, capped. */
const MAX_ATTR_CHARS = 4096;

function entryAttrs(entry: TraceEntry): Record<string, string> {
  const attrs: Record<string, string> = {
    'routerly.panel': entry.panel,
    'routerly.module': entry.module ?? 'unknown',
  };
  const fields: Record<string, unknown> = { ...entry.details, ...(entry.content ? { content: entry.content } : {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    attrs[`routerly.${key}`] = text.slice(0, MAX_ATTR_CHARS);
  }
  return attrs;
}

/**
 * One OTLP trace: a root server span for the request, a child span per pipeline
 * phase, and every trace entry as a span event on the phase that produced it.
 * Span ids are derived from the trace id so a retried export overwrites rather
 * than duplicating.
 */
export async function pushOtelTrace(integration: OtelIntegration, trace: TraceCompletedEvent): Promise<void> {
  const stamps = trace.entries.map((e) => e.at).filter((t): t is number => typeof t === 'number');
  const start = stamps.length ? Math.min(...stamps) : Date.now();
  const end = stamps.length ? Math.max(...stamps) : start;

  const traceId = otlpTraceId(trace.traceId);
  const rootId = hashHex(`${trace.traceId}:root`, 16);

  const phases = [...new Set(trace.entries.map((e) => e.phase ?? 'unknown'))];

  const spans = [
    {
      traceId,
      spanId: rootId,
      name: 'routerly.request',
      kind: 2, // SPAN_KIND_SERVER
      startTimeUnixNano: ns(start),
      endTimeUnixNano: ns(end),
      attributes: toAttrs({
        'routerly.trace_id': trace.traceId,
        ...(trace.routerId ? { 'routerly.router_id': trace.routerId } : {}),
      }),
    },
    ...phases.map((phase) => {
      const own = trace.entries.filter((e) => (e.phase ?? 'unknown') === phase);
      const ownStamps = own.map((e) => e.at).filter((t): t is number => typeof t === 'number');
      const phaseStart = ownStamps.length ? Math.min(...ownStamps) : start;
      const phaseEnd = ownStamps.length ? Math.max(...ownStamps) : phaseStart;
      return {
        traceId,
        spanId: hashHex(`${trace.traceId}:${phase}`, 16),
        parentSpanId: rootId,
        name: `routerly.${phase}`,
        kind: 1, // SPAN_KIND_INTERNAL
        startTimeUnixNano: ns(phaseStart),
        endTimeUnixNano: ns(phaseEnd),
        attributes: toAttrs({ 'routerly.phase': phase }),
        events: own.map((entry) => ({
          timeUnixNano: ns(entry.at ?? phaseStart),
          name: entry.message,
          attributes: toAttrs(entryAttrs(entry)),
        })),
      };
    }),
  ];

  const body = JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'routerly' } }] },
      scopeSpans: [{ scope: { name: 'routerly', version: SERVICE_VERSION }, spans }],
    }],
  });

  await fetch(`${integration.endpoint}/v1/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...integration.headers },
    body,
  });
}

/** The same signed envelope as the metric push, with the trace as the body. */
export async function pushWebhookTrace(integration: WebhookIntegration, trace: TraceCompletedEvent): Promise<void> {
  const body = JSON.stringify({
    source: 'routerly',
    type: 'trace',
    timestamp: new Date().toISOString(),
    trace: {
      id: trace.traceId,
      ...(trace.routerId ? { routerId: trace.routerId } : {}),
      entries: trace.entries,
    },
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...integration.headers };
  if (integration.secret) {
    headers['X-Routerly-Signature'] = `sha256=${createHmac('sha256', integration.secret).update(body).digest('hex')}`;
  }

  await fetch(integration.url, { method: 'POST', headers, body });
}
