import type { CatalogField, CatalogDefaults } from '@routerly/shared';
import { catalogFetcher } from './fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { listEffectiveModelsIncludingDisabled } from '../provider/list-effective.js';

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

    const catalogDefaults: CatalogDefaults = {
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
    if (!isOverridden('cachePerMillion') && catalogDefaults.cachePerMillion !== undefined) {
      if (model.cost.cachePerMillion !== catalogDefaults.cachePerMillion) {
        model.cost.cachePerMillion = catalogDefaults.cachePerMillion;
        modelChanged = true;
      }
    }
    if (!isOverridden('cacheWritePerMillion') && catalogDefaults.cacheWritePerMillion !== undefined) {
      if (model.cost.cacheWritePerMillion !== catalogDefaults.cacheWritePerMillion) {
        model.cost.cacheWritePerMillion = catalogDefaults.cacheWritePerMillion;
        modelChanged = true;
      }
    }
    if (!isOverridden('pricingTiers') && catalogDefaults.pricingTiers !== undefined) {
      model.cost.pricingTiers = catalogDefaults.pricingTiers;
      modelChanged = true;
    }
    if (!isOverridden('contextWindow') && catalogDefaults.contextWindow !== undefined) {
      if (model.contextWindow !== catalogDefaults.contextWindow) {
        model.contextWindow = catalogDefaults.contextWindow;
        modelChanged = true;
      }
    }
    if (!isOverridden('capabilities') && catalogDefaults.capabilities !== undefined) {
      model.capabilities = catalogDefaults.capabilities;
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
      return {
        ...inst,
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
