import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}));

import { migrateModelsToConnections } from './migrate-connections.js';
import { readConfig, writeConfig } from './loader.js';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

afterEach(() => vi.clearAllMocks());

const sharedModels = [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    endpoint: 'e',
    apiKey: 'k',
    cost: { inputPerMillion: 5, outputPerMillion: 15 },
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    endpoint: 'e',
    apiKey: 'k',
    cost: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
];

function stubStores(models: unknown[], connections: unknown[] = [], instances: unknown[] = []): void {
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'models') return models as any;
    if (key === 'connections') return connections as any;
    if (key === 'instances') return instances as any;
    return [] as any;
  });
}

describe('migrateModelsToConnections', () => {
  it('groups shared-credential models into one connection', async () => {
    stubStores(sharedModels);

    const r = await migrateModelsToConnections();

    expect(r.connections).toBe(1);
    expect(r.instances).toBe(2);

    const savedConnections = mockWriteConfig.mock.calls.find((c) => c[0] === 'connections')?.[1] as any[];
    const savedInstances = mockWriteConfig.mock.calls.find((c) => c[0] === 'instances')?.[1] as any[];
    expect(savedConnections).toHaveLength(1);
    expect(savedInstances).toHaveLength(2);
    expect(savedInstances[0].connectionId).toBe(savedConnections[0].id);
    expect(savedInstances[1].connectionId).toBe(savedConnections[0].id);
    expect(savedConnections[0].label).toBe(savedConnections[0].providerId);
  });

  it('strips a legacy "(migrated)" suffix from existing connection labels', async () => {
    mockReadConfig.mockImplementation(async (key: string) => {
      if (key === 'models') return [] as any;
      if (key === 'connections')
        return [{ id: 'c1', providerId: 'openai', label: 'openai (migrated)', credentials: {}, enabled: true }] as any;
      if (key === 'instances') return [] as any;
      return [] as any;
    });

    await migrateModelsToConnections();

    const savedConnections = mockWriteConfig.mock.calls.find((c) => c[0] === 'connections')?.[1] as any[];
    expect(savedConnections[0].label).toBe('openai');
  });

  it('is idempotent', async () => {
    // First run starts from empty stores; second run sees what the first run produced.
    let connections: unknown[] = [];
    let instances: unknown[] = [];
    mockReadConfig.mockImplementation(async (key: string) => {
      if (key === 'models') return sharedModels as any;
      if (key === 'connections') return connections as any;
      if (key === 'instances') return instances as any;
      return [] as any;
    });
    mockWriteConfig.mockImplementation(async (key: string, data: any) => {
      if (key === 'connections') connections = data;
      if (key === 'instances') instances = data;
    });

    const first = await migrateModelsToConnections();
    expect(first.connections).toBe(1);
    expect(first.instances).toBe(2);

    const second = await migrateModelsToConnections();
    expect(second.connections).toBe(0);
    expect(second.instances).toBe(0);
  });

  it('does not write connections/instances when there is nothing new', async () => {
    stubStores([]);

    const r = await migrateModelsToConnections();

    expect(r.connections).toBe(0);
    expect(r.instances).toBe(0);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('only copies defined credential fields onto the connection', async () => {
    stubStores([
      {
        id: 'anthropic/claude',
        name: 'Claude',
        provider: 'anthropic',
        endpoint: 'e2',
        apiKey: 'a-key',
        cost: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ]);

    await migrateModelsToConnections();

    const savedConnections = mockWriteConfig.mock.calls.find((c) => c[0] === 'connections')?.[1] as any[];
    expect(savedConnections[0].credentials).toEqual({ apiKey: 'a-key' });
  });

  it('carries cost, contextWindow fallback, and upstreamModelId fallback onto the instance', async () => {
    stubStores([
      {
        id: 'openai/custom-id',
        name: 'Custom',
        provider: 'openai',
        endpoint: 'e3',
        apiKey: 'k3',
        cost: { inputPerMillion: 1, outputPerMillion: 2 },
      },
    ]);

    await migrateModelsToConnections();

    const savedInstances = mockWriteConfig.mock.calls.find((c) => c[0] === 'instances')?.[1] as any[];
    expect(savedInstances[0].id).toBe('openai/custom-id');
    expect(savedInstances[0].upstreamModelId).toBe('openai/custom-id');
    expect(savedInstances[0].contextWindow).toBe(0);
    expect(savedInstances[0].cost).toEqual({ inputPerMillion: 1, outputPerMillion: 2 });
  });
});
