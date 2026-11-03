/**
 * The trace side channel.
 *
 * A caller that wants to watch its own request live sends a correlation id on the
 * proxy request and reads the entries here, on the management API. Nothing about
 * the proxied request or its response changes: the LLM wire stays exactly what the
 * SDK sent and what the provider returned.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@routerly/shared';
import type { EventBus } from '../../core/index.js';
import type { TraceEvent } from './store.js';

/** How often a comment line is written so proxies do not drop an idle stream. */
const KEEPALIVE_MS = 15_000;

function requirePerm(req: FastifyRequest, perm: Permission, reply: FastifyReply): boolean {
  if (!req.dashUser?.permissions.includes(perm)) {
    reply.status(403).send({ error: 'Forbidden', message: `Required permission: ${perm}` });
    return false;
  }
  return true;
}

interface StreamQuery {
  /** Only entries of requests that carried this `x-routerly-trace` value. */
  correlationId?: string;
  /** Only entries of this router. */
  routerId?: string;
  /** Only entries of this single request. */
  traceId?: string;
}

function matches(q: StreamQuery, event: TraceEvent): boolean {
  if (q.correlationId && event.correlationId !== q.correlationId) return false;
  if (q.routerId && event.routerId !== q.routerId) return false;
  if (q.traceId && event.traceId !== q.traceId) return false;
  return true;
}

/**
 * GET /api/traces/stream — server-sent events, one `trace` event per entry.
 * Contributed to API_ROUTES by traceModule.register(), which owns the bus.
 */
export function makeTraceStreamHandler(events: EventBus) {
  return async function traceStreamHandler(request: unknown, reply: unknown): Promise<unknown> {
    const req = request as FastifyRequest<{ Querystring: StreamQuery }>;
    const rep = reply as FastifyReply;
    if (!requirePerm(req, 'report:read', rep)) return;

    const query: StreamQuery = {
      ...(req.query?.correlationId ? { correlationId: req.query.correlationId } : {}),
      ...(req.query?.routerId ? { routerId: req.query.routerId } : {}),
      ...(req.query?.traceId ? { traceId: req.query.traceId } : {}),
    };

    rep.hijack();
    rep.raw.setHeader('Content-Type', 'text/event-stream');
    rep.raw.setHeader('Cache-Control', 'no-cache');
    rep.raw.setHeader('Connection', 'keep-alive');
    rep.raw.setHeader('X-Accel-Buffering', 'no'); // nginx buffers SSE by default
    rep.raw.flushHeaders();
    rep.raw.write(': open\n\n');

    const unsubscribe = events.subscribe('trace/**', (topic, payload) => {
      const event = payload as TraceEvent;
      if (!matches(query, event)) return;
      rep.raw.write(`event: trace\ndata: ${JSON.stringify({ ...event, topic })}\n\n`);
    });

    const keepalive = setInterval(() => rep.raw.write(': ping\n\n'), KEEPALIVE_MS);
    if (typeof keepalive.unref === 'function') keepalive.unref();

    const close = (): void => {
      clearInterval(keepalive);
      unsubscribe();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
    return rep;
  };
}
