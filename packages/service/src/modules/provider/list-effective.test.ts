import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as loader from '../config/loader.js';
import { listEffectiveModels, listEffectiveModelsIncludingDisabled } from './list-effective.js';

describe('listEffectiveModels', () => {
  beforeEach(() => vi.restoreAllMocks());

  function stub(connections: unknown[], instances: unknown[]) {
    vi.spyOn(loader, 'readConfig').mockImplementation(async (name: string) =>
      (name === 'connections' ? connections : name === 'instances' ? instances : []) as never);
  }

  it('resolves one effective model per instance of an enabled connection', async () => {
    stub(
      [{ id: 'c1', providerId: 'openai', label: 'A', credentials: { apiKey: 'k' }, enabled: true }],
      [{ id: 'gpt-4', connectionId: 'c1', upstreamModelId: 'gpt-4', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 8000 }],
    );
    const models = await listEffectiveModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'gpt-4', provider: 'openai', connectionId: 'c1', endpoint: undefined });
  });

  it('skips instances whose connection is disabled', async () => {
    stub(
      [{ id: 'c1', providerId: 'openai', label: 'A', credentials: {}, enabled: false }],
      [{ id: 'gpt-4', connectionId: 'c1', upstreamModelId: 'gpt-4', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 8000 }],
    );
    expect(await listEffectiveModels()).toHaveLength(0);
    expect(await listEffectiveModelsIncludingDisabled()).toHaveLength(1);
  });

  it('skips instances whose connection is missing (dangling)', async () => {
    stub([], [{ id: 'x', connectionId: 'gone', upstreamModelId: 'x', cost: { inputPerMillion: 0, outputPerMillion: 0 }, contextWindow: 0 }]);
    expect(await listEffectiveModels()).toHaveLength(0);
    expect(await listEffectiveModelsIncludingDisabled()).toHaveLength(0);
  });

  describe('model state (ROUT-437)', () => {
    const connection = { id: 'c1', providerId: 'openai', label: 'A', credentials: { apiKey: 'k' }, enabled: true };
    const inst = (id: string, extra: Record<string, unknown> = {}) =>
      ({ id, connectionId: 'c1', upstreamModelId: id, cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 8000, ...extra });

    beforeEach(() => stub([connection], [
      inst('legacy'),
      inst('on', { enabled: true }),
      inst('off', { enabled: false, isNew: true, source: 'catalog' }),
      inst('gone', { enabled: true, source: 'catalog', unavailable: 'removed' }),
    ]));

    it('routing list keeps only routable models (absent enabled = routable)', async () => {
      expect((await listEffectiveModels()).map((m) => m.id)).toEqual(['legacy', 'on']);
    });

    it('management list keeps disabled and unavailable models, with their state', async () => {
      const all = await listEffectiveModelsIncludingDisabled();
      expect(all.map((m) => m.id)).toEqual(['legacy', 'on', 'off', 'gone']);
      expect(all.find((m) => m.id === 'off')).toMatchObject({ enabled: false, isNew: true, source: 'catalog' });
      expect(all.find((m) => m.id === 'gone')).toMatchObject({ unavailable: 'removed' });
    });
  });
});
