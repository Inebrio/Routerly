// ─── Config types ────────────────────────────────────────────────────────────

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'cohere' | 'xai' | 'ollama' | 'custom' | 'openai-web' | 'anthropic-web' | 'deepseek' | 'groq' | 'together' | 'perplexity';

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
  /** Cost per 1M cached input tokens in USD (prompt cache read — Anthropic ~0.1×, OpenAI ~0.5×) */
  cachePerMillion?: number;
  /** Cost per 1M cache-write input tokens in USD (Anthropic cache creation ~1.25× base; not used by OpenAI) */
  cacheWritePerMillion?: number;
  /** Pricing overrides: when metric exceeds threshold, these prices apply instead */
  pricingTiers?: PricingTier[];
}

/** What dimension is being measured for a limit */
export type LimitMetric = 'cost' | 'calls' | 'input_tokens' | 'output_tokens' | 'total_tokens';

/**
 * How a limit override at a given level interacts with parent limits.
 * - 'replace': this level's limits completely replace the parent's (default)
 * - 'extend':  this level's limits are stacked on top of the parent's (all must pass)
 * - 'disable': explicitly disables all limits at this level, ignoring the parent entirely
 */
export type LimitsMode = 'replace' | 'extend' | 'disable';

/**
 * Calendar-fixed periods — the window resets at a natural boundary.
 * e.g. 'daily' = 00:00:00 → 23:59:59 of the current day
 */
export type LimitPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Time unit for rolling (sliding) windows */
export type RollingUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';

/**
 * A single usage limit rule.
 * Two window modes:
 *  - 'period': calendar-fixed (e.g., daily resets at midnight every day)
 *  - 'rolling': sliding window of the last N units (e.g., last 24 hours)
 *
 * Examples:
 *   { metric: 'cost',         windowType: 'period',  period: 'daily',  value: 5    }  → max $5/day (resets at midnight)
 *   { metric: 'cost',         windowType: 'rolling', rollingAmount: 24, rollingUnit: 'hour', value: 5 }  → max $5 in any 24 h window
 *   { metric: 'calls',        windowType: 'period',  period: 'monthly', value: 1000 }  → max 1000 calls/month
 *   { metric: 'calls',        windowType: 'rolling', rollingAmount: 60, rollingUnit: 'second', value: 10 }  → max 10 req/min
 *   { metric: 'input_tokens', windowType: 'period',  period: 'daily',  value: 500000 }  → max 500k input tokens/day
 *   { metric: 'total_tokens', windowType: 'rolling', rollingAmount: 1, rollingUnit: 'hour', value: 200000 }  → max 200k tokens per hour
 */
export interface Limit {
  metric: LimitMetric;
  /** 'period': calendar-fixed boundary, 'rolling': sliding window */
  windowType: 'period' | 'rolling';
  /** Calendar period — used when windowType === 'period' */
  period?: LimitPeriod;
  /** Number of units for rolling window — used when windowType === 'rolling' */
  rollingAmount?: number;
  /** Time unit for rolling window — used when windowType === 'rolling' */
  rollingUnit?: RollingUnit;
  value: number;
}

/** @deprecated Use Limit[] instead */
export interface BudgetThresholds {
  daily?: number;
  weekly?: number;
  monthly?: number;
}

export interface ModelCapabilities {
  /** Whether the model supports extended thinking (e.g. claude-3-7-sonnet, claude-opus-4) */
  thinking?: boolean;
  /** Whether the model supports image/vision inputs */
  vision?: boolean;
  /** Whether the model supports tool/function calling */
  functionCalling?: boolean;
  /** Whether the model supports JSON-mode output (response_format: json_object) */
  json?: boolean;
  /** Whether the model is an embedding model */
  embedding?: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  endpoint: string;
  /** Provider API key (stored in plaintext; file permissions protect it) */
  apiKey?: string | undefined;
  /** cf_clearance cookie value for Cloudflare bypass (openai-web only) */
  cfClearance?: string | undefined;
  /**
   * The exact model identifier sent to the upstream provider API.
   * Used by the custom adapter to decouple the Routerly ID from the upstream model name.
   * If absent, the adapter falls back to stripping the provider prefix from `id`.
   */
  upstreamModelId?: string;
  cost: TokenCost;
  /** Maximum context window size in tokens */
  contextWindow?: number;
  /** Global usage limits for this model */
  limits?: Limit[];
  /** @deprecated use limits instead */
  globalThresholds?: BudgetThresholds | undefined;
  /** Optional capability flags for special features */
  capabilities?: ModelCapabilities;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
}

export interface ProjectModelRef {
  modelId: string;
  prompt?: string;
  /** How these limits interact with the global model limits */
  limitsMode?: LimitsMode;
  /** Per-project usage limit overrides (take priority over global) */
  limits?: Limit[];
  /** @deprecated use limits instead */
  thresholds?: BudgetThresholds;
}

export type RoutingPolicyType = 'context' | 'cheapest' | 'health' | 'performance' | 'llm' | 'capability' | 'rate-limit' | 'fairness' | 'budget-remaining' | 'semantic-intent';

export interface RoutingPolicy {
  type: RoutingPolicyType;
  /** Whether this policy should be checked when routing */
  enabled: boolean;
  /** Optional policy-specific settings */
  config?: any;
}

/** One intent definition: example utterances and the models to consider for this intent. */
export interface IntentDefinition {
  /** Representative utterances used to compute the intent embedding (centroid). */
  examples: string[];
  /** Model IDs from the project's candidate pool to route to when this intent is matched. */
  candidate_models: string[];
}

/** Configuration for the `semantic-intent` routing policy. */
export interface SemanticIntentConfig {
  /** Embedding provider to use: 'openai' or 'ollama'. */
  embedding_provider: 'openai' | 'ollama';
  /** Embedding model ID (e.g. 'text-embedding-3-small', 'nomic-embed-text'). */
  embedding_model: string;
  /** Fallback embedding model IDs tried in order if the primary fails. */
  embedding_fallback_models?: string[];
  /** API endpoint for the embedding provider. Defaults to provider's default. */
  embedding_endpoint?: string;
  /** API key for the embedding provider. Required for OpenAI. */
  embedding_api_key?: string;
  /**
   * Minimum cosine similarity score for a classification to be considered `confident`.
   * Requests scoring below this threshold are classified as `unknown` (no filtering applied).
   * @default 0.60
   */
  absolute_threshold?: number;
  /**
   * Minimum margin between the top and second-best intent score to be considered `confident`.
   * If the margin is below this value, the classification is `ambiguous`.
   * @default 0.08
   */
  ambiguity_threshold?: number;
  /**
   * Name of the policy type to fall back to when the classification is `ambiguous` or `unknown`.
   * If not set, all candidates are passed through unchanged.
   */
  fallback_policy?: RoutingPolicyType;
  /** Map of intent name to its definition. */
  intents: Record<string, IntentDefinition>;
}

/** Cache configuration used inside the `llm` routing policy (`policy.config.cache`). */
export interface SemanticCacheConfig {
  /** Embedding provider to use: 'openai' or 'ollama'. */
  embedding_provider: 'openai' | 'ollama';
  /** Embedding model ID (e.g. 'text-embedding-3-small', 'nomic-embed-text'). */
  embedding_model: string;
  /** Fallback embedding model IDs tried in order if the primary fails. */
  embedding_fallback_models?: string[];
  /** API endpoint for the embedding provider. Defaults to provider's default. */
  embedding_endpoint?: string;
  /** API key for the embedding provider. Required for OpenAI. */
  embedding_api_key?: string;
  /**
   * How long a cached response remains valid, in minutes.
   * @default 60
   */
  ttl_seconds?: number;
  extend_on_hit?: boolean;
  /**
   * Minimum cosine similarity between the incoming request embedding and a cached entry
   * for the cached response to be returned.
   * @default 0.85
   */
  similarity_threshold?: number;
}

/** Result of classifying a request against known intents. */
export interface IntentClassification {
  /** The name of the top-ranked intent (or null when status is 'unknown'). */
  topIntent: string | null;
  /** Cosine similarity score of the top intent. */
  topScore: number;
  /** The name of the second-ranked intent (or null when fewer than 2 intents). */
  secondIntent: string | null;
  /** Cosine similarity of the second-ranked intent. */
  secondScore: number;
  /** Difference between topScore and secondScore. */
  margin: number;
  /** Classification confidence status. */
  status: 'confident' | 'ambiguous' | 'unknown';
}

export type ProjectRole = 'viewer' | 'editor' | 'admin';

export interface ProjectMember {
  userId: string;
  role: ProjectRole;
}

export interface TokenModelRef {
  modelId: string;
  /** How these limits interact with the project/global limits */
  limitsMode?: LimitsMode;
  /** Per-token usage limit overrides for this model */
  limits?: Limit[];
  /** @deprecated use limits instead */
  thresholds?: BudgetThresholds;
}

export interface ProjectToken {
  id: string;
  /** Project token (stored in plaintext; file permissions protect it) */
  token: string;
  /** First 10 characters of the token, for display purposes */
  tokenSnippet?: string;
  createdAt: string; // ISO 8601
  /** Per-token model-specific budget overrides */
  models?: TokenModelRef[];
  /** Optional labels/tags to identify this token's usage */
  labels?: string[];
}

export interface ProjectConfig {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  tokens: ProjectToken[];
  members: ProjectMember[];
  /** ID of the ModelConfig to use for routing decisions (deprecated, use policies instead) */
  routingModelId?: string;
  /** Whether auto-routing via prompt is enabled. If false, typical load-balancing/fallback logic may apply instead. (deprecated) */
  autoRouting?: boolean;
  /** Optional fallback routing models used if the primary routing model fails (deprecated) */
  fallbackRoutingModelIds?: string[];

  /** Ordered list of routing policies applied to requests */
  policies?: RoutingPolicy[];
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
  /** SHA-256 hash of the CLI refresh token. Absent means no refresh token issued. */
  refreshTokenHash?: string;
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
  /**
   * Public base URL of the service (e.g. https://routerly.example.com).
   * Used in the dashboard "How to connect" section when the dashboard is served
   * from a different host/port than the service itself.
   * If omitted, the dashboard falls back to window.location.origin.
   */
  publicUrl?: string;
  /** Optional notification channels configuration */
  notifications?: NotificationsConfig;
  /** Distribution channel for updates: 'latest' | 'stable' | 'develop' | vX.Y.Z tag */
  channel?: string;
}

// ─── Update info ─────────────────────────────────────────────────────────────

/** Available channels and version tags from GitHub Releases. */
export interface AvailableReleases {
  /** Named channels (e.g. 'latest', 'stable', 'develop') */
  channels: string[];
  /** Semver version tags (e.g. 'v0.2.0', 'v0.1.5') */
  versions: string[];
}

/** Result of a version update check against GitHub Releases. */
export interface UpdateInfo {
  /** Whether a newer version is available */
  available: boolean;
  /** Version string currently running (e.g. '0.1.5') */
  currentVersion: string;
  /** Latest version found in the resolved channel (e.g. '0.2.0') */
  latestVersion: string;
  /** Channel or tag that was checked (e.g. 'latest', 'stable', 'v0.2.0') */
  channel: string;
  /** URL to the GitHub release page */
  releaseUrl?: string;
  /** ISO-8601 timestamp of the last check */
  checkedAt: string;
}

// ─── Notification config types ────────────────────────────────────────────────

export type EmailProvider   = 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google';
export type ChannelProvider = EmailProvider | 'webhook';

interface ChannelBase {
  /** Unique channel identifier generated client-side */
  id: string;
  /** User-defined label shown in the UI */
  name?: string;
}

interface EmailChannelBase extends ChannelBase {
  fromAddress: string;
  fromName?: string;
}

export interface SmtpChannelConfig extends EmailChannelBase {
  provider: 'smtp';
  host: string;
  port: number;
  /** Use TLS/SSL (direct SSL on 465) vs STARTTLS (587/25) */
  secure: boolean;
  username?: string;
  password?: string;
}

export interface SesChannelConfig extends EmailChannelBase {
  provider: 'ses';
  region: string;
  /** Optional if using IAM instance role */
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface SendGridChannelConfig extends EmailChannelBase {
  provider: 'sendgrid';
  apiKey: string;
}

export interface AzureChannelConfig extends EmailChannelBase {
  provider: 'azure';
  connectionString: string;
}

export interface GoogleChannelConfig extends EmailChannelBase {
  provider: 'google';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface WebhookChannelConfig extends ChannelBase {
  provider: 'webhook';
  url: string;
  method?: 'POST' | 'GET';
  /** Optional HMAC-SHA256 signing secret sent as X-Routerly-Signature */
  secret?: string;
}

export type NotificationChannel =
  | SmtpChannelConfig
  | SesChannelConfig
  | SendGridChannelConfig
  | AzureChannelConfig
  | GoogleChannelConfig
  | WebhookChannelConfig;

/** Top-level notifications configuration */
export interface NotificationsConfig {
  channels?: NotificationChannel[];
}

// ── Backward-compat aliases (used by service code) ────────────────────────────
export type SmtpEmailConfig     = SmtpChannelConfig;
export type SesEmailConfig      = SesChannelConfig;
export type SendGridEmailConfig = SendGridChannelConfig;
export type AzureEmailConfig    = AzureChannelConfig;
export type GoogleEmailConfig   = GoogleChannelConfig;
export type EmailConfig =
  | SmtpChannelConfig
  | SesChannelConfig
  | SendGridChannelConfig
  | AzureChannelConfig
  | GoogleChannelConfig;

// ─── Trace types ─────────────────────────────────────────────────────────────

/** A single entry in a request trace log */
export interface TraceEntry {
  panel: string;
  message: string;
  details: Record<string, unknown>;
}

// ─── Usage & Cost types ───────────────────────────────────────────────────────

export type CallOutcome = 'success' | 'error' | 'budget_exceeded' | 'timeout';

export type CallType = 'routing' | 'completion';

export interface UsageRecord {
  id: string;
  timestamp: string; // ISO 8601
  projectId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from prompt cache read (subset of inputTokens, charged at cachePerMillion rate) */
  cachedInputTokens?: number;
  /** Input tokens written to prompt cache (Anthropic only; charged at cacheWritePerMillion rate) */
  cacheCreationInputTokens?: number;
  /** Cost in USD */
  cost: number;
  /** Latency in ms (from forwarding start to last byte received) */
  latencyMs: number;
  /** Time to first token in ms (streaming only) */
  ttftMs?: number;
  /** Tokens per second: (inputTokens + outputTokens) / (latencyMs / 1000) */
  tokensPerSec?: number;
  outcome: CallOutcome;
  errorMessage?: string;
  /** Whether this call was made by the router (LLM decision) or by the user request */
  callType?: CallType;
  /** Full trace captured at tracking time (router + model call events) */
  trace?: TraceEntry[];
  /** Request trace ID (matches x-routerly-trace-id response header) */
  traceId?: string;
  /** Cost breakdown: input tokens cost in USD (includes cached + cache-write) */
  costInput?: number;
  /** Cost breakdown: output tokens cost in USD */
  costOutput?: number;
  /** Price per 1M input tokens in USD (from model config at call time) */
  priceInput?: number;
  /** Price per 1M output tokens in USD (from model config at call time) */
  priceOutput?: number;
  /** True when this completion was served from the semantic response cache */
  cacheHit?: boolean;
  /** Cosine similarity score of the matched cache entry (0–1) */
  cacheSimilarity?: number;
}
