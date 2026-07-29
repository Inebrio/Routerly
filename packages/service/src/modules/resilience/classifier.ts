import type { ResilienceFault } from '@routerly/shared';

export interface UpstreamResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

const TIMEOUT_RE = /ETIMEDOUT|ECONNRESET|ETIMEOUT|abort/i;
const RATE_LIMIT_RE = /429|rate.?limit|too many/i;
const CONTENT_SAFETY_RE = /content_polic|content_filter/i;
const QUOTA_RE = /quota|billing/i;

function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/** Parses OpenAI's `retry-after-ms` (preferred) or the standard `retry-after` (seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  const msRaw = getHeader(headers, 'retry-after-ms');
  if (msRaw !== undefined) {
    const ms = Number(msRaw);
    if (!Number.isNaN(ms)) return ms;
  }
  const raw = getHeader(headers, 'retry-after');
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function fault(category: ResilienceFault['category'], retryAfterMs?: number, resetAt?: number): ResilienceFault {
  const f: ResilienceFault = { category };
  if (retryAfterMs !== undefined) f.retryAfterMs = retryAfterMs;
  if (resetAt !== undefined) f.resetAt = resetAt;
  return f;
}

/**
 * Classifies an upstream provider failure into a stable fault category, used by the
 * circuit breaker (Task 3+) to decide whether/how long to trip a breaker.
 *
 * Precedence: synthetic Anthropic refusal body -> HTTP status (narrows the category set) ->
 * provider-specific `error.type`/`error.code` disambiguation -> `Error.message`/`.code` fallback
 * when there is no HTTP response at all.
 */
export function classifyUpstreamError(err: unknown, response?: UpstreamResponse): ResilienceFault {
  const body = asRecord(response?.body);

  // Anthropic content refusals surface as a normal 200 response (`stop_reason: 'refusal'`), not
  // an HTTP error. The executor may route a detected refusal through this classifier as a
  // synthetic fault; recognize it before status-based classification.
  if (body?.stop_reason === 'refusal') {
    return fault('content-safety');
  }

  const status = response?.status;
  if (status !== undefined) {
    const errorField = asRecord(body?.error);
    const errType = typeof errorField?.type === 'string' ? errorField.type : undefined;
    const errCode = typeof errorField?.code === 'string' ? errorField.code : undefined;
    const retryAfterMs = parseRetryAfterMs(response?.headers);

    switch (status) {
      case 400: {
        if ((errCode && CONTENT_SAFETY_RE.test(errCode)) || (errType && CONTENT_SAFETY_RE.test(errType))) {
          return fault('content-safety');
        }
        return fault('invalid-request');
      }
      case 401:
        return fault('auth');
      case 402:
        // Anthropic billing_error — payment issue, same bucket as quota exhaustion.
        return fault('quota', retryAfterMs, retryAfterMs !== undefined ? Date.now() + retryAfterMs : undefined);
      case 403:
        return fault('auth');
      case 404:
        return fault('model-not-found');
      case 409:
        return fault('invalid-request');
      case 413:
        return fault('invalid-request');
      case 429: {
        const isQuota = (errCode && QUOTA_RE.test(errCode)) || (errType && QUOTA_RE.test(errType));
        if (isQuota) {
          return fault('quota', retryAfterMs, retryAfterMs !== undefined ? Date.now() + retryAfterMs : undefined);
        }
        return fault('rate-limit', retryAfterMs);
      }
      case 504:
        return fault('timeout');
      case 529:
        // Anthropic overloaded_error — temporary overload, same bucket as generic 5xx.
        return fault('server');
      default:
        if (status >= 500) return fault('server');
        break;
    }
  }

  // No response, or a status not covered above: fall back to Error inspection.
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const code = err instanceof Error && 'code' in err && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : '';
  if (TIMEOUT_RE.test(message) || TIMEOUT_RE.test(code)) {
    return fault('timeout');
  }
  if (RATE_LIMIT_RE.test(message)) {
    return fault('rate-limit');
  }
  return fault('server');
}
