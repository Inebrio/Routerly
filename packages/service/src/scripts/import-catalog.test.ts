import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelInstance, ProviderConnection } from '@routerly/shared';

vi.mock('../modules/catalog/fetcher.js', () => ({
  catalogFetcher: { get: vi.fn() },
}));
vi.mock('../modules/config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(() => Promise.resolve()),
}));

import { catalogFetcher } from '../modules/catalog/fetcher.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';
import { importCatalog, parseArgs, main } from './import-catalog.js';

const mockGet = vi.mocked(catalogFetcher.get);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

interface TestCatalogEntry {
  id: string;
  input: number;
  output: number;
  cache?: number;
  cacheWrite?: number;
  contextWindow?: number;
  deprecated?: boolean;
  capabilities?: { embedding?: boolean };
  pricingTiers?: Array<{ metric: string; above: number; input: number; output: number; cache?: number }>;
}

function openaiCatalog(models: TestCatalogEntry[]) {
  return { openai: { endpoint: 'https://api.openai.com/v1', models } };
}

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return { id: 'c1', providerId: 'openai', label: 'OpenAI', credentials: {}, enabled: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteConfig.mockResolvedValue(undefined as never);
  mockReadConfig.mockImplementation((key: string) => {
    if (key === 'instances') return Promise.resolve([] as never);
    if (key === 'connections') return Promise.resolve([connection()] as never);
    throw new Error(`unexpected readConfig(${key})`);
  });
});

describe('importCatalog', () => {
  it('upserts instances from catalog and is idempotent', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    let instances: ModelInstance[] = [];
    mockWriteConfig.mockImplementation((key: string, value: unknown) => {
      if (key === 'instances') instances = value as ModelInstance[];
      return Promise.resolve(undefined as never);
    });
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'instances') return Promise.resolve(instances as never);
      if (key === 'connections') return Promise.resolve([connection()] as never);
      throw new Error(`unexpected readConfig(${key})`);
    });

    const first = await importCatalog({ provider: 'openai', connectionId: 'c1' });
    expect(first.upserted).toBeGreaterThan(0);
    expect(mockWriteConfig).toHaveBeenCalledOnce();

    const second = await importCatalog({ provider: 'openai', connectionId: 'c1' });
    expect(second.upserted).toBe(0);
    expect(mockWriteConfig).toHaveBeenCalledOnce();
  });

  it('creates a ModelInstance with mapped id, cost, and contextWindow', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    await importCatalog({ provider: 'openai', connectionId: 'c1' });
    const written = (mockWriteConfig.mock.calls[0]?.[1] ?? []) as ModelInstance[];
    expect(written[0]).toEqual({
      id: 'c1__gpt-4o',
      connectionId: 'c1',
      upstreamModelId: 'gpt-4o',
      cost: { inputPerMillion: 5, outputPerMillion: 15 },
      contextWindow: 128000,
    });
  });

  it('defaults contextWindow to 0 when catalog entry omits it', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15 }]));
    await importCatalog({ provider: 'openai', connectionId: 'c1' });
    const written = (mockWriteConfig.mock.calls[0]?.[1] ?? []) as ModelInstance[];
    expect(written[0]?.contextWindow).toBe(0);
  });

  it('maps cache, cacheWrite, capabilities, and pricingTiers', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{
      id: 'gpt-4o', input: 5, output: 15, cache: 1.25, cacheWrite: 3.75,
      capabilities: { embedding: true },
      pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9, cache: 1.5 }],
    }]));
    await importCatalog({ provider: 'openai', connectionId: 'c1' });
    const written = (mockWriteConfig.mock.calls[0]?.[1] ?? []) as ModelInstance[];
    expect(written[0]?.cost).toEqual({
      inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 1.25, cacheWritePerMillion: 3.75,
      pricingTiers: [{ metric: 'output', above: 1000000, inputPerMillion: 3, outputPerMillion: 9, cachePerMillion: 1.5 }],
    });
    expect(written[0]?.capabilities).toEqual({ embedding: true });
  });

  it('omits cachePerMillion from pricingTier when cache absent', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{
      id: 'gpt-4o', input: 5, output: 15,
      pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9 }],
    }]));
    await importCatalog({ provider: 'openai', connectionId: 'c1' });
    const written = (mockWriteConfig.mock.calls[0]?.[1] ?? []) as ModelInstance[];
    expect(written[0]?.cost.pricingTiers?.[0]).not.toHaveProperty('cachePerMillion');
  });

  it('skips deprecated entries entirely', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-3.5', input: 1, output: 2, deprecated: true }]));
    const result = await importCatalog({ provider: 'openai', connectionId: 'c1' });
    expect(result.upserted).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('updates an existing instance when catalog values change', async () => {
    const existing: ModelInstance = {
      id: 'c1__gpt-4o', connectionId: 'c1', upstreamModelId: 'gpt-4o',
      cost: { inputPerMillion: 99, outputPerMillion: 99 }, contextWindow: 1000,
      capabilities: { embedding: true },
    };
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'instances') return Promise.resolve([existing] as never);
      if (key === 'connections') return Promise.resolve([connection()] as never);
      throw new Error(`unexpected readConfig(${key})`);
    });
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    const result = await importCatalog({ provider: 'openai', connectionId: 'c1' });
    expect(result.upserted).toBe(1);
    const written = (mockWriteConfig.mock.calls[0]?.[1] ?? []) as ModelInstance[];
    expect(written[0]?.cost.inputPerMillion).toBe(5);
    expect(written[0]?.contextWindow).toBe(128000);
  });

  it('resolves provider from the connection when opts.provider is omitted', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    const result = await importCatalog({ connectionId: 'c1' });
    expect(result.upserted).toBe(1);
    expect(mockReadConfig).toHaveBeenCalledWith('connections');
  });

  it('throws when connectionId does not resolve to a known connection and no provider given', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'instances') return Promise.resolve([] as never);
      if (key === 'connections') return Promise.resolve([] as never);
      throw new Error(`unexpected readConfig(${key})`);
    });
    await expect(importCatalog({ connectionId: 'missing' })).rejects.toThrow('Connection not found: missing');
  });

  it('throws when connectionId does not resolve to a known connection even if provider is given', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'instances') return Promise.resolve([] as never);
      if (key === 'connections') return Promise.resolve([] as never);
      throw new Error(`unexpected readConfig(${key})`);
    });
    await expect(importCatalog({ provider: 'openai', connectionId: 'missing' })).rejects.toThrow('Connection not found: missing');
  });

  it('throws when the explicit provider disagrees with the resolved connection providerId', async () => {
    mockReadConfig.mockImplementation((key: string) => {
      if (key === 'instances') return Promise.resolve([] as never);
      if (key === 'connections') return Promise.resolve([connection({ providerId: 'anthropic' })] as never);
      throw new Error(`unexpected readConfig(${key})`);
    });
    await expect(importCatalog({ provider: 'openai', connectionId: 'c1' })).rejects.toThrow(
      "Provider mismatch: connection 'c1' is bound to provider 'anthropic', not 'openai'",
    );
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('returns upserted: 0 when the provider is absent from the catalog', async () => {
    mockGet.mockResolvedValue({});
    const result = await importCatalog({ provider: 'openai', connectionId: 'c1' });
    expect(result.upserted).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('passes routerlyVersion override to catalogFetcher.get', async () => {
    mockGet.mockResolvedValue({});
    await importCatalog({ provider: 'openai', connectionId: 'c1', routerlyVersion: '9.9.9' });
    expect(mockGet).toHaveBeenCalledWith('9.9.9');
  });
});

describe('parseArgs', () => {
  it('parses --provider and --connection flags', () => {
    expect(parseArgs(['--provider', 'openai', '--connection', 'c1'])).toEqual({ provider: 'openai', connection: 'c1' });
  });

  it('ignores unknown flags', () => {
    expect(parseArgs(['--foo', 'bar', '--connection', 'c1'])).toEqual({ connection: 'c1' });
  });

  it('ignores a dangling --provider flag with no value', () => {
    expect(parseArgs(['--provider'])).toEqual({});
  });

  it('ignores a dangling --connection flag with no value', () => {
    expect(parseArgs(['--connection'])).toEqual({});
  });
});

describe('main', () => {
  it('prints usage and exits 1 when --connection is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(main(['--provider', 'openai'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('runs importCatalog and prints the result to stdout', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await main(['--provider', 'openai', '--connection', 'c1']);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Upserted 1 instance'));
  });

  it('resolves provider from the connection when --provider is omitted', async () => {
    mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4o', input: 5, output: 15, contextWindow: 128000 }]));
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await main(['--connection', 'c1']);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Upserted 1 instance'));
  });
});
