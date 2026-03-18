/**
 * Browser-safe entry point for @routerly/shared.
 * Exports only static JSON data and type-only definitions — no Node.js APIs.
 */

// Static configuration data (JSON, safe in any environment)
import providersConf from './conf/providers.json';
import llmApiPricing from './conf/llm_api_pricing.json';
export { providersConf, llmApiPricing };

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
  UserConfig,
  RoleConfig,
  Permission,
  Settings,
  CallOutcome,
  UsageRecord,
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
