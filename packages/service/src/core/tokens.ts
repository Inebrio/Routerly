// packages/service/src/core/tokens.ts
import { token, type ProcessorRegistry } from './index.js';
import type { ProviderAdapter } from '../modules/provider/types.js';
import type { ProviderCatalog, RepoStatus } from '../modules/catalog/fetcher.js';
import type { RouteResult } from '../routing/router.js';
import type {
  ModelConfig,
  ProjectConfig,
  ProjectToken,
  ChatCompletionRequest,
  ProviderRepo,
} from '@routerly/shared';

// Each token wraps existing functions/types. Modules register these; processors
// resolve them. Only CONFIG_STORE is registered in Plan 2; the rest are declared
// so Plans 3-6 import stable token keys. Types are imported, never redefined.

export const CONFIG_STORE = token<{
  readConfig: typeof import('../modules/config/loader.js').readConfig;
  writeConfig: typeof import('../modules/config/loader.js').writeConfig;
  appendUsageRecord: typeof import('../modules/config/loader.js').appendUsageRecord;
}>('config.store');

export const PROVIDER_REGISTRY = token<{
  getProviderAdapter(model: ModelConfig): ProviderAdapter;
}>('provider.registry');

export const CATALOG = token<{
  get(routerlyVersion: string): Promise<ProviderCatalog>;
  setRepos(repos: ProviderRepo[]): void;
  invalidate(): void;
  getStatus(): RepoStatus[];
  syncModelsFromCatalog: typeof import('../modules/catalog/sync.js').syncModelsFromCatalog;
}>('catalog.registry');

export const ROUTER = token<{
  routeRequest(
    request: ChatCompletionRequest,
    project: ProjectConfig,
    log?: unknown,
    emit?: unknown,
    token?: ProjectToken,
    traceId?: string,
    conversationId?: string,
  ): Promise<RouteResult>;
}>('routing.router');

export const USAGE_TRACKER = token<{
  trackUsage(params: unknown): Promise<void>;
}>('usage.tracker');

export const BUDGET = token<{
  isAllowed: typeof import('../cost/budget.js').isAllowed;
  getViolatedLimits: typeof import('../cost/budget.js').getViolatedLimits;
  getLimitUsageSnapshot: typeof import('../cost/budget.js').getLimitUsageSnapshot;
}>('cost.budget');

// ProxyContext is defined in Plan 4 (reverse-proxy/context.ts). Until then the
// pipeline registry is parameterized over `unknown`; Plan 4 narrows the generic
// to ProxyContext. The token key 'proxy.pipeline' is frozen now.
export const PROXY_PIPELINE = token<ProcessorRegistry<unknown>>('proxy.pipeline');
