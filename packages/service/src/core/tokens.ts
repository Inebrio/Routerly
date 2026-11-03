// packages/service/src/core/tokens.ts
import { token, type ProcessorRegistry, type AlterableRegistry, type RouteContribution } from './index.js';
import type { ProviderAdapter } from '../modules/provider/types.js';
import type { ProviderCatalog, RepoStatus } from '../modules/catalog/fetcher.js';
import type { EmbeddingProvider, EmbeddingProviderType } from '../modules/embeddings/dispatch.js';
import type { RouteResult } from '../modules/routing/router.js';
import type { OptimizerRegistry } from '../modules/optimizers/registry.js';
import type { McpToolRegistry } from '../modules/mcp/registry.js';
import type {
  ModelConfig,
  RouterConfig,
  RouterToken,
  ChatCompletionRequest,
  ProviderRepo,
  UpdateInfo,
  AvailableReleases,
  ResilienceStore,
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

export const EMBEDDINGS = token<{
  getEmbeddingProvider(
    type: EmbeddingProviderType,
    endpoint?: string,
    apiKey?: string,
  ): EmbeddingProvider;
}>('embeddings.registry');

export const AUDIT = token<{
  logAudit: typeof import('../modules/audit/logger.js').logAudit;
}>('audit.registry');

export const AUTH = token<{
  signToken: typeof import('../modules/auth/jwt.js').signToken;
  verifyToken: typeof import('../modules/auth/jwt.js').verifyToken;
  createSessionToken: typeof import('../modules/auth/jwt.js').createSessionToken;
  generateRawToken: typeof import('../modules/auth/jwt.js').generateRawToken;
  extractRouterToken: typeof import('../modules/auth/auth.js').extractRouterToken;
  resolveRouterByToken: typeof import('../modules/auth/auth.js').resolveRouterByToken;
  getEffectiveRoles: typeof import('../modules/auth/roles.js').getEffectiveRoles;
}>('auth.registry');

export const NOTIFICATIONS = token<{
  emitEvent: typeof import('../modules/notifications/emitter.js').emitEvent;
  appendToInbox: typeof import('../modules/notifications/emitter.js').appendToInbox;
  dispatchNotification: typeof import('../modules/notifications/sender.js').dispatchNotification;
  sendTestNotification: typeof import('../modules/notifications/sender.js').sendTestNotification;
}>('notifications.registry');

export const OBSERVABILITY = token<{
  getMetricsSnapshot: typeof import('../modules/observability/metrics-snapshot.js').getMetricsSnapshot;
  startIntegrationRunner: typeof import('../modules/observability/runner.js').startIntegrationRunner;
  metricsRoutes: typeof import('../modules/observability/metrics.js').metricsRoutes;
}>('observability.registry');

export const ROUTER = token<{
  routeRequest(
    request: ChatCompletionRequest,
    router: RouterConfig,
    log?: unknown,
    emit?: unknown,
    token?: RouterToken,
    traceId?: string,
    conversationId?: string,
  ): Promise<RouteResult>;
}>('routing.router');

export const USAGE_TRACKER = token<{
  trackUsage(params: unknown): Promise<void>;
}>('usage.tracker');

export const BUDGET = token<{
  isAllowed: typeof import('../modules/budget/budget.js').isAllowed;
  getViolatedLimits: typeof import('../modules/budget/budget.js').getViolatedLimits;
  getLimitUsageSnapshot: typeof import('../modules/budget/budget.js').getLimitUsageSnapshot;
}>('cost.budget');

export const RESILIENCE_STORE = token<ResilienceStore>('resilience.store');

// ProxyContext is defined in Plan 4 (reverse-proxy/context.ts). Until then the
// pipeline registry is parameterized over `unknown`; Plan 4 narrows the generic
// to ProxyContext. The token key 'proxy.pipeline' is frozen now.
export const PROXY_PIPELINE = token<ProcessorRegistry<unknown>>('proxy.pipeline');

// Optimizer registry (Plan 4). optimizer-core creates and binds it on register;
// the optimizer.apply processor and later optimizer submodules resolve it.
export const OPTIMIZER_REGISTRY = token<OptimizerRegistry>('optimizer.registry');

// MCP tool registry (Plan 6). The mcp module creates and binds it on register;
// its start contributes each built-in tool whose required DI token is present,
// and the MCP transports/routes resolve it. AlterableRegistry of McpToolEntry.
export const MCP_TOOLS = token<McpToolRegistry>('mcp.tools');

export const API_REVERSE_PROXY = token<{
  openaiRoutes: typeof import('../modules/api-reverse-proxy/openai.js').openaiRoutes;
  anthropicRoutes: typeof import('../modules/api-reverse-proxy/anthropic.js').anthropicRoutes;
  passthroughHandler: typeof import('../modules/api-reverse-proxy/passthrough.js').passthroughHandler;
  routerPassthroughRoutes: typeof import('../modules/api-reverse-proxy/router-passthrough.js').routerPassthroughRoutes;
}>('api-reverse-proxy.registry');

export const API_ROUTES = token<AlterableRegistry<RouteContribution>>('api.routes');

export const TELEMETRY = token<{
  pingTelemetry: typeof import('../modules/telemetry/telemetry.js').pingTelemetry;
}>('telemetry.registry');

export const UPDATE_CHECKER = token<{
  start(currentVersion: string, channel: string): void;
  updateChannel(channel: string): void;
  check(): Promise<UpdateInfo>;
  getAvailableReleases(): Promise<AvailableReleases>;
  getLastResult(): UpdateInfo | null;
  stop(): void;
}>('update-checker.registry');
