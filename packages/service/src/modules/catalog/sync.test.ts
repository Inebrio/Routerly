import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelConfig } from '@routerly/shared';

vi.mock('./fetcher.js', () => ({
  catalogFetcher: { get: vi.fn() },
}));
vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(() => Promise.resolve()),
}));

import { catalogFetcher } from './fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { syncModelsFromCatalog } from './sync.js';
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

    // connections-cutover (A3/A2): migrate-connections.ts (not touched by A3) sets
    // instance.upstreamModelId = model.upstreamModelId ?? model.id — i.e. always the full,
    // provider-prefixed id when no explicit upstreamModelId was configured. Since
    // resolveEffectiveModel always copies instance.upstreamModelId onto the effective
    // model, sync.ts's `model.upstreamModelId ?? <strip-provider-prefix>` fallback branch
    // is now unreachable: model.upstreamModelId is never undefined post-cutover, so the
    // id-stripping fallback never runs and catalog lookups for migrated models without an
    // explicit upstreamModelId now use the unstripped, prefixed id and MISS the catalog
    // entry. Flagged as a concern in task-A3-report.md (real regression, not test noise).
    it('does NOT strip provider prefix from id when no upstreamModelId was configured (id-stripping fallback is unreachable post-cutover)', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      const { upstreamModelId: _unused, ...noUpstream } = makeModel({ id: 'openai/gpt-4' });
      mockModels([noUpstream as ModelConfig]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('uses id as-is when no slash present', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      mockModels([makeModel({ id: 'gpt-4' })]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('does NOT strip multi-segment id to its last segment when no upstreamModelId was configured (id-stripping fallback is unreachable post-cutover)', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'org/gpt-4', input: 5, output: 15 }]));
      const { upstreamModelId: _unused, ...noUpstream } = makeModel({ id: 'openai/org/gpt-4' });
      mockModels([noUpstream as ModelConfig]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
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

    it('does not touch cachePerMillion when absent from catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cachePerMillion).toBe(99);
    });

    // connections-cutover (A3): catalogDefaults has no home on ModelInstance (see A2),
    // so it never survives the instances/connections round trip and is always undefined
    // on the resolved effective model — sync now always reports changed=true, even when
    // the live values already match the catalog. Flagged as a concern in task-A3-report.md.
    it('marks changed even when cachePerMillion already matches catalog (catalogDefaults cannot round-trip through instances)', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('marks changed even when cacheWritePerMillion already matches catalog (catalogDefaults cannot round-trip through instances)', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
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

    it('marks changed even when contextWindow already matches (catalogDefaults cannot round-trip through instances)', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, contextWindow: 128000 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, contextWindow: 128000, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
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

  // connections-cutover (A3): fieldOverrides has no home on ModelInstance (see A2), so
  // it never survives the instances/connections round trip — isOverridden() always sees
  // `undefined` on the resolved effective model and every catalog-tracked field gets
  // overwritten regardless of what the user pinned. This is a real regression surfaced
  // by wiring the real instances/connections read path through here; flagged as a
  // concern in task-A3-report.md, not fixed by this task (schema decision, not a read swap).
  describe('field override respect (currently non-functional post-cutover, see comment above)', () => {
    it('does NOT skip inputPerMillion when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 99, outputPerMillion: 20 }, fieldOverrides: { inputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.inputPerMillion).toBe(5);
    });

    it('does NOT skip outputPerMillion when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 99 }, fieldOverrides: { outputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.outputPerMillion).toBe(20);
    });

    it('does NOT skip cachePerMillion when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 }, fieldOverrides: { cachePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cachePerMillion).toBe(1.25);
    });

    it('does NOT skip cacheWritePerMillion when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 99 }, fieldOverrides: { cacheWritePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().cost.cacheWritePerMillion).toBe(3.75);
    });

    it('does NOT skip contextWindow when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ contextWindow: 99999, fieldOverrides: { contextWindow: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().contextWindow).toBe(128000);
    });

    it('does NOT skip capabilities when overridden (fieldOverrides lost)', async () => {
      const m = makeModel({ capabilities: { vision: false }, fieldOverrides: { capabilities: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, capabilities: { vision: true } }]));
      mockModels([m]);
      await syncModelsFromCatalog('0.3.0');
      expect(written().capabilities).toEqual({ vision: true });
    });

    it('does NOT skip pricingTiers when overridden (fieldOverrides lost)', async () => {
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
      expect(written().cost.pricingTiers).toEqual([
        { metric: 'output', above: 1000000, inputPerMillion: 3, outputPerMillion: 9 },
      ]);
    });
  });

  describe('writeConfig behavior', () => {
    it('calls writeConfig and returns true when a field changes', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(mockWriteConfig).toHaveBeenCalledOnce();
      expect(mockWriteConfig.mock.calls[0]?.[0]).toBe('models');
      expect(mockWriteConfig.mock.calls[0]?.[1]).toHaveLength(1);
      expect(written().id).toBe(m.id);
      expect(written().cost.inputPerMillion).toBe(5);
    });

    // connections-cutover (A3): catalogDefaults cannot round-trip through ModelInstance
    // (see comment on the "field updates" describe block above), so sync now always
    // reports changed=true even when nothing has actually drifted from the catalog.
    it('calls writeConfig and returns true even when nothing changes (catalogDefaults cannot round-trip through instances)', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockModels([m]);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(mockWriteConfig).toHaveBeenCalledOnce();
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
  });
});
