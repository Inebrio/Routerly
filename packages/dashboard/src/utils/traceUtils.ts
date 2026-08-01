/**
 * Utilities for extracting stats and metadata from trace entries
 */

interface TraceEntry {
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

export interface MessageStats {
  selectedModel: string | null;
  routerScore: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  tokensPerSec: number | null;
  // Cost information
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  totalCostUsd: number | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  hasError: boolean;
  errorMessage?: string;
  fallbackUsed: boolean;
  // Guardrail judge activity, present even on a blocked turn, which has no completion
  guardrailBlocked: boolean;
  guardrailInputTokens: number | null;
  guardrailOutputTokens: number | null;
  guardrailCostUsd: number | null;
}

/**
 * Extract statistics from trace entries.
 * Note: details field is intentionally typed as any since it contains dynamic SSE data.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
export function extractMessageStats(traces: TraceEntry[]): MessageStats {
  const stats: MessageStats = {
    selectedModel: null,
    routerScore: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    latencyMs: null,
    ttftMs: null,
    tokensPerSec: null,
    inputCostUsd: null,
    outputCostUsd: null,
    totalCostUsd: null,
    inputPerMillion: null,
    outputPerMillion: null,
    hasError: false,
    fallbackUsed: false,
    guardrailBlocked: false,
    guardrailInputTokens: null,
    guardrailOutputTokens: null,
    guardrailCostUsd: null,
  };

  if (!traces || traces.length === 0) return stats;

  // Extract from router:recap
  const recap = traces.find((e) => e.message === 'router:recap');
  if (recap?.details?.final?.[0]) {
    stats.selectedModel = recap.details.final[0].model;
    stats.routerScore = recap.details.final[0].score ?? recap.details.final[0].weight ?? null;
  }

  // Extract from model:success
  const success = traces.find((e) => e.message === 'model:success');
  if (success?.details) {
    stats.inputTokens = success.details.inputTokens ?? null;
    stats.outputTokens = success.details.outputTokens ?? null;
    stats.cachedTokens = success.details.cachedInputTokens ?? null;
    stats.latencyMs = success.details.latencyMs ?? null;
    stats.ttftMs = success.details.ttftMs ?? null;
    stats.tokensPerSec = success.details.tokensPerSec ?? null;
    // Extract cost information
    stats.inputCostUsd = success.details.inputCostUsd ?? null;
    stats.outputCostUsd = success.details.outputCostUsd ?? null;
    stats.totalCostUsd = success.details.totalCostUsd ?? null;
    stats.inputPerMillion = success.details.inputPerMillion ?? null;
    stats.outputPerMillion = success.details.outputPerMillion ?? null;
  }

  // Check for errors — only fatal if there's no subsequent model:success (fallback)
  const errorEntry = traces.find((e) => e.message === 'model:error');
  const hasSuccess = traces.some((e) => e.message === 'model:success');
  if (errorEntry) {
    stats.errorMessage = errorEntry.details?.error ?? errorEntry.details?.message ?? 'Unknown error';
    if (hasSuccess) {
      stats.fallbackUsed = true;
    } else {
      stats.hasError = true;
    }
  }

  // Guardrail judge usage + block state. A blocked turn has no completion, so this is
  // the only signal the Debug card has to render (otherwise the turn box is empty).
  // ponytail: only topic/moderation judges attach usage; semantic (embedding) rules
  // are tracked for billing but carry no usage on the eval, so they are not summed here.
  let gIn = 0, gOut = 0, sawUsage = false;
  for (const e of traces) {
    if (e.message !== 'guardrail:evaluated') continue;
    const rules = e.details?.rules;
    if (!Array.isArray(rules)) continue;
    for (const r of rules) {
      if (r?.usage) { gIn += r.usage.inputTokens ?? 0; gOut += r.usage.outputTokens ?? 0; sawUsage = true; }
    }
  }
  if (sawUsage) {
    stats.guardrailInputTokens = gIn;
    stats.guardrailOutputTokens = gOut;
    // ponytail: flat estimate, same as the message-bubble footer; no per-model lookup here
    stats.guardrailCostUsd = gIn * 0.000005 + gOut * 0.000015;
  }
  stats.guardrailBlocked = traces.some(
    (e) => (e.message === 'guardrail:triggered' || e.message === 'guardrail:response-triggered') && e.details?.block === true,
  );

  return stats;
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  // Saved time can be negative when routing picked the slower model, and it adds
  // up over a whole window, so the thresholds read the magnitude, the sign goes
  // back in front, and hours stay hours instead of five-digit seconds.
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(2)}s`;
  if (abs < 3_600_000) return `${sign}${(abs / 60_000).toFixed(1)}m`;
  return `${sign}${(abs / 3_600_000).toFixed(1)}h`;
}

export function formatTokensPerSec(tps: number | null): string {
  if (tps == null) return '—';
  return `${Math.round(tps)} T/s`;
}

export function formatCost(usd: number | null): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0.000';
  // A saving can come out negative when routing picked the costlier model, so
  // the thresholds read the magnitude and the sign is put back in front.
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  if (abs < 0.000001) return `${sign}<$0.000001`;
  if (abs < 0.01) return `${sign}$${abs.toFixed(8)}`;
  if (abs < 1) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatTokens(count: number | null): string {
  if (count == null) return '—';
  return count.toLocaleString();
}
