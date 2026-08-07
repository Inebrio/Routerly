import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }));
vi.mock('./sender.js', () => ({ dispatchNotification: vi.fn() }));

import {
  emitEvent, matchesPattern, _resetCooldowns, resolveTargetUsers,
} from './emitter.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { dispatchNotification } from './sender.js';

const mockRead = vi.mocked(readConfig as (key: string) => Promise<any>);
const mockWrite = vi.mocked(writeConfig as (key: string, value: any) => Promise<void>);
const mockDispatch = vi.mocked(dispatchNotification);

beforeEach(() => { _resetCooldowns(); });
afterEach(() => vi.clearAllMocks());

/** Set up readConfig for settings + empty users/roles/routers/notifications. */
function settings(notifications: any, extra: Record<string, any> = {}) {
  mockRead.mockImplementation(async (key: string) => {
    if (key === 'settings') return { notifications };
    if (key === 'notifications') return extra['notifications'] ?? [];
    if (key === 'routers') return extra['routers'] ?? [];
    if (key === 'users') return extra['users'] ?? [];
    if (key === 'roles') return extra['roles'] ?? [];
    return [];
  });
  mockWrite.mockResolvedValue(undefined);
}

const lastInbox = (): any => {
  const calls = mockWrite.mock.calls.filter(c => c[0] === 'notifications');
  return calls.at(-1)?.[1] ?? null;
};


describe('matchesPattern', () => {
  it('exact match', () => expect(matchesPattern('provider.error', 'provider.error')).toBe(true));
  it('wildcard *', () => expect(matchesPattern('*', 'anything')).toBe(true));
  it('glob budget.*', () => {
    expect(matchesPattern('budget.*', 'budget.threshold')).toBe(true);
    expect(matchesPattern('budget.*', 'provider.error')).toBe(false);
  });
  it('bare trailing star prefix*', () => expect(matchesPattern('prov*', 'provider.error')).toBe(true));
  it('non-match', () => expect(matchesPattern('provider.error', 'provider.degraded')).toBe(false));
});

describe('resolveTargetUsers', () => {
  const users = [
    { id: 'u-admin', email: 'a@x', roleId: 'admin' },
    { id: 'u-view',  email: 'v@x', roleId: 'viewer' },
    { id: 'u-cust',  email: 'c@x', roleId: 'custom' },
  ] as any;
  const roles = [
    { id: 'admin',  name: 'Admin',  permissions: ['user:write', 'report:read'] },
    { id: 'viewer', name: 'Viewer', permissions: ['report:read'] },
    { id: 'custom', name: 'Custom', permissions: ['model:read'] },
  ] as any;

  it('undefined targets → all users', () => {
    expect(resolveTargetUsers(undefined, users, roles)).toHaveLength(3);
  });
  it('all-empty targets → all users', () => {
    expect(resolveTargetUsers({ roles: [], permissions: [], users: [] }, users, roles)).toHaveLength(3);
  });
  it('role match', () => {
    const r = resolveTargetUsers({ roles: ['viewer'] }, users, roles);
    expect(r.map(u => u.id)).toEqual(['u-view']);
  });
  it('permission match', () => {
    const r = resolveTargetUsers({ permissions: ['user:write'] }, users, roles);
    expect(r.map(u => u.id)).toEqual(['u-admin']);
  });
  it('user id match', () => {
    const r = resolveTargetUsers({ users: ['u-cust'] }, users, roles);
    expect(r.map(u => u.id)).toEqual(['u-cust']);
  });
  it('union of role ∪ permission ∪ user (deduped)', () => {
    const r = resolveTargetUsers({ roles: ['admin'], permissions: ['report:read'], users: ['u-cust'] }, users, roles);
    expect(r.map(u => u.id).sort()).toEqual(['u-admin', 'u-cust', 'u-view']);
  });
  it('permission targeting an unknown role yields nobody', () => {
    const r = resolveTargetUsers({ permissions: ['user:write'] }, [{ id: 'x', email: 'x@x', roleId: 'ghost' }] as any, roles);
    expect(r).toHaveLength(0);
  });
});

describe('inbox is opt-in: no dashboard channel → nothing appended', () => {
  it('no notifications config at all → inbox stays empty', async () => {
    settings(undefined);
    await emitEvent('system.startup', 'info', { v: '1' });
    expect(lastInbox()).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('zero channels configured → inbox stays empty', async () => {
    settings({ channels: [] });
    await emitEvent('system.startup', 'info', {});
    expect(lastInbox()).toBeNull();
  });

  it('only external channels exist → inbox stays empty', async () => {
    settings({ channels: [{ id: 'w', provider: 'webhook', url: 'https://x' }] });
    await emitEvent('config.model_added', 'info', {});
    expect(lastInbox()).toBeNull();
  });

  it('trims inbox to 200 items when a dashboard channel matches', async () => {
    const big = Array.from({ length: 250 }, (_, i) => ({
      id: String(i), event: 'x', severity: 'info', timestamp: new Date().toISOString(), details: {}, readBy: [],
    }));
    settings({ channels: [{ id: 'd', provider: 'dashboard' }] }, { notifications: big });
    await emitEvent('config.model_added', 'info', {});
    expect(lastInbox()).toHaveLength(200);
  });
});

describe('inbox gated by dashboard channels (U5)', () => {
  it('appends only when a dashboard channel matches the event', async () => {
    settings({ channels: [{ id: 'd', provider: 'dashboard', events: ['config.*'] }] });
    await emitEvent('config.model_added', 'info', {});
    expect(lastInbox()).toHaveLength(1);
  });

  it('does NOT append when no dashboard channel matches the event', async () => {
    settings({ channels: [{ id: 'd', provider: 'dashboard', events: ['config.*'] }] });
    await emitEvent('provider.error', 'critical', {});
    expect(lastInbox()).toBeNull();
  });

  it('untargeted dashboard channel → recipients undefined (everyone)', async () => {
    settings({ channels: [{ id: 'd', provider: 'dashboard' }] });
    await emitEvent('provider.error', 'critical', {});
    expect(lastInbox()[0].recipients).toBeUndefined();
  });

  it('targeted dashboard channel → recipients = resolved user ids', async () => {
    settings(
      { channels: [{ id: 'd', provider: 'dashboard', targets: { roles: ['admin'] } }] },
      {
        users: [{ id: 'u1', email: 'a@x', roleId: 'admin' }, { id: 'u2', email: 'b@x', roleId: 'viewer' }],
        roles: [],
      },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(lastInbox()[0].recipients).toEqual(['u1']);
  });

  it('multiple dashboard channels: one untargeted → recipients undefined (everyone)', async () => {
    settings(
      { channels: [
        { id: 'd1', provider: 'dashboard', targets: { roles: ['admin'] } },
        { id: 'd2', provider: 'dashboard' },
      ] },
      { users: [{ id: 'u1', email: 'a@x', roleId: 'admin' }], roles: [] },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(lastInbox()[0].recipients).toBeUndefined();
  });

  it('multiple targeted dashboard channels → union of ids', async () => {
    settings(
      { channels: [
        { id: 'd1', provider: 'dashboard', targets: { roles: ['admin'] } },
        { id: 'd2', provider: 'dashboard', targets: { users: ['u2'] } },
      ] },
      {
        users: [{ id: 'u1', email: 'a@x', roleId: 'admin' }, { id: 'u2', email: 'b@x', roleId: 'viewer' }],
        roles: [],
      },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(lastInbox()[0].recipients.sort()).toEqual(['u1', 'u2']);
  });
});

describe('per-channel events matching (U5)', () => {
  it('channel.events takes precedence and matches', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['provider.*'] }] });
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('channel.events present but non-matching → no dispatch', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['budget.*'] }] });
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('channel with matching events filter → dispatches', async () => {
    settings({ channels: [{ id: 'webhook-ops', provider: 'webhook', url: 'https://x', events: ['provider.error'] }] });
    await emitEvent('provider.error', 'critical', { code: 500 });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'webhook-ops' }),
      expect.objectContaining({ event: 'provider.error', severity: 'critical' }),
      undefined,
    );
  });

  it('channel events filter not matching → no dispatch', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['provider.error'] }] });
    await emitEvent('routing.no_candidates', 'critical', {});
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('external channel with no events and no rule receives NOTHING (opt-in, pre-U5 silence)', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x' }] });
    await emitEvent('anything.happened', 'info', {});
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dashboard channel with no events and no rule receives ALL events', async () => {
    settings({ channels: [{ id: 'd', provider: 'dashboard' }] });
    await emitEvent('anything.happened', 'info', {});
    // inbox appended for everyone; no external dispatch
    expect(lastInbox()).toHaveLength(1);
    expect(lastInbox()[0].recipients).toBeUndefined();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('channel.events filter set to budget.* → does not receive provider.error', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['budget.*'] }] });
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('email recipient resolution (U5)', () => {
  it('targeted email channel → dispatch receives resolved emails', async () => {
    settings(
      { channels: [{ id: 'm', provider: 'smtp', fromAddress: 'sys@x', events: ['*'], targets: { roles: ['admin'] } }] },
      {
        users: [{ id: 'u1', email: 'admin@x', roleId: 'admin' }, { id: 'u2', email: 'v@x', roleId: 'viewer' }],
        roles: [],
      },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm' }), expect.anything(), ['admin@x'],
    );
  });

  it('untargeted email channel → recipients undefined (sender uses fromAddress)', async () => {
    settings({ channels: [{ id: 'm', provider: 'smtp', fromAddress: 'sys@x', events: ['*'] }] });
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm' }), expect.anything(), undefined,
    );
  });

  it('targeted email channel resolving to zero users → undefined (sender uses fromAddress)', async () => {
    settings(
      { channels: [{ id: 'm', provider: 'smtp', fromAddress: 'sys@x', events: ['*'], targets: { roles: ['ghost'] } }] },
      { users: [{ id: 'u1', email: 'a@x', roleId: 'admin' }], roles: [] },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm' }), expect.anything(), undefined,
    );
  });

  it('webhook channel → recipients undefined regardless of targets', async () => {
    settings(
      { channels: [{ id: 'w', provider: 'webhook', url: 'https://x', events: ['*'], targets: { roles: ['admin'] } }] },
      { users: [{ id: 'u1', email: 'a@x', roleId: 'admin' }], roles: [] },
    );
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'w' }), expect.anything(), undefined,
    );
  });
});

describe('per-router override + cooldown (preserved)', () => {
  it('merges per-router channel override', async () => {
    settings(
      { channels: [{ id: 'proj-ch', provider: 'webhook', url: 'https://x', events: ['budget.only'] }] },
      { routers: [{ id: 'p1', notifications: { channels: ['proj-ch'] } }] },
    );
    await emitEvent('config.router_created', 'info', {}, { routerId: 'p1' });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-ch' }), expect.anything(), undefined,
    );
  });

  it('per-router override referencing a non-external (unknown) channel id is ignored', async () => {
    settings(
      { channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['budget.only'] }] },
      { routers: [{ id: 'p1', notifications: { channels: ['does-not-exist'] } }] },
    );
    await emitEvent('config.router_created', 'info', {}, { routerId: 'p1' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('routerId pointing to an unknown router adds nothing', async () => {
    settings(
      { channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['budget.only'] }] },
      { routers: [] },
    );
    await emitEvent('config.router_created', 'info', {}, { routerId: 'ghost' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('router found without notifications config adds nothing', async () => {
    settings(
      { channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['budget.only'] }] },
      { routers: [{ id: 'p1' }] },
    );
    await emitEvent('config.router_created', 'info', {}, { routerId: 'p1' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('suppresses repeated dispatch within per-channel cooldown window', async () => {
    settings({
      channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['provider.degraded'], cooldownSeconds: 900 }],
    });
    await emitEvent('provider.degraded', 'warning', {});
    await emitEvent('provider.degraded', 'warning', {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches both when no cooldown configured', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['provider.degraded'] }] });
    await emitEvent('provider.degraded', 'warning', {});
    await emitEvent('provider.degraded', 'warning', {});
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it('never throws when dispatch fails', async () => {
    settings({ channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['*'] }] });
    mockDispatch.mockRejectedValue(new Error('boom'));
    await expect(emitEvent('provider.error', 'critical', {})).resolves.toBeUndefined();
  });

  it('never throws when inbox append fails', async () => {
    settings({ channels: [{ id: 'd', provider: 'dashboard' }] });
    mockWrite.mockRejectedValue(new Error('disk'));
    await expect(emitEvent('system.startup', 'info', {})).resolves.toBeUndefined();
  });

  it('never throws when the external-channel block errors (routers read fails)', async () => {
    mockRead.mockImplementation(async (key: string) => {
      if (key === 'settings') return { notifications: { channels: [{ id: 'c1', provider: 'webhook', url: 'https://x', events: ['*'] }] } };
      if (key === 'notifications') return [];
      if (key === 'routers') throw new Error('routers boom');
      return [];
    });
    mockWrite.mockResolvedValue(undefined);
    await expect(emitEvent('provider.error', 'critical', {}, { routerId: 'p1' })).resolves.toBeUndefined();
  });

  it('survives readConfig(settings) throwing', async () => {
    mockRead.mockImplementation(async (key: string) => {
      if (key === 'settings') throw new Error('no settings');
      if (key === 'notifications') return [];
      return [];
    });
    mockWrite.mockResolvedValue(undefined);
    await expect(emitEvent('system.startup', 'info', {})).resolves.toBeUndefined();
    // No dashboard channel known → opt-in inbox stays empty.
    expect(lastInbox()).toBeNull();
  });
});

describe('router-scoped channel filtering (lines 165-166)', () => {
  it('dispatches when channel has routers filter and event is from one of them (line 166 if branch=0)', async () => {
    // Channel has routers: ['p1'] and event is from router p1 → dispatch (branch=0 = includes → not returned)
    settings(
      { channels: [{ id: 'scoped', provider: 'webhook', url: 'https://x', events: ['provider.error'], routers: ['p1'] }] },
    );
    await emitEvent('provider.error', 'critical', {}, { routerId: 'p1' });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('skips dispatch when channel has routers filter and event is from a different router (line 166 if branch=1)', async () => {
    // Channel has routers: ['p1'] but event is from router p2 → skip (branch=1 = not includes → return)
    settings(
      { channels: [{ id: 'scoped', provider: 'webhook', url: 'https://x', events: ['provider.error'], routers: ['p1'] }] },
    );
    await emitEvent('provider.error', 'critical', {}, { routerId: 'p2' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches when channel has routers filter but no routerId in opts (line 165 binary-expr branch=1)', async () => {
    // channel.routers.length > 0 BUT opts.routerId is undefined → second condition false → short-circuit → no skip
    settings(
      { channels: [{ id: 'scoped', provider: 'webhook', url: 'https://x', events: ['provider.error'], routers: ['p1'] }] },
    );
    // No routerId in opts → the && short-circuits → channel is not filtered → dispatch
    await emitEvent('provider.error', 'critical', {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches when channel has no routers filter (line 165 if branch=0)', async () => {
    // channel.routers is empty/undefined → routers?.length > 0 is false → if is false → no skip
    settings(
      { channels: [{ id: 'any', provider: 'webhook', url: 'https://x', events: ['provider.error'] }] },
    );
    await emitEvent('provider.error', 'critical', {}, { routerId: 'p1' });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});

describe('incident correlation by traceId (T50)', () => {
  /**
   * Dashboard channel that takes everything, with an inbox that survives across
   * emits: the emitter reads back what it wrote, like the real config file.
   */
  function liveInbox(seed: any[] = [], channels?: any[]) {
    let inbox = seed;
    mockRead.mockImplementation(async (key: string) => {
      if (key === 'settings') {
        return { notifications: { channels: channels ?? [{ id: 'd', provider: 'dashboard' }] } };
      }
      if (key === 'notifications') return inbox;
      if (key === 'users') return [{ id: 'u1', email: 'a@x', roleId: 'admin' }, { id: 'u2', email: 'b@x', roleId: 'viewer' }];
      return [];
    });
    mockWrite.mockImplementation(async (key: string, value: any) => {
      if (key === 'notifications') inbox = value;
    });
    return () => inbox;
  }

  it('folds two events with the same traceId into one item', async () => {
    const inbox = liveInbox();
    await emitEvent('routing.fallback_used', 'info', { traceId: 't1', fallbackModelId: 'm2' });
    await emitEvent('provider.error', 'warning', { traceId: 't1', error: 'boom' });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0].traceId).toBe('t1');
    expect(inbox()[0].events.map((e: any) => e.event)).toEqual(['routing.fallback_used', 'provider.error']);
  });

  it('the item takes the identity of the worst event of the incident', async () => {
    const inbox = liveInbox();
    await emitEvent('routing.fallback_used', 'info', { traceId: 't1' });
    await emitEvent('routing.no_candidates', 'critical', { traceId: 't1', requestedModel: 'gpt-4o' });
    await emitEvent('budget.reset', 'info', { traceId: 't1' });
    const item = inbox()[0];
    expect(item.event).toBe('routing.no_candidates');
    expect(item.severity).toBe('critical');
    expect(item.details.requestedModel).toBe('gpt-4o');
    expect(item.events).toHaveLength(3);
  });

  it('a later event of equal severity takes over the identity', async () => {
    const inbox = liveInbox();
    await emitEvent('provider.error', 'warning', { traceId: 't1', error: 'first' });
    await emitEvent('provider.rate_limited', 'warning', { traceId: 't1', error: 'second' });
    expect(inbox()[0].event).toBe('provider.rate_limited');
    expect(inbox()[0].details.error).toBe('second');
  });

  it('a new event makes the incident unread again but keeps a manual dismissal', async () => {
    const inbox = liveInbox([{
      id: 'n1', event: 'provider.error', severity: 'warning', traceId: 't1',
      timestamp: new Date().toISOString(), details: {}, readBy: ['u1'], deletedBy: ['u2'],
    }]);
    await emitEvent('provider.rate_limited', 'warning', { traceId: 't1' });
    expect(inbox()[0].readBy).toEqual([]);
    expect(inbox()[0].deletedBy).toEqual(['u2']);
  });

  it('different traceIds stay separate items', async () => {
    const inbox = liveInbox();
    await emitEvent('provider.error', 'warning', { traceId: 't1' });
    await emitEvent('provider.error', 'warning', { traceId: 't2' });
    expect(inbox()).toHaveLength(2);
  });

  it('events without a traceId are never folded', async () => {
    const inbox = liveInbox();
    await emitEvent('config.model_added', 'info', { modelId: 'm1' });
    await emitEvent('config.model_added', 'info', { modelId: 'm2' });
    expect(inbox()).toHaveLength(2);
    expect(inbox()[0].events).toBeUndefined();
  });

  it('a trace whose last event is older than the window opens a new incident', async () => {
    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const inbox = liveInbox([{
      id: 'n1', event: 'provider.error', severity: 'warning', traceId: 't1',
      timestamp: stale, details: {}, readBy: [],
    }]);
    await emitEvent('provider.error', 'warning', { traceId: 't1' });
    expect(inbox()).toHaveLength(2);
  });

  it('audience is the union, and everyone wins over a list', async () => {
    const inbox = liveInbox(
      [{
        id: 'n1', event: 'provider.error', severity: 'warning', traceId: 't1',
        timestamp: new Date().toISOString(), details: {}, readBy: [], recipients: ['u1'],
      }],
      [{ id: 'd1', provider: 'dashboard', targets: { users: ['u2'] } }],
    );
    await emitEvent('provider.rate_limited', 'warning', { traceId: 't1' });
    expect(inbox()[0].recipients.sort()).toEqual(['u1', 'u2']);

    const everyone = liveInbox([{
      id: 'n1', event: 'provider.error', severity: 'warning', traceId: 't2',
      timestamp: new Date().toISOString(), details: {}, readBy: [], recipients: ['u1'],
    }]);
    await emitEvent('provider.rate_limited', 'warning', { traceId: 't2' });
    expect(everyone()[0].recipients).toBeUndefined();
  });
});
