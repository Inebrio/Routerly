import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { RouterConfig } from '@routerly/shared';
import { requestTypeFromPath } from '@routerly/shared';
import type { RequestType } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { trackUsage } from '../usage/tracker.js';
import { checkGuardrails } from '../guardrails/guardrails.js';
import type { GuardrailRouterCtx } from '../guardrails/guardrails.js';
import { mergePolicies, scrubMessages, scrubText } from '../pii/piiScrubber.js';
import { conversationText, wrapWithStreamingScrubber, wrapWithResponseGuardrail } from '../reverse-proxy/helpers.js';
import type { ProxyContext } from '../reverse-proxy/context.js';

/**
 * RTR-03 Passthrough: forwards the client's own upstream credential
 * byte-for-byte to the real OpenAI/Anthropic endpoint. No Routerly auth (see
 * modules/auth/auth.ts skip-list), no model resolution — the router only
 * selects which upstream family to hit and, optionally, which
 * guardrails/PII policy to apply on top.
 */

// NOT authorization/x-api-key — RTR-03 forwards the client's own credential
// untouched, unlike the model-execution passthrough.ts which swaps it out.
const HOP_BY_HOP_REQUEST = new Set(['host', 'content-length', 'connection']);
const HOP_BY_HOP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';

interface FamilyMatch {
  family: 'anthropic' | 'openai';
  base: string;
  requestType: RequestType;
}

/** Path-shape-only family detection — no model, no provider config to consult. */
function resolveFamily(path: string): FamilyMatch | null {
  if (path === '/v1/messages' || path.startsWith('/v1/messages/')) {
    return { family: 'anthropic', base: ANTHROPIC_BASE, requestType: 'chat' };
  }
  const requestType = requestTypeFromPath(path);
  if (requestType) return { family: 'openai', base: OPENAI_BASE, requestType };
  return null;
}

/** Minimal SSE line parser for OpenAI-shaped streams: `data: {json}\n\n`, terminated by `data: [DONE]`. */
async function* parseOpenAISSE(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = Readable.fromWeb(body as never);
  let buffer = '';
  for await (const chunk of reader) {
    buffer += (chunk as Buffer).toString('utf8');
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload); } catch { /* not a JSON chunk — ignore, wire-transparency has no place to put it anyway */ }
    }
  }
}

function serializeOpenAISSE(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const routerPassthroughRoutes: FastifyPluginAsync = async (fastify) => {
  // Raw bytes in — Fastify's default JSON parser would 400 a malformed/empty
  // body before this handler ever runs, which breaks EC2 ("forward as-is").
  // Scoped to this plugin only (Fastify content-type parsers are per-instance).
  const rawParser = (_req: unknown, body: Buffer, done: (err: null, body: Buffer) => void) => done(null, body);
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, rawParser);
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, rawParser);

  fastify.all('/passthrough/:slug/*', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const rest = (request.params as Record<string, string>)['*'] ?? '';
    const path = `/${rest}`;

    const routers = await readConfig('routers');
    const router = routers.find((r: RouterConfig) => r.kind === 'passthrough' && r.slug === slug);
    if (!router) {
      return reply.code(404).send({ error: 'not_found', message: 'No passthrough router at this path' });
    }

    const match = resolveFamily(path);
    if (!match) {
      return reply.code(400).send({
        error: 'unrecognized_wire_format',
        message: 'Could not match this request to a known upstream wire format',
      });
    }
    const { family, base, requestType } = match;

    const search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    const targetUrl = base + path + search;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_REQUEST.has(lower)) continue;
      headers[lower] = Array.isArray(value) ? value.join(', ') : value;
    }

    const rawBody = Buffer.isBuffer(request.body) ? request.body : undefined;
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && rawBody !== undefined && rawBody.length > 0;

    // Best-effort JSON parse for model id / guardrails / PII / usage — a parse
    // failure never blocks forwarding (EC2: malformed body goes out as-is).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    if (hasBody) {
      try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { parsed = undefined; }
    }
    const modelId: string = typeof parsed?.model === 'string' ? parsed.model : 'unknown';
    const isStream = parsed?.stream === true;

    const guardrailPctx: GuardrailRouterCtx = { routerId: router.id, router };
    let outBody: Buffer | undefined = hasBody ? rawBody : undefined;
    let piiRedactedRequest: string[] = [];
    let guardrailTriggeredName: string | undefined;
    let blockedBy: string | undefined;

    // ---- Request-side guardrails + PII (both families — request.preprocess has no protocol gate on a plain Router) ----
    if (parsed && Array.isArray(parsed.messages)) {
      if (router.guardrails) {
        const text = conversationText(parsed);
        const result = await checkGuardrails('request', text, router.guardrails, guardrailPctx, request.log, text);
        if (result.triggered) {
          if (result.block) blockedBy = result.triggered;
          else if (result.log) guardrailTriggeredName = result.triggered;
        }
      }
      // ponytail: prompt-injection steering (buildRequestInjection) is a plain-Router
      // guardrails feature too, deliberately not wired here — Task 3 scope named
      // checkGuardrails/scrubMessages/StreamingScrubber only. Add if Passthrough
      // needs injection parity.
      if (!blockedBy && router.pii?.policies?.length) {
        const effective = mergePolicies(router.pii.policies, 'input');
        if (effective.entities?.length || effective.customPatterns?.length) {
          const { messages, redacted } = scrubMessages(parsed.messages, effective);
          if (redacted.length > 0) {
            piiRedactedRequest = redacted;
            parsed = { ...parsed, messages };
            outBody = Buffer.from(JSON.stringify(parsed));
          }
        }
      }
    }

    if (blockedBy) {
      const body = family === 'anthropic'
        ? {
          id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', content: [],
          model: modelId, stop_reason: 'refusal', stop_details: { type: 'refusal' },
          usage: { input_tokens: 0, output_tokens: 0 },
        }
        : {
          id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: modelId,
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
      void trackUsage({
        routerId: router.id, modelId, inputTokens: 0, outputTokens: 0, latencyMs: 0,
        outcome: 'blocked', blockedBy, requestType,
        ...(piiRedactedRequest.length ? { piiRedacted: piiRedactedRequest } : {}),
      }).catch(() => {});
      return reply.code(200).send(body);
    }

    const startedAt = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        ...(outBody !== undefined ? { body: outBody, duplex: 'half' } : {}),
      } as RequestInit);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'upstream request failed';
      request.log.error({ err, url: targetUrl }, 'passthrough upstream error');
      void trackUsage({
        routerId: router.id, modelId, inputTokens: 0, outputTokens: 0,
        latencyMs: Date.now() - startedAt, outcome: 'error', errorMessage: message, requestType,
        ...(piiRedactedRequest.length ? { piiRedacted: piiRedactedRequest } : {}),
      }).catch(() => {});
      return reply.code(502).send({ error: 'upstream_error', message });
    }

    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) reply.header(key, value);
    });
    reply.code(upstream.status);

    // Response-side guardrails/PII: OpenAI-lane only, matching the plain-Router
    // asymmetry (modules/guardrails/index.ts, modules/pii/index.ts — Anthropic
    // response processors are gated off by design, "routes/anthropic.ts has
    // none"). Passthrough matches that parity rather than adding new coverage.
    const piiOutput = family === 'openai' && router.pii?.policies?.length ? mergePolicies(router.pii.policies, 'output') : undefined;
    const wantsOutputPii = !!piiOutput && ((piiOutput.entities?.length ?? 0) > 0 || (piiOutput.customPatterns?.length ?? 0) > 0);
    const wantsOutputGuardrail = family === 'openai' && !!router.guardrails;
    const contentType = upstream.headers.get('content-type') ?? '';

    const finalizeUsage = (outcome: 'success' | 'error' | 'blocked', extra?: { redacted?: string[]; blockedBy?: string }) => {
      void trackUsage({
        routerId: router.id, modelId, inputTokens: 0, outputTokens: 0,
        latencyMs: Date.now() - startedAt, outcome, requestType,
        ...(extra?.blockedBy ? { blockedBy: extra.blockedBy } : {}),
        ...(!extra?.blockedBy && guardrailTriggeredName ? { guardrailTriggered: guardrailTriggeredName } : {}),
        ...((piiRedactedRequest.length || extra?.redacted?.length)
          ? { piiRedacted: [...new Set([...piiRedactedRequest, ...(extra?.redacted ?? [])])] }
          : {}),
      }).catch(() => {});
    };

    if (!upstream.body) {
      finalizeUsage(upstream.status < 400 ? 'success' : 'error');
      return reply.send();
    }

    if (!wantsOutputPii && !wantsOutputGuardrail) {
      finalizeUsage(upstream.status < 400 ? 'success' : 'error');
      return reply.send(Readable.fromWeb(upstream.body as never));
    }

    // From here on: guardrails and/or PII are configured for this router's response side.
    const fakeCtx = { traceId: randomUUID(), request: { model: modelId }, blockedBy: undefined } as unknown as ProxyContext;

    if (!isStream && contentType.includes('application/json')) {
      const buf = Buffer.concat(await collectStream(upstream.body));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any;
      try { json = JSON.parse(buf.toString('utf8')); } catch { json = undefined; }
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        finalizeUsage(upstream.status < 400 ? 'success' : 'error');
        return reply.send(buf);
      }
      let text = content;
      let redacted: string[] = [];
      if (wantsOutputPii && piiOutput) {
        const scrub = scrubText(text, piiOutput);
        text = scrub.text; redacted = scrub.found;
      }
      let responseBlockedBy: string | undefined;
      let responseLoggedOnly: string | undefined;
      if (wantsOutputGuardrail && router.guardrails) {
        const result = await checkGuardrails('response', text, router.guardrails, guardrailPctx, request.log);
        if (result.triggered) {
          if (result.block) responseBlockedBy = result.triggered;
          else if (result.log) responseLoggedOnly = result.triggered;
        }
      }
      if (responseBlockedBy) {
        json.choices[0].message.content = '';
        json.choices[0].finish_reason = 'content_filter';
      } else if (redacted.length > 0) {
        json.choices[0].message.content = text;
      }
      guardrailTriggeredName = responseLoggedOnly ?? guardrailTriggeredName;
      finalizeUsage(responseBlockedBy ? 'blocked' : (upstream.status < 400 ? 'success' : 'error'), { redacted, ...(responseBlockedBy ? { blockedBy: responseBlockedBy } : {}) });
      return reply.send(Buffer.from(JSON.stringify(json)));
    }

    if (isStream && contentType.includes('text/event-stream')) {
      let iter: AsyncIterable<unknown> = parseOpenAISSE(upstream.body as never);
      if (wantsOutputPii && piiOutput) iter = wrapWithStreamingScrubber(iter, piiOutput, fakeCtx);
      if (wantsOutputGuardrail) iter = wrapWithResponseGuardrail(iter, router, guardrailPctx, request.log, fakeCtx);
      // finalizeUsage must run after the stream is fully drained: fakeCtx.blockedBy
      // is only set (by wrapWithResponseGuardrail) once the buffered guardrail
      // check completes, which happens mid-iteration, not before it starts.
      const out = (async function* (): AsyncGenerator<string> {
        try {
          for await (const chunk of iter) yield serializeOpenAISSE(chunk);
          yield 'data: [DONE]\n\n';
        } finally {
          finalizeUsage(fakeCtx.blockedBy ? 'blocked' : (upstream.status < 400 ? 'success' : 'error'), fakeCtx.blockedBy ? { blockedBy: fakeCtx.blockedBy } : undefined);
        }
      })();
      return reply.send(Readable.from(out));
    }

    // Neither a recognized JSON nor SSE response shape (e.g. a binary/other
    // content-type on an OpenAI-family path) — no place to apply guardrails/PII,
    // forward untouched.
    finalizeUsage(upstream.status < 400 ? 'success' : 'error');
    return reply.send(Readable.fromWeb(upstream.body as never));
  });
};

async function collectStream(body: ReadableStream<Uint8Array>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(body as never)) chunks.push(chunk as Buffer);
  return chunks;
}
