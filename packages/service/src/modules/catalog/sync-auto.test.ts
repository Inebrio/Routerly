import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./fetcher.js', () => ({
  catalogFetcher: { get: vi.fn(), getStatus: vi.fn() },
}));
vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(() => Promise.resolve([])),
  writeConfig: vi.fn(() => Promise.resolve()),
}));

import { catalogFetcher } from './fetcher.js';
import { readConfig } from '../config/loader.js';
import { runCatalogSync, startCatalogSync } from './sync.js';

const mockGet = vi.mocked(catalogFetcher.get);
const mockStatus = vi.mocked(catalogFetcher.getStatus);
const mockRead = vi.mocked(readConfig);
const ok = [{ url: 'u', enabled: true, resolvedFile: 'f', updatedAt: null, lastChecked: 'x', error: null }];

beforeEach(() => { vi.clearAllMocks(); mockGet.mockResolvedValue({}); mockStatus.mockReturnValue(ok); });
afterEach(() => vi.useRealTimers());

describe('automatic catalog sync', () => {
  it('applies the catalog when the fetch succeeds', async () => {
    await runCatalogSync('1.0.0');
    expect(mockGet).toHaveBeenCalledWith('1.0.0');
    expect(mockRead).toHaveBeenCalled(); // sync reached the model lookup
  });

  it('changes nothing when the fetch fails (error stays in status)', async () => {
    mockStatus.mockReturnValue([{ ...ok[0]!, error: 'boom' }]);
    await runCatalogSync('1.0.0');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('does not throw when get rejects', async () => {
    mockGet.mockRejectedValue(new Error('net'));
    await expect(runCatalogSync('1.0.0')).resolves.toBeUndefined();
  });

  it('runs at start and again every ~6h', async () => {
    vi.useFakeTimers();
    const t = startCatalogSync('1.0.0');
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6 * 3600_000 + 60_000);
    expect(mockGet).toHaveBeenCalledTimes(4); // each run = fetch + sync's own get
    clearInterval(t);
  });
});
