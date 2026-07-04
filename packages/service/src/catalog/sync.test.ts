import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelConfig } from '@routerly/shared';

vi.mock('../catalog/fetcher.js', () => ({
  catalogFetcher: { get: vi.fn() },
}));
vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(() => Promise.resolve()),
}));

import { catalogFetcher } from '../catalog/fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { syncModelsFromCatalog } from './sync.js';

const mockGet = vi.mocked(catalogFetcher.get);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai/gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
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
      mockReadConfig.mockResolvedValue([makeModel()] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('returns false and skips when model id not found in provider catalog', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-5', input: 10, output: 20 }]));
      mockReadConfig.mockResolvedValue([makeModel({ id: 'openai/gpt-4' })] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('uses upstreamModelId for lookup when set', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'actual-upstream', input: 5, output: 15 }]));
      mockReadConfig.mockResolvedValue([makeModel({ id: 'openai/alias', upstreamModelId: 'actual-upstream' })] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('strips provider prefix from id when no upstreamModelId', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      mockReadConfig.mockResolvedValue([makeModel({ id: 'openai/gpt-4' })] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('uses id as-is when no slash present', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 15 }]));
      mockReadConfig.mockResolvedValue([makeModel({ id: 'gpt-4' })] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('handles multi-segment id by stripping first segment only', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'org/gpt-4', input: 5, output: 15 }]));
      mockReadConfig.mockResolvedValue([makeModel({ id: 'openai/org/gpt-4' })] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
    });

    it('passes pkgVersion to catalogFetcher.get', async () => {
      mockGet.mockResolvedValue({});
      mockReadConfig.mockResolvedValue([] as never);
      await syncModelsFromCatalog('1.2.3');
      expect(mockGet).toHaveBeenCalledWith('1.2.3');
    });
  });

  describe('field updates', () => {
    it('updates inputPerMillion from catalog value', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.inputPerMillion).toBe(5);
    });

    it('updates outputPerMillion from catalog value', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.outputPerMillion).toBe(20);
    });

    it('updates cachePerMillion when present in catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.cachePerMillion).toBe(1.25);
    });

    it('does not touch cachePerMillion when absent from catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.cachePerMillion).toBe(99);
    });

    it('does not mark changed when cachePerMillion already matches catalog', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 1.25 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('does not mark changed when cacheWritePerMillion already matches catalog', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 3.75 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('updates cacheWritePerMillion when present in catalog', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.cacheWritePerMillion).toBe(3.75);
    });

    it('updates contextWindow when present in catalog', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.contextWindow).toBe(128000);
    });

    it('does not mark changed when contextWindow already matches', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20, contextWindow: 128000 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, contextWindow: 128000, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
    });

    it('updates capabilities when present in catalog', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, capabilities: { vision: true } }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.capabilities).toEqual({ vision: true });
    });

    it('maps pricingTiers fields correctly', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{
        id: 'gpt-4', input: 5, output: 20,
        pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9, cache: 1.5 }],
      }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.pricingTiers).toEqual([{
        metric: 'output', above: 1000000, inputPerMillion: 3, outputPerMillion: 9, cachePerMillion: 1.5,
      }]);
    });

    it('omits cachePerMillion from pricingTier when cache absent', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{
        id: 'gpt-4', input: 5, output: 20,
        pricingTiers: [{ metric: 'output', above: 1000000, input: 3, output: 9 }],
      }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.pricingTiers?.[0]).not.toHaveProperty('cachePerMillion');
    });

    it('stores catalogDefaults on model after sync', async () => {
      const m = makeModel();
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.catalogDefaults).toEqual({ inputPerMillion: 5, outputPerMillion: 20, contextWindow: 128000 });
    });
  });

  describe('field override respect', () => {
    it('skips inputPerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 99, outputPerMillion: 20 }, fieldOverrides: { inputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.inputPerMillion).toBe(99);
    });

    it('skips outputPerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 99 }, fieldOverrides: { outputPerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.outputPerMillion).toBe(99);
    });

    it('skips cachePerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: 99 }, fieldOverrides: { cachePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cache: 1.25 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.cachePerMillion).toBe(99);
    });

    it('skips cacheWritePerMillion when overridden', async () => {
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20, cacheWritePerMillion: 99 }, fieldOverrides: { cacheWritePerMillion: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, cacheWrite: 3.75 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.cacheWritePerMillion).toBe(99);
    });

    it('skips contextWindow when overridden', async () => {
      const m = makeModel({ contextWindow: 99999, fieldOverrides: { contextWindow: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, contextWindow: 128000 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.contextWindow).toBe(99999);
    });

    it('skips capabilities when overridden', async () => {
      const m = makeModel({ capabilities: { vision: false }, fieldOverrides: { capabilities: true } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20, capabilities: { vision: true } }]));
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.capabilities).toEqual({ vision: false });
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
      mockReadConfig.mockResolvedValue([m] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(m.cost.pricingTiers).toEqual(existing);
    });
  });

  describe('writeConfig behavior', () => {
    it('calls writeConfig and returns true when a field changes', async () => {
      const m = makeModel({ cost: { inputPerMillion: 30, outputPerMillion: 60 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 60 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(mockWriteConfig).toHaveBeenCalledOnce();
      expect(mockWriteConfig).toHaveBeenCalledWith('models', [m]);
    });

    it('does not call writeConfig and returns false when nothing changes', async () => {
      const catalogDefaults = { inputPerMillion: 5, outputPerMillion: 20 };
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 }, catalogDefaults });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
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
      mockReadConfig.mockResolvedValue([m1, m2] as never);
      await syncModelsFromCatalog('0.3.0');
      expect(mockWriteConfig).toHaveBeenCalledTimes(1);
    });

    it('returns false with empty models list', async () => {
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(false);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    });

    it('updates catalogDefaults even when field values already match', async () => {
      // values match but catalogDefaults is undefined → still marks changed
      const m = makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 20 } });
      mockGet.mockResolvedValue(openaiCatalog([{ id: 'gpt-4', input: 5, output: 20 }]));
      mockReadConfig.mockResolvedValue([m] as never);
      const changed = await syncModelsFromCatalog('0.3.0');
      expect(changed).toBe(true);
      expect(m.catalogDefaults).toEqual({ inputPerMillion: 5, outputPerMillion: 20 });
    });
  });
});
