// ─── Unified call timeline ───────────────────────────────────────────────────
// A read model over usage records (grouped by traceId) plus the activity log
// (MCP tool calls and non-model proxy routes). Nothing here is stored in
// usage.ndjson, so Usage totals are untouched.

import type { CallOutcome, TraceEntry } from './config.js';
import type { RequestType } from './usage.js';

/** `attempt` = a completion-type upstream try of the client request. */
export type TimelineEventKind = 'attempt' | 'routing' | 'guardrail' | 'judge' | 'mcp' | 'proxy';

export const TIMELINE_EVENT_KINDS = ['attempt', 'routing', 'guardrail', 'judge', 'mcp', 'proxy'] as const;

export type ActivityKind = 'mcp' | 'proxy';

/** Outcome of an activity event. Never carries arguments, bodies or query strings. */
export type ActivityOutcome = 'success' | 'error' | 'blocked';

export interface ActivityRecord {
  id: string;
  timestamp: string; // ISO 8601
  kind: ActivityKind;
  outcome: ActivityOutcome;
  durationMs: number;
  routerId?: string;
  tokenId?: string;
  userId?: string;
  /** MCP tool name, or `METHOD /path` without query string for a proxy route. */
  name: string;
  /** HTTP status (proxy) */
  status?: number;
  errorMessage?: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: TimelineEventKind;
  requestType?: RequestType;
  modelId?: string;
  outcome: CallOutcome | ActivityOutcome;
  durationMs: number;
  ttftMs?: number;
  /** USD. Null when unknown (never 0). */
  cost: number | null;
  inputTokens?: number;
  outputTokens?: number;
  /** 1-based, attempt events only */
  attempt?: number;
  /** True on the attempt that answered the client */
  final?: boolean;
  blockedBy?: string;
  errorMessage?: string;
  /** mcp tool name / proxy `METHOD /path` */
  name?: string;
  /** HTTP status, proxy events only */
  status?: number;
  /** Usage record id (links to /api/usage/:id). Absent on activity events. */
  recordId?: string;
  /** Detail route only: the record's trace, `content` stripped. */
  trace?: TraceEntry[];
}

export interface TimelineGroup {
  /** traceId, or the record/activity id for an uncorrelated event */
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  routerId?: string;
  tokenId?: string;
  sessionId?: string;
  endUserId?: string;
  userId?: string;
  outcome: CallOutcome | ActivityOutcome;
  /** Number of completion attempts */
  attempts: number;
  /** attempts > 1 */
  fallback: boolean;
  /** False for events with no traceId: shown alone, never merged */
  correlated: boolean;
  /** Sum of the known event costs; null when every cost is unknown */
  cost: number | null;
  events: TimelineEvent[];
}
