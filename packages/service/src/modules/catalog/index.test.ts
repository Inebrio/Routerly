import { describe, it, expect, vi } from 'vitest';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { catalogModule } from './index.js';
import { CATALOG } from '../../core/tokens.js';
import { catalogFetcher } from './fetcher.js';
import { syncModelsFromCatalog } from './sync.js';

describe('catalog module', () => {
  it('has the frozen manifest', () => {
    expect(catalogModule.manifest.id).toBe('catalog');
    expect(catalogModule.manifest.version).toBe('0.4.0');
    expect(catalogModule.manifest.dependsOn).toEqual({ config: '^0.4.0' });
  });

  it('registers CATALOG exposing the real catalogFetcher/syncModelsFromCatalog surface', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await catalogModule.register({ container, events });

    expect(container.has(CATALOG)).toBe(true);
    const registry = container.resolve(CATALOG);

    // syncModelsFromCatalog is passed by direct reference (plain function export).
    expect(registry.syncModelsFromCatalog).toBe(syncModelsFromCatalog);

    // catalogFetcher methods are delegated (bound via arrow wrapper), not re-implemented.
    const getSpy = vi.spyOn(catalogFetcher, 'get').mockResolvedValue({});
    await registry.get('1.0.0');
    expect(getSpy).toHaveBeenCalledWith('1.0.0');
    getSpy.mockRestore();

    const setReposSpy = vi.spyOn(catalogFetcher, 'setRepos').mockImplementation(() => {});
    registry.setRepos([]);
    expect(setReposSpy).toHaveBeenCalledWith([]);
    setReposSpy.mockRestore();

    const invalidateSpy = vi.spyOn(catalogFetcher, 'invalidate').mockImplementation(() => {});
    registry.invalidate();
    expect(invalidateSpy).toHaveBeenCalled();
    invalidateSpy.mockRestore();

    const getStatusSpy = vi.spyOn(catalogFetcher, 'getStatus').mockReturnValue([]);
    expect(registry.getStatus()).toEqual([]);
    expect(getStatusSpy).toHaveBeenCalled();
    getStatusSpy.mockRestore();
  });
});
