import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./sync.js', () => ({
  syncModelsFromCatalog: vi.fn(() => Promise.resolve(false)),
  syncConnectionsFromCatalog: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(() => Promise.resolve({})) }));
vi.mock('./fetcher.js', async (orig) => ({
  ...(await orig<typeof import('./fetcher.js')>()),
  catalogFetcher: { get: vi.fn(), setRepos: vi.fn(), invalidate: vi.fn(), getStatus: vi.fn() },
}));

import { catalogModule } from './index.js';
import { CACHE_TTL_MS } from './fetcher.js';
import { syncModelsFromCatalog, syncConnectionsFromCatalog } from './sync.js';

const ctx = {} as never;

describe('catalog module sync timer (ROUT-437)', () => {
  const env = { NODE_ENV: process.env['NODE_ENV'], STDIO: process.env['ROUTERLY_MCP_STDIO'] };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env['ROUTERLY_MCP_STDIO'];
  });
  afterEach(async () => {
    await catalogModule.stop?.();
    vi.useRealTimers();
    process.env['NODE_ENV'] = env.NODE_ENV;
    if (env.STDIO === undefined) delete process.env['ROUTERLY_MCP_STDIO']; else process.env['ROUTERLY_MCP_STDIO'] = env.STDIO;
  });

  it('exports a 6 hour TTL', () => {
    expect(CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('does not fetch or sync at start under NODE_ENV=test, only arms the timer', async () => {
    process.env['NODE_ENV'] = 'test';
    await catalogModule.start?.(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncModelsFromCatalog).not.toHaveBeenCalled();
    expect(syncConnectionsFromCatalog).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('runs price sync then connection sync on every CACHE_TTL_MS tick', async () => {
    process.env['NODE_ENV'] = 'test';
    await catalogModule.start?.(ctx);
    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS - 1);
    expect(syncConnectionsFromCatalog).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(syncModelsFromCatalog).toHaveBeenCalledTimes(1);
    expect(syncConnectionsFromCatalog).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS);
    expect(syncConnectionsFromCatalog).toHaveBeenCalledTimes(2);
  });

  it('stop() clears the timer', async () => {
    process.env['NODE_ENV'] = 'test';
    await catalogModule.start?.(ctx);
    await catalogModule.stop?.();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS * 2);
    expect(syncConnectionsFromCatalog).not.toHaveBeenCalled();
  });

  it('start() twice keeps a single timer', async () => {
    process.env['NODE_ENV'] = 'test';
    await catalogModule.start?.(ctx);
    await catalogModule.start?.(ctx);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('outside test it also runs one pass at startup', async () => {
    process.env['NODE_ENV'] = 'production';
    await catalogModule.start?.(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncModelsFromCatalog).toHaveBeenCalledTimes(1);
    expect(syncConnectionsFromCatalog).toHaveBeenCalledTimes(1);
  });

  it('a failing pass never throws out of the timer', async () => {
    process.env['NODE_ENV'] = 'test';
    vi.mocked(syncModelsFromCatalog).mockRejectedValueOnce(new Error('boom'));
    await catalogModule.start?.(ctx);
    await expect(vi.advanceTimersByTimeAsync(CACHE_TTL_MS)).resolves.not.toThrow();
  });

  it('MCP stdio side process never syncs and arms no timer', async () => {
    process.env['ROUTERLY_MCP_STDIO'] = '1';
    process.env['NODE_ENV'] = 'production';
    await catalogModule.start?.(ctx);
    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS * 2);
    expect(syncModelsFromCatalog).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
