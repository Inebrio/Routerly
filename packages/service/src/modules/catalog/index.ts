import { defineModule } from '../../core/index.js';
import { CATALOG } from '../../core/tokens.js';
import { catalogFetcher } from './fetcher.js';
import { syncModelsFromCatalog } from './sync.js';

/**
 * Catalog module: owns the real remote-fetch-into-local-cache implementation
 * (fetcher.ts, sync.ts) and exposes it behind the CATALOG DI token. Other
 * files still import fetcher.ts/sync.ts directly by path; this module
 * additionally makes them reachable through the container.
 */
export const catalogModule = defineModule({
  manifest: { id: 'catalog', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(CATALOG, {
      get: (routerlyVersion: string) => catalogFetcher.get(routerlyVersion),
      setRepos: (repos) => catalogFetcher.setRepos(repos),
      invalidate: () => catalogFetcher.invalidate(),
      getStatus: () => catalogFetcher.getStatus(),
      syncModelsFromCatalog,
    });
  },
});
