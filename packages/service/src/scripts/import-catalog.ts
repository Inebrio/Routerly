/**
 * Repeatable per-provider ModelInstance import script.
 *
 * Sourced from Routerly's own provider catalog (the same source
 * `syncModelsFromCatalog` uses to keep `ModelConfig` pricing in sync) — no
 * external catalog source is added here. Upserts `ModelInstance` records
 * bound to a given `ProviderConnection`: pricing/capability data comes from
 * the catalog, deprecated catalog entries are skipped, and re-running the
 * script against unchanged catalog data upserts nothing (idempotent by
 * deterministic instance id).
 *
 * Runnable directly:
 *   npm run import:catalog --workspace=packages/service -- --connection <id> [--provider <id>]
 */
import { readFileSync } from 'node:fs';
import type { ModelInstance, ProviderId, TokenCost } from '@routerly/shared';
import { catalogFetcher, type ProviderCatalog } from '../modules/catalog/fetcher.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';

const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
) as { version: string };

type CatalogEntry = ProviderCatalog[string]['models'][number];

function mapCost(entry: CatalogEntry): TokenCost {
  return {
    inputPerMillion: entry.input,
    outputPerMillion: entry.output,
    ...(entry.cache !== undefined ? { cachePerMillion: entry.cache } : {}),
    ...(entry.cacheWrite !== undefined ? { cacheWritePerMillion: entry.cacheWrite } : {}),
    ...(entry.pricingTiers?.length ? {
      pricingTiers: entry.pricingTiers.map(t => ({
        metric: t.metric,
        above: t.above,
        inputPerMillion: t.input,
        outputPerMillion: t.output,
        ...(t.cache !== undefined ? { cachePerMillion: t.cache } : {}),
      })),
    } : {}),
  };
}

export async function importCatalog(opts: {
  provider?: ProviderId;
  connectionId: string;
  routerlyVersion?: string;
}): Promise<{ upserted: number }> {
  const [catalog, instances, connections] = await Promise.all([
    catalogFetcher.get(opts.routerlyVersion ?? pkgVersion),
    readConfig('instances'),
    readConfig('connections'),
  ]);

  // Always resolve the connection, even when opts.provider is given — a connection's
  // credentials/endpoint are provider-specific, so a mismatched opts.provider must fail
  // loudly here rather than silently bind wrong-provider catalog entries to it.
  const connection = connections.find(c => c.id === opts.connectionId);
  if (!connection) throw new Error(`Connection not found: ${opts.connectionId}`);
  if (opts.provider !== undefined && opts.provider !== connection.providerId) {
    throw new Error(
      `Provider mismatch: connection '${opts.connectionId}' is bound to provider '${connection.providerId}', not '${opts.provider}'`,
    );
  }
  const provider = connection.providerId;

  const providerEntry = catalog[provider];
  if (!providerEntry) return { upserted: 0 };

  let upserted = 0;

  for (const entry of providerEntry.models) {
    if (entry.deprecated === true) continue;

    const id = `${opts.connectionId}__${entry.id}`;
    const cost = mapCost(entry);
    // ponytail: catalog entries without contextWindow default to 0 — ModelInstance.contextWindow
    // is required but the catalog field is optional; upstream data gap, not fixable here.
    const contextWindow = entry.contextWindow ?? 0;

    const next: Pick<ModelInstance, 'cost' | 'contextWindow' | 'capabilities'> = {
      cost, contextWindow,
      ...(entry.capabilities !== undefined ? { capabilities: entry.capabilities } : {}),
    };

    const existingIdx = instances.findIndex(i => i.id === id);
    if (existingIdx === -1) {
      instances.push({ id, connectionId: opts.connectionId, upstreamModelId: entry.id, ...next });
      upserted++;
      continue;
    }

    const existing = instances[existingIdx]!;
    const current: Pick<ModelInstance, 'cost' | 'contextWindow' | 'capabilities'> = {
      cost: existing.cost, contextWindow: existing.contextWindow,
      ...(existing.capabilities !== undefined ? { capabilities: existing.capabilities } : {}),
    };

    if (JSON.stringify(current) !== JSON.stringify(next)) {
      instances[existingIdx] = { ...existing, ...next };
      upserted++;
    }
  }

  if (upserted > 0) await writeConfig('instances', instances);
  return { upserted };
}

// ─── CLI entry (Commander-free — `packages/service` has no Commander dependency) ──

export function parseArgs(argv: string[]): { provider?: string; connection?: string } {
  const args: { provider?: string; connection?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') {
      const value = argv[++i];
      if (value !== undefined) args.provider = value;
    } else if (argv[i] === '--connection') {
      const value = argv[++i];
      if (value !== undefined) args.connection = value;
    }
  }
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { provider, connection } = parseArgs(argv);
  if (!connection) {
    process.stderr.write('Usage: import-catalog --connection <id> [--provider <id>]\n');
    process.exit(1);
    return;
  }
  const result = await importCatalog({ connectionId: connection, ...(provider !== undefined ? { provider } : {}) });
  process.stdout.write(`Upserted ${result.upserted} instance(s).\n`);
}

/* v8 ignore start -- entrypoint guard, only exercised when run as `node dist/scripts/import-catalog.js` */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
