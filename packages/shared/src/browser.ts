/**
 * Browser-safe entry point for @routerly/shared.
 * Exports only static JSON data and type-only definitions — no Node.js APIs.
 */

// Static configuration data (JSON, safe in any environment)
import providersConf from './conf/providers.json' with { type: 'json' };
export { providersConf };

// Static notification event list and secret-field map (safe for browser — plain data)
export { NOTIFICATION_EVENTS, CHANNEL_SECRET_FIELDS, DEFAULT_PROJECT_TIMEOUT_MS } from './types/config.js';
export type { NotificationEvent } from './types/config.js';

// Readable catalog for those events (T51) — plain data plus pure functions
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_CATALOG,
  notificationTitle,
  notificationCategory,
  notificationCause,
} from './types/notifications.js';
export type { NotificationCategory, NotificationEventMeta } from './types/notifications.js';

// Usage request types (T60) — plain data plus pure functions
export { REQUEST_TYPES, requestTypeFromPath, requestTypeLabel } from './types/usage.js';
export type { RequestType, SavingsBaseline, SavingsOptimizerEntry, SavingsSummary } from './types/usage.js';

// Experiments (T70) — plain data plus pure functions
export {
  EXPERIMENT_ROTATIONS,
  EXPERIMENT_STATUSES,
  STICKY_KEYS,
  ROTATION_CATALOG,
  DEFAULT_MIN_SAMPLES_PER_VARIANT,
  rotationLabel,
  rotationDescription,
  variantShares,
} from './types/experiments.js';
export type {
  ExperimentConfig,
  ExperimentRotation,
  ExperimentRotationMeta,
  ExperimentStatus,
  ExperimentStickyKey,
  ExperimentVariant,
  ExperimentJudge,
} from './types/experiments.js';

// Optimizer catalog (T63) — plain data plus pure functions
export { OPTIMIZER_CATALOG, optimizerLabel, optimizerThreshold } from './types/optimizers.js';
export type {
  OptimizerClass,
  OptimizerId,
  OptimizerResult,
  OptimizerStep,
  OptimizerConfig,
  OptimizerCallStat,
  OptimizerThresholdSpec,
  OptimizerMeta,
} from './types/optimizers.js';

// Client registry: plain data plus pure string builders, no Node.js APIs.
export { CLIENT_REGISTRY, buildSnippet, buildMcpSnippet } from './clients/index.js';
export type { SupportState, WireFormat, ConnectMode, ClientMeta } from './clients/index.js';

// Re-export all types (erased at compile time, no runtime cost)
export type {
  Provider,
  PricingTier,
  TokenCost,
  BudgetThresholds,
  ModelConfig,
  ProjectModelRef,
  ProjectConfig,
  ProjectToken,
  ProjectMember,
  ProjectRole,
  TokenModelRef,
  RoutingPolicy,
  RoutingPolicyType,
  SelectorType,
  FallbackStrategyType,
  IntentDefinition,
  SemanticIntentConfig,
  IntentClassification,
  UserConfig,
  McpToken,
  RoleConfig,
  Permission,
  Settings,
  CallOutcome,
  UsageRecord,
  UsageByModelEntry,
  // Notification channel types (U5)
  EmailProvider,
  NativeProvider,
  ChannelProvider,
  ChannelTargets,
  NotificationsConfig,
  NotificationChannel,
  NotificationInboxItem,
  NotificationIncidentEvent,
  NotificationSeverity,
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
