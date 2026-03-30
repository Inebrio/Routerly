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
      const data = await res.json() as { token: string };
      localStorage.setItem('lr_token', data.token);
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
    window.location.href = '/dashboard/login';
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
  request<{ token: string; refreshToken?: string; user: { id: string; email: string; role: string; permissions: string[] } }>(
    '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }
  );

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

export interface Model {
  id: string; name: string; provider: string; endpoint: string;
  upstreamModelId?: string;
  cost: { inputPerMillion: number; outputPerMillion: number; cachePerMillion?: number; pricingTiers?: PricingTier[] };
  contextWindow?: number;
  limits?: Limit[];
  /** @deprecated use limits */ globalThresholds?: { daily?: number; weekly?: number; monthly?: number };
}

export const getModels = () => request<Model[]>('/models');
export const createModel = (data: {
  id: string; name?: string; provider: string; endpoint: string; apiKey?: string;
  cloneFrom?: string; upstreamModelId?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  limits?: Limit[];
}) => request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: {
  id?: string;
  name?: string; provider: string; endpoint: string; apiKey?: string;
  upstreamModelId?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  limits?: Limit[];
}) => request<Model>(`/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface RoutingPolicy {
  type: 'context' | 'cheapest' | 'health' | 'performance' | 'llm' | 'capability' | 'rate-limit' | 'fairness' | 'budget-remaining';
  enabled: boolean;
  config?: any;
}

export interface ProjectToken {
  id: string;
  tokenSnippet?: string;
  createdAt: string;
  models?: Array<{ modelId: string; limitsMode?: LimitsMode; limits?: Limit[] }>;
  labels?: string[];
}

export interface ProjectMember {
  userId: string;
  role: string;
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
}) => request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProject = (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' });
export const createProjectToken = (id: string, labels?: string[]) => request<{ token: string; tokenInfo: ProjectToken }>(`/projects/${id}/tokens`, { method: 'POST', body: JSON.stringify({ labels }) });
export const updateProjectToken = (id: string, tokenId: string, models?: Array<{ modelId: string; limitsMode?: LimitsMode; limits?: Limit[] }>, labels?: string[]) => request<ProjectToken>(`/projects/${id}/tokens/${tokenId}`, { method: 'PUT', body: JSON.stringify({ models, labels }) });
export const deleteProjectToken = (id: string, tokenId: string) => request<void>(`/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' });

export const addProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });
export const updateProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) });
export const removeProjectMember = (id: string, userId: string) => request<void>(`/projects/${id}/members/${userId}`, { method: 'DELETE' });

// ── Users ─────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; roleId: string; projectIds: string[];
  permissions?: string[];
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
}

export interface UsageStats {
  summary: { totalCost: number; totalCalls: number; successCalls: number; errorCalls: number; routingCalls: number; completionCalls: number; routingCost: number; completionCost: number };
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; cost: number; errors: number }>;
  timeline: [string, number][];
  records: Array<UsageRecord>;
  pagination?: { page: number; pageSize: number; totalRecords: number; totalPages: number };
}

export const getUsage = (period = 'monthly', projectId?: string, from?: string, to?: string, page?: number, pageSize?: number) => {
  const params = new URLSearchParams({ period });
  if (projectId) params.set('projectId', projectId);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  if (page != null) params.set('page', String(page));
  if (pageSize != null) params.set('pageSize', String(pageSize));
  return request<UsageStats>(`/usage?${params.toString()}`);
};

export const getUsageRecord = (id: string) =>
  request<UsageRecord>(`/usage/${id}`);

// ── Settings ──────────────────────────────────────────────────────────────
export type EmailProvider   = 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google';
export type ChannelProvider = EmailProvider | 'webhook';

export interface SmtpChannelConfig   { id: string; name?: string; provider: 'smtp';      fromAddress: string; fromName?: string; host: string; port: number; secure: boolean; username?: string; password?: string; }
export interface SesChannelConfig    { id: string; name?: string; provider: 'ses';       fromAddress: string; fromName?: string; region: string; accessKeyId?: string; secretAccessKey?: string; }
export interface SendGridChannelConfig { id: string; name?: string; provider: 'sendgrid'; fromAddress: string; fromName?: string; apiKey: string; }
export interface AzureChannelConfig  { id: string; name?: string; provider: 'azure';     fromAddress: string; fromName?: string; connectionString: string; }
export interface GoogleChannelConfig { id: string; name?: string; provider: 'google';    fromAddress: string; fromName?: string; clientId: string; clientSecret: string; refreshToken: string; }
export interface WebhookChannelConfig { id: string; name?: string; provider: 'webhook'; url: string; method?: 'POST' | 'GET'; secret?: string; }

export type NotificationChannel =
  | SmtpChannelConfig | SesChannelConfig | SendGridChannelConfig
  | AzureChannelConfig | GoogleChannelConfig | WebhookChannelConfig;

export interface NotificationsConfig {
  channels?: NotificationChannel[];
}

// backward-compat aliases
export type SmtpEmailConfig     = SmtpChannelConfig;
export type SesEmailConfig      = SesChannelConfig;
export type SendGridEmailConfig = SendGridChannelConfig;
export type AzureEmailConfig    = AzureChannelConfig;
export type GoogleEmailConfig   = GoogleChannelConfig;
export type EmailConfig = SmtpChannelConfig | SesChannelConfig | SendGridChannelConfig | AzureChannelConfig | GoogleChannelConfig;

export interface Settings {
  port: number;
  host: string;
  dashboardEnabled: boolean;
  defaultTimeoutMs: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  /** Public base URL of the service — used in "How to connect" when dashboard runs on a different host. */
  publicUrl?: string;
  notifications?: NotificationsConfig;
}

export const getSettings = () => request<Settings>('/settings');
export const updateSettings = (data: Partial<Settings>) =>
  request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(data) });

// ── System info ──────────────────────────────────────────────────────────────
export interface SystemInfo {
  version: string;
  nodeVersion: string;
  platform: string;
  configDir: string;
  dataDir: string;
  uptimeSeconds: number;
}

export const getSystemInfo = () => request<SystemInfo>('/system/info');

export const testNotificationChannel = (channelId: string, to: string) =>
  request<{ ok: boolean; message: string; fixedSecure?: boolean }>('/notifications/test', {
    method: 'POST',
    body: JSON.stringify({ channelId, to }),
  });

// ── Profile (current user) ────────────────────────────────────────────────
export interface Me {
  id: string;
  email: string;
  roleId: string;
}

export const getMe = () => request<Me>('/me');
export const updateMe = (data: { currentPassword: string; newPassword: string }) =>
  request<Me>('/me', { method: 'PUT', body: JSON.stringify(data) });
