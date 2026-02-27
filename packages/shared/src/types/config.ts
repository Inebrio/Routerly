// ─── Config types ────────────────────────────────────────────────────────────

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'cohere' | 'xai' | 'ollama' | 'custom';

export interface PricingTier {
  /** What dimension is being measured, e.g. "context_tokens" */
  metric: string;
  /** Threshold above which this tier's pricing applies */
  above: number;
  /** Cost per 1M input tokens in USD for this tier */
  inputPerMillion: number;
  /** Cost per 1M output tokens in USD for this tier */
  outputPerMillion: number;
  /** Cost per 1M cached tokens in USD for this tier (optional) */
  cachePerMillion?: number;
}

export interface TokenCost {
  /** Cost per 1M input tokens in USD (base / default) */
  inputPerMillion: number;
  /** Cost per 1M output tokens in USD (base / default) */
  outputPerMillion: number;
  /** Cost per 1M cached input tokens in USD (prompt caching, optional) */
  cachePerMillion?: number;
  /** Pricing overrides: when metric exceeds threshold, these prices apply instead */
  pricingTiers?: PricingTier[];
}

export interface BudgetThresholds {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  endpoint: string;
  /** AES-256-GCM encrypted API key */
  encryptedApiKey?: string | undefined;
  cost: TokenCost;
  /** Global budget thresholds for this model */
  globalThresholds?: BudgetThresholds | undefined;
}

export interface ProjectModelRef {
  modelId: string;
  /** Per-project budget overrides (take priority over global) */
  thresholds?: BudgetThresholds;
}

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  /** AES-256-GCM encrypted project token */
  encryptedToken: string;
  /** Excerpt of the first 10 characters of the token */
  tokenSnippet?: string;
  /** ID of the ModelConfig to use for routing decisions */
  routingModelId: string;
  models: ProjectModelRef[];
  /** Timeout in ms for each individual model attempt */
  timeoutMs?: number;
}

export interface UserConfig {
  id: string;
  email: string;
  /** bcrypt hash */
  passwordHash: string;
  roleId: string;
  projectIds: string[];
}

export interface RoleConfig {
  id: string;
  name: string;
  permissions: Permission[];
}

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'model:read'
  | 'model:write'
  | 'user:read'
  | 'user:write'
  | 'report:read';

export interface Settings {
  port: number;
  host: string;
  /** Whether to serve the dashboard at /dashboard */
  dashboardEnabled: boolean;
  /** Default timeout per model attempt in ms */
  defaultTimeoutMs: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

// ─── Usage & Cost types ───────────────────────────────────────────────────────

export type CallOutcome = 'success' | 'error' | 'budget_exceeded' | 'timeout';

export interface UsageRecord {
  id: string;
  timestamp: string; // ISO 8601
  projectId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Cost in USD */
  cost: number;
  /** Latency in ms (from forwarding start to last byte received) */
  latencyMs: number;
  outcome: CallOutcome;
  errorMessage?: string;
}
