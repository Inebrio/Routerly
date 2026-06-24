import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { PromptEntry } from '@routerly/shared';

// ── Hoist mock factories ──────────────────────────────────────────────────────

const { mockReadConfig, mockWriteConfig } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockWriteConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/loader.js', () => ({
  readConfig: mockReadConfig,
  writeConfig: mockWriteConfig,
  initConfigDirs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/paths.js', () => ({
  CONFIG_PATHS: { settings: '/fake/settings.json' },
}));

vi.mock('../plugins/jwt.js', () => ({
  verifyToken: vi.fn().mockReturnValue({ sub: 'user-1' }),
  loadSecret: vi.fn(),
  createSessionToken: vi.fn(),
  generateRawToken: vi.fn(),
}));

vi.mock('../telemetry.js', () => ({ pingTelemetry: vi.fn() }));
vi.mock('../update-checker.js', () => ({ updateChecker: { start: vi.fn(), getLastResult: vi.fn(), updateChannel: vi.fn() } }));
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }));
vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn(), setTrace: vi.fn(), appendTrace: vi.fn() }));

// ── Build a minimal test Fastify app ─────────────────────────────────────────

import Fastify from 'fastify';
import { apiRoutes } from './api.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(apiRoutes);
  await app.ready();
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSettings(prompts: PromptEntry[] = []) {
  return {
    port: 3000, host: '0.0.0.0', dashboardEnabled: false,
    defaultTimeoutMs: 30000, logLevel: 'info' as const,
    prompts,
  };
}

// Returns auth header for a mocked admin user
const AUTH = { Authorization: 'Bearer fake-jwt' };

// We need roles and users for the preHandler to resolve permissions
function setupConfigMocks(prompts: PromptEntry[] = []) {
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'users') {
      return [{ id: 'user-1', email: 'admin@test.com', passwordHash: '$2b$12$xxx', roleId: 'admin', projectIds: [] }];
    }
    if (key === 'roles') return [];
    if (key === 'settings') return makeSettings(prompts);
    return [];
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => vi.clearAllMocks());

describe('GET /api/prompts', () => {
  it('returns empty array when no prompts', async () => {
    setupConfigMocks([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/prompts', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('returns existing prompts', async () => {
    const prompt: PromptEntry = {
      id: 'p-1', name: 'Test', versions: [{ version: 1, systemPrompt: 'Hi', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'user-1' }], activeVersion: 1,
    };
    setupConfigMocks([prompt]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/prompts', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as PromptEntry[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe('p-1');
  });
});

describe('POST /api/prompts', () => {
  it('creates a prompt with version 1', async () => {
    setupConfigMocks([]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/prompts', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Prompt', systemPrompt: 'You are helpful.' }),
    });
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as PromptEntry;
    expect(created.name).toBe('My Prompt');
    expect(created.activeVersion).toBe(1);
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]!.systemPrompt).toBe('You are helpful.');
    expect(mockWriteConfig).toHaveBeenCalledWith('settings', expect.objectContaining({
      prompts: expect.arrayContaining([expect.objectContaining({ name: 'My Prompt' })]),
    }));
  });

  it('returns 400 when name is missing', async () => {
    setupConfigMocks([]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/prompts', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt: 'Hello' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/prompts/:id', () => {
  it('returns a single prompt', async () => {
    const prompt: PromptEntry = {
      id: 'p-42', name: 'Single', versions: [{ version: 1, systemPrompt: 'S', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'user-1' }], activeVersion: 1,
    };
    setupConfigMocks([prompt]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/prompts/p-42', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as PromptEntry).id).toBe('p-42');
  });

  it('returns 404 for unknown id', async () => {
    setupConfigMocks([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/prompts/nope', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/prompts/:id/activate/:version', () => {
  it('sets activeVersion', async () => {
    const prompt: PromptEntry = {
      id: 'p-1', name: 'P', activeVersion: 1,
      versions: [
        { version: 1, systemPrompt: 'A', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u' },
        { version: 2, systemPrompt: 'B', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u' },
      ],
    };
    setupConfigMocks([prompt]);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/prompts/p-1/activate/2', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as PromptEntry).activeVersion).toBe(2);
    expect(mockWriteConfig).toHaveBeenCalledWith('settings', expect.objectContaining({
      prompts: expect.arrayContaining([expect.objectContaining({ activeVersion: 2 })]),
    }));
  });
});

describe('DELETE /api/prompts/:id', () => {
  it('removes the prompt and returns 204', async () => {
    const prompt: PromptEntry = {
      id: 'p-del', name: 'ToDelete',
      versions: [{ version: 1, systemPrompt: 'X', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u' }],
      activeVersion: 1,
    };
    setupConfigMocks([prompt]);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/prompts/p-del', headers: AUTH });
    expect(res.statusCode).toBe(204);
    expect(mockWriteConfig).toHaveBeenCalledWith('settings', expect.objectContaining({
      prompts: [],
    }));
  });

  it('returns 404 for unknown prompt', async () => {
    setupConfigMocks([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/prompts/no-such', headers: AUTH });
    expect(res.statusCode).toBe(404);
  });
});
