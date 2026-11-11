import { routerUsesModel } from '@routerly/shared';
import type { CatalogField, CatalogDefaults, CatalogSyncSummary, ModelInstance } from '@routerly/shared';
import { catalogFetcher } from './fetcher.js';
import type { ProviderCatalog } from './fetcher.js';
import { readConfig, writeConfig, updateConfig } from '../config/loader.js';
import { listEffectiveModelsIncludingDisabled } from '../provider/list-effective.js';
import { defaultUpstreamModelId } from '../provider/resolve.js';
import { emitEvent } from '../notifications/emitter.js';
import { logAudit } from '../audit/logger.js';

type CatalogModel = ProviderCatalog[string]['models'][number];

/** Catalog-trackable values of one catalog entry (prices, context window, capabilities). */
export function toCatalogDefaults(entry: CatalogModel): CatalogDefaults {
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
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.capabilities !== undefined ? { capabilities: entry.capabilities } : {}),
  };
}

export async function syncModelsFromCatalog(pkgVersion: string): Promise<boolean> {
  // catalog cross-ref: sync disabled-connection models too, in case they get re-enabled later
  const [catalog, models] = await Promise.all([
    catalogFetcher.get(pkgVersion),
    listEffectiveModelsIncludingDisabled(),
  ]);

  let changed = false;
  const changedIds = new Set<string>();

  for (const model of models) {
    const providerEntry = catalog[model.provider];
    if (!providerEntry) continue;

    const lookupId = model.upstreamModelId ?? (model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id);
    const entry = providerEntry.models.find(m => m.id === lookupId);
    if (!entry) continue;

    const catalogDefaults = toCatalogDefaults(entry);

    const overrides: Partial<Record<CatalogField, boolean>> = model.fieldOverrides ?? {};
    const isOverridden = (field: CatalogField): boolean => (overrides as Record<string, boolean | undefined>)[field] === true;

    let modelChanged = false;

    if (!isOverridden('inputPerMillion')) {
      if (model.cost.inputPerMillion !== catalogDefaults.inputPerMillion) {
        model.cost.inputPerMillion = catalogDefaults.inputPerMillion!;
        modelChanged = true;
      }
    }
    if (!isOverridden('outputPerMillion')) {
      if (model.cost.outputPerMillion !== catalogDefaults.outputPerMillion) {
        model.cost.outputPerMillion = catalogDefaults.outputPerMillion!;
        modelChanged = true;
      }
    }
    // A field the catalog no longer carries is removed from the model (unless overridden).
    for (const field of ['cachePerMillion', 'cacheWritePerMillion'] as const) {
      if (isOverridden(field)) continue;
      if (model.cost[field] !== catalogDefaults[field]) {
        if (catalogDefaults[field] === undefined) delete model.cost[field];
        else model.cost[field] = catalogDefaults[field];
        modelChanged = true;
      }
    }
    if (!isOverridden('pricingTiers') && JSON.stringify(model.cost.pricingTiers) !== JSON.stringify(catalogDefaults.pricingTiers)) {
      if (catalogDefaults.pricingTiers === undefined) delete model.cost.pricingTiers;
      else model.cost.pricingTiers = catalogDefaults.pricingTiers;
      modelChanged = true;
    }
    // contextWindow is required on the model: 0 means unknown.
    if (!isOverridden('contextWindow') && model.contextWindow !== (catalogDefaults.contextWindow ?? 0)) {
      model.contextWindow = catalogDefaults.contextWindow ?? 0;
      modelChanged = true;
    }
    if (!isOverridden('capabilities') && JSON.stringify(model.capabilities) !== JSON.stringify(catalogDefaults.capabilities)) {
      if (catalogDefaults.capabilities === undefined) delete model.capabilities;
      else model.capabilities = catalogDefaults.capabilities;
      modelChanged = true;
    }

    if (JSON.stringify(model.catalogDefaults) !== JSON.stringify(catalogDefaults)) {
      model.catalogDefaults = catalogDefaults;
      modelChanged = true;
    }

    if (modelChanged) {
      changed = true;
      changedIds.add(model.id);
    }
  }

  if (changed) {
    const instances = await readConfig('instances');
    const byId = new Map(models.map(m => [m.id, m]));
    const updatedInstances = instances.map(inst => {
      if (!changedIds.has(inst.id)) return inst;
      const m = byId.get(inst.id)!;
      const { capabilities: _c, ...rest } = inst;
      return {
        ...rest,
        cost: m.cost,
        contextWindow: m.contextWindow ?? inst.contextWindow,
        ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
        ...(m.catalogDefaults !== undefined ? { catalogDefaults: m.catalogDefaults } : {}),
      };
    });
    await writeConfig('instances', updatedInstances);
  }
  return changed;
}

export interface CatalogSyncOptions {
  /** Sync only this connection (default: every connection with catalogSync on). */
  connectionId?: string;
  /** Who triggered the run; absent = the background timer / first status read (audited as `system`). */
  actor?: { id: string; email: string; endpoint: string };
}

type Unavailability = { modelId: string; connectionId: string; reason: 'removed' | 'deprecated' };

/**
 * Loads and tracks the catalog models of every connection with `catalogSync` on: new catalog
 * models are created disabled + new, catalog-sourced models the catalog dropped or deprecated
 * are flagged `unavailable` (and cleared when they return). `enabled` is never touched.
 * A provider key missing from the catalog, or an empty one, changes nothing for that connection.
 */
export async function syncConnectionsFromCatalog(
  pkgVersion: string,
  opts: CatalogSyncOptions = {},
): Promise<CatalogSyncSummary> {
  const summary: CatalogSyncSummary = { added: [], unavailable: [], restored: [], skipped: [], catalogAvailable: false };
  const catalog = await catalogFetcher.get(pkgVersion).catch((): ProviderCatalog => ({}));

  const seenAdds = new Map<string, string[]>();
  const nowUnavailable: Unavailability[] = [];
  const nowRestored: { modelId: string; connectionId: string }[] = [];

  await updateConfig('instances', async (instances) => {
    const connections = (await readConfig('connections'))
      .filter(c => c.catalogSync === true && (opts.connectionId === undefined || c.id === opts.connectionId));
    const next = [...instances];
    let changed = false;

    for (const conn of connections) {
      const providerEntry = catalog[conn.providerId];
      if (!providerEntry?.models?.length) continue;
      summary.catalogAvailable = true;

      const upstreamOf = (i: ModelInstance) =>
        i.upstreamModelId === i.id ? defaultUpstreamModelId(i.id) : i.upstreamModelId;
      const present = new Set(next.filter(i => i.connectionId === conn.id).map(upstreamOf));
      const seen = new Set(conn.catalogSeen ?? []);
      const newlySeen: string[] = [];

      for (const entry of providerEntry.models) {
        if (entry.deprecated || seen.has(entry.id)) continue;
        newlySeen.push(entry.id);
        if (present.has(entry.id)) continue;
        const id = `${conn.label}/${entry.id}`;
        if (next.some(i => i.id === id)) {
          summary.skipped.push({ upstreamModelId: entry.id, reason: 'id_taken' });
          continue;
        }
        const d = toCatalogDefaults(entry);
        next.push({
          id,
          connectionId: conn.id,
          upstreamModelId: entry.id,
          cost: {
            inputPerMillion: d.inputPerMillion!,
            outputPerMillion: d.outputPerMillion!,
            ...(d.cachePerMillion !== undefined ? { cachePerMillion: d.cachePerMillion } : {}),
            ...(d.cacheWritePerMillion !== undefined ? { cacheWritePerMillion: d.cacheWritePerMillion } : {}),
            ...(d.pricingTiers !== undefined ? { pricingTiers: d.pricingTiers } : {}),
          },
          contextWindow: d.contextWindow ?? 0,
          ...(d.capabilities !== undefined ? { capabilities: d.capabilities } : {}),
          catalogDefaults: d,
          enabled: false,
          isNew: true,
          source: 'catalog',
        });
        summary.added.push(id);
        changed = true;
      }
      if (newlySeen.length) seenAdds.set(conn.id, newlySeen);

      const byUpstream = new Map(providerEntry.models.map(m => [m.id, m]));
      next.forEach((inst, idx) => {
        if (inst.connectionId !== conn.id || inst.source !== 'catalog') return;
        const entry = byUpstream.get(upstreamOf(inst));
        const want: ModelInstance['unavailable'] = !entry ? 'removed' : entry.deprecated ? 'deprecated' : undefined;
        if (want === inst.unavailable) return;
        const { unavailable: was, ...rest } = inst;
        next[idx] = want ? { ...rest, unavailable: want } : rest;
        changed = true;
        if (want && !was) {
          summary.unavailable.push(inst.id);
          nowUnavailable.push({ modelId: inst.id, connectionId: conn.id, reason: want });
        } else if (!want) {
          summary.restored.push(inst.id);
          nowRestored.push({ modelId: inst.id, connectionId: conn.id });
        }
      });
    }
    return changed ? next : instances;
  });

  if (seenAdds.size) {
    await updateConfig('connections', (conns) => conns.map(c => {
      const add = seenAdds.get(c.id);
      return add ? { ...c, catalogSeen: [...new Set([...(c.catalogSeen ?? []), ...add])] } : c;
    }));
  }

  if (nowUnavailable.length || nowRestored.length) {
    const routers = await readConfig('routers').catch(() => []);
    const usedBy = (modelId: string) =>
      routers.filter(r => routerUsesModel(r, modelId)).map(r => ({ id: r.id, name: r.name ?? r.id }));
    for (const u of nowUnavailable) {
      void emitEvent('config.model_unavailable', 'warning', { ...u, routers: usedBy(u.modelId) }).catch(() => {});
    }
    for (const r of nowRestored) {
      void emitEvent('config.model_restored', 'info', { ...r, routers: usedBy(r.modelId) }).catch(() => {});
    }
  }

  if (summary.added.length || summary.unavailable.length || summary.restored.length || summary.skipped.length) {
    await logAudit({
      userId: opts.actor?.id ?? 'system',
      email: opts.actor?.email ?? 'system',
      endpoint: opts.actor?.endpoint ?? 'catalog-sync',
      action: 'catalog:sync',
      result: 'success',
      details: { ...summary, ...(opts.connectionId !== undefined ? { connectionId: opts.connectionId } : {}) },
    });
  }
  return summary;
}

// Just above the fetcher's 6h cache TTL, so every tick finds the cache expired and refetches.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 + 60_000;

/** One automatic run: fetch the catalog and apply it. A failed fetch changes nothing (status keeps the error). */
export async function runCatalogSync(pkgVersion: string): Promise<void> {
  try {
    await catalogFetcher.get(pkgVersion);
    if (catalogFetcher.getStatus().some(s => s.enabled && s.error)) return;
    await syncModelsFromCatalog(pkgVersion);
    await syncConnectionsFromCatalog(pkgVersion);
  } catch { /* best-effort: the next tick retries */ }
}

/** Sync at startup, then every ~6h. The timer is unref'd: the listening socket keeps the process alive. */
export function startCatalogSync(pkgVersion: string): NodeJS.Timeout {
  void runCatalogSync(pkgVersion);
  return setInterval(() => void runCatalogSync(pkgVersion), SYNC_INTERVAL_MS).unref();
}
