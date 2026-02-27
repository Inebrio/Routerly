const BASE = '/api';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('lr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
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
export interface Model {
  id: string; name: string; provider: string; endpoint: string;
  cost: { inputPerMillion: number; outputPerMillion: number };
  globalThresholds?: { daily?: number; monthly?: number };
}

export const getModels = () => request<Model[]>('/models');
export const createModel = (data: {
  id: string; name?: string; provider: string; endpoint: string; apiKey?: string;
  inputPerMillion: number; outputPerMillion: number;
  dailyBudget?: number; monthlyBudget?: number;
}) => request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
export const deleteModel = (id: string) => request<void>(`/models/${id}`, { method: 'DELETE' });

// ── Projects ──────────────────────────────────────────────────────────────
export interface Project {
  id: string; name: string; slug: string; routingModelId: string;
  models: { modelId: string }[];
  token?: string;
}

export const getProjects = () => request<Project[]>('/projects');
export const createProject = (data: {
  name: string; slug: string; routingModelId: string; modelIds: string[]; timeoutMs?: number;
}) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });
export const deleteProject = (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' });

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
