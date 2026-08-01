// ─── Config types ────────────────────────────────────────────────────────────

import type { OptimizerConfig } from './optimizers.js';

export type Provider = 'openai' | 'anthropic' | 'anthropic-oauth' | 'openai-oauth' | 'gemini' | 'mistral' | 'cohere' | 'xai' | 'ollama' | 'custom' | 'openai-web' | 'anthropic-web' | 'deepseek' | 'groq' | 'together' | 'perplexity' | 'azure-openai' | 'bedrock' | 'vertex';

export type ProviderId = string;

export interface ProviderConnection {
  id: string;
  providerId: ProviderId;
  label: string;
  credentials: Record<string, unknown>;
  endpoint?: string;
  enabled: boolean;
}

export interface ModelInstance {
  id: string;
  connectionId: string;
  upstreamModelId: string;
  cost: TokenCost;
  contextWindow: number;
  limits?: Limit[];
  capabilities?: ModelCapabilities;
  /** Fields manually overridden by user; these won't auto-sync from catalog */
  fieldOverrides?: Partial<Record<CatalogField, boolean>>;
  /** Last known catalog values for catalog-trackable fields; used to show defaults in UI */
  catalogDefaults?: CatalogDefaults;
}

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

/** Fields in ModelConfig that can be sourced from and auto-synced with the provider catalog */
export type CatalogField = 'inputPerMillion' | 'outputPerMillion' | 'cachePerMillion' | 'cacheWritePerMillion' | 'pricingTiers' | 'contextWindow' | 'capabilities';

/** Last known catalog values for auto-synced fields (used to show defaults in UI) */
export interface CatalogDefaults {
  inputPerMillion?: number;
  outputPerMillion?: number;
  cachePerMillion?: number;
  cacheWritePerMillion?: number;
  pricingTiers?: PricingTier[];
  contextWindow?: number;
  capabilities?: ModelCapabilities;
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
  endpoint?: string | undefined;
  /** Provider API key (stored in plaintext; file permissions protect it) */
  apiKey?: string | undefined;
  /** cf_clearance cookie value for Cloudflare bypass (openai-web only) */
  cfClearance?: string | undefined;
  // AWS Bedrock
  awsAccessKeyId?: string | undefined;
  awsSecretAccessKey?: string | undefined;
  awsRegion?: string | undefined;
  awsSessionToken?: string | undefined;
  // Azure OpenAI
  azureResourceName?: string | undefined;
  azureDeploymentId?: string | undefined;
  /** Azure OpenAI API version (default '2024-02-01') */
  azureApiVersion?: string | undefined;
  // Google Vertex AI
  vertexProjectId?: string | undefined;
  /** Vertex AI location, e.g. 'us-central1' */
  vertexLocation?: string | undefined;
  /** JSON string of service account key */
  vertexServiceAccountKey?: string | undefined;
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
  /** Fields manually overridden by user; these won't auto-sync from catalog */
  fieldOverrides?: Partial<Record<CatalogField, boolean>>;
  /** Last known catalog values for catalog-trackable fields; used to show defaults in UI */
  catalogDefaults?: CatalogDefaults;
}

/** Effective model computed from ModelInstance + ProviderConnection. Carries connectionId so resilience keys can target the real connection. */
export type EffectiveModel = ModelConfig & { connectionId: string };

export interface ProjectModelRef {
  modelId: string;
  prompt?: string;
  /**
   * Whether this model ref is active for the project. Persisted, but not yet
   * consumed by the routing engine (a later plan will wire routing to honor it);
   * toggled today via the MCP `toggle_model` write tool.
   */
  enabled?: boolean;
  /** How these limits interact with the global model limits */
  limitsMode?: LimitsMode;
  /** Per-project usage limit overrides (take priority over global) */
  limits?: Limit[];
  /** @deprecated use limits instead */
  thresholds?: BudgetThresholds;
}

export type RoutingPolicyType = 'context' | 'cheapest' | 'health' | 'performance' | 'llm' | 'capability' | 'rate-limit' | 'fairness' | 'budget-remaining' | 'semantic-intent' | 'model-preference';

export interface RoutingPolicy {
  type: RoutingPolicyType;
  /** Whether this policy should be checked when routing */
  enabled: boolean;
  /** Optional policy-specific settings */
  config?: any;
}

export type SelectorType = 'argmax' | 'weighted-random' | 'round-robin' | 'cheapest' | 'lowest-latency';

export type FallbackStrategyType = 'next-best' | 'retry-after-cooldown' | 'abort';

/**
 * The three independent kinds of reusable project preset. A project picks a
 * profile or goes custom for each kind separately: routing, optimizers and
 * security are unrelated concerns and share nothing but the envelope.
 */
export type ProfileKind = 'routing' | 'optimizer' | 'security';

/** Fields every profile carries regardless of kind. */
export interface ProfileBase {
  id: string;
  version: number;
  label: string;
  /** Built-ins ship with Routerly: immutable, not deletable, clone to customize. */
  builtin: boolean;
  /** For user overlays: the built-in preset id this profile was cloned from. */
  baseId?: string;
}

export interface RoutingProfile extends ProfileBase {
  kind: 'routing';
  policies: RoutingPolicy[];
  selector: SelectorType;
  fallbackStrategy: FallbackStrategyType;
}

export interface OptimizerProfile extends ProfileBase {
  kind: 'optimizer';
  optimizers: OptimizerConfig;
}

/**
 * Guardrails and PII travel together: they are the two halves of what the
 * dashboard already presents as a project's Security tab, and splitting them
 * into two profile kinds would make the user pick twice for one decision.
 */
export interface SecurityProfile extends ProfileBase {
  kind: 'security';
  guardrails: GuardrailConfig;
  pii: PiiConfig;
}

export type Profile = RoutingProfile | OptimizerProfile | SecurityProfile;

/** Maps a ProfileKind to its concrete profile type. */
export type ProfileOfKind<K extends ProfileKind> = Extract<Profile, { kind: K }>;

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

/** Content guardrail rule type (#77). */
export type GuardrailRuleType = 'regex' | 'semantic' | 'topic' | 'moderation';

/** Which side of the conversation the rule applies to (#77). */
export type GuardrailTarget = 'request' | 'response' | 'both';

export interface RegexGuardConfig {
  patterns: string[];
}

export interface SemanticGuardConfig {
  /** Model ID from project's configured models — must be an embedding model. */
  embeddingModelId: string;
  /** Ordered fallback embedding model IDs, tried in order if the primary fails (not-found or call error). */
  fallbackModelIds?: string[];
  /** Example texts to block (similarity above threshold triggers). */
  examples: string[];
  /** Cosine similarity threshold 0-1, default 0.82. */
  threshold?: number;
}

export interface TopicGuardConfig {
  /** Judge model ID from project's configured models (any LLM provider). Optional only when enforcement is 'inject' (no judge call). */
  modelId?: string;
  /** Ordered fallback judge model IDs, tried in order if the primary fails. */
  fallbackModelIds?: string[];
  /** Natural language description of allowed topics. */
  allowedTopics: string;
  /** Score 0-1, default 0.5. BELOW threshold = off-topic = blocked. */
  threshold?: number;
}

export interface ModerationGuardConfig {
  /** Judge model ID from project's configured models (any LLM provider). Optional only when enforcement is 'inject' (no judge call). */
  modelId?: string;
  /** Ordered fallback judge model IDs, tried in order if the primary fails. */
  fallbackModelIds?: string[];
  /** Harm score 0-1, default 0.5. ABOVE threshold = blocked. */
  threshold?: number;
  /** Custom system prompt for the moderation judge model. Falls back to the built-in classifier prompt when omitted. */
  systemPrompt?: string;
}

export interface GuardrailRule {
  type: GuardrailRuleType;
  enabled?: boolean;
  /**
   * Where the rule's judge/scan runs: 'request', 'response', or 'both'. Required for
   * regex/semantic. For topic/moderation it may be omitted when the rule only injects
   * (inject-only, no judge). request+response are two independent flags in the UI.
   */
  target?: GuardrailTarget;
  config: RegexGuardConfig | SemanticGuardConfig | TopicGuardConfig | ModerationGuardConfig;
  /** Stop the request/response when this rule triggers. */
  block?: boolean;
  /** Record the trigger in usage (monitor) even when it does not block. */
  log?: boolean;
  /** Static message returned to the client when this rule blocks. Falls back to a built-in default when absent. */
  blockMessage?: string;
  /**
   * (topic/moderation only) Use the judge model's own explanation as the block
   * response. The judge is asked to return `{ score, message }`; on block the
   * `message` is returned to the client, falling back to `blockMessage` (then a
   * built-in default) when the judge fails or returns none.
   */
  useJudgeResponse?: boolean;
  /**
   * (topic/moderation only) Inject the rule's instruction (allowedTopics / systemPrompt)
   * into the outgoing request system prompt so the serving model self-enforces. Soft:
   * this steers the model, it does not guarantee a block. Mutates the request payload.
   * Independent of the judge: a rule may inject and/or judge (request/response) in any
   * combination. Injection always applies to the request regardless of `target`.
   */
  inject?: boolean;
}

/** Content guardrail configuration for a project (#77). Presence of this config activates guardrails — no separate enabled flag. Each rule carries its own block/log action. */
export interface GuardrailConfig {
  /** When true, run built-in prompt-injection detection on every request (top-level, not a rule). A hit blocks and is logged. */
  detectInjection?: boolean;
  /** Ordered list of rules evaluated in sequence; first match wins. */
  rules: GuardrailRule[];
}

/** PII entity types detected and scrubbed before forwarding (#76). */
export type PiiEntity = 'EMAIL' | 'PHONE' | 'CREDIT_CARD' | 'SSN' | 'IBAN';

/**
 * A PII policy with its own entity set, patterns, direction, and streaming
 * buffer (#76). All enabled policies are merged per-direction at scrub time.
 */
export interface PiiPolicy {
  /** Default true when absent. */
  enabled?: boolean;
  entities?: PiiEntity[];
  customPatterns?: string[];
  /** Which side(s) to scrub: request input, model response, or both. */
  target: GuardrailTarget;
  /**
   * Suffix buffer size (chars) for streaming response scrubbing. The last N chars
   * are held back until the next chunk arrives, so patterns spanning chunk
   * boundaries are caught. Defaults to 30. Only relevant when `target` includes
   * response. When several response policies are active the largest value wins.
   */
  outputBufferSize?: number;
}

/**
 * PII detection and scrubbing configuration for a project (#76). Just a list of
 * policies; the presence of at least one enabled policy activates
 * scrubbing. Each policy controls its own entity set, patterns, and direction.
 */
export interface PiiConfig {
  /** Policies merged per-direction at scrub time. */
  policies: PiiPolicy[];
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
  /** ISO 8601 timestamp of last use (updated on each authenticated request) */
  lastUsedAt?: string;
  /** ISO 8601 expiry timestamp; absent or null means never expires */
  expiresAt?: string;
  /** Per-token model-specific budget overrides */
  models?: TokenModelRef[];
  /** Optional labels/tags to identify this token's usage */
  labels?: string[];
  /** Free-form access scopes/labels granted to this token */
  scopes?: string[];
  /** Arbitrary key-value metadata attached to this token, forwarded to usage records */
  tags?: Record<string, string>;
}

/** A saved prompt preset for the playground (#99). */
export interface PlaygroundPreset {
  id: string;
  name: string;
  systemPrompt: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}


/** Default TTFT timeout per model attempt (ms) for a new project. Low on purpose:
 *  it is time-to-first-byte, not total duration, so a provider that has not started
 *  answering within two seconds is better replaced by the next candidate. */
export const DEFAULT_PROJECT_TIMEOUT_MS = 2000;

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
  /** TTFT timeout per model attempt (ms). If the first response byte hasn't arrived
   *  within this time, the attempt is aborted and the next candidate is tried.
   *  Does not limit total response duration. `0` disables the timeout: the attempt
   *  waits as long as the provider takes. Default: DEFAULT_PROJECT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Content guardrails: input blocklist + prompt-injection detection (#77) */
  guardrails?: GuardrailConfig;
  /** PII detection and scrubbing before requests reach the model (#76) */
  pii?: PiiConfig;
  /** Per-project notification override: channel IDs to dispatch this project's events to (#91) */
  notifications?: { channels: string[] };
  /** Named saved prompts for the playground (#99) */
  playgroundPresets?: PlaygroundPreset[];
  /**
   * Active routing profile id. Absent means custom: the project's own
   * `policies` are used. Same contract for the two ids below.
   */
  routingProfileId?: string;
  /** Active optimizer profile id. Absent means custom: the project's own `optimizers` are used. */
  optimizerProfileId?: string;
  /** Active security profile id. Absent means custom: the project's own `guardrails`/`pii` are used. */
  securityProfileId?: string;
  /** @deprecated renamed to routingProfileId; migrated at startup. */
  profileId?: string;
  /** Prompt/context optimizer pipeline. Presence activates the subsystem; step order = execution order */
  optimizers?: OptimizerConfig;
}

/**
 * A named MCP token owned by a user. Unlike ProjectToken (plaintext on disk,
 * because the proxy must compare it against an incoming Authorization header of
 * unknown project), an MCP token identifies a single user, so it is stored as a
 * SHA-256 hash and the raw value is shown once, at creation.
 */
export interface McpToken {
  id: string;
  /** User-chosen label, unique per user. */
  name: string;
  /** SHA-256 hash of the raw token. */
  tokenHash: string;
  /** First 14 characters of the raw token, for display. */
  tokenSnippet: string;
  createdAt: string; // ISO 8601
  /** ISO 8601 timestamp of last use on the MCP surface. */
  lastUsedAt?: string;
  /** ISO 8601 expiry timestamp; absent means never expires. */
  expiresAt?: string;
}

export interface UserConfig {
  id: string;
  email: string;
  /** bcrypt hash */
  passwordHash: string;
  roleId: string;
  projectIds: string[];
  /** MCP tokens minted by this user. Each grants exactly this user's permissions. */
  mcpTokens?: McpToken[];
  /** SHA-256 hash of the CLI refresh token. Absent means no refresh token issued. */
  refreshTokenHash?: string;
  /** base32-encoded TOTP secret, present when 2FA is enrolled */
  totpSecret?: string;
  totpEnabled?: boolean;
  /** SHA-256 hashed one-time backup codes */
  backupCodes?: string[];
}

export interface RoleConfig {
  id: string;
  name: string;
  permissions: Permission[];
}

export interface ModuleRecord {
  id: string;
  enabled: boolean;
  config?: unknown;
}

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'model:read'
  | 'model:write'
  | 'user:read'
  | 'user:write'
  | 'report:read'
  | 'settings:read'
  | 'settings:write'
  | 'notification:write'
  | 'token:read'
  | 'token:write'
  | 'role:write'
  | 'modules:read'
  | 'modules:manage'
  | 'audit:read'
  | 'connections:read'
  | 'connections:manage'
  | 'resilience:read'
  | 'resilience:manage'
  | 'profiles:read'
  | 'profiles:manage'
  | 'optimizers:read'
  | 'optimizers:manage';

// ─── Integration types ────────────────────────────────────────────────────────

export interface PrometheusIntegration {
  id: string;
  type: 'prometheus';
  enabled: boolean;
  authToken?: string;
}

export interface OtelIntegration {
  id: string;
  type: 'otel';
  enabled: boolean;
  endpoint: string;
  protocol: 'http' | 'grpc';
  headers?: Record<string, string>;
}

export interface DatadogIntegration {
  id: string;
  type: 'datadog';
  enabled: boolean;
  apiKey: string;
  site: 'datadoghq.com' | 'datadoghq.eu' | 'us3.datadoghq.com' | 'us5.datadoghq.com' | 'ddog-gov.com';
}

export interface GrafanaIntegration {
  id: string;
  type: 'grafana';
  enabled: boolean;
  url: string;
  username: string;
  apiKey: string;
}

export interface InfluxDBIntegration {
  id: string;
  type: 'influxdb';
  enabled: boolean;
  url: string;
  token: string;
  org: string;
  bucket: string;
}

export interface WebhookIntegration {
  id: string;
  type: 'webhook';
  enabled: boolean;
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

export type Integration =
  | PrometheusIntegration
  | OtelIntegration
  | DatadogIntegration
  | GrafanaIntegration
  | InfluxDBIntegration
  | WebhookIntegration;

export type IntegrationType = Integration['type'];

export interface TelemetryConfig {
  /** Whether the user has opted in to anonymous install metrics */
  enabled: boolean;
  /** Random UUID generated once at opt-in time, never changes */
  installId: string;
  /** Version that last fired a telemetry ping — absent means not yet tracked */
  lastPingedVersion?: string;
}

export interface ProviderRepo {
  /** Raw base URL of the provider catalog repo (e.g. https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/) */
  url: string;
  /** Channel override: 'stable' | 'latest' | 'beta'. If omitted, Routerly resolves by version range. */
  channel?: string;
  /** Whether this repo is active. Disabled repos are kept in config but skipped at fetch time. */
  enabled: boolean;
}

export interface Settings {
  port: number;
  host: string;
  /** Whether to serve the dashboard at /dashboard */
  dashboardEnabled: boolean;
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
  /** Whether to expose the Prometheus-compatible /metrics endpoint (default true) */
  metricsEnabled?: boolean;
  /** Optional Bearer token required to access /metrics. Absent means no auth. */
  prometheusAuthToken?: string | undefined;
  /** Anonymous install metrics opt-in. Absent means the user has not been asked yet. */
  telemetry?: TelemetryConfig;
  /** When true, all users must enroll in and pass 2FA before accessing the API */
  requireMfa?: boolean;
  /** Configured integrations (metrics exporters, webhooks, etc.) */
  integrations?: Integration[];
  /** Provider catalog repos. Fetched at runtime via HTTP. First repo takes precedence on conflict. */
  providerRepos?: ProviderRepo[];
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

export type EmailProvider    = 'smtp' | 'ses' | 'sendgrid' | 'azure' | 'google';
export type NativeProvider   = 'slack' | 'teams' | 'pagerduty' | 'discord';
export type ChannelProvider  = EmailProvider | 'webhook' | NativeProvider | 'dashboard';

/** Recipient targeting for a channel. Empty/undefined arrays = everyone (U5). */
export interface ChannelTargets {
  /** Role IDs whose users are targeted */
  roles?: string[];
  /** Users whose role grants any of these permissions are targeted */
  permissions?: Permission[];
  /** Explicit user IDs targeted */
  users?: string[];
}

interface ChannelBase {
  /** Unique channel identifier generated client-side */
  id: string;
  /** User-defined label shown in the UI */
  name?: string;
  /**
   * Event-name patterns this channel receives (exact, `*`, or `prefix.*`).
   * When non-empty it is the primary routing mechanism; empty/undefined falls
   * back to receive-all for dashboard channels, silence for external channels.
   */
  events?: string[];
  /** Per-channel minimum interval between dispatches in seconds (0 or absent = no cooldown) */
  cooldownSeconds?: number;
  /** Project IDs this channel applies to; empty/absent = all projects */
  projects?: string[];
  /** Recipient targeting (U5). Undefined or all-empty = everyone. */
  targets?: ChannelTargets;
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

export interface SlackChannelConfig extends ChannelBase {
  provider: 'slack';
  botToken: string;
  channelId: string;
}

export interface TeamsChannelConfig extends ChannelBase {
  provider: 'teams';
  webhookUrl: string;
}

export interface PagerDutyChannelConfig extends ChannelBase {
  provider: 'pagerduty';
  integrationKey: string;
}

export interface DiscordChannelConfig extends ChannelBase {
  provider: 'discord';
  webhookUrl: string;
}

/** In-dashboard inbox channel (U5). No secrets; delivery is the in-app inbox. */
export interface DashboardChannelConfig extends ChannelBase {
  provider: 'dashboard';
}

export type NotificationChannel =
  | SmtpChannelConfig
  | SesChannelConfig
  | SendGridChannelConfig
  | AzureChannelConfig
  | GoogleChannelConfig
  | WebhookChannelConfig
  | SlackChannelConfig
  | TeamsChannelConfig
  | PagerDutyChannelConfig
  | DiscordChannelConfig
  | DashboardChannelConfig;

/**
 * Secret fields per channel provider. Authoritative source of truth shared by
 * service (for redaction), dashboard (for edit form), and CLI (for edit command).
 */
export const CHANNEL_SECRET_FIELDS: Record<ChannelProvider, string[]> = {
  smtp:       ['password'],
  ses:        ['secretAccessKey'],
  sendgrid:   ['apiKey'],
  azure:      ['connectionString'],
  google:     ['clientSecret', 'refreshToken'],
  webhook:    ['secret'],
  slack:      ['botToken'],
  teams:      ['webhookUrl'],
  pagerduty:  ['integrationKey'],
  discord:    ['webhookUrl'],
  dashboard:  [],
};

/** Top-level notifications configuration */
export interface NotificationsConfig {
  channels?: NotificationChannel[];
}

/** Severity of a system notification event (#89) */
export type NotificationSeverity = 'info' | 'warning' | 'critical';

/**
 * Canonical system event taxonomy (#89). Single source of truth shared by
 * service, dashboard and CLI. `emitEvent` accepts any string, but these are the
 * events Routerly emits.
 */
export const NOTIFICATION_EVENTS = [
  'provider.error',
  'provider.degraded',
  'provider.recovered',
  'provider.rate_limited',
  'routing.no_candidates',
  'routing.fallback_used',
  'auth.login_failed',
  'auth.token_invalid',
  'config.model_added',
  'config.model_deleted',
  'config.project_created',
  'config.project_deleted',
  'budget.threshold_reached',
  'budget.exceeded',
  'budget.reset',
  'system.startup',
  'system.shutdown',
] as const;

/** One of the canonical {@link NOTIFICATION_EVENTS} names. */
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** A persisted in-app inbox notification (#91) */
export interface NotificationInboxItem {
  id: string;
  event: string;
  severity: NotificationSeverity;
  timestamp: string; // ISO 8601
  details: Record<string, unknown>;
  /** User IDs that have marked this item as read */
  readBy: string[];
  /**
   * User IDs that have dismissed (deleted) this item. Per-user soft delete:
   * the item stays in storage but is hidden from each listed user's inbox.
   */
  deletedBy?: string[];
  /**
   * User IDs allowed to see this item (U5). Undefined = visible to everyone
   * (legacy items and items from untargeted dashboard channels).
   */
  recipients?: string[];
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

export type CallOutcome = 'success' | 'error' | 'budget_exceeded' | 'timeout' | 'blocked';

export type CallType = 'routing' | 'completion' | 'guardrail';

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
  /** End-user identifier from the OpenAI `user` field — for per-user cost attribution (#96) */
  endUserId?: string;
  /** Session identifier — groups related calls for cost attribution */
  sessionId?: string;
  /** Arbitrary key-value tags — for cost attribution and filtering */
  tags?: Record<string, string>;
  /** Name of the guardrail rule that triggered on this request, if any (#77) */
  guardrailTriggered?: string;
  /** Guardrail rule that BLOCKED this request (outcome 'blocked'); distinct from guardrailTriggered, which is also set on a non-blocking flag/log pass-through (#77) */
  blockedBy?: string;
  /** PII entity types redacted from this request before forwarding (#76) */
  piiRedacted?: string[];
}

/** Per-model aggregate row in the GET /api/usage response (`byModel`). */
export interface UsageByModelEntry {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cost: number;
  errors: number;
  /** Count of outcome === 'success' (for client-side successRate = success/calls). */
  success: number;
  /** Mean latencyMs over records that carry a latency (0 when none). */
  avgLatencyMs: number;
  /** 95th-percentile latencyMs (0 when none). */
  p95LatencyMs: number;
}
