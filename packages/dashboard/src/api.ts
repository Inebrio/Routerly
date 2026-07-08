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

async function processResponse<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return undefined as T;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse API response as JSON:', text);
    throw new Error('Invalid JSON response from server');
  }

  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
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
  id: string; name?: string; provider: string; endpoint: string; apiKey?: string; cfClearance?: string;
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
  name?: string; provider: string; endpoint: string; apiKey?: string; cfClearance?: string;
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

export interface ProjectToken {
  id: string;
  tokenSnippet?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  models?: Array<{ modelId: string; limitsMode?: LimitsMode; limits?: Limit[] }>;
  labels?: string[];
  tags?: Record<string, string>;
}

export interface ProjectMember {
  userId: string;
  role: string;
}

export type GuardrailRuleType = 'regex' | 'semantic' | 'topic' | 'moderation';
export type GuardrailTarget = 'request' | 'response' | 'both';

export interface RegexGuardConfig { patterns: string[]; }
export interface SemanticGuardConfig { embeddingModelId: string; fallbackModelIds?: string[]; examples: string[]; threshold?: number; }
export interface TopicGuardConfig { modelId: string; fallbackModelIds?: string[]; allowedTopics: string; threshold?: number; }
export interface ModerationGuardConfig { modelId: string; fallbackModelIds?: string[]; threshold?: number; systemPrompt?: string; }

export interface GuardrailRule {
  type: GuardrailRuleType;
  enabled?: boolean;
  target: GuardrailTarget;
  config: RegexGuardConfig | SemanticGuardConfig | TopicGuardConfig | ModerationGuardConfig;
  /** Stop the request/response when this rule triggers. */
  block?: boolean;
  /** Record the trigger in usage (monitor) even when it does not block. */
  log?: boolean;
  /** Static message returned to the client when this rule blocks. */
  blockMessage?: string;
  /** (topic/moderation only) Use the judge model's own explanation as the block response. */
  useJudgeResponse?: boolean;
}

export interface GuardrailConfig {
  /** When true, run built-in prompt-injection detection on every request. */
  detectInjection?: boolean;
  rules: GuardrailRule[];
}

export type PiiEntity = 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'SSN' | 'IBAN';

export interface PiiPolicy {
  name: string;
  enabled?: boolean;
  entities?: PiiEntity[];
  customPatterns?: string[];
  /** Which side(s) to scrub: request input, model response, or both. */
  target: GuardrailTarget;
  /** Suffix buffer size (chars) for streaming response scrubbing. Only relevant when target includes response. */
  outputBufferSize?: number;
}

export interface PiiConfig {
  /** Named policies merged per-direction at scrub time. */
  policies: PiiPolicy[];
}

export interface Project {
  id: string; name: string; routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  tokens?: ProjectToken[];
  members?: ProjectMember[];
  token?: string;
  timeoutMs?: number;
  guardrails?: GuardrailConfig;
  pii?: PiiConfig;
}

export const getProjects = () => request<Project[]>('/projects');

export const createProject = (data: {
  name: string;
  routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  timeoutMs?: number;
}) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });

export const updateProject = (id: string, data: {
  name: string;
  routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  timeoutMs?: number;
  guardrails?: GuardrailConfig | null;
  pii?: PiiConfig | null;
}) => request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProject = (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' });
export const createProjectToken = (id: string, labels?: string[], tags?: Record<string, string>) => request<{ token: string; tokenInfo: ProjectToken }>(`/projects/${id}/tokens`, { method: 'POST', body: JSON.stringify({ labels, ...(tags ? { tags } : {}) }) });
export const updateProjectToken = (id: string, tokenId: string, models?: Array<{ modelId: string; limitsMode?: LimitsMode; limits?: Limit[] }>, labels?: string[], tags?: Record<string, string>) => request<ProjectToken>(`/projects/${id}/tokens/${tokenId}`, { method: 'PUT', body: JSON.stringify({ models, labels, ...(tags !== undefined ? { tags } : {}) }) });
export const deleteProjectToken = (id: string, tokenId: string) => request<void>(`/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' });

export const addProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });
export const updateProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) });
export const removeProjectMember = (id: string, userId: string) => request<void>(`/projects/${id}/members/${userId}`, { method: 'DELETE' });

// ── Users ─────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; roleId: string; projectIds: string[];
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
  'project:read', 'project:write',
  'model:read', 'model:write',
  'user:read', 'user:write',
  'report:read',
  'settings:read', 'settings:write',
  'notification:write',
  'token:read', 'token:write',
  'role:write',
  'audit:read',
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

// ── Usage Stats ───────────────────────────────────────────────────────────
export interface TraceEntry {
  panel: string;
  message: string;
  details: Record<string, unknown>;
}

export interface UsageRecord {
  id: string; timestamp: string; projectId: string; modelId: string;
  inputTokens: number; outputTokens: number; cachedInputTokens?: number; cost: number; latencyMs: number; ttftMs?: number; tokensPerSec?: number; outcome: string;
  callType?: 'routing' | 'completion';
  errorMessage?: string;
  trace?: TraceEntry[];
  guardrailTriggered?: string;
  blockedBy?: string;
  piiRedacted?: string[];
}

import type { UsageByModelEntry, Integration, IntegrationType, ProviderRepo } from '@routerly/shared';
export type { UsageByModelEntry, Integration, IntegrationType, ProviderRepo };

export interface UsageStats {
  summary: { totalCost: number; totalCalls: number; successCalls: number; errorCalls: number; routingCalls: number; completionCalls: number; routingCost: number; completionCost: number; guardrailCalls?: number; guardrailCost?: number; blockedCalls?: number };
  byModel: Record<string, UsageByModelEntry>;
  timeline: [string, number][];
  records: Array<UsageRecord>;
  pagination?: { page: number; pageSize: number; totalRecords: number; totalPages: number };
}

export interface GetUsageOptions {
  period?: string;
  projectId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  projectIds?: string[];
  modelIds?: string[];
  callType?: string;
  outcome?: string;
}

export const getUsage = (period = 'monthly', projectId?: string, from?: string, to?: string, page?: number, pageSize?: number, opts?: GetUsageOptions) => {
  const params = new URLSearchParams({ period });
  if (projectId) params.set('projectId', projectId);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  if (page != null) params.set('page', String(page));
  if (pageSize != null) params.set('pageSize', String(pageSize));
  if (opts?.projectIds?.length) params.set('projectIds', opts.projectIds.join(','));
  if (opts?.modelIds?.length)   params.set('modelIds',   opts.modelIds.join(','));
  if (opts?.callType && opts.callType !== 'all') params.set('callType', opts.callType);
  if (opts?.outcome  && opts.outcome  !== 'all') params.set('outcome',  opts.outcome);
  return request<UsageStats>(`/usage?${params.toString()}`);
};

export const getUsageRecord = (id: string) =>
  request<UsageRecord>(`/usage/${id}`);

export const getTrace = (id: string) =>
  request<{ trace: TraceEntry[] }>(`/traces/${id}`);

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
  cooldownUntil: string | null;
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
} from '@routerly/shared';

// backward-compat aliases
export type { SmtpChannelConfig as SmtpEmailConfig } from '@routerly/shared';
export type { SesChannelConfig as SesEmailConfig } from '@routerly/shared';
export type { SendGridChannelConfig as SendGridEmailConfig } from '@routerly/shared';
export type { AzureChannelConfig as AzureEmailConfig } from '@routerly/shared';
export type { GoogleChannelConfig as GoogleEmailConfig } from '@routerly/shared';
// ponytail: local imports for types used in interfaces defined below
import type { SmtpChannelConfig, SesChannelConfig, SendGridChannelConfig, AzureChannelConfig, GoogleChannelConfig, NotificationsConfig } from '@routerly/shared';
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
  defaultTimeoutMs: number;
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
  isDocker: boolean;
  updateInfo: UpdateInfo | null;
}

export const getSystemInfo = () => request<SystemInfo>('/system/info');
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
}

export const getMe = () => request<Me>('/me');
export const updateMe = (data: { currentPassword: string; newPassword: string }) =>
  request<Me>('/me', { method: 'PUT', body: JSON.stringify(data) });

// ── Notification inbox (#91) ───────────────────────────────────────────────
export interface InboxItem {
  id: string;
  event: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  details: Record<string, unknown>;
  read: boolean;
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
  unreadOnly?: boolean;
  from?: string;
  to?: string;
}) => {
  const q = new URLSearchParams();
  q.set('page', String(opts.page));
  q.set('pageSize', String(opts.pageSize));
  if (opts.severity) q.set('severity', opts.severity);
  if (opts.event) q.set('event', opts.event);
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

export const getPlaygroundPresets = (projectId: string) =>
  request<PlaygroundPreset[]>(`/projects/${projectId}/playground-presets`);

export const createPlaygroundPreset = (projectId: string, data: { name: string; systemPrompt: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> }) =>
  request<PlaygroundPreset>(`/projects/${projectId}/playground-presets`, { method: 'POST', body: JSON.stringify(data) });

export const deletePlaygroundPreset = (projectId: string, presetId: string) =>
  request<void>(`/projects/${projectId}/playground-presets/${presetId}`, { method: 'DELETE' });

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

export interface EndUser {
  userId: string;
  projectId: string;
  firstSeen: string;
  lastSeen: string;
  requests: number;
  totalCost: number;
  totalTokens: number;
}

export const getEndUsers = (projectId: string) =>
  request<{ users: EndUser[] }>(`/end-users?projectId=${encodeURIComponent(projectId)}`)
    .then(r => r.users);

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

