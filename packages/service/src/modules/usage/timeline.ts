import type {
  ActivityRecord, CallOutcome, ActivityOutcome, TimelineEvent, TimelineEventKind, TimelineGroup, UsageRecord,
} from '@routerly/shared';
import { isCompletionCall } from '@routerly/shared';

// Unified call timeline (ROUT-563): a pure read model over usage records, grouped
// by traceId, plus activity events (MCP tool calls, non-model proxy routes).
// Nothing is invented: a record without a traceId and every activity event is its
// own group, never merged into another.

const byTime = (a: TimelineEvent, b: TimelineEvent) => a.timestamp.localeCompare(b.timestamp);

function usageKind(r: UsageRecord): TimelineEventKind {
  // Records written before callType existed were all completions.
  return isCompletionCall(r.callType) ? 'attempt' : (r.callType as 'routing' | 'guardrail' | 'judge');
}

function usageEvent(r: UsageRecord): TimelineEvent {
  return {
    id: r.id,
    recordId: r.id,
    timestamp: r.timestamp,
    kind: usageKind(r),
    ...(r.requestType !== undefined ? { requestType: r.requestType } : {}),
    modelId: r.modelId,
    outcome: r.outcome,
    durationMs: r.latencyMs,
    ...(r.ttftMs !== undefined ? { ttftMs: r.ttftMs } : {}),
    cost: r.cost ?? null,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    ...(r.blockedBy !== undefined ? { blockedBy: r.blockedBy } : {}),
    ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
  };
}

function activityEvent(a: ActivityRecord): TimelineEvent {
  return {
    id: a.id,
    timestamp: a.timestamp,
    kind: a.kind,
    name: a.name,
    outcome: a.outcome,
    durationMs: a.durationMs,
    cost: null,
    ...(a.status !== undefined ? { status: a.status } : {}),
    ...(a.errorMessage !== undefined ? { errorMessage: a.errorMessage } : {}),
  };
}

/**
 * Cost of a set of events, with the rule /api/usage applies: only successful
 * calls count. Null (not 0) when every cost is unknown.
 */
function sumCost(events: TimelineEvent[]): number | null {
  if (events.every((e) => e.cost === null)) return null;
  return events.reduce((s, e) => (e.outcome === 'success' ? s + (e.cost ?? 0) : s), 0);
}

function buildGroup(
  id: string,
  events: TimelineEvent[],
  meta: Partial<Record<'routerId' | 'tokenId' | 'sessionId' | 'endUserId' | 'userId', string | undefined>>,
  correlated: boolean,
): TimelineGroup {
  events.sort(byTime);
  const attempts = events.filter((e) => e.kind === 'attempt');
  attempts.forEach((e, i) => { e.attempt = i + 1; });
  // The attempt that answered the client: the last successful one.
  const final = [...attempts].reverse().find((e) => e.outcome === 'success');
  if (final) final.final = true;

  // Outcome: what the client got (final attempt), else a block, else how the last try ended.
  const outcome: CallOutcome | ActivityOutcome =
    final?.outcome ??
    events.find((e) => e.outcome === 'blocked')?.outcome ??
    (attempts.at(-1) ?? events.at(-1)!).outcome;

  const startedMs = Math.min(...events.map((e) => Date.parse(e.timestamp) - e.durationMs));
  const endedMs = Math.max(...events.map((e) => Date.parse(e.timestamp)));
  const defined = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Partial<Record<keyof typeof meta, string>>;

  return {
    id,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    ...defined,
    outcome,
    attempts: attempts.length,
    fallback: attempts.length > 1,
    correlated,
    cost: sumCost(events),
    events,
  };
}

const firstDefined = <T>(records: UsageRecord[], pick: (r: UsageRecord) => T | undefined): T | undefined => {
  for (const r of records) { const v = pick(r); if (v !== undefined) return v; }
  return undefined;
};

/** Groups usage records by traceId and wraps activity events; most recent group first. */
export function groupTimeline(usage: UsageRecord[], activity: ActivityRecord[]): TimelineGroup[] {
  const traced = new Map<string, UsageRecord[]>();
  const groups: TimelineGroup[] = [];

  for (const r of usage) {
    if (!r.traceId) {
      groups.push(buildGroup(r.id, [usageEvent(r)], usageMeta([r]), false));
      continue;
    }
    const list = traced.get(r.traceId);
    if (list) list.push(r); else traced.set(r.traceId, [r]);
  }
  for (const [traceId, records] of traced) {
    groups.push(buildGroup(traceId, records.map(usageEvent), usageMeta(records), true));
  }
  for (const a of activity) {
    groups.push(buildGroup(a.id, [activityEvent(a)], {
      ...(a.routerId !== undefined ? { routerId: a.routerId } : {}),
      ...(a.tokenId !== undefined ? { tokenId: a.tokenId } : {}),
      ...(a.userId !== undefined ? { userId: a.userId } : {}),
    }, false));
  }
  return groups.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function usageMeta(records: UsageRecord[]) {
  return {
    routerId: firstDefined(records, (r) => r.routerId),
    tokenId: firstDefined(records, (r) => r.tokenId),
    sessionId: firstDefined(records, (r) => r.sessionId),
    endUserId: firstDefined(records, (r) => r.endUserId),
  };
}

/** Group-level `kind` / `outcome` filters. `error` = any outcome that is neither success nor blocked, as in /api/usage. */
export function filterGroups(groups: TimelineGroup[], f: { kind?: string | undefined; outcome?: string | undefined }): TimelineGroup[] {
  let out = groups;
  if (f.kind && f.kind !== 'all') out = out.filter((g) => g.events.some((e) => e.kind === f.kind));
  if (f.outcome && f.outcome !== 'all') {
    out = f.outcome === 'error'
      ? out.filter((g) => g.outcome !== 'success' && g.outcome !== 'blocked')
      : out.filter((g) => g.outcome === f.outcome);
  }
  return out;
}

/** Totals over the groups; `cost` follows /api/usage `summary.totalCost` (successful calls, unknown = 0). */
export function timelineTotals(groups: TimelineGroup[]) {
  const eventsByKind: Partial<Record<TimelineEventKind, number>> = {};
  let events = 0;
  let cost = 0;
  for (const g of groups) {
    for (const e of g.events) {
      events++;
      eventsByKind[e.kind] = (eventsByKind[e.kind] ?? 0) + 1;
      if (e.outcome === 'success') cost += e.cost ?? 0;
    }
  }
  return { groups: groups.length, events, cost, eventsByKind };
}
