import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }));
vi.mock('./sender.js', () => ({ dispatchNotification: vi.fn() }));

import { emitEvent, matchesPattern, parseDuration, _resetCooldowns } from './emitter.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { dispatchNotification } from './sender.js';

const mockRead = vi.mocked(readConfig as (key: string) => Promise<any>);
const mockWrite = vi.mocked(writeConfig as (key: string, value: any) => Promise<void>);
const mockDispatch = vi.mocked(dispatchNotification);

beforeEach(() => { _resetCooldowns(); });
afterEach(() => vi.clearAllMocks());

function settings(notifications: any) {
  mockRead.mockImplementation(async (key: string) => {
    if (key === 'settings') return { notifications };
    if (key === 'notifications') return [];
    if (key === 'projects') return [];
    return [];
  });
  mockWrite.mockResolvedValue(undefined);
}

describe('parseDuration', () => {
  it('parses s/m/h/d', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('2d')).toBe(172_800_000);
  });
  it('returns 0 for invalid', () => {
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('abc')).toBe(0);
  });
});

describe('matchesPattern', () => {
  it('exact match', () => expect(matchesPattern('provider.error', 'provider.error')).toBe(true));
  it('wildcard *', () => expect(matchesPattern('*', 'anything')).toBe(true));
  it('glob budget.*', () => {
    expect(matchesPattern('budget.*', 'budget.threshold')).toBe(true);
    expect(matchesPattern('budget.*', 'provider.error')).toBe(false);
  });
  it('non-match', () => expect(matchesPattern('provider.error', 'provider.degraded')).toBe(false));
});

describe('emitEvent inbox append', () => {
  it('always appends to inbox even with no channels', async () => {
    settings(undefined);
    await emitEvent('system.startup', 'info', { v: '1' });
    expect(mockWrite).toHaveBeenCalledWith('notifications', expect.arrayContaining([
      expect.objectContaining({ event: 'system.startup', severity: 'info', readBy: [] }),
    ]));
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('trims inbox to 200 items', async () => {
    const big = Array.from({ length: 250 }, (_, i) => ({
      id: String(i), event: 'x', severity: 'info', timestamp: new Date().toISOString(), details: {}, readBy: [],
    }));
    mockRead.mockImplementation(async (key: string) => {
      if (key === 'settings') return { notifications: undefined };
      if (key === 'notifications') return big;
      return [];
    });
    mockWrite.mockResolvedValue(undefined);
    await emitEvent('config.model_added', 'info', {});
    const written = mockWrite.mock.calls.find(c => c[0] === 'notifications')![1];
    expect(written).toHaveLength(200);
  });
});

describe('emitEvent rule matching & dispatch', () => {
  it('dispatches to channels matched by exact rule', async () => {
    settings({
      channels: [{ id: 'webhook-ops', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['provider.error'], channels: ['webhook-ops'] }],
    });
    await emitEvent('provider.error', 'critical', { code: 500 });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'webhook-ops' }),
      expect.objectContaining({ event: 'provider.error', severity: 'critical' }),
    );
  });

  it('dispatches via glob rule budget.*', async () => {
    settings({
      channels: [{ id: 'smtp-admin', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['budget.*'], channels: ['smtp-admin'] }],
    });
    await emitEvent('budget.threshold', 'warning', {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when no rule matches', async () => {
    settings({
      channels: [{ id: 'c1', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['provider.error'], channels: ['c1'] }],
    });
    await emitEvent('routing.no_candidates', 'critical', {});
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('merges per-project channel override', async () => {
    mockRead.mockImplementation(async (key: string) => {
      if (key === 'settings') return {
        notifications: { channels: [{ id: 'proj-ch', provider: 'webhook', url: 'https://x' }], notificationRules: [] },
      };
      if (key === 'notifications') return [];
      if (key === 'projects') return [{ id: 'p1', notifications: { channels: ['proj-ch'] } }];
      return [];
    });
    mockWrite.mockResolvedValue(undefined);
    await emitEvent('config.project_created', 'info', {}, { projectId: 'p1' });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-ch' }), expect.anything(),
    );
  });
});

describe('emitEvent cooldown', () => {
  it('suppresses repeated dispatch within cooldown window', async () => {
    settings({
      channels: [{ id: 'c1', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['provider.degraded'], channels: ['c1'] }],
      cooldowns: { 'provider.degraded': '15m' },
    });
    await emitEvent('provider.degraded', 'warning', {});
    await emitEvent('provider.degraded', 'warning', {});
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches both when no cooldown configured', async () => {
    settings({
      channels: [{ id: 'c1', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['provider.degraded'], channels: ['c1'] }],
    });
    await emitEvent('provider.degraded', 'warning', {});
    await emitEvent('provider.degraded', 'warning', {});
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it('never throws when dispatch fails', async () => {
    settings({
      channels: [{ id: 'c1', provider: 'webhook', url: 'https://x' }],
      notificationRules: [{ events: ['provider.error'], channels: ['c1'] }],
    });
    mockDispatch.mockRejectedValue(new Error('boom'));
    await expect(emitEvent('provider.error', 'critical', {})).resolves.toBeUndefined();
  });
});
