// Types
export type {
  Provider,
  ProviderId,
  ProviderConnection,
  ModelInstance,
  PricingTier,
  TokenCost,
  CatalogField,
  CatalogDefaults,
  Limit,
  LimitMetric,
  LimitPeriod,
  LimitsMode,
  RollingUnit,
  BudgetThresholds,
  ModelCapabilities,
  ModelConfig,
  EffectiveModel,
  ProjectModelRef,
  ProjectConfig,
  PlaygroundPreset,
  ProjectToken,
  ProjectMember,
  ProjectRole,
  GuardrailConfig,
  GuardrailRule,
  GuardrailRuleType,
  GuardrailTarget,
  RegexGuardConfig,
  SemanticGuardConfig,
  TopicGuardConfig,
  ModerationGuardConfig,
  PiiConfig,
  PiiEntity,
  PiiPolicy,
  TokenModelRef,
  RoutingPolicy,
  RoutingPolicyType,
  ProfileKind,
  ProfileBase,
  RoutingProfile,
  OptimizerProfile,
  SecurityProfile,
  Profile,
  ProfileOfKind,
  SelectorType,
  FallbackStrategyType,
  IntentDefinition,
  SemanticIntentConfig,
  IntentClassification,
  UserConfig,
  McpToken,
  RoleConfig,
  ModuleRecord,
  Permission,
  Settings,
  ProviderRepo,
  NotificationsConfig,
  NotificationSeverity,
  NotificationInboxItem,
  NotificationIncidentEvent,
  EmailConfig,
  EmailProvider,
  SmtpEmailConfig,
  SesEmailConfig,
  SendGridEmailConfig,
  AzureEmailConfig,
  GoogleEmailConfig,
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
  DashboardChannelConfig,
  ChannelTargets,
  NativeProvider,
  ChannelProvider,
  NotificationChannel,
  CallOutcome,
  CallType,
  TraceEntry,
  UsageRecord,
  UsageByModelEntry,
  UpdateInfo,
  AvailableReleases,
  Integration,
  IntegrationType,
  PrometheusIntegration,
  OtelIntegration,
  DatadogIntegration,
  GrafanaIntegration,
  InfluxDBIntegration,
  WebhookIntegration,
} from './types/config.js';

export type {
  Role,
  ContentPart,
  Message,
  ChatCompletionRequest,
  UsageInfo,
  Choice,
  ChatCompletionResponse,
  ChoiceDelta,
  StreamChoice,
  StreamChunk,
  ModelObject,
  ModelsListResponse,
} from './types/openai.js';

export type {
  AnthropicRole,
  AnthropicTextBlock,
  AnthropicImageSource,
  AnthropicImageBlock,
  AnthropicContentBlock,
  AnthropicMessage,
  MessagesRequest,
  AnthropicUsage,
  AnthropicStopReason,
  MessagesResponse,
} from './types/anthropic.js';

export type { RoutingCandidate, RoutingResponse } from './types/routing.js';

export type { McpTool, McpToolResult, McpAuthContext } from './types/mcp.js';

export type {
  OptimizerClass,
  OptimizerId,
  OptimizerEstimate,
  OptimizerResult,
  OptimizerStep,
  OptimizerConfig,
  OptimizerCallStat,
  OptimizerThresholdSpec,
  OptimizerMeta,
} from './types/optimizers.js';

// Readable catalog for the built-in optimizers: label, class, threshold spec (T63)
export { OPTIMIZER_CATALOG, optimizerLabel, optimizerThreshold } from './types/optimizers.js';

export type {
  ResilienceLevel,
  ResilienceState,
  ResilienceFault,
  ResilienceKey,
  ResilienceEntry,
  ResilienceSnapshot,
  ResilienceStore,
} from './types/resilience.js';

export type { SupportState, WireFormat, ConnectMode, ClientMeta } from './clients/index.js';
export { AUTO_MODEL, CLIENT_REGISTRY, buildSnippet, buildMcpSnippet } from './clients/index.js';

// Notification event taxonomy (runtime value + derived type)
export { NOTIFICATION_EVENTS, CHANNEL_SECRET_FIELDS, DEFAULT_PROJECT_TIMEOUT_MS, CALL_TYPES, isCompletionCall } from './types/config.js';
export type { NotificationEvent } from './types/config.js';

// Readable catalog for those events: title, category, cause line (T51)
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_CATALOG,
  notificationTitle,
  notificationCategory,
  notificationCause,
} from './types/notifications.js';
export type { NotificationCategory, NotificationEventMeta } from './types/notifications.js';

// Usage request types: what a call asked for, derived from its path (T60)
export { REQUEST_TYPES, requestTypeFromPath, requestTypeLabel } from './types/usage.js';
export type {
  RequestType, SavingsBaseline, SavingsOptimizerEntry, SavingsSummary, UsageSeries, UsageSeriesPoint,
} from './types/usage.js';

// Experiments: A/B tests that pick a whole project per request (T70)
export {
  EXPERIMENT_ROTATIONS,
  STICKY_KEYS,
  ROTATION_CATALOG,
  STICKY_KEY_CATALOG,
  DEFAULT_MIN_SAMPLES_PER_VARIANT,
  rotationLabel,
  rotationDescription,
  variantShares,
} from './types/experiments.js';
export type {
  ExperimentConfig,
  ExperimentRotation,
  ExperimentRotationMeta,
  ExperimentStickyKey,
  ExperimentVariant,
  ExperimentJudge,
  ExperimentJudgeTally,
  ExperimentVariantMetrics,
  ExperimentMetrics,
} from './types/experiments.js';

// Static configuration data
import providersConf from './conf/providers.json' with { type: 'json' };
export { providersConf };
