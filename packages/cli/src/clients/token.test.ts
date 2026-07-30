import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mocks (hoisted before imports) ────────────────────────────────────────

const { mockApi } = vi.hoisted(() => ({
  mockApi: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: mockApi,
}));

import { acquireToken } from './token.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('acquireToken', () => {
  it('returns explicitToken verbatim and makes no HTTP call', async () => {
    const result = await acquireToken({ projectId: 'proj-1', explicitToken: 'sk-rt-explicit' });
    expect(result).toBe('sk-rt-explicit');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('mints a new token via the projects tokens endpoint when no explicitToken given', async () => {
    mockApi.mockResolvedValue({ token: 'sk-rt-minted' });
    const result = await acquireToken({ projectId: 'proj-1' });
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/projects/proj-1/tokens', { labels: ['client:configurator'] });
    expect(result).toBe('sk-rt-minted');
  });
});
