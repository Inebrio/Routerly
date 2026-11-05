import { describe, it, expect } from 'vitest';
import type { ActivityRecord, UsageRecord } from '@routerly/shared';
import { groupTimeline, filterGroups, timelineTotals } from './timeline.js';

let n = 0;
function rec(o: Partial<UsageRecord> = {}): UsageRecord {
  n++;
  return {
    id: `r${n}`, timestamp: `2026-01-01T10:00:${String(n % 60).padStart(2, '0')}.000Z`, routerId: 'rt1', modelId: 'm1',
    inputTokens: 10, outputTokens: 5, cost: 0.01, latencyMs: 100, outcome: 'success', callType: 'completion', ...o,
  };
}
const act = (o: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id: `a${++n}`, timestamp: '2026-01-01T11:00:00.000Z', kind: 'mcp', outcome: 'success', durationMs: 20, name: 'list_routers', ...o,
});

describe('groupTimeline', () => {
  it('groups records of one traceId; fallback = ordered routing + failed attempt 1 + final attempt 2', () => {
    const groups = groupTimeline([
      rec({ id: 'b', traceId: 't1', timestamp: '2026-01-01T10:00:02.000Z', outcome: 'error', errorMessage: 'upstream 500', cost: 0, modelId: 'm1' }),
      rec({ id: 'c', traceId: 't1', timestamp: '2026-01-01T10:00:03.000Z', modelId: 'm2', ttftMs: 40 }),
      rec({ id: 'a', traceId: 't1', timestamp: '2026-01-01T10:00:01.000Z', callType: 'routing', cost: 0.002 }),
    ], []);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.id).toBe('t1');
    expect(g.correlated).toBe(true);
    expect(g.events.map((e) => [e.id, e.kind, e.attempt, e.final])).toEqual([
      ['a', 'routing', undefined, undefined],
      ['b', 'attempt', 1, undefined],
      ['c', 'attempt', 2, true],
    ]);
    expect(g.attempts).toBe(2);
    expect(g.fallback).toBe(true);
    expect(g.outcome).toBe('success');
    expect(g.events[1]).toMatchObject({ errorMessage: 'upstream 500', outcome: 'error' });
    expect(g.events[2]).toMatchObject({ ttftMs: 40, recordId: 'c' });
  });

  it('routing + guardrail + judge calls become their own kinds and are not attempts', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', callType: 'routing' }), rec({ traceId: 't', callType: 'guardrail' }),
      rec({ traceId: 't', callType: 'judge' }), rec({ traceId: 't' }),
    ], []);
    expect(g!.events.map((e) => e.kind).sort()).toEqual(['attempt', 'guardrail', 'judge', 'routing']);
    expect(g!.attempts).toBe(1);
    expect(g!.fallback).toBe(false);
  });

  it('a record with no callType is a completion attempt (legacy)', () => {
    const { callType: _c, ...legacy } = rec({ traceId: 't' });
    expect(groupTimeline([legacy as UsageRecord], [])[0]!.events[0]!.kind).toBe('attempt');
  });

  it('blocked by a guardrail: outcome blocked, blockedBy kept, no attempt', () => {
    const [g] = groupTimeline([rec({ traceId: 't', callType: 'guardrail', outcome: 'blocked', blockedBy: 'no-pii', cost: 0 })], []);
    expect(g!.outcome).toBe('blocked');
    expect(g!.events[0]).toMatchObject({ kind: 'guardrail', blockedBy: 'no-pii' });
    expect(g!.attempts).toBe(0);
    expect(g!.events[0]!.final).toBeUndefined();
  });

  it('all attempts failed: outcome is the last attempt outcome, no final', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:01.000Z', outcome: 'error', cost: 0 }),
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:02.000Z', outcome: 'timeout', cost: 0 }),
    ], []);
    expect(g!.outcome).toBe('timeout');
    expect(g!.events.some((e) => e.final)).toBe(false);
    expect(g!.fallback).toBe(true);
  });

  it('a block wins over a later error when nothing answered', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:01.000Z', callType: 'guardrail', outcome: 'blocked', cost: 0 }),
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:02.000Z', outcome: 'error', cost: 0 }),
    ], []);
    expect(g!.outcome).toBe('blocked');
  });

  it('unknown cost stays null and is never 0; the group cost is null when every cost is unknown', () => {
    const [g] = groupTimeline([rec({ traceId: 't', cost: null })], []);
    expect(g!.events[0]!.cost).toBeNull();
    expect(g!.cost).toBeNull();
  });

  it('group cost sums known costs and ignores unknown ones', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', callType: 'routing', cost: 0.5 }), rec({ traceId: 't', cost: null }), rec({ traceId: 't', cost: 0.25 }),
    ], []);
    expect(g!.cost).toBeCloseTo(0.75, 10);
  });

  it('a failed attempt carrying a cost does not count, as in /api/usage', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', outcome: 'error', cost: 9 }), rec({ traceId: 't', cost: 1 }),
    ], []);
    expect(g!.cost).toBe(1);
  });

  it('records without traceId are single uncorrelated groups, never merged', () => {
    const groups = groupTimeline([rec({ sessionId: 's' }), rec({ sessionId: 's' })], []);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => !g.correlated && g.events.length === 1)).toBe(true);
    expect(groups.map((g) => g.id).sort()).toEqual(groups.map((g) => g.events[0]!.id).sort());
  });

  it('activity events are single uncorrelated groups carrying userId, name and status; cost null', () => {
    const groups = groupTimeline([], [
      act({ userId: 'u1', name: 'list_routers' }),
      act({ kind: 'proxy', name: 'GET /v1/models', status: 200, routerId: 'rt1', tokenId: 'tk' }),
    ]);
    const mcp = groups.find((g) => g.events[0]!.kind === 'mcp')!;
    const proxy = groups.find((g) => g.events[0]!.kind === 'proxy')!;
    expect(mcp).toMatchObject({ userId: 'u1', correlated: false, cost: null, attempts: 0 });
    expect(mcp.events[0]).toMatchObject({ name: 'list_routers', cost: null });
    expect(proxy).toMatchObject({ routerId: 'rt1', tokenId: 'tk' });
    expect(proxy.events[0]).toMatchObject({ name: 'GET /v1/models', status: 200, cost: null });
  });

  it('carries router/token/session/end-user from the records and spans startedAt..endedAt', () => {
    const [g] = groupTimeline([
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:01.000Z', latencyMs: 200, tokenId: 'tk', sessionId: 's', endUserId: 'eu' }),
      rec({ traceId: 't', timestamp: '2026-01-01T10:00:03.000Z', latencyMs: 100 }),
    ], []);
    expect(g).toMatchObject({ routerId: 'rt1', tokenId: 'tk', sessionId: 's', endUserId: 'eu' });
    expect(g!.startedAt).toBe('2026-01-01T10:00:00.800Z');
    expect(g!.endedAt).toBe('2026-01-01T10:00:03.000Z');
    expect(g!.durationMs).toBe(2200);
  });

  it('orders groups most recent first', () => {
    const groups = groupTimeline([], [act({ id: 'old', timestamp: '2026-01-01T09:00:00.000Z' }), act({ id: 'new', timestamp: '2026-01-01T12:00:00.000Z' })]);
    expect(groups.map((g) => g.id)).toEqual(['new', 'old']);
  });

  it('returns no group for empty input', () => {
    expect(groupTimeline([], [])).toEqual([]);
  });
});

describe('filterGroups / timelineTotals', () => {
  const groups = () => groupTimeline([
    rec({ traceId: 'ok', cost: 0.1 }),
    rec({ traceId: 'bad', outcome: 'error', cost: 0 }),
    rec({ traceId: 'blk', callType: 'guardrail', outcome: 'blocked', cost: 0 }),
  ], [act()]);

  it('filters by kind (any event of the kind) and by outcome, with error = neither success nor blocked', () => {
    expect(filterGroups(groups(), { kind: 'mcp' })).toHaveLength(1);
    expect(filterGroups(groups(), { kind: 'guardrail' }).map((g) => g.id)).toEqual(['blk']);
    expect(filterGroups(groups(), { outcome: 'error' }).map((g) => g.id)).toEqual(['bad']);
    expect(filterGroups(groups(), { outcome: 'blocked' }).map((g) => g.id)).toEqual(['blk']);
    expect(filterGroups(groups(), { outcome: 'all', kind: 'all' })).toHaveLength(4);
  });

  it('totals: counts by kind and cost = the /api/usage summary.totalCost rule (success only, unknown = 0)', () => {
    const usage = [
      rec({ traceId: 'a', callType: 'routing', cost: 0.2 }), rec({ traceId: 'a', cost: 0.3 }),
      rec({ traceId: 'b', outcome: 'error', cost: 5 }), rec({ cost: null }),
    ];
    const t = timelineTotals(groupTimeline(usage, [act()]));
    const usageTotal = usage.filter((r) => r.outcome === 'success').reduce((s, r) => s + (r.cost ?? 0), 0);
    expect(t.cost).toBeCloseTo(usageTotal, 10);
    expect(t).toMatchObject({ groups: 4, events: 5, eventsByKind: { routing: 1, attempt: 3, mcp: 1 } });
  });
});
