import { defineModule } from '../../core/index.js';
import { CATALOG } from '../../core/tokens.js';
import { PRODUCT_VERSION } from '../../core/version.js';
import { readConfig } from '../config/loader.js';
import { catalogFetcher, CACHE_TTL_MS } from './fetcher.js';
import { syncModelsFromCatalog, syncConnectionsFromCatalog } from './sync.js';

let syncTimer: ReturnType<typeof setInterval> | null = null;

/** One background pass: refresh prices of configured models, then load/track connection models. Never throws. */
async function runCatalogSync(): Promise<void> {
  try {
    await syncModelsFromCatalog(PRODUCT_VERSION);
    await syncConnectionsFromCatalog(PRODUCT_VERSION);
  } catch { /* best-effort: a failed pass is retried at the next tick */ }
}

/**
 * Catalog module: owns the real remote-fetch-into-local-cache implementation
 * (fetcher.ts, sync.ts) and exposes it behind the CATALOG DI token. Other
 * files still import fetcher.ts/sync.ts directly by path; this module
 * additionally makes it reachable through the container.
 */
export const catalogModule = defineModule({
  manifest: { id: 'catalog', version: '0.6.0', dependsOn: { config: '^0.6.0' } },
  register({ container }) {
    container.register(CATALOG, {
      get: (routerlyVersion: string) => catalogFetcher.get(routerlyVersion),
      setRepos: (repos) => catalogFetcher.setRepos(repos),
      invalidate: () => catalogFetcher.invalidate(),
      getStatus: () => catalogFetcher.getStatus(),
      syncModelsFromCatalog,
    });
  },

  // Sync once at startup (in the background) then every CACHE_TTL_MS, using the fetcher's own
  // 6 h cache. Under test (NODE_ENV=test) no startup pass runs, so booting a server never fetches;
  // `routerly mcp serve` (stdio) is a side process of the real service and never syncs at all.
  async start() {
    if (process.env['ROUTERLY_MCP_STDIO'] === '1') return;
    if (process.env['NODE_ENV'] !== 'test') {
      void (async () => {
        const settings = await readConfig('settings').catch(() => undefined);
        if (settings?.providerRepos?.length) catalogFetcher.setRepos(settings.providerRepos);
        await runCatalogSync();
      })();
    }
    // ponytail: unref'd, the listening socket keeps the process alive.
    syncTimer ??= setInterval(() => { void runCatalogSync(); }, CACHE_TTL_MS).unref();
  },

  stop() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  },
});
