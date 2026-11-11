import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelConfig } from '@routerly/shared';

vi.mock('./fetcher.js', () => ({
  catalogFetcher: { get: vi.fn() },
}));
vi.mock('../config/loader.js', () => {
  const readConfig = vi.fn<(key: string) => Promise<unknown>>();
  const writeConfig = vi.fn<(key: string, value: unknown) => Promise<void>>(() => Promise.resolve());
  // Same read-mutate-write contract as the real updateConfig, on top of the mocked read/write.
  const updateConfig = vi.fn(async (key: string, mutate: (current: unknown) => unknown) => {
    const current = await readConfig(key);
    const next = await mutate(current);
    if (next !== current) await writeConfig(key, next);
    return next;
  });
  return { readConfig, writeConfig, updateConfig };
});
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn(() => Promise.resolve()) }));

import { catalogFetcher } from './fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { syncModelsFromCatalog, syncConnectionsFromCatalog, toCatalogDefaults } from './sync.js';
import { emitEvent } from '../notifications/emitter.js';
import { logAudit } from '../audit/logger.js';
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js';

const mockGet = vi.mocked(catalogFetcher.get);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

// Seeds readConfig('connections')/readConfig('instances') so syncModelsFromCatalog's
// listEffectiveModelsIncludingDisabled() resolves these models. Note: the resolved
// EffectiveModel is a NEW object built by resolveEffectiveModel(), not the same
// reference as the input `models` — assertions must read the object handed to
// writeConfig, not the original `m`.
function mockModels(models: ModelConfig[]) {
  const { instances, connections } = splitModelsIntoInstancesConnections(models);
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never;
    if (key === 'instances') return instances as never;
    return [] as never;
  });
}

function written(index = 0): any {
  const arg = mockWriteConfig.mock.calls[0]?.[1];
  return Array.isArray(arg) ? arg[index] : undefined;
}

// upstreamModelId defaults to the bare catalog id ('gpt-4'): real ModelInstance always
// carries upstreamModelId (see comment in the "catalog lookup" describe block below), so
// fixtures that aren't specifically testing id-stripping must set it explicitly to match
// the catalog fixture, exactly as a correctly-configured instance would.
function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai/gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    upstreamModelId: 'gpt-4',
    cost: { inputPerMillion: 30, outputPerMillion: 60 },
    ...overrides,
  } as ModelConfig;
}

function openaiCatalog(models: Array<{ id: string; input: number; output: number; [k: string]: unknown }>) {
  return { openai: { endpoint: 'https://api.openai.com/v1', models } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteConfig.mockResolvedValue(undefined as never);
});

describe('syncModelsFromCatalog', () => {
  describe('catalog lookup', () => {
    it('returns false and skips when provider not in catalog', async () => {
      mockGet.mockResolvedValue({});
      mockModels([makeModel()]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('returns false and skips when model id not found in provider catalog', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-5', input: 10, output: 20 }]));
      mockModels([makeModel({ id: 'openai/gpt-4' })]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('uses upstreamModelId for lookup when set', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'actual-upstream', input: 5, output: 15 }]));
      mockModels([makeModel({ id: 'openai/alias', upstreamModelId: 'actual-upstream' })]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    // resolveEffectiveModel (ROUT-275/283) maps an instance whose upstreamModelId equals its
    // full registry id back to the stripped default, so the provider prefix is still removed
    // for catalog lookups.
    it('strips provider prefix from id when no upstreamModelId was configured', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      const { upstreamModelId: _unused, ...noUpstream } = makeModel({ id: 'openai/gpt-4' });
      mockModels([noUpstream as ModelConfig]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('uses id as-is when no slash present', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      mockModels([makeModel({ id: 'gpt-4' })]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('strips only the provider segment of a multi-segment id when no upstreamModelId was configured', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'org/gpt-4', input: 5, output: 15 }]));
      const { upstreamModelId: _unused, ...noUpstream } = makeModel({ id: 'openai/org/gpt-4' });
      mockModels([noUpstream as ModelConfig]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('passes pkgVersion to catalogFetcher.get', async () => {
      mockGet.mockResolvedValue({});
      mockModels([]);
      await syncModelsFromCatalog('1.2.3');
      expect(mockGet).toHaveBeenCalledWith('1.2.3');
    });
  });

  describe('field updates', () => {
    it('updates inputPerMillion from catalog value', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.inputPerMillion).toBe(5);
    });

    it('updates outputPerMillion from catalog value', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.outputPerMillion).toBe(20);
    });

    it('updates cachePerMillion when present in catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cachePerMillion).toBe(1.25);
    });

    it('removes cachePerMillion when the catalog drops it', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost).not.toHaveProperty('cachePerMillion');
      expect(written().catalogDefaults).not.toHaveProperty('cachePerMillion');
    });

    it('removes cacheWritePerMillion, pricingTiers, contextWindow and capabilities when the catalog drops them', async () => {
      const tiers = [{ metric: 'input' as const, above: 200000, inputPerMillion: 6, outputPerMillion: 22 }];
      const m = makeModel({
        cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 7, pricingTiers: tiers },
        contextWindow: 128000,
        capabilities: { vision: true },
      });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      const w = written();
      expect(w.cost).not.toHaveProperty('cacheWritePerMillion');
      expect(w.cost).not.toHaveProperty('pricingTiers');
      expect(w.contextWindow).toBe(0);
      expect(w).not.toHaveProperty('capabilities');
      expect(w.cost).toEqual({ inputPerMillion: 5, outputPerMillion: 20 });
      expect(w.catalogDefaults).toEqual({ inputPerMillion: 5, outputPerMillion: 20 });
    });

    it('keeps overridden fields when the catalog drops them', async () => {
      const tiers = [{ metric: 'input' as const, above: 200000, inputPerMillion: 6, outputPerMillion: 22 }];
      const m = makeModel({
        cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 9, cacheWritePerMillion: 7, pricingTiers: tiers },
        contextWindow: 128000,
        capabilities: { vision: true },
        fieldOverrides: { cachePerMillion: true, cacheWritePerMillion: true, pricingTiers: true, contextWindow: true, capabilities: true },
      });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      const w = written();
      expect(w.cost).toEqual({ inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 9, cacheWritePerMillion: 7, pricingTiers: tiers });
      expect(w.contextWindow).toBe(128000);
      expect(w.capabilities).toEqual({ vision: true });
    });

    it('does not mark changed when cachePerMillion already matches catalog', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('does not mark changed when cacheWritePerMillion already matches catalog', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('updates cacheWritePerMillion when present in catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cacheWritePerMillion).toBe(3.75);
    });

    it('updates contextWindow when present in catalog', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().contextWindow).toBe(128000);
    });

    it('does not mark changed when contextWindow already matches catalog', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, contextWindow: 128000 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, contextWindow: 128000, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('updates capabilities when present in catalog', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, capabilities: { vision: true } }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().capabilities).toEqual({ vision: true });
    });

    it('maps pricingTiers fields correctly', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{
        id: 'gpt-4', input: 5, output: 20,
        pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9, cache: 1.5 }],
      }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.pricingTiers).toEqual([{
        metric: 'output', above: 1000000, inputPerMillion: 3, outputPerMillion: 9, cachePerMillion: 1.5,
      }]);
    });

    it('omits cachePerMillion from pricingTier when cache absent', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{
        id: 'gpt-4', input: 5, output: 20,
        pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9 }],
      }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.pricingTiers?.[0]).not.toHaveProperty('cachePerMillion');
    });

    it('stores catalogDefaults on model after sync', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().catalogDefaults).toEqual({ inputPerMillion: 5, outputPerMillion: 20, contextWindow: 128000 });
    });
  });

  describe('field override respect', () => {
    it('skips inputPerMillion when overridden (fieldOverrides-pinned value survives a sync tick)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 99, outputPerMillion: 20 }, fieldOverrides: { inputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.inputPerMillion).toBe(99);
    });

    it('skips outputPerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 99 }, fieldOverrides: { outputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.outputPerMillion).toBe(99);
    });

    it('skips cachePerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 }, fieldOverrides: { cachePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cachePerMillion).toBe(99);
    });

    it('skips cacheWritePerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 99 }, fieldOverrides: { cacheWritePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cacheWritePerMillion).toBe(99);
    });

    it('skips contextWindow when overridden', async () => {
      const m = makeModel({ contextWindow: 99999, fieldOverrides: { contextWindow: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().contextWindow).toBe(99999);
    });

    it('skips capabilities when overridden', async () => {
      const m = makeModel({ capabilities: { vision: false }, fieldOverrides: { capabilities: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, capabilities: { vision: true } }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().capabilities).toEqual({ vision: false });
    });

    it('skips pricingTiers when overridden', async () => {
      const existing = [{ metric: 'output', above: 0, inputPerMillion: 99, outputPerMillion: 99 }];
      const m = makeModel({
        cost: { inputPerMillion: 5, outputPerMillion: 20, pricingTiers: existing },
        fieldOverrides: { pricingTiers: true },
      });
      mockGet.mockResolvedValue(openaiCatalog([{
        id: 'gpt-4', input: 5, output: 20,
        pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9 }],
      }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.pricingTiers).toEqual(existing);
    });
  });

  describe('writeConfig behavior', () => {
    it('calls writeConfig and returns true when a field changes, writing the result back to instances', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(mockWriteConfig).toHaveBeenCalledOnce();
      expect(mockWriteConfig.mock.calls[0]?.[0]).toBe('instances');
      expect(mockWriteConfig.mock.calls[0]?.[1]).toHaveLength(1);
      expect(written().id).toBe(m.id);
      expect(written().cost.inputPerMillion).toBe(5);
    });

    it('does not call writeConfig and returns false when nothing changes', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('calls writeConfig once even with multiple changed models', async () => {
      const m1 = makeModel({ id: 'openai/gpt-4', cost: { inputPerMillion: 99, outputPerMillion: 60 } });
      const m2 = makeModel({ id: 'openai/gpt-5', cost: { inputPerMillion: 30, outputPerMillion: 99 } });
      mockGet.mockResolvedValue({
        openai: {
          endpoint: '...', models: [
            { id: 'gpt-4', input: 5, output: 60 },
            { id: 'gpt-5', input: 30, output: 10 },
          ],
        },
      });
      mockModels([m1, m2]);
      await syncModelsFromCatalog('0.3.0');
      expect(mockWriteConfig).toHaveBeenCalledTimes(1);
    });

    it('returns false with empty models list', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('updates catalogDefaults even when field values already match', async () => {
      // values match but catalogDefaults is undefined → still marks changed
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(written().catalogDefaults).toEqual({ inputPerMillion: 5, outputPerMillion: 20 });
    });

    it('writes the updated cost back onto the ModelInstance record (readConfig(\'instances\') shape, not the dead models.json)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');

      const [key, persisted] = mockWriteConfig.mock.calls[0]!;
      expect(key).toBe('instances');
      const instance = (persisted as any[])[0];
      // ModelInstance shape: connectionId + upstreamModelId, not the flat ModelConfig/EffectiveModel
      // fields (provider, endpoint, name) that only exist on the resolved effective model.
      expect(instance.connectionId).toBeDefined();
      expect(instance.upstreamModelId).toBe('gpt-4');
      expect(instance.cost.inputPerMillion).toBe(5);
      expect(instance.provider).toBeUndefined();
      expect(instance.endpoint).toBeUndefined();
    });
  });
});

// ─── ROUT-437: syncConnectionsFromCatalog ─────────────────────────────────────

const mockEmit = vi.mocked(emitEvent);
const mockAudit = vi.mocked(logAudit);

type Store = { connections: any[]; instances: any[]; routers: any[] };

function seed(store: Partial<Store>): Store {
  const state: Store = { connections: [], instances: [], routers: [], ...store };
  // Writes land in `state`, like the real files: a second sync run sees the first one's result.
  mockReadConfig.mockImplementation(async (key: string) => (state as any)[key] ?? []);
  mockWriteConfig.mockImplementation(async (key: string, value: unknown) => { (state as any)[key] = value; });
  return state;
}

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'c1', providerId: 'openai', label: 'openai', credentials: { apiKey: 'k' }, enabled: true, catalogSync: true, ...over,
});
const inst = (over: Record<string, unknown> = {}) => ({
  id: 'openai/gpt-4o', connectionId: 'c1', upstreamModelId: 'gpt-4o',
  cost: { inputPerMillion: 5, outputPerMillion: 15 }, contextWindow: 128000, ...over,
});
const catalogInst = (over: Record<string, unknown> = {}) => inst({ enabled: false, isNew: true, source: 'catalog', ...over });
const cat = (...models: Array<Record<string, unknown>>) => openaiCatalog(models as any);

describe('toCatalogDefaults', () => {
  it('maps prices, tiers, context window and capabilities and omits absent fields', () => {
    expect(toCatalogDefaults({ id: 'm', input: 1, output: 2 })).toEqual({ inputPerMillion: 1, outputPerMillion: 2 });
    expect(toCatalogDefaults({
      id: 'm', input: 1, output: 2, cache: 0.5, cacheWrite: 3, contextWindow: 8000, capabilities: { embedding: true },
      pricingTiers: [{ metric: 'input_tokens', above: 200000, input: 6, output: 12, cache: 1 }],
    })).toEqual({
      inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: 0.5, cacheWritePerMillion: 3, contextWindow: 8000,
      capabilities: { embedding: true },
      pricingTiers: [{ metric: 'input_tokens', above: 200000, inputPerMillion: 6, outputPerMillion: 12, cachePerMillion: 1 }],
    });
  });
});

describe('syncConnectionsFromCatalog', () => {
  describe('adding models', () => {
    it('creates every catalog model disabled and new, with catalog values and no limits, overrides or timeout', async () => {
      const state = seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat(
        { id: 'gpt-4o', input: 5, output: 15, cache: 2.5, contextWindow: 128000, capabilities: { embedding: false } },
        { id: 'gpt-4.1-nano', input: 0.1, output: 0.4 },
      ));
      const summary = await syncConnectionsFromCatalog('0.6.0');

      expect(summary).toEqual({ added: ['openai/gpt-4o', 'openai/gpt-4.1-nano'], unavailable: [], restored: [], skipped: [], catalogAvailable: true });
      const [a, b] = state.instances;
      expect(a).toEqual({
        id: 'openai/gpt-4o', connectionId: 'c1', upstreamModelId: 'gpt-4o',
        cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 2.5 },
        contextWindow: 128000, capabilities: { embedding: false },
        catalogDefaults: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 2.5, contextWindow: 128000, capabilities: { embedding: false } },
        enabled: false, isNew: true, source: 'catalog',
      });
      for (const m of state.instances) {
        expect(m).not.toHaveProperty('limits');
        expect(m).not.toHaveProperty('fieldOverrides');
        expect(m).not.toHaveProperty('timeout');
      }
      // missing contextWindow -> 0 (unknown), missing capabilities -> absent
      expect(b.contextWindow).toBe(0);
      expect(b).not.toHaveProperty('capabilities');
      expect(state.connections[0].catalogSeen).toEqual(['gpt-4o', 'gpt-4.1-nano']);
    });

    it('does not add deprecated models, and offers them once they are no longer deprecated', async () => {
      const state = seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'old', input: 1, output: 2, deprecated: true }, { id: 'gpt-4o', input: 5, output: 15 }));
      expect((await syncConnectionsFromCatalog('0.6.0')).added).toEqual(['openai/gpt-4o']);
      expect(state.connections[0].catalogSeen).toEqual(['gpt-4o']);

      mockGet.mockResolvedValue(cat({ id: 'old', input: 1, output: 2 }, { id: 'gpt-4o', input: 5, output: 15 }));
      expect((await syncConnectionsFromCatalog('0.6.0')).added).toEqual(['openai/old']);
    });

    it('does not re-add a model the operator deleted (catalogSeen)', async () => {
      const state = seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await syncConnectionsFromCatalog('0.6.0');
      state.instances = [];
      const again = await syncConnectionsFromCatalog('0.6.0');
      expect(again.added).toEqual([]);
      expect(state.instances).toEqual([]);
    });

    it('is idempotent: a second run changes nothing and writes nothing', async () => {
      seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await syncConnectionsFromCatalog('0.6.0');
      mockWriteConfig.mockClear();
      mockAudit.mockClear();
      const again = await syncConnectionsFromCatalog('0.6.0');
      expect(again).toEqual({ added: [], unavailable: [], restored: [], skipped: [], catalogAvailable: true });
      expect(mockWriteConfig).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it('skips a model whose id is taken by another connection, reports it and never overwrites', async () => {
      const taken = inst({ connectionId: 'other', upstreamModelId: 'custom-name', cost: { inputPerMillion: 1, outputPerMillion: 1 } });
      const state = seed({ connections: [conn()], instances: [taken] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }, { id: 'gpt-4.1-nano', input: 1, output: 2 }));
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary.skipped).toEqual([{ upstreamModelId: 'gpt-4o', reason: 'id_taken' }]);
      expect(summary.added).toEqual(['openai/gpt-4.1-nano']);
      expect(state.instances.find(i => i.id === 'openai/gpt-4o')).toBe(taken);
      // reported once: the id counts as seen
      expect((await syncConnectionsFromCatalog('0.6.0')).skipped).toEqual([]);
    });

    it('does not duplicate a model already configured on the connection (by upstream id) but marks it seen', async () => {
      const own = inst({ id: 'my-name', upstreamModelId: 'gpt-4o' });
      const state = seed({ connections: [conn()], instances: [own] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary.added).toEqual([]);
      expect(state.instances).toEqual([own]);
      expect(state.connections[0].catalogSeen).toEqual(['gpt-4o']);
    });

    it('does not touch the instances of a connection with catalogSync off or absent', async () => {
      const state = seed({ connections: [conn({ catalogSync: false }), conn({ id: 'c2', label: 'legacy', catalogSync: undefined })] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary).toEqual({ added: [], unavailable: [], restored: [], skipped: [], catalogAvailable: false });
      expect(state.instances).toEqual([]);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('only syncs the connection named in opts.connectionId', async () => {
      const state = seed({ connections: [conn(), conn({ id: 'c2', label: 'second' })] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await syncConnectionsFromCatalog('0.6.0', { connectionId: 'c2' });
      expect(summary.added).toEqual(['second/gpt-4o']);
      expect(state.instances.map(i => i.connectionId)).toEqual(['c2']);
    });
  });

  describe('availability', () => {
    const run = (opts?: Parameters<typeof syncConnectionsFromCatalog>[1]) => syncConnectionsFromCatalog('0.6.0', opts);

    it('flags a catalog model the catalog dropped as removed and keeps enabled untouched', async () => {
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst({ enabled: true, isNew: undefined })] });
      mockGet.mockResolvedValue(cat({ id: 'other', input: 1, output: 2 }));
      const summary = await run();
      expect(summary.unavailable).toEqual(['openai/gpt-4o']);
      expect(state.instances[0]).toMatchObject({ unavailable: 'removed', enabled: true });
    });

    it('flags a deprecated catalog model as deprecated', async () => {
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst({ enabled: true })] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15, deprecated: true }));
      expect((await run()).unavailable).toEqual(['openai/gpt-4o']);
      expect(state.instances[0].unavailable).toBe('deprecated');
    });

    it('restores a model that returns, to exactly its prior state', async () => {
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst({ enabled: true, isNew: undefined })] });
      mockGet.mockResolvedValue(cat({ id: 'other', input: 1, output: 2 }));
      await run();
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await run();
      expect(summary.restored).toEqual(['openai/gpt-4o']);
      expect(state.instances[0]).not.toHaveProperty('unavailable');
      expect(state.instances[0].enabled).toBe(true);
    });

    it('a never-enabled model that disappears and returns ends disabled and new', async () => {
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst()] });
      mockGet.mockResolvedValue(cat({ id: 'other', input: 1, output: 2 }));
      await run();
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await run();
      expect(state.instances[0]).toMatchObject({ enabled: false, isNew: true });
      expect(state.instances[0]).not.toHaveProperty('unavailable');
    });

    it('a change of reason (removed -> deprecated) updates the flag without a new event', async () => {
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst({ unavailable: 'removed' })] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15, deprecated: true }));
      const summary = await run();
      expect(state.instances[0].unavailable).toBe('deprecated');
      expect(summary.unavailable).toEqual([]);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('never flags a hand-made model, even one missing from the catalog', async () => {
      const hand = inst({ id: 'my-finetune', upstreamModelId: 'ft:gpt-4o:acme' });
      const state = seed({ connections: [conn()], instances: [hand] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await run();
      expect(summary.unavailable).toEqual([]);
      expect(state.instances.find(i => i.id === 'my-finetune')).toBe(hand);
    });

    it('emits model_unavailable with the routers that use the model (direct and via token) and model_restored', async () => {
      seed({
        connections: [conn({ catalogSeen: ['gpt-4o'] })], instances: [catalogInst({ enabled: true })],
        routers: [
          { id: 'r1', name: 'Direct', models: [{ modelId: 'openai/gpt-4o' }], tokens: [] },
          { id: 'r2', name: 'ViaToken', models: [], tokens: [{ id: 't', models: [{ modelId: 'openai/gpt-4o' }] }] },
          { id: 'r3', name: 'Unrelated', models: [{ modelId: 'x' }], tokens: [] },
        ],
      });
      mockGet.mockResolvedValue(cat({ id: 'other', input: 1, output: 2 }));
      await run();
      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith('config.model_unavailable', 'warning', {
        modelId: 'openai/gpt-4o', connectionId: 'c1', reason: 'removed',
        routers: [{ id: 'r1', name: 'Direct' }, { id: 'r2', name: 'ViaToken' }],
      });

      mockEmit.mockClear();
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await run();
      expect(mockEmit).toHaveBeenCalledWith('config.model_restored', 'info', expect.objectContaining({ modelId: 'openai/gpt-4o', connectionId: 'c1', routers: expect.any(Array) }));
    });
  });

  describe('safety', () => {
    it.each([
      ['the provider key is missing from the catalog', {}],
      ['the catalog is empty', { openai: { endpoint: 'x', models: [] } }],
    ])('changes nothing when %s', async (_name, catalog) => {
      const instances = [catalogInst({ enabled: true }), inst({ id: 'hand', upstreamModelId: 'hand' })];
      const state = seed({ connections: [conn({ catalogSeen: ['gpt-4o'] })], instances });
      mockGet.mockResolvedValue(catalog as any);
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary).toEqual({ added: [], unavailable: [], restored: [], skipped: [], catalogAvailable: false });
      expect(state.instances).toEqual(instances);
      expect(mockWriteConfig).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it('a fetch failure is an unavailable catalog, not an error', async () => {
      const state = seed({ connections: [conn()], instances: [catalogInst({ enabled: true })] });
      mockGet.mockRejectedValue(new Error('network down'));
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary.catalogAvailable).toBe(false);
      expect(state.instances[0]).not.toHaveProperty('unavailable');
    });

    it('a missing provider key on one connection does not stop the others', async () => {
      const state = seed({ connections: [conn({ id: 'c0', providerId: 'nope', label: 'nope' }), conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      const summary = await syncConnectionsFromCatalog('0.6.0');
      expect(summary.added).toEqual(['openai/gpt-4o']);
      expect(state.instances.every(i => i.connectionId === 'c1')).toBe(true);
    });

    it('goes through the locked updateConfig, never a bare writeConfig of a stale read', async () => {
      const { updateConfig } = await import('../config/loader.js');
      seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await syncConnectionsFromCatalog('0.6.0');
      expect(vi.mocked(updateConfig).mock.calls.map(c => c[0])).toEqual(['instances', 'connections']);
    });
  });

  describe('audit', () => {
    it('logs catalog:sync as system for a background run, with the summary', async () => {
      seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await syncConnectionsFromCatalog('0.6.0');
      expect(mockAudit).toHaveBeenCalledWith({
        userId: 'system', email: 'system', endpoint: 'catalog-sync', action: 'catalog:sync', result: 'success',
        details: { added: ['openai/gpt-4o'], unavailable: [], restored: [], skipped: [], catalogAvailable: true },
      });
    });

    it('logs the actor and route for a user-triggered run', async () => {
      seed({ connections: [conn()] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      await syncConnectionsFromCatalog('0.6.0', { connectionId: 'c1', actor: { id: 'u1', email: 'a@b.c', endpoint: 'POST /api/connections/c1/sync' } });
      expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', email: 'a@b.c', endpoint: 'POST /api/connections/c1/sync', action: 'catalog:sync' }));
    });
  });

  describe('price sync unchanged', () => {
    it('syncModelsFromCatalog still updates prices of a catalog-sourced model and leaves its state flags alone', async () => {
      const state = seed({ connections: [conn()], instances: [catalogInst({ cost: { inputPerMillion: 1, outputPerMillion: 1 } })] });
      mockGet.mockResolvedValue(cat({ id: 'gpt-4o', input: 5, output: 15 }));
      expect(await syncModelsFromCatalog('0.6.0')).toBe(true);
      expect(state.instances[0]).toMatchObject({ cost: { inputPerMillion: 5, outputPerMillion: 15 }, enabled: false, isNew: true, source: 'catalog' });
    });
  });
});
