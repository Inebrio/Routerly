/**
 * Formatters shared by everything that shows trace numbers.
 *
 * The stats these used to be extracted from now come from the `trace:recap`
 * entry the service emits, so only the formatting is left here.
 */

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
