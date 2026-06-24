import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockReadConfig, mockWriteConfig, mockLoadSecret, mockLogAudit } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockWriteConfig: vi.fn().mockResolvedValue(undefined),
  mockLoadSecret: vi.fn().mockResolvedValue(undefined),
  mockLogAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/loader.js', () => ({
  readConfig: mockReadConfig,
  writeConfig: mockWriteConfig,
  getOrCreateSecret: vi.fn().mockResolvedValue('test-secret-00000000000000000000000000000000'),
}));
vi.mock('../audit/logger.js', () => ({ logAudit: mockLogAudit }));
vi.mock('../telemetry.js', () => ({ pingTelemetry: vi.fn() }));
vi.mock('../plugins/jwt.js', () => {
  // Encode sub and roleId separated by '|' so verifyToken can decode without a Map
  return {
    loadSecret: mockLoadSecret,
    createSessionToken: (sub: string, roleId: string) => Buffer.from(`${sub}|${roleId}`).toString('base64'),
    verifyToken: (t: string) => {
      try {
        const [sub, roleId] = Buffer.from(t, 'base64').toString().split('|');
        if (!sub || !roleId) return null;
        return { sub, roleId };
      } catch { return null; }
    },
    generateRawToken: () => 'raw-refresh-token',
  };
});
vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn().mockReturnValue(null) }));
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }));
vi.mock('../update-checker.js', () => ({ updateChecker: { getLastResult: vi.fn().mockReturnValue(null), getAvailableReleases: vi.fn(), check: vi.fn(), updateChannel: vi.fn() } }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0-test"}') }));

import { apiRoutes } from './api.js';

afterEach(() => vi.clearAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(apiRoutes);
  await app.ready();
  return app;
}

const ADMIN_USER = { id: 'admin-id', email: 'admin@example.com', passwordHash: '$2b$12$fakehash', roleId: 'admin', projectIds: [] };
const VIEWER_USER = { id: 'viewer-id', email: 'viewer@example.com', passwordHash: '$2b$12$fakehash', roleId: 'viewer', projectIds: [] };

function makeToken(userId: string, roleId: string) {
  return Buffer.from(`${userId}|${roleId}`).toString('base64');
}

// ── GET /api/audit ────────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  const sampleEntries = [
    { id: 'e1', timestamp: '2026-01-01T10:00:00.000Z', userId: 'admin-id', email: 'admin@example.com', endpoint: '/api/models', action: 'model:create', result: 'success' as const },
    { id: 'e2', timestamp: '2026-01-02T10:00:00.000Z', userId: 'viewer-id', email: 'viewer@example.com', endpoint: '/api/auth/login', action: 'auth:login', result: 'success' as const },
  ];

  it('returns audit entries (most recent first) for users with audit:read', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'users') return Promise.resolve([ADMIN_USER]);
      if (key === 'roles') return Promise.resolve([]);
      if (key === 'audit') return Promise.resolve(sampleEntries);
      return Promise.resolve([]);
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { authorization: `Bearer ${makeToken('admin-id', 'admin')}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string }[]>();
    // most recent first
    expect(body[0]!.id).toBe('e2');
    expect(body[1]!.id).toBe('e1');
  });

  it('returns 403 for users without audit:read permission', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'users') return Promise.resolve([VIEWER_USER]);
      if (key === 'roles') return Promise.resolve([]);
      if (key === 'audit') return Promise.resolve(sampleEntries);
      return Promise.resolve([]);
    });

    // Viewer has audit:read — adjust: use a custom role without it
    const viewerNoAudit = { ...VIEWER_USER, roleId: 'no-audit-role' };
    const noAuditRole = { id: 'no-audit-role', name: 'No Audit', permissions: ['project:read'] };
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'users') return Promise.resolve([viewerNoAudit]);
      if (key === 'roles') return Promise.resolve([noAuditRole]);
      if (key === 'audit') return Promise.resolve(sampleEntries);
      return Promise.resolve([]);
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { authorization: `Bearer ${makeToken('viewer-id', 'no-audit-role')}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('filters by userId query param', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'users') return Promise.resolve([ADMIN_USER]);
      if (key === 'roles') return Promise.resolve([]);
      if (key === 'audit') return Promise.resolve(sampleEntries);
      return Promise.resolve([]);
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit?userId=viewer-id',
      headers: { authorization: `Bearer ${makeToken('admin-id', 'admin')}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ userId: string }[]>();
    expect(body).toHaveLength(1);
    expect(body[0]!.userId).toBe('viewer-id');
  });
});
