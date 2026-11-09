import type { ModelConfig } from '@routerly/shared';
import type { DecisionAnswer, DecisionOptions, DecisionQuestion, DecisionResult } from './types.js';

// Spec: https://docs.typesafe.ai/api.md (checked 2026-11-05)
const DEFAULT_TIMEOUT_MS = 60_000;

function errorDetail(body: unknown): string | undefined {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const msg = (d[0] as { msg?: unknown } | undefined)?.msg;
    return typeof msg === 'string' ? msg : undefined;
  }
  const msg = (d as { message?: unknown } | null | undefined)?.message;
  return typeof msg === 'string' ? msg : undefined;
}

function parseAnswer(name: string, a: Record<string, unknown>): DecisionAnswer {
  if (a['type'] === 'noul' && typeof a['noul'] === 'number') return { type: 'noul', probability: a['noul'] };
  if (a['type'] === 'choice' && typeof a['choice'] === 'string') {
    return { type: 'choice', choice: a['choice'], confidence: Number(a['confidence'] ?? 0), probabilities: (a['probabilities'] ?? {}) as Record<string, number> };
  }
  if (a['type'] === 'score' && typeof a['score'] === 'number') {
    return { type: 'score', score: a['score'], confidence: Number(a['confidence'] ?? 0), probabilities: (a['probabilities'] ?? {}) as Record<string, number> };
  }
  throw new Error(`Unexpected answer for question "${name}"`);
}

export async function typesafeDecide(
  model: ModelConfig,
  state: string,
  questions: Record<string, DecisionQuestion>,
  opts: DecisionOptions = {},
): Promise<DecisionResult> {
  const t0 = Date.now();
  const base = (model.endpoint ?? 'https://api.typesafe.ai/v1').replace(/\/+$/, '');
  // /v1 is part of the default endpoint; the vendor path is /v1/systemone.
  const url = `${base.replace(/\/v1$/, '')}/v1/systemone`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${model.apiKey ?? ''}` },
    body: JSON.stringify({ model: model.upstreamModelId ?? model.id, state, questions }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? model.timeout ?? DEFAULT_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorDetail(body) ?? res.statusText}`);
  const b = body as { model?: string; answers?: Record<string, Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number } } | null;
  if (!b?.answers || typeof b.answers !== 'object') throw new Error('Malformed response: missing answers');
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, a] of Object.entries(b.answers)) answers[name] = parseAnswer(name, a);
  return {
    model: b.model ?? model.upstreamModelId ?? model.id,
    answers,
    inputTokens: b.usage?.input_tokens ?? 0,
    outputTokens: b.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
}
