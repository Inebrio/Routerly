import { z } from 'zod';
import {
  CALL_DEFAULT_THRESHOLDS,
  CALL_MAX_OUTPUT_TOKENS_MAX,
  CALL_MAX_OUTPUT_TOKENS_MIN,
  CALL_SETTINGS,
  type AppliedCallConfig,
  type CallConfig,
  type CallSettingId,
  type CallSettings,
  type CallSettingSkip,
  type CallTier,
  type ChatCompletionRequest,
  type ModelConfig,
  type RoutingProfile,
} from '@routerly/shared';
import { estimateInputTokens } from './policies/context.js';

/**
 * Call configuration: per router / routing profile, opt-in choice of reasoning effort,
 * output token cap and verbosity by request complexity.
 *
 * Invariant: with no resolved config, or `enabled: false`, nothing in this file reads or
 * writes the request. Everything here is pure; the writers live in the provider adapters
 * and verbatim forwarders and only run when an `AppliedCallConfig` reached them.
 */

// ─── Schema (management API) ─────────────────────────────────────────────────

const levelSchema = z.enum(['low', 'medium', 'high']);
const policySchema = z.enum(['keep', 'override']);
const thresholdSchema = z.number().int().positive();

const settingsSchema = z
  .object({
    effort: levelSchema.optional(),
    maxOutputTokens: z
      .number()
      .int()
      .min(CALL_MAX_OUTPUT_TOKENS_MIN)
      .max(CALL_MAX_OUTPUT_TOKENS_MAX)
      .optional(),
    verbosity: levelSchema.optional(),
  })
  .strict();

export const callConfigSchema = z
  .object({
    enabled: z.boolean(),
    clientValues: z
      .object({
        effort: policySchema.optional(),
        maxOutputTokens: policySchema.optional(),
        verbosity: policySchema.optional(),
      })
      .strict()
      .optional(),
    tiers: z
      .object({
        low: settingsSchema.optional(),
        medium: settingsSchema.optional(),
        high: settingsSchema.optional(),
      })
      .strict(),
    thresholds: z
      .object({ mediumFromTokens: thresholdSchema.optional(), highFromTokens: thresholdSchema.optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const { mediumFromTokens, highFromTokens } = effectiveThresholds(cfg);
    if (mediumFromTokens >= highFromTokens) {
      ctx.addIssue({
        code: 'custom',
        path: ['thresholds'],
        message: `mediumFromTokens (${mediumFromTokens}) must be lower than highFromTokens (${highFromTokens})`,
      });
    }
  });

export function effectiveThresholds(cfg: { thresholds?: { mediumFromTokens?: number | undefined; highFromTokens?: number | undefined } | undefined }): { mediumFromTokens: number; highFromTokens: number } {
  return {
    mediumFromTokens: cfg.thresholds?.mediumFromTokens ?? CALL_DEFAULT_THRESHOLDS.mediumFromTokens,
    highFromTokens: cfg.thresholds?.highFromTokens ?? CALL_DEFAULT_THRESHOLDS.highFromTokens,
  };
}

// ─── Decision (per request) ──────────────────────────────────────────────────

export interface CallDecision {
  tier: CallTier;
  source: 'router' | 'profile';
  config: CallConfig;
  /** The tier's configured settings. */
  desired: CallSettings;
  signals: { estimatedInputTokens: number; hasTools: boolean; messageCount: number };
  thresholds: { mediumFromTokens: number; highFromTokens: number };
}

/**
 * The enabled call configuration for a request, or undefined when none applies. A bound
 * routing profile wins entirely over the router's own config (no field merge); the
 * ephemeral `custom` profile already carries the router's config.
 */
export function pickCallConfig(profile: RoutingProfile): { config: CallConfig; source: 'router' | 'profile' } | undefined {
  const config = profile.callConfig;
  if (!config?.enabled) return undefined;
  return { config, source: profile.id === 'custom' ? 'router' : 'profile' };
}

/** high from `highFromTokens`; medium from `mediumFromTokens` or when tools are present; low otherwise. */
export function decideCallTier(
  request: ChatCompletionRequest,
  config: CallConfig,
  source: 'router' | 'profile',
): CallDecision {
  const thresholds = effectiveThresholds(config);
  const estimatedInputTokens = estimateInputTokens(request);
  const hasTools = Array.isArray(request.tools) && request.tools.length > 0;
  const tier: CallTier =
    estimatedInputTokens >= thresholds.highFromTokens
      ? 'high'
      : estimatedInputTokens >= thresholds.mediumFromTokens || hasTools
        ? 'medium'
        : 'low';
  return {
    tier,
    source,
    config,
    desired: config.tiers[tier] ?? {},
    signals: { estimatedInputTokens, hasTools, messageCount: request.messages?.length ?? 0 },
    thresholds,
  };
}

// ─── Capability gating (per candidate model) ─────────────────────────────────

/** Upstream model name, same derivation the verbatim forwarders use for the `model` field. */
function upstreamName(model: ModelConfig): string {
  const raw = model.upstreamModelId ?? model.id;
  const prefix = `${model.id.split('/')[0]}/`;
  return (raw.startsWith(prefix) ? raw.slice(prefix.length) : raw) || model.id;
}

// Anthropic models documented to accept `output_config.effort`
// (https://platform.claude.com/docs/en/build-with-claude/effort, 2026-11-04).
const ANTHROPIC_EFFORT_MODEL =
  /^(claude-(fable-5(-1)?|mythos-5(-1)?|mythos-preview|opus-5(-5)?|sonnet-5(-5)?|haiku-5-5|opus-4-[678]|sonnet-4-6)(-\d{8})?|claude-opus-4-5-20251101)$/;
const OPENAI_FAMILIES = new Set(['openai', 'azure-openai', 'openai-oauth']);
// Adapters that honour the canonical `max_tokens`. Web providers and the Codex backend
// (`openai-oauth`, undocumented) are left out; anything unlisted is unsupported.
const MAX_TOKENS_PROVIDERS = new Set([
  'openai', 'azure-openai', 'anthropic', 'anthropic-oauth', 'gemini', 'vertex', 'bedrock', 'ollama', 'custom',
  'mistral', 'cohere', 'xai', 'deepseek', 'groq', 'together', 'perplexity',
]);

function supports(setting: CallSettingId, model: ModelConfig): boolean {
  const name = upstreamName(model);
  switch (setting) {
    case 'effort':
      if (model.provider === 'anthropic' || model.provider === 'anthropic-oauth') return ANTHROPIC_EFFORT_MODEL.test(name);
      return OPENAI_FAMILIES.has(model.provider) && /^(o[1-9]|gpt-5)/.test(name) && !/^o1-(mini|preview)/.test(name) && !/-chat/.test(name);
    case 'verbosity':
      return OPENAI_FAMILIES.has(model.provider) && /^gpt-5/.test(name) && !/-chat/.test(name);
    case 'maxOutputTokens':
      return MAX_TOKENS_PROVIDERS.has(model.provider);
    default:
      return false;
  }
}

function validValue(setting: CallSettingId, value: unknown): boolean {
  if (setting === 'maxOutputTokens') {
    return Number.isInteger(value) && (value as number) >= CALL_MAX_OUTPUT_TOKENS_MIN && (value as number) <= CALL_MAX_OUTPUT_TOKENS_MAX;
  }
  return value === 'low' || value === 'medium' || value === 'high';
}

// ─── Client-sent detection (reads the original body, never writes it) ────────

export type ClientSent = Record<CallSettingId, boolean>;
export type CallShape = 'chat' | 'responses' | 'anthropic';

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const has = (v: unknown): boolean => v !== undefined && v !== null;

export function clientSentSettings(original: unknown, shape: CallShape): ClientSent {
  const b = obj(original) ?? {};
  switch (shape) {
    case 'responses':
      return {
        effort: has(obj(b.reasoning)?.effort),
        verbosity: has(obj(b.text)?.verbosity),
        maxOutputTokens: has(b.max_output_tokens),
      };
    case 'anthropic':
      return {
        effort: has(obj(b.output_config)?.effort),
        verbosity: false,
        maxOutputTokens: has(b.max_tokens),
      };
    default:
      return {
        effort: has(b.reasoning_effort),
        verbosity: has(b.verbosity),
        maxOutputTokens: has(b.max_tokens) || has(b.max_completion_tokens),
      };
  }
}

/** Applies the decision to one candidate model: what is sent, what is skipped and why. */
export function resolveForModel(
  decision: CallDecision,
  clientSent: ClientSent,
  model: ModelConfig,
): { applied: CallSettings; skipped?: CallSettingSkip[] } {
  const applied: Record<string, unknown> = {};
  const skipped: CallSettingSkip[] = [];
  for (const setting of CALL_SETTINGS) {
    const value = decision.desired[setting];
    if (value === undefined) continue;
    if (!validValue(setting, value)) skipped.push({ setting, reason: 'invalid' });
    else if (!supports(setting, model)) skipped.push({ setting, reason: 'unsupported' });
    else if (clientSent[setting] && (decision.config.clientValues?.[setting] ?? 'keep') === 'keep') {
      skipped.push({ setting, reason: 'client_kept' });
    } else applied[setting] = value;
  }
  return { applied: applied as CallSettings, ...(skipped.length > 0 ? { skipped } : {}) };
}

/** Minimal context view the per-attempt resolver needs (ProxyContext satisfies it). */
export interface CallDecisionContext {
  callDecision?: CallDecision;
  attempt?: { model: ModelConfig };
  original: unknown;
  protocol: 'openai' | 'anthropic';
  responsesApi?: boolean;
}

/** Per-attempt application: re-evaluated for every fallback candidate, nothing is cached. */
export function resolveAttemptCallConfig(ctx: CallDecisionContext): AppliedCallConfig | undefined {
  const decision = ctx.callDecision;
  if (!decision || !ctx.attempt) return undefined;
  const shape: CallShape = ctx.protocol === 'anthropic' ? 'anthropic' : ctx.responsesApi ? 'responses' : 'chat';
  return {
    tier: decision.tier,
    source: decision.source,
    ...resolveForModel(decision, clientSentSettings(ctx.original, shape), ctx.attempt.model),
  };
}

/** Trace entry A body: the decision plus a per-candidate preview in ranked order. */
export function callConfigTraceDetails(
  decision: CallDecision,
  ranked: { id: string; model: ModelConfig | undefined }[],
  request: ChatCompletionRequest,
): Record<string, unknown> {
  const sent = clientSentSettings(request, 'chat');
  return {
    tier: decision.tier,
    source: decision.source,
    signals: decision.signals,
    thresholds: decision.thresholds,
    desired: decision.desired,
    perModel: ranked.flatMap(({ id, model }) =>
      model ? [{ model: id, ...resolveForModel(decision, sent, model) }] : [],
    ),
  };
}
