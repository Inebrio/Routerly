import { z } from 'zod';

/**
 * Zod schemas for the project config shapes that more than one route file has
 * to validate: guardrails, PII and optimizers. They live here rather than in
 * api.ts because profiles.ts validates the same shapes, and api.ts imports
 * profiles.ts, so importing back the other way would be a cycle.
 */

const ruleCommonFields = {
  enabled: z.boolean().optional(),
  // Judge/scan scope. Required for regex/semantic; optional for topic/moderation
  // (omitted = inject-only, no judge). Enforced in .superRefine below.
  target: z.enum(['request', 'response', 'both']).optional(),
  block: z.boolean().optional(),
  log: z.boolean().optional(),
  blockMessage: z.string().optional(),
  useJudgeResponse: z.boolean().optional(),
  // (topic/moderation only) Inject the rule instruction into the request system
  // prompt. Independent of the judge; see cross-field checks in .superRefine.
  inject: z.boolean().optional(),
};

export const guardrailRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('regex'), ...ruleCommonFields, config: z.object({ patterns: z.array(z.string()) }) }),
  z.object({ type: z.literal('semantic'), ...ruleCommonFields, config: z.object({ embeddingModelId: z.string(), examples: z.array(z.string()), threshold: z.number().min(0).max(1).optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal('topic'), ...ruleCommonFields, config: z.object({ modelId: z.string().optional(), allowedTopics: z.string(), threshold: z.number().min(0).max(1).optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal('moderation'), ...ruleCommonFields, config: z.object({ modelId: z.string().optional(), threshold: z.number().min(0).max(1).optional(), systemPrompt: z.string().optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
]).superRefine((rule, ctx) => {
  const inject = (rule as { inject?: boolean }).inject === true;
  const canInject = rule.type === 'topic' || rule.type === 'moderation';
  // inject is a topic/moderation-only flag.
  if (inject && !canInject) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'inject is only valid for topic or moderation rules', path: ['inject'] });
  }
  // regex/semantic always scan a side; topic/moderation may skip the judge when injecting.
  if (!rule.target) {
    if (!canInject) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'target is required', path: ['target'] });
    } else if (!inject) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a topic/moderation rule must judge (set target) or inject', path: ['target'] });
    }
  }
  // Judge model is required whenever the judge runs (target set).
  if (canInject && rule.target && !(rule.config as { modelId?: string }).modelId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'config.modelId is required when a target is set', path: ['config', 'modelId'] });
  }
});

export const guardrailConfigSchema = z.object({
  detectInjection: z.boolean().optional(),
  rules: z.array(guardrailRuleSchema),
});

export const piiEntityEnum = z.enum(['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN']);

export const piiPolicySchema = z.object({
  enabled: z.boolean().optional(),
  entities: z.array(piiEntityEnum).optional(),
  customPatterns: z.array(z.string()).optional(),
  target: z.enum(['request', 'response', 'both']),
  outputBufferSize: z.number().int().min(10).max(500).optional(),
});

export const piiConfigSchema = z.object({
  policies: z.array(piiPolicySchema),
});

export const optimizerIdEnum = z.enum(['session-dedup', 'ccr', 'rtk', 'headroom', 'relevance', 'caveman', 'llmlingua-2']);

// threshold's natural range depends on the optimizer: ccr (turn count) and
// headroom (token budget) are unbounded positive numbers; relevance and
// llmlingua-2 use a 0-1 ratio.
const RATIO_THRESHOLD_IDS = new Set(['relevance', 'llmlingua-2']);

export const optimizerStepSchema = z.object({
  id: optimizerIdEnum,
  enabled: z.boolean(),
  threshold: z.number().positive().optional(),
}).superRefine((step, ctx) => {
  if (step.threshold !== undefined && RATIO_THRESHOLD_IDS.has(step.id) && step.threshold > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${step.id}: threshold must be between 0 and 1`, path: ['threshold'] });
  }
});

// steps order = execution order; each optimizer id may appear at most once.
export const optimizerConfigSchema = z.object({
  steps: z.array(optimizerStepSchema),
}).superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  cfg.steps.forEach((step, i) => {
    if (seen.has(step.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate optimizer step: ${step.id}`, path: ['steps', i, 'id'] });
    }
    seen.add(step.id);
  });
});
