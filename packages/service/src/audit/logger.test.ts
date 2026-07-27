import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockReadConfig, mockWriteConfig } = vi.hoisted(() => ({
  mockReadConfig: vi.fn(),
  mockWriteConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/config/loader.js', () => ({
  readConfig: mockReadConfig,
  writeConfig: mockWriteConfig,
}));

import { logAudit } from './logger.js';

afterEach(() => vi.clearAllMocks());

const baseEntry = {
  userId: 'u1',
  email: 'admin@example.com',
  endpoint: '/api/models',
  action: 'model:create',
  result: 'success' as const,
};

describe('logAudit', () => {
  it('appends a new entry with id and timestamp to the audit log', async () => {
    mockReadConfig.mockResolvedValue([]);
    await logAudit(baseEntry);
    expect(mockWriteConfig).toHaveBeenCalledOnce();
    const [, written] = mockWriteConfig.mock.calls[0]!;
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject(baseEntry);
    expect(typeof written[0].id).toBe('string');
    expect(typeof written[0].timestamp).toBe('string');
  });

  it('prunes entries older than 90 days', async () => {
    const old = {
      id: 'old-id',
      timestamp: new Date(Date.now() - 91 * 86400_000).toISOString(),
      ...baseEntry,
    };
    const recent = {
      id: 'recent-id',
      timestamp: new Date().toISOString(),
      ...baseEntry,
    };
    mockReadConfig.mockResolvedValue([old, recent]);
    await logAudit(baseEntry);
    const [, written] = mockWriteConfig.mock.calls[0]!;
    // old entry must be gone, recent + new entry remain
    expect(written.some((e: { id: string }) => e.id === 'old-id')).toBe(false);
    expect(written.some((e: { id: string }) => e.id === 'recent-id')).toBe(true);
  });

  it('never throws even when readConfig rejects', async () => {
    mockReadConfig.mockRejectedValue(new Error('disk full'));
    await expect(logAudit(baseEntry)).resolves.toBeUndefined();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });
});
