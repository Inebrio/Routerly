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
  const data = await res.json() as T;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
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
  globalThresholds?: { daily?: number; monthly?: number };
}

export const getModels = () => request<Model[]>('/models');
export const createModel = (data: {
  id: string; name?: string; provider: string; endpoint: string; apiKey?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  dailyBudget?: number; monthlyBudget?: number;
}) => request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModel = (id: string, data: {
  name?: string; provider: string; endpoint: string; apiKey?: string;
  inputPerMillion: number; outputPerMillion: number;
  cachePerMillion?: number;
  contextWindow?: number;
  pricingTiers?: PricingTier[];
  dailyBudget?: number; monthlyBudget?: number;
}) => request<Model>(`/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModel = (id: string) => request<void>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface RoutingPolicy {
  type: 'context' | 'cheapest' | 'health' | 'fallback' | 'llm';
  enabled: boolean;
  weight: number;
  config?: any;
}

export interface Project {
  id: string; name: string; routingModelId?: string;
  autoRouting?: boolean;
  fallbackRoutingModelIds?: string[];
  policies?: RoutingPolicy[];
  models: { modelId: string; prompt?: string }[];
  token?: string;
  tokenSnippet?: string;
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
export const rotateToken = (id: string) => request<Project & { token: string }>(`/projects/${id}/rotate-token`, { method: 'POST' });

// ── Users ─────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; roleId: string; projectIds: string[];
}

export const getUsers = () => request<User[]>('/users');
export const createUser = (data: { email: string; password: string; roleId?: string }) =>
  request<User>('/users', { method: 'POST', body: JSON.stringify(data) });
export const deleteUser = (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' });

// ── Usage Stats ───────────────────────────────────────────────────────────
export interface UsageStats {
  summary: { totalCost: number; totalCalls: number; successCalls: number; errorCalls: number };
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number; errors: number }>;
  timeline: [string, number][];
  records: Array<{
    id: string; timestamp: string; projectId: string; modelId: string;
    inputTokens: number; outputTokens: number; cost: number; latencyMs: number; outcome: string;
  }>;
}

export const getUsage = (period = 'monthly', projectId?: string) =>
  request<UsageStats>(`/usage?period=${period}${projectId ? `&projectId=${projectId}` : ''}`);
