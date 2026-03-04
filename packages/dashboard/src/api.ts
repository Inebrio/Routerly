const BASE = '/api';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('lr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });

  if (res.status === 401 && path !== '/auth/login') {
    localStorage.removeItem('lr_token');
    localStorage.removeItem('lr_user');
    window.location.href = '/dashboard/login';
    throw new Error('Unauthorized');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return undefined as T;
  }

  let data: any;
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
  request<{ token: string; user: { id: string; email: string; role: string } }>(
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
export interface PricingTier {
  metric: string;
  above: number;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion?: number;
}

export interface Model {
  id: string; name: string; provider: string; endpoint: string;
  cost: { inputPerMillion: number; outputPerMillion: number; cachePerMillion?: number; pricingTiers?: PricingTier[] };
  contextWindow?: number;
  globalThresholds?: { daily?: number; weekly?: number; monthly?: number };
}

export const getModels = () => request<Model[]>('/models');
export const createModel = (data: {
  id: string; name?: string; provider: string; endpoint: string; apiKey?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  dailyBudget?: number; weeklyBudget?: number; monthlyBudget?: number;
}) => request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: {
  id?: string;
  name?: string; provider: string; endpoint: string; apiKey?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  dailyBudget?: number; weeklyBudget?: number; monthlyBudget?: number;
}) => request<Model>(`/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface RoutingPolicy {
  type: 'context' | 'cheapest' | 'health' | 'llm';
  enabled: boolean;
  config?: any;
}

export interface ProjectToken {
  id: string;
  tokenSnippet?: string;
  createdAt: string;
  models?: any[];
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
export const updateProjectToken = (id: string, tokenId: string, models?: any[], labels?: string[]) => request<ProjectToken>(`/projects/${id}/tokens/${tokenId}`, { method: 'PUT', body: JSON.stringify({ models, labels }) });
export const deleteProjectToken = (id: string, tokenId: string) => request<void>(`/projects/${id}/tokens/${tokenId}`, { method: 'DELETE' });

export const addProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });
export const updateProjectMember = (id: string, userId: string, role: string) => request<ProjectMember>(`/projects/${id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) });
export const removeProjectMember = (id: string, userId: string) => request<void>(`/projects/${id}/members/${userId}`, { method: 'DELETE' });

// ── Users ─────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; roleId: string; projectIds: string[];
}

export const getUsers = () => request<User[]>('/users');
export const createUser = (data: { email: string; password: string; roleId?: string }) =>
  request<User>('/users', { method: 'POST', body: JSON.stringify(data) });
export const updateUser = (id: string, data: { email?: string; roleId?: string; newPassword?: string }) =>
  request<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUser = (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' });

// ── Usage Stats ───────────────────────────────────────────────────────────
export interface TraceEntry {
  panel: string;
  message: string;
  details: Record<string, unknown>;
}

export interface UsageRecord {
  id: string; timestamp: string; projectId: string; modelId: string;
  inputTokens: number; outputTokens: number; cost: number; latencyMs: number; ttftMs?: number; tokensPerSec?: number; outcome: string;
  callType?: 'routing' | 'completion';
  errorMessage?: string;
  trace?: TraceEntry[];
}

export interface UsageStats {
  summary: { totalCost: number; totalCalls: number; successCalls: number; errorCalls: number; routingCalls: number; completionCalls: number; routingCost: number; completionCost: number };
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number; errors: number }>;
  timeline: [string, number][];
  records: Array<UsageRecord>;
}

export const getUsage = (period = 'monthly', projectId?: string, from?: string, to?: string) => {
  const params = new URLSearchParams({ period });
  if (projectId) params.set('projectId', projectId);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  return request<UsageStats>(`/usage?${params.toString()}`);
};

export const getUsageRecord = (id: string) =>
  request<UsageRecord>(`/usage/${id}`);

// ── Settings ──────────────────────────────────────────────────────────────
export type EmailProvider = 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google';

export interface SmtpEmailConfig   { provider: 'smtp';      fromAddress: string; fromName?: string; host: string; port: number; secure: boolean; username?: string; password?: string; }
export interface SesEmailConfig    { provider: 'ses';       fromAddress: string; fromName?: string; region: string; accessKeyId?: string; secretAccessKey?: string; }
export interface SendGridEmailConfig { provider: 'sendgrid'; fromAddress: string; fromName?: string; apiKey: string; }
export interface AzureEmailConfig  { provider: 'azure';     fromAddress: string; fromName?: string; connectionString: string; }
export interface GoogleEmailConfig { provider: 'google';    fromAddress: string; fromName?: string; clientId: string; clientSecret: string; refreshToken: string; }
export type EmailConfig = SmtpEmailConfig | SesEmailConfig | SendGridEmailConfig | AzureEmailConfig | GoogleEmailConfig;

export interface NotificationsConfig {
  email?: EmailConfig;
}

export interface Settings {
  port: number;
  host: string;
  dashboardEnabled: boolean;
  defaultTimeoutMs: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
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

// ── Profile (current user) ────────────────────────────────────────────────
export interface Me {
  id: string;
  email: string;
  roleId: string;
}

export const getMe = () => request<Me>('/me');
export const updateMe = (data: { currentPassword: string; newPassword: string }) =>
  request<Me>('/me', { method: 'PUT', body: JSON.stringify(data) });
