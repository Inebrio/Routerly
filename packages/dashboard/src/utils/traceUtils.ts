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

  // Check for errors
  const error = traces.find((e) => e.message === 'model:error');
  if (error) {
    stats.hasError = true;
    stats.errorMessage = error.details?.error ?? error.details?.message ?? 'Unknown error';
  }

  return stats;
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTokensPerSec(tps: number | null): string {
  if (tps == null) return '—';
  return `${Math.round(tps)} T/s`;
}

export function formatCost(usd: number | null): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0.000';
  if (usd < 0.000001) return '<$0.000001';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(count: number | null): string {
  if (count == null) return '—';
  return count.toLocaleString();
}
