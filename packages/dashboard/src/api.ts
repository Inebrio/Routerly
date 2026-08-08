import type { PermissionCheckStatus } from '@routerly/shared';
export type { PermissionCheckStatus } from '@routerly/shared';

const BASE = '/api';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('lr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Returns ms until token expiry, or 0 if unknown/expired. */
function msUntilExpiry(): number {
  const raw = localStorage.getItem('lr_expires_at');
  if (!raw) return 0;
  return Math.max(0, parseInt(raw, 10) - Date.now());
}

let refreshPromise: Promise<boolean> | null = null;

/** Attempts a silent refresh. Returns true if successful. Concurrent calls share one promise. */
function trySilentRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('lr_refresh_token');
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { token: string; refreshToken?: string };
      localStorage.setItem('lr_token', data.token);
      if (data.refreshToken) localStorage.setItem('lr_refresh_token', data.refreshToken);
      // Decode expiry from new token
      try {
        const payload = JSON.parse(atob(data.token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
        if (payload.exp) localStorage.setItem('lr_expires_at', String(payload.exp * 1000));
      } catch { /* keep previous expiry */ }
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Proactive refresh: if token expires within 5 minutes, refresh before the call
  const FIVE_MIN = 5 * 60 * 1000;
  if (path !== '/auth/login' && path !== '/auth/refresh') {
    const remaining = msUntilExpiry();
    if (remaining > 0 && remaining < FIVE_MIN) {
      await trySilentRefresh();
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });

  if (res.status === 423) {
    const detail = await res.clone().json().catch(() => null);
    window.dispatchEvent(new CustomEvent('lr-permission-blocked', { detail }));
  }

  if (res.status === 401 && path !== '/auth/login') {
    // Try refresh once, then retry the original request
    const refreshed = await trySilentRefresh();
    if (refreshed) {
      const retry = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...authHeaders(),
          ...(init.headers as Record<string, string> ?? {}),
        },
      });
      if (retry.status !== 401) {
        // Process the retried response — fall through to normal handling below
        return processResponse<T>(retry, path);
      }
    }
    localStorage.removeItem('lr_token');
    localStorage.removeItem('lr_user');
    localStorage.removeItem('lr_refresh_token');
    localStorage.removeItem('lr_expires_at');
    if (window.location.pathname !== '/dashboard/login') {
      window.location.href = `/dashboard/login?to=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new Error('Unauthorized');
  }

  return processResponse<T>(res, path);
}

/** Thrown by request()/processResponse() on any non-2xx response. `status` lets
 * callers distinguish e.g. 404 (feature/module disabled) from other failures. */
export type ApiError = Error & { status?: number };

function httpError(message: string, status: number): ApiError {
  const err: ApiError = new Error(message);
  err.status = status;
  return err;
}

async function processResponse<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) {
    if (!res.ok) throw httpError(`HTTP ${res.status}`, res.status);
    return undefined as T;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse API response as JSON:', text);
    throw new Error('Invalid JSON response from server');
  }

  if (!res.ok) {
    // Some routes answer with a machine code plus a sentence (`label_taken` +
    // "Label ... is already used"); the sentence is the one worth showing.
    const body = data as { error?: string; message?: string };
    throw httpError(body.message ?? body.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const login = (email: string, password: string) =>
  request<{ token: string; refreshToken?: string; user: { id: string; email: string; role: string; permissions: string[] }; requiresTotp?: boolean; userId?: string }>(
    '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }
  );

// ── 2FA ───────────────────────────────────────────────────────────────────
export const verify2fa = (userId: string, token?: string, backupCode?: string) =>
  request<{ token: string; refreshToken?: string; user: { id: string; email: string; role: string; permissions: string[] } }>(
    '/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ userId, token, backupCode }) }
  );

export const setup2fa = () =>
  request<{ secret: string; qrUrl: string; backupCodes: string[] }>(
    '/auth/2fa/setup', { method: 'POST' }
  );

export const confirm2fa = (token: string) =>
  request<{ ok: boolean }>('/auth/2fa/confirm', { method: 'POST', body: JSON.stringify({ token }) });

export const disable2fa = (token?: string, backupCode?: string) =>
  request<{ ok: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ token, backupCode }) });

export const regenerateBackupCodes = (token: string) =>
  request<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { method: 'POST', body: JSON.stringify({ token }) });

export const reset2faForUser = (userId: string) =>
  request<{ ok: boolean }>(`/users/${userId}/2fa/reset`, { method: 'POST' });

// ── Setup ─────────────────────────────────────────────────────────────────
export const checkSetupStatus = () =>
  request<{ needsSetup: boolean }>('/setup/status');

export const setupFirstAdmin = (email: string, password: string) =>
  request<{ token: string; user: { id: string; email: string; role: string } }>(
    '/setup/first-admin', { method: 'POST', body: JSON.stringify({ email, password }) }
  );

// ── Models ────────────────────────────────────────────────────────────────
// ── Limits ───────────────────────────────────────────────────────────────────
export type LimitMetric = 'cost' | 'calls' | 'input_tokens' | 'output_tokens' | 'total_tokens';
export type LimitPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RollingUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
export type LimitsMode = 'replace' | 'extend' | 'disable';
export interface Limit {
  metric: LimitMetric;
  /** 'period': calendar-fixed (resets at midnight/Monday/1st…), 'rolling': sliding window */
  windowType: 'period' | 'rolling';
  period?: LimitPeriod;
  rollingAmount?: number;
  rollingUnit?: RollingUnit;
  value: number;
}

export interface PricingTier {
  metric: string;
  above: number;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion?: number;
}

export interface ModelCapabilities {
  thinking?: boolean;
  vision?: boolean;
  functionCalling?: boolean;
  json?: boolean;
  embedding?: boolean;
}

export interface Model {
  id: string; name: string; provider: string; endpoint: string;
  /** Present when the model is bound to a connection (shared or dedicated). */
  connectionId?: string;
  upstreamModelId?: string;
  cost: { inputPerMillion: number; outputPerMillion: number; cachePerMillion?: number; cacheWritePerMillion?: number; pricingTiers?: PricingTier[] };
  contextWindow?: number;
  limits?: Limit[];
  /** @deprecated use limits */ globalThresholds?: { daily?: number; weekly?: number; monthly?: number };
  capabilities?: ModelCapabilities;
  fieldOverrides?: Partial<Record<string, boolean>>;
  catalogDefaults?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
    cachePerMillion?: number;
    cacheWritePerMillion?: number;
    pricingTiers?: PricingTier[];
    contextWindow?: number;
    capabilities?: ModelCapabilities;
  };
}

export const getModels = () => request<Model[]>('/models');

export interface CatalogEntry {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  pricing: { inputPer1kTokens: number; outputPer1kTokens: number };
  local?: boolean;
  embedding?: boolean;
  isConfigured: boolean;
}

export const getModelCatalog = () => request<CatalogEntry[]>('/models/catalog');

export type ProviderCatalog = Record<string, {
  endpoint: string;
  models: Array<{
    id: string;
    input: number;
    output: number;
    cache?: number;
    cacheWrite?: number;
    contextWindow?: number;
    notes?: string;
    deprecated?: boolean;
    capabilities?: { embedding?: boolean };
  }>;
}>;

export const getProviders = () => request<ProviderCatalog>('/providers');
export const refreshCatalog = () => request<RepoStatus[]>('/catalog/refresh', { method: 'POST' });
export const probeRepo = (url: string) => request<{ ok: boolean; error?: string }>(`/catalog/probe?url=${encodeURIComponent(url)}`);

export interface RepoStatus {
  url: string;
  enabled: boolean;
  resolvedFile: string | null;
  updatedAt: string | null;
  lastChecked: string | null;
  error: string | null;
}
export const getCatalogStatus = () => request<RepoStatus[]>('/catalog/status');
export const createModel = (data: {
  id: string; name?: string; provider: string; endpoint?: string; apiKey?: string; cfClearance?: string;
  /** Bind to an existing (preconfigured) connection instead of submitting endpoint/apiKey. */
  connectionId?: string;
  cloneFrom?: string; upstreamModelId?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  cacheWritePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  limits?: Limit[];
  capabilities?: ModelCapabilities;
  fieldOverrides?: Partial<Record<string, boolean>>;
}) => request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: {
  id?: string;
  name?: string; provider: string; endpoint?: string; apiKey?: string; cfClearance?: string;
  /** Bind to an existing (preconfigured) connection instead of submitting endpoint/apiKey. */
  connectionId?: string;
  upstreamModelId?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  cacheWritePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  limits?: Limit[];
  capabilities?: ModelCapabilities;
  fieldOverrides?: Partial<Record<string, boolean>>;
}) => request<Model>(`/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const testModel = (id: string) => request<{ ok: boolean; latencyMs: number; error?: string }>(`/models/${encodeURIComponent(id)}/test`, { method: 'POST' });

export interface RoutingPolicy {
  type: 'context' | 'cheapest' | 'health' | 'performance' | 'llm' | 'capability' | 'rate-limit' | 'fairness' | 'budget-remaining' | 'semantic-intent' | 'model-preference';
  enabled: boolean;
  config?: any;
}

import type {
  RouterConfig,
  RouterKind,
  RouterToken as SharedRouterToken,
  RouterMember,
  RouterModelRef,
} from '@routerly/shared';
export type { RouterKind } from '@routerly/shared';

/** List/detail responses omit the raw token value: only creation returns it. */
export type RouterToken = Omit<SharedRouterToken, 'token'>;

export type GuardrailRuleType = 'regex' | 'semantic' | 'topic' | 'moderation';
export type GuardrailTarget = 'request' | 'response' | 'both';

export interface RegexGuardConfig { patterns: string[]; }
export interface SemanticGuardConfig { embeddingModelId: string; fallbackModelIds?: string[]; examples: string[]; threshold?: number; }
export interface TopicGuardConfig { modelId?: string; fallbackModelIds?: string[]; allowedTopics: string; threshold?: number; }
export interface ModerationGuardConfig { modelId?: string; fallbackModelIds?: string[]; threshold?: number; systemPrompt?: string; }

export interface GuardrailRule {
  type: GuardrailRuleType;
  enabled?: boolean;
  /** Judge/scan scope. Required for regex/semantic; omit on topic/moderation for inject-only. */
  target?: GuardrailTarget;
  config: RegexGuardConfig | SemanticGuardConfig | TopicGuardConfig | ModerationGuardConfig;
  /** Stop the request/response when this rule triggers. */
  block?: boolean;
  /** Record the trigger in usage (monitor) even when it does not block. */
  log?: boolean;
  /** Static message returned to the client when this rule blocks. */
  blockMessage?: string;
  /** (topic/moderation only) Use the judge model's own explanation as the block response. */
  useJudgeResponse?: boolean;
  /**
   * (topic/moderation only) Inject the rule instruction into the request system prompt
   * (steer, no block). Independent of the judge; injection always applies to the request.
   */
  inject?: boolean;
}

export interface GuardrailConfig {
  /** When true, run built-in prompt-injection detection on every request. */
  detectInjection?: boolean;
  rules: GuardrailRule[];
}

export type PiiEntity = 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'SSN' | 'IBAN';

export interface PiiPolicy {
  enabled?: boolean;
  entities?: PiiEntity[];
  customPatterns?: string[];
  /** Which side(s) to scrub: request input, model response, or both. */
  target: GuardrailTarget;
  /** Suffix buffer size (chars) for streaming response scrubbing. Only relevant when target includes response. */
  outputBufferSize?: number;
}

export interface PiiConfig {
  /** Policies merged per-direction at scrub time. */
  policies: PiiPolicy[];
}

/** An orchestrator candidate as the GET response resolves it: the server
 *  looks up `name` from the candidate router, nothing else of that router
 *  is ever included (AC7 opacity guarantee). */
export interface OrchestratorCandidate {
  routerId: string;
  name: string;
  /** Per-candidate usage limit overrides, scored the same way as a model's `limits`. */
  limits?: Limit[];
}

/** Local response shape: same fields as the shared RouterConfig, but tokens
 *  carry no raw token value (see RouterToken above), models/members/tokens
 *  are optional to match what list/detail responses actually send, and
 *  `candidates` is the name-resolved wire shape, not the stored one. */
export type Router = Omit<RouterConfig, 'models' | 'tokens' | 'members' | 'candidates'> & {
  models: RouterModelRef[];
  tokens?: RouterToken[];
  members?: RouterMember[];
  token?: string;
  kind?: RouterKind;
  candidates?: OrchestratorCandidate[];
};

export const getRouters = () => request<Router[]>('/routers');

export const createRouter = (data: {
  name: string;
  kind?: RouterKind;
  candidates?: { routerId: string; limits?: Limit[] }[];
  routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  timeoutMs?: number;
}) => request<Router>('/routers', { method: 'POST', body: JSON.stringify(data) });

export const updateRouter = (id: string, data: {
  name: string;
  kind?: RouterKind;
  candidates?: { routerId: string; limits?: Limit[] }[];
  routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  timeoutMs?: number;
  guardrails?: GuardrailConfig | null;
  pii?: PiiConfig | null;
  optimizers?: OptimizerConfig | null;
  traceContent?: boolean;
}) => request<Router>(`/routers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRouter = (id: string) => request<void>(`/routers/${id}`, { method: 'DELETE' });
export const createRouterToken = (id: string, labels?: string[], tags?: Record<string, string>, scopes?: string[]) => request<{ token: string; tokenInfo: RouterToken }>(`/routers/${id}/tokens`, { method: 'POST', body: JSON.stringify({ labels, ...(tags ? { tags } : {}), ...(scopes ? { scopes } : {}) }) });
export const updateRouterToken = (id: string, tokenId: string, models?: Array<{ modelId: string; limitsMode?: LimitsMode; limits?: Limit[] }>, labels?: string[], tags?: Record<string, string>, scopes?: string[]) => request<RouterToken>(`/routers/${id}/tokens/${tokenId}`, { method: 'PUT', body: JSON.stringify({ models, labels, ...(tags !== undefined ? { tags } : {}), ...(scopes !== undefined ? { scopes } : {}) }) });
export const deleteRouterToken = (id: string, tokenId: string) => request<void>(`/routers/${id}/tokens/${tokenId}`, { method: 'DELETE' });

export const addRouterMember = (id: string, userId: string, role: string) => request<RouterMember>(`/routers/${id}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });
export const updateRouterMember = (id: string, userId: string, role: string) => request<RouterMember>(`/routers/${id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) });
export const removeRouterMember = (id: string, userId: string) => request<void>(`/routers/${id}/members/${userId}`, { method: 'DELETE' });

// ── Users ─────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; roleId: string; routerIds: string[];
  permissions?: string[];
  totpEnabled?: boolean;
}

export const getUsers = () => request<User[]>('/users');
export const createUser = (data: { email: string; password: string; roleId?: string }) =>
  request<User>('/users', { method: 'POST', body: JSON.stringify(data) });
export const updateUser = (id: string, data: { email?: string; roleId?: string; newPassword?: string }) =>
  request<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUser = (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' });

// ── Roles ───────────────────────────────────────────────────────────────────────────────────
export const ALL_PERMISSIONS = [
  'router:read', 'router:write',
  'model:read', 'model:write',
  'user:read', 'user:write',
  'report:read',
  'settings:read', 'settings:write',
  'notification:write',
  'token:read', 'token:write',
  'role:write',
  'audit:read',
  'modules:read', 'modules:manage',
  'connections:read', 'connections:manage',
  'resilience:read', 'resilience:manage',
  'profiles:read', 'profiles:manage',
  'optimizers:read', 'optimizers:manage',
  'experiments:read', 'experiments:manage',
] as const;
export type Permission = typeof ALL_PERMISSIONS[number];

export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  builtin: boolean;
}

export const getRoles = () => request<Role[]>('/roles');
export const createRole = (data: { id: string; name: string; permissions: Permission[] }) =>
  request<Role>('/roles', { method: 'POST', body: JSON.stringify(data) });
export const updateRole = (id: string, data: { name?: string; permissions?: Permission[] }) =>
  request<Role>(`/roles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRole = (id: string) =>
  request<void>(`/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ── Modules ───────────────────────────────────────────────────────────────
export interface ModuleInfo {
  id: string;
  version: string;
  enabled: boolean;
  alwaysOn: boolean;
  dependsOn: string[];
}

export interface ModuleToggleResult {
  id: string;
  enabled: boolean;
  restartRequired: boolean;
}

export const getModules = () => request<ModuleInfo[]>('/modules');
export const enableModule = (id: string) =>
  request<ModuleToggleResult>(`/modules/${encodeURIComponent(id)}/enable`, { method: 'POST' });
export const disableModule = (id: string) =>
  request<ModuleToggleResult>(`/modules/${encodeURIComponent(id)}/disable`, { method: 'POST' });

// ── Usage Stats ───────────────────────────────────────────────────────────
export interface TraceEntry {
  panel: string;
  message: string;
  details: Record<string, unknown>;
  /** Stamped by the trace module: emitting module, pipeline phase, wall clock. */
  module?: string;
  phase?: string;
  at?: number;
  /** Prompts and answers. Present only for routers that opted in. */
  content?: Record<string, unknown>;
}

export interface UsageRecord {
  id: string; timestamp: string; routerId: string; modelId: string;
  inputTokens: number; outputTokens: number; cachedInputTokens?: number; cost: number; latencyMs: number; ttftMs?: number; tokensPerSec?: number; outcome: string;
  callType?: 'routing' | 'completion' | 'guardrail' | 'judge';
  requestType?: RequestType;
  errorMessage?: string;
  trace?: TraceEntry[];
  guardrailTriggered?: string;
  blockedBy?: string;
  piiRedacted?: string[];
  /** Router token the call authenticated with. Absent on records written before it was tracked. */
  tokenId?: string;
}

import type { UsageByModelEntry, Integration, IntegrationTraces, IntegrationType, ProviderRepo, RequestType, SavingsSummary, UsageSeries } from '@routerly/shared';
export type { UsageByModelEntry, Integration, IntegrationTraces, IntegrationType, ProviderRepo, RequestType, SavingsSummary, UsageSeries };

export interface UsageStats {
  summary: {
    totalCost: number; totalCalls: number; successCalls: number; errorCalls: number;
    routingCalls: number; completionCalls: number; routingCost: number; completionCost: number;
    guardrailCalls?: number; guardrailCost?: number; blockedCalls?: number;
    latencyMedianMs?: number; latencyP95Ms?: number;
    ttftMedianMs?: number; ttftP95Ms?: number; ttftSamples?: number;
  };
  byModel: Record<string, UsageByModelEntry>;
  /** Calls per caller in the window, before the caller filter narrowed it (T210). */
  byCallType?: Record<string, number>;
  /** Calls per request type in the window, before the type filter narrowed it (T210). */
  byRequestType?: Record<string, number>;
  timeline: [string, number][];
  records: Array<UsageRecord>;
  pagination?: { page: number; pageSize: number; totalRecords: number; totalPages: number };
  /** Only present when the call asked for it with `savings: true`. */
  savings?: SavingsSummary;
  /** Only present when the call asked for it with `series: true`. */
  series?: UsageSeries;
}

export interface GetUsageOptions {
  period?: string;
  routerId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  routerIds?: string[];
  modelIds?: string[];
  tokenIds?: string[];
  callType?: string;
  requestType?: string;
  outcome?: string;
  /** Ask the service for the counterfactual block. Costs a config read, so opt in. */
  savings?: boolean;
  /** Ask the service for the savings series over time. Same cost as `savings`, so opt in. */
  series?: boolean;
}

export const getUsage = (period = 'monthly', routerId?: string, from?: string, to?: string, page?: number, pageSize?: number, opts?: GetUsageOptions) => {
  const params = new URLSearchParams({ period });
  if (routerId) params.set('routerId', routerId);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  if (page != null) params.set('page', String(page));
  if (pageSize != null) params.set('pageSize', String(pageSize));
  if (opts?.routerIds?.length) params.set('routerIds', opts.routerIds.join(','));
  if (opts?.modelIds?.length)   params.set('modelIds',   opts.modelIds.join(','));
  if (opts?.tokenIds?.length)   params.set('tokenIds',   opts.tokenIds.join(','));
  if (opts?.callType && opts.callType !== 'all') params.set('callType', opts.callType);
  if (opts?.requestType && opts.requestType !== 'all') params.set('requestType', opts.requestType);
  if (opts?.outcome  && opts.outcome  !== 'all') params.set('outcome',  opts.outcome);
  if (opts?.savings) params.set('savings', '1');
  if (opts?.series) params.set('series', '1');
  return request<UsageStats>(`/usage?${params.toString()}`);
};

export const getUsageRecord = (id: string) =>
  request<UsageRecord>(`/usage/${id}`);

export const getTrace = (id: string) =>
  request<{ trace: TraceEntry[] }>(`/traces/${id}`);

export interface TraceStreamEvent {
  traceId: string;
  routerId?: string;
  correlationId?: string;
  topic: string;
  entry: TraceEntry;
}

/**
 * Live trace side channel. Resolves once the stream is open — the server has
 * subscribed by then, so a request fired afterwards loses no entry — and calls
 * `onEvent` for each one until the returned stop function runs.
 *
 * fetch, not EventSource: the bearer token has to travel in a header.
 */
export async function streamTraces(
  query: { correlationId?: string; routerId?: string; traceId?: string },
  onEvent: (event: TraceStreamEvent) => void,
): Promise<() => void> {
  const controller = new AbortController();
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  const stop = (): void => controller.abort();
  let res: Response;
  try {
    res = await fetch(`${BASE}/traces/stream?${params.toString()}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
  } catch {
    return stop; // no side channel: the stored trace is still fetched after the turn
  }
  if (!res.ok || !res.body) return stop;

  const reader = res.body.getReader();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue; // keepalive comment
          try { onEvent(JSON.parse(line.slice(6)) as TraceStreamEvent); } catch { /* malformed frame */ }
        }
      }
    } catch { /* aborted or dropped */ }
  })();
  return stop;
}

// ── Provider Health ───────────────────────────────────────────────────────
export interface ProviderHealth {
  modelId: string;
  name: string;
  provider: string;
  status: 'healthy' | 'degraded' | 'unavailable' | 'cooldown';
  errorRate: number;
  p95LatencyMs: number | null;
  requestsLastHour: number;
  lastSuccessAt: string | null;
  circuitState: ResilienceState;
  cooldownUntil: number | null;
  lockoutUntil: number | null;
}

export const getProviderHealth = () =>
  request<{ providers: ProviderHealth[] }>('/health/providers');


// ── Settings ──────────────────────────────────────────────────────────────
// Channel config types live in @routerly/shared — re-export for callers that import from api.ts
export type {
  EmailProvider,
  ChannelProvider,
  ChannelTargets,
  NotificationsConfig,
  NotificationChannel,
  DashboardChannelConfig,
  SmtpChannelConfig,
  SesChannelConfig,
  SendGridChannelConfig,
  AzureChannelConfig,
  GoogleChannelConfig,
  WebhookChannelConfig,
  SlackChannelConfig,
  TeamsChannelConfig,
  PagerDutyChannelConfig,
  DiscordChannelConfig,
  UsageRetentionConfig,
} from '@routerly/shared';

// backward-compat aliases
export type { SmtpChannelConfig as SmtpEmailConfig } from '@routerly/shared';
export type { SesChannelConfig as SesEmailConfig } from '@routerly/shared';
export type { SendGridChannelConfig as SendGridEmailConfig } from '@routerly/shared';
export type { AzureChannelConfig as AzureEmailConfig } from '@routerly/shared';
export type { GoogleChannelConfig as GoogleEmailConfig } from '@routerly/shared';
// ponytail: local imports for types used in interfaces defined below
import type { SmtpChannelConfig, SesChannelConfig, SendGridChannelConfig, AzureChannelConfig, GoogleChannelConfig, NotificationsConfig, UsageRetentionConfig } from '@routerly/shared';
export type EmailConfig = SmtpChannelConfig | SesChannelConfig | SendGridChannelConfig | AzureChannelConfig | GoogleChannelConfig;

export interface TelemetryConfig {
  enabled: boolean;
  installId: string;
  lastPingedVersion?: string;
}

export interface Settings {
  port: number;
  host: string;
  dashboardEnabled: boolean;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  /** Public base URL of the service — used in "How to connect" when dashboard runs on a different host. */
  publicUrl?: string;
  notifications?: NotificationsConfig;
  /** Distribution channel for updates: 'latest' | 'stable' | 'develop' | vX.Y.Z tag */
  channel?: string;
  /** Anonymous install metrics opt-in. Absent means the user has not been asked yet. */
  telemetry?: TelemetryConfig;
  /** When true, all users must have 2FA enabled to access the dashboard. */
  requireMfa?: boolean;
  /** Whether to expose the Prometheus-compatible /metrics endpoint (default true) */
  metricsEnabled?: boolean;
  /** Optional Bearer token required to access /metrics. Absent means no auth. */
  prometheusAuthToken?: string | undefined;
  /** Provider catalog repositories. */
  providerRepos?: ProviderRepo[];
  /** Non-loopback IPv4 addresses of the machine running the service — injected at runtime, not persisted. */
  localAddresses?: string[];
  /** URLs the service is actually reachable at, derived from the bind host — injected at runtime, not persisted. */
  listeningAddresses?: string[];
  /** Usage/billing history retention policy. Absent means no policy configured. */
  usageRetention?: UsageRetentionConfig;
  /** Instance-wide default dashboard language for users who haven't picked their own yet. Absent means English. */
  defaultLanguage?: string;
}

export const getSettings = () => request<Settings>('/settings');
export const updateSettings = (data: Partial<Settings>) =>
  request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(data) });

// ── System info ──────────────────────────────────────────────────────────────
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  channel: string;
  releaseUrl?: string;
  checkedAt: string;
}

export interface SystemInfo {
  version: string;
  nodeVersion: string;
  platform: string;
  configDir: string;
  dataDir: string;
  uptimeSeconds: number;
  channel: string;
  rawChannel: string;
  isDocker: boolean;
  updateInfo: UpdateInfo | null;
}

export const getSystemInfo = () => request<SystemInfo>('/system/info');

// ── Permission guard (RTR-04) ─────────────────────────────────────────────
export const getPermissionStatus = () => request<PermissionCheckStatus>('/system/permissions');
export const fixPermissions = () =>
  request<{ fixed: string[] }>('/system/permissions/fix', { method: 'POST', body: JSON.stringify({ confirm: true }) })
    .then(result => {
      // Multiple independent components poll permission status (App.tsx's
      // banner, PermissionGuardModal, SettingsPage's FilePermissionsSection).
      // A fix from any one of them must refresh all of them — mirrors the
      // 'lr-permission-blocked' event above.
      window.dispatchEvent(new CustomEvent('lr-permission-fixed'));
      return result;
    });

export const checkForUpdates = () => request<UpdateInfo>('/system/update-check');
export const triggerUpdate = () => request<{ message: string }>('/system/update', { method: 'POST' });

export interface AvailableReleases {
  channels: string[];
  versions: string[];
}
export const getAvailableReleases = () => request<AvailableReleases>('/system/releases');

export const testNotificationChannel = (channelId: string, to: string) =>
  request<{ ok: boolean; message: string; fixedSecure?: boolean }>('/notifications/test', {
    method: 'POST',
    body: JSON.stringify({ channelId, to }),
  });

// ── Notification channel CRUD ─────────────────────────────────────────────────

/**
 * A channel as returned by GET endpoints — secret fields are replaced with
 * '********' by the service, so they are typed optional here.
 */
export type RedactedChannel = Record<string, unknown> & {
  id: string;
  provider: string;
  name?: string;
  events?: string[];
  targets?: {
    roles?: string[];
    permissions?: string[];
    users?: string[];
  };
};

export const getNotificationChannels = () =>
  request<RedactedChannel[]>('/notifications/channels');

export const getNotificationChannel = (id: string) =>
  request<RedactedChannel>(`/notifications/channels/${id}`);

export const createNotificationChannel = (body: Record<string, unknown>) =>
  request<RedactedChannel>('/notifications/channels', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateNotificationChannel = (id: string, patch: Record<string, unknown>) =>
  request<RedactedChannel>(`/notifications/channels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteNotificationChannel = (id: string) =>
  request<void>(`/notifications/channels/${id}`, { method: 'DELETE' });

export const testOpenAIOAuth = (authFilePath?: string) =>
  request<{ ok: boolean; accountId?: string; expiresAt?: string | null; error?: string }>(
    '/test/openai-oauth',
    { method: 'POST', body: JSON.stringify({ authFilePath }) },
  );

// ── Profile (current user) ────────────────────────────────────────────────
export interface Me {
  id: string;
  email: string;
  roleId: string;
  language?: string;
}

export const getMe = () => request<Me>('/me');
export const updateMe = (data: { currentPassword: string; newPassword: string }) =>
  request<Me>('/me', { method: 'PUT', body: JSON.stringify(data) });
export const updateMyLanguage = (language: string) =>
  request<{ language: string }>('/me/language', { method: 'PATCH', body: JSON.stringify({ language }) });

// ── Notification inbox (#91) ───────────────────────────────────────────────
import type { NotificationCategory, NotificationIncidentEvent } from '@routerly/shared';
export type { NotificationCategory, NotificationIncidentEvent };

export interface InboxItem {
  id: string;
  event: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  details: Record<string, unknown>;
  read: boolean;
  /** Set when the event belongs to a traced request (T50). */
  traceId?: string;
  /** How many events the incident folded together; 1 for a plain notification. */
  eventCount?: number;
  /** The folded sequence, sent by the detail route only. */
  events?: NotificationIncidentEvent[];
}

export interface InboxPagination {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

/** Flat-list fetch (NotificationBell, opt-in probe). */
export const getNotificationInbox = (opts: { limit?: number; unreadOnly?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.unreadOnly) q.set('unreadOnly', 'true');
  const qs = q.toString();
  return request<{ items: InboxItem[]; unreadCount: number; enabled: boolean }>(`/notifications/inbox${qs ? `?${qs}` : ''}`);
};

/** Paginated fetch with filters (notifications table). */
export const getNotificationInboxPage = (opts: {
  page: number;
  pageSize: number;
  severity?: 'info' | 'warning' | 'critical';
  event?: string;
  category?: NotificationCategory;
  unreadOnly?: boolean;
  from?: string;
  to?: string;
}) => {
  const q = new URLSearchParams();
  q.set('page', String(opts.page));
  q.set('pageSize', String(opts.pageSize));
  if (opts.severity) q.set('severity', opts.severity);
  if (opts.event) q.set('event', opts.event);
  if (opts.category) q.set('category', opts.category);
  if (opts.unreadOnly) q.set('unreadOnly', 'true');
  if (opts.from) q.set('from', opts.from);
  if (opts.to) q.set('to', opts.to);
  return request<{ items: InboxItem[]; pagination: InboxPagination; unreadCount: number; enabled: boolean }>(
    `/notifications/inbox?${q.toString()}`,
  );
};

export const getNotificationInboxItem = (id: string) =>
  request<InboxItem>(`/notifications/inbox/${id}`);

export const markNotificationsRead = (body: { ids?: string[]; all?: boolean }) =>
  request<{ updated: number }>('/notifications/inbox/read', { method: 'POST', body: JSON.stringify(body) });

export const markNotificationsUnread = (body: { ids?: string[]; all?: boolean }) =>
  request<{ updated: number }>('/notifications/inbox/unread', { method: 'POST', body: JSON.stringify(body) });

export const deleteNotifications = (body: { ids?: string[]; all?: boolean }) =>
  request<{ deleted: number }>('/notifications/inbox/delete', { method: 'POST', body: JSON.stringify(body) });

// ── Playground presets (#99) ──────────────────────────────────────────────
export interface PlaygroundPreset {
  id: string;
  name: string;
  systemPrompt: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export const getPlaygroundPresets = (routerId: string) =>
  request<PlaygroundPreset[]>(`/routers/${routerId}/playground-presets`);

export const createPlaygroundPreset = (routerId: string, data: { name: string; systemPrompt: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> }) =>
  request<PlaygroundPreset>(`/routers/${routerId}/playground-presets`, { method: 'POST', body: JSON.stringify(data) });

export const deletePlaygroundPreset = (routerId: string, presetId: string) =>
  request<void>(`/routers/${routerId}/playground-presets/${presetId}`, { method: 'DELETE' });

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  email: string;
  endpoint: string;
  action: string;
  result: 'success' | 'forbidden' | 'error';
  details?: Record<string, unknown>;
}

export interface AuditPage {
  entries: AuditEntry[];
  pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
}

// ── Integrations ──────────────────────────────────────────────────────────────

export const getIntegrations = () =>
  request<Integration[]>('/integrations');

export const createIntegration = (body: Record<string, unknown>) =>
  request<Integration>('/integrations', { method: 'POST', body: JSON.stringify(body) });

export const updateIntegration = (id: string, patch: Record<string, unknown>) =>
  request<Integration>(`/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteIntegration = (id: string) =>
  request<void>(`/integrations/${id}`, { method: 'DELETE' });

export const testIntegration = (id: string) =>
  request<{ ok: boolean; message: string }>(`/integrations/${id}/test`, { method: 'POST' });

export const getAuditLog = (params?: { userId?: string; action?: string; result?: string; from?: string; to?: string; page?: number; pageSize?: number }) => {
  const q = new URLSearchParams();
  if (params?.userId)                       q.set('userId', params.userId);
  if (params?.action)                       q.set('action', params.action);
  if (params?.result && params.result !== 'all') q.set('result', params.result);
  if (params?.from)                         q.set('from', params.from);
  if (params?.to)                           q.set('to', params.to);
  if (params?.page)                         q.set('page', String(params.page));
  if (params?.pageSize)                     q.set('pageSize', String(params.pageSize));
  return request<AuditPage>(`/audit${q.size ? '?' + q : ''}`);
};

// ── Provider connections & model instances ───────────────────────────────────

export interface ProviderDescriptor {
  id: string;
  label: string;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  supportLevel: 'native' | 'compatible' | 'oauth' | 'web';
  nativeCapabilities: ModelCapabilities;
}

export const getProviderDescriptors = () => request<ProviderDescriptor[]>('/providers/descriptors');

/**
 * Connection as returned by the API. Secrets are redacted server-side; only non-secret
 * cloud config fields (region, resource names, router id) are returned so the edit form
 * can prefill them, exactly like the model detail form.
 */
export interface Connection {
  id: string;
  providerId: string;
  /** Upstream provider behind a `custom` connection, e.g. `deepseek` (T205). */
  providerName?: string;
  label: string;
  credentials?: Record<string, string>;
  endpoint?: string;
  enabled: boolean;
}

export const getConnections = () => request<Connection[]>('/connections');
/** `label` omitted or blank: the server names the connection after its provider. */
export const createConnection = (data: {
  providerId: string; providerName?: string; label?: string; credentials: Record<string, string>;
  endpoint?: string; enabled: boolean;
}) => request<Connection>('/connections', { method: 'POST', body: JSON.stringify(data) });
export const updateConnection = (id: string, data: Partial<{
  providerId: string; providerName: string; label: string; credentials: Record<string, string>;
  endpoint?: string; enabled: boolean;
}>) => request<Connection>(`/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteConnection = (id: string) => request<void>(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ── Personal MCP surface (tools + tokens of the signed-in user) ──────────────

import type { McpToken } from '@routerly/shared';

export interface McpToolRow {
  name: string;
  scope: 'read' | 'write';
  description: string;
  sourceModule: string;
  /** Permission the caller must hold for this tool; always one the caller has. */
  permission: Permission;
}

/** A stored MCP token as the API returns it: everything but the hash. */
export type McpTokenRow = Omit<McpToken, 'tokenHash'>;

export const getMyMcpTools = () => request<McpToolRow[]>('/me/mcp-tools');
export const getMyMcpTokens = () => request<McpTokenRow[]>('/me/mcp-tokens');
/** The raw `token` is returned once, here, and never again. */
export const createMyMcpToken = (body: { name: string; expiresAt?: string }) =>
  request<McpTokenRow & { token: string }>('/me/mcp-tokens', { method: 'POST', body: JSON.stringify(body) });
export const deleteMyMcpToken = (id: string) =>
  request<void>(`/me/mcp-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface Instance {
  id: string;
  connectionId: string;
  upstreamModelId: string;
  cost: { inputPerMillion: number; outputPerMillion: number; cachePerMillion?: number; cacheWritePerMillion?: number; pricingTiers?: PricingTier[] };
  contextWindow: number;
  limits?: Limit[];
  capabilities?: ModelCapabilities;
}

export const getInstances = () => request<Instance[]>('/instances');
export const createInstance = (data: {
  connectionId: string; upstreamModelId: string; cost: Instance['cost']; contextWindow: number;
  limits?: Limit[]; capabilities?: ModelCapabilities;
}) => request<Instance>('/instances', { method: 'POST', body: JSON.stringify(data) });
export const updateInstance = (id: string, data: Partial<{
  connectionId: string; upstreamModelId: string; cost: Instance['cost']; contextWindow: number;
  limits?: Limit[]; capabilities?: ModelCapabilities;
}>) => request<Instance>(`/instances/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteInstance = (id: string) => request<void>(`/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ── Resilience ───────────────────────────────────────────────────────────
import type { ResilienceLevel, ResilienceState } from '@routerly/shared';
export type { ResilienceLevel, ResilienceState } from '@routerly/shared';

export const resetResilience = (body?: { level: ResilienceLevel; id: string }) =>
  request<{ ok: true }>('/resilience/reset', { method: 'POST', body: JSON.stringify(body ?? {}) });

// ── Profiles (routing, optimizer, security) ───────────────────────────────
import type {
  SelectorType, FallbackStrategyType,
  Profile, ProfileKind, RoutingProfile, OptimizerProfile, SecurityProfile,
} from '@routerly/shared';
export type {
  SelectorType, FallbackStrategyType,
  Profile, ProfileKind, RoutingProfile, OptimizerProfile, SecurityProfile,
} from '@routerly/shared';

/** Body of a create: kind and label are required, the rest defaults server-side. */
export type CreateProfileBody =
  | ({ kind: 'routing'; label: string } & Partial<Pick<RoutingProfile, 'policies' | 'selector' | 'fallbackStrategy'>>)
  | ({ kind: 'optimizer'; label: string } & Partial<Pick<OptimizerProfile, 'optimizers'>>)
  | ({ kind: 'security'; label: string } & Partial<Pick<SecurityProfile, 'guardrails' | 'pii'>>);

/** Patch body: only the fields of the profile's own kind are accepted server-side. */
export type UpdateProfileBody = { label?: string } & Partial<
  Pick<RoutingProfile, 'policies' | 'selector' | 'fallbackStrategy'> &
  Pick<OptimizerProfile, 'optimizers'> &
  Pick<SecurityProfile, 'guardrails' | 'pii'>
>;

export const getProfiles = (kind?: ProfileKind) =>
  request<Profile[]>(`/profiles${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`);
export const createProfile = (data: CreateProfileBody) =>
  request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(data) });
export const cloneProfile = (baseId: string, label: string) =>
  request<Profile>('/profiles/clone', { method: 'POST', body: JSON.stringify({ baseId, label }) });
export const updateProfile = (id: string, data: UpdateProfileBody) =>
  request<Profile>(`/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteProfile = (id: string) => request<void>(`/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
/** Assigns or clears (null) one or more kinds at once. Omitted kinds are left as they are. */
export const assignRouterProfiles = (
  routerId: string,
  body: Partial<Record<ProfileKind, string | null>>,
) => request<Router>(`/routers/${encodeURIComponent(routerId)}/profiles`, { method: 'PUT', body: JSON.stringify(body) });

// ── Experiments (T73) ─────────────────────────────────────────────────────────

export type {
  ExperimentConfig as Experiment,
  ExperimentJudge,
  ExperimentMetrics,
  ExperimentRotation,
  ExperimentStickyKey,
  ExperimentVariant,
  ExperimentVariantMetrics,
} from '@routerly/shared';
import type { ExperimentConfig, ExperimentJudge, ExperimentMetrics, ExperimentRotation, ExperimentStickyKey, ExperimentVariant } from '@routerly/shared';

/** The list and detail routes blank out the token value: only creation returns it. */
export type MaskedExperiment = Omit<ExperimentConfig, 'tokens'> & { tokens: RouterToken[] };

/** A variant added in the form has no id yet: the service mints one on save. */
export type ExperimentVariantInput = Omit<ExperimentVariant, 'id'> & { id?: string };

export interface CreateExperimentBody {
  name: string;
  description?: string;
  rotation?: ExperimentRotation;
  stickyKey?: ExperimentStickyKey;
  variants: ExperimentVariantInput[];
  judge?: ExperimentJudge;
  minSamplesPerVariant?: number;
}

export type UpdateExperimentBody = Partial<CreateExperimentBody>;

export const getExperiments = () => request<MaskedExperiment[]>('/experiments');
export const getExperiment = (id: string) => request<MaskedExperiment>(`/experiments/${encodeURIComponent(id)}`);
/** `from`/`to` are ISO timestamps; omitting both measures the whole history. */
export const getExperimentMetrics = (id: string, window?: { from?: string; to?: string }) => {
  const qs = new URLSearchParams();
  if (window?.from) qs.set('from', window.from);
  if (window?.to) qs.set('to', window.to);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request<ExperimentMetrics>(`/experiments/${encodeURIComponent(id)}/metrics${suffix}`);
};
/** The only response that carries the raw token: show it once, it is never readable again. */
export const createExperiment = (data: CreateExperimentBody) =>
  request<MaskedExperiment & { token: string }>('/experiments', { method: 'POST', body: JSON.stringify(data) });
export const updateExperiment = (id: string, data: UpdateExperimentBody) =>
  request<MaskedExperiment>(`/experiments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
export const createExperimentToken = (id: string) =>
  request<{ token: string; tokenInfo: RouterToken }>(`/experiments/${encodeURIComponent(id)}/tokens`, { method: 'POST' });
export const deleteExperimentToken = (id: string, tokenId: string) =>
  request<void>(`/experiments/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' });
export const deleteExperiment = (id: string) =>
  request<void>(`/experiments/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ── Optimizers ────────────────────────────────────────────────────────────
import type { LlmLinguaCheckpoint, Message, OptimizerConfig, OptimizerId, OptimizerStep } from '@routerly/shared';
export type { OptimizerConfig, OptimizerId, OptimizerStep } from '@routerly/shared';

export interface InstalledOptimizer {
  id: OptimizerId;
  klass: string;
  installed: boolean;
}

export const getInstalledOptimizers = () => request<InstalledOptimizer[]>('/optimizers');

export interface OptimizerPreviewStep {
  id: OptimizerId;
  before: number;
  after: number;
  /** The prompt as this step left it, so consecutive steps can be diffed. */
  messages: Message[];
  /** The step changed the prompt and the change was rejected and rolled back. */
  rolledBack?: boolean;
  /** Why a step that saved nothing never ran, in the operator's words. */
  skipReason?: string;
}

export interface OptimizerPreviewResult {
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  perStep: OptimizerPreviewStep[];
  /** The prompt the whole pipeline would forward. */
  messages: Message[];
}

export const previewOptimizers = (body: {
  routerId?: string;
  /** Model the sample is addressed to, so context-window steps have a window. */
  model?: string;
  sampleMessages: Message[];
  steps: OptimizerStep[];
}) => request<OptimizerPreviewResult>('/optimizers/preview', { method: 'POST', body: JSON.stringify(body) });

/** One installable LLMLingua-2 checkpoint, as the service host reports it. */
export interface LlmLinguaCheckpointState extends LlmLinguaCheckpoint {
  state: 'absent' | 'downloading' | 'ready';
  /** The one a step with no `model` runs on. */
  isDefault: boolean;
  /** 0-100 while downloading, absent otherwise. */
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

/** State of the optional LLMLingua-2 checkpoints on the service host. */
export interface LlmLinguaModelState {
  runtimeInstalled: boolean;
  checkpoints: LlmLinguaCheckpointState[];
}

export const getLlmLinguaModel = () => request<LlmLinguaModelState>('/optimizers/llmlingua2/model');

/** Starts one download and returns at once: the caller polls getLlmLinguaModel. */
export const installLlmLinguaModel = (key?: string) =>
  request<LlmLinguaModelState>('/optimizers/llmlingua2/model', {
    method: 'POST',
    body: JSON.stringify(key ? { key } : {}),
  });

// ── Client configurator ──────────────────────────────────────────────────
import type { ClientMeta } from '@routerly/shared';
export type { ClientMeta, SupportState, WireFormat } from '@routerly/shared';

export interface ClientListItem extends ClientMeta {
  /** Gateway root as this request reached it; snippet builders append `/v1`. */
  baseUrl: string;
}

export interface ClientsResponse {
  enabled: boolean;
  clients: ClientListItem[];
  /** Non-loopback IPv4 addresses of the machine running the service. */
  advertisedAddresses: string[];
}

/** 404s (as an ApiError with `status === 404`) when the client-configurator module is disabled. */
export const getClients = () => request<ClientsResponse>('/clients');

