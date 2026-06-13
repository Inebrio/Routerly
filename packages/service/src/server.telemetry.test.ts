import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dir = dirname(fileURLToPath(import.meta.url));
const { version: CURRENT_VERSION } = JSON.parse(
  readFileSync(join(_dir, '../package.json'), 'utf-8'),
) as { version: string };

// ── Hoist mock factories before any import ───────────────────────────────────

const { mockPing, mockReadConfig, mockWriteConfig, mockInitConfigDirs, mockLoadSecret } =
  vi.hoisted(() => ({
    mockPing: vi.fn(),
    mockReadConfig: vi.fn(),
    mockWriteConfig: vi.fn().mockResolvedValue(undefined),
    mockInitConfigDirs: vi.fn().mockResolvedValue(undefined),
    mockLoadSecret: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('./telemetry.js', () => ({ pingTelemetry: mockPing }));
vi.mock('./config/loader.js', () => ({
  initConfigDirs: mockInitConfigDirs,
  readConfig: mockReadConfig,
  writeConfig: mockWriteConfig,
}));
vi.mock('./plugins/jwt.js', () => ({ loadSecret: mockLoadSecret }));
vi.mock('./update-checker.js', () => ({ updateChecker: { start: vi.fn() } }));

vi.mock('fastify', () => ({
  default: vi.fn(() => ({
    register: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    addContentTypeParser: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    log: { warn: vi.fn(), error: vi.fn() },
    setNotFoundHandler: vi.fn(),
  })),
}));
vi.mock('@fastify/cors', () => ({ default: vi.fn() }));
vi.mock('@fastify/static', () => ({ default: vi.fn() }));
vi.mock('./plugins/auth.js', () => ({ default: vi.fn() }));
vi.mock('./routes/api.js', () => ({ apiRoutes: vi.fn() }));
vi.mock('./routes/openai.js', () => ({ openaiRoutes: vi.fn() }));
vi.mock('./routes/anthropic.js', () => ({ anthropicRoutes: vi.fn() }));
vi.mock('./routes/passthrough.js', () => ({ passthroughHandler: vi.fn() }));

import { startServer } from './server.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSettings(telemetry?: { enabled: boolean; installId: string; lastPingedVersion?: string }) {
  return {
    port: 3000,
    host: '0.0.0.0',
    dashboardEnabled: false,
    defaultTimeoutMs: 30000,
    logLevel: 'info' as const,
    channel: 'latest',
    ...(telemetry !== undefined ? { telemetry } : {}),
  };
}

afterEach(() => vi.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startServer() startup telemetry', () => {
  it('does not ping when telemetry is absent (user not yet asked)', async () => {
    mockReadConfig.mockResolvedValue(makeSettings());

    await startServer();

    expect(mockPing).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('does not ping when telemetry is disabled', async () => {
    mockReadConfig.mockResolvedValue(makeSettings({ enabled: false, installId: 'id-1' }));

    await startServer();

    expect(mockPing).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('fires "install" when lastPingedVersion is absent', async () => {
    mockReadConfig.mockResolvedValue(makeSettings({ enabled: true, installId: 'uuid-abc' }));

    await startServer();

    expect(mockPing).toHaveBeenCalledWith('uuid-abc', 'install');
    expect(mockWriteConfig).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        telemetry: expect.objectContaining({ lastPingedVersion: CURRENT_VERSION }),
      }),
    );
  });

  it('fires "upgrade" when lastPingedVersion differs from current version', async () => {
    mockReadConfig.mockResolvedValue(
      makeSettings({ enabled: true, installId: 'uuid-def', lastPingedVersion: '0.0.1' }),
    );

    await startServer();

    expect(mockPing).toHaveBeenCalledWith('uuid-def', 'upgrade');
    expect(mockWriteConfig).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        telemetry: expect.objectContaining({ lastPingedVersion: CURRENT_VERSION }),
      }),
    );
  });

  it('does not ping when lastPingedVersion already matches current version', async () => {
    mockReadConfig.mockResolvedValue(
      makeSettings({ enabled: true, installId: 'uuid-ghi', lastPingedVersion: CURRENT_VERSION }),
    );

    await startServer();

    expect(mockPing).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});
