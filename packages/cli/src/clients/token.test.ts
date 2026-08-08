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
    const result = await acquireToken({ routerId: 'proj-1', explicitToken: 'sk-rt-explicit' });
    expect(result).toBe('sk-rt-explicit');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('mints a new token via the routers tokens endpoint when no explicitToken given', async () => {
    mockApi.mockResolvedValue({ token: 'sk-rt-minted' });
    const result = await acquireToken({ routerId: 'proj-1' });
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/routers/proj-1/tokens', { labels: ['client:configurator'] });
    expect(result).toBe('sk-rt-minted');
  });

  it('sends scopes in the request body when provided', async () => {
    mockApi.mockResolvedValue({ token: 'sk-rt-scoped' });
    const result = await acquireToken({ routerId: 'proj-1', scopes: ['mcp', 'mcp:write'] });
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/routers/proj-1/tokens', {
      labels: ['client:configurator'],
      scopes: ['mcp', 'mcp:write'],
    });
    expect(result).toBe('sk-rt-scoped');
  });

  it('omits the scopes field entirely when not provided', async () => {
    mockApi.mockResolvedValue({ token: 'sk-rt-minted' });
    await acquireToken({ routerId: 'proj-1' });
    const body = mockApi.mock.calls[0]![2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('scopes');
  });
});
