import type {
  GuardrailConfig,
  GuardrailRule,
  GuardrailTarget,
  SemanticGuardConfig,
  TopicGuardConfig,
  ModerationGuardConfig,
  RegexGuardConfig,
} from '@routerly/shared';
import type { ProjectConfig, ProjectToken } from '@routerly/shared';
import type { FastifyBaseLogger } from 'fastify';
import { classifyIntent } from '../routing/intent/classifier.js';
import { getEmbeddingProvider } from '../embeddings/index.js';
import { llmChat, checkBudget, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';
import { readConfig } from '../config/loader.js';
import { trackUsage } from '../cost/tracker.js';

/**
 * Real project context for guardrail judge calls (#77, BUG-4).
 * Judge LLM calls (topic/moderation) and semantic embeddings run against the
 * caller's real project so their tokens are attributed, counted, and subject to
 * the same usage limits as a completion — the guardrail check runs *before* the
 * main completion, so an over-limit judge call fails like an over-limit call.
 */
export interface GuardrailProjectCtx {
  projectId: string;
  project: ProjectConfig;
  token?: ProjectToken;
}

const MODERATION_JSON_INSTRUCTION = 'Respond ONLY with a JSON object: {"score": <number between 0 and 1>} where 0 means completely safe and 1 means severely harmful. Do not include any other text.';

const DEFAULT_MODERATION_PROMPT = `You are a content safety classifier. Evaluate the following text for harmful content.\nCategories: hate speech, violence, sexual content, self-harm.\n${MODERATION_JSON_INSTRUCTION}`;

/** Built-in prompt-injection detection patterns (#77). */
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-instructions', re: /ignore\s+(previous|above|prior)\s+instructions?/i },
  { name: 'you-are-now', re: /you\s+are\s+now\s+/i },
  { name: 'disregard', re: /disregard\s+(your|all)\s+/i },
  { name: 'dan-mode', re: /DAN\s+mode/i },
  { name: 'jailbreak', re: /jailbreak/i },
];

/**
 * LLM ctx for a guardrail judge call (#77, BUG-4).
 *
 * Attributed to the real project so the judge call's tokens are counted in the
 * project's usage and gated by its limits (checkBudget runs inside llmChat).
 * callType 'guardrail' makes it a distinct sub-activity in the usage detail,
 * recorded once and separate from routing/completion — no double-count (#77, BUG-5).
 */
function makeGuardrailCtx(pctx: GuardrailProjectCtx, log?: FastifyBaseLogger): LLMCallContext {
  return {
    projectId: pctx.projectId,
    project: pctx.project,
    callType: 'guardrail',
    ...(pctx.token ? { token: pctx.token } : {}),
    // ponytail: log is optional in LLMCallContext; spread only when present
    ...(log ? { log } : {}),
  };
}

/** Per-rule evaluation outcome surfaced in the request trace (#77 observability). */
export interface RuleEval {
  /** Rule identifier: built-in flag name or `<type>:<config-id>`. */
  rule: string;
  outcome: 'passed' | 'triggered' | 'skipped';
  /** Triggered: the hit string. Skipped: why (model-not-found, embedding-failed, judge-failed). */
  reason?: string;
}

/** Result of evaluating all guardrail rules for one target. */
export interface GuardrailResult {
  /** The hit string of the first rule that fired, if any. */
  triggered?: string;
  /** One entry per rule that ran (incl. the injection flag), for trace observability. */
  evaluated: RuleEval[];
}

/** Run built-in injection detection. Returns triggered string or null. */
function checkInjection(text: string): string | null {
  for (const { name, re } of INJECTION_PATTERNS) {
    if (re.test(text)) return `injection:${name}`;
  }
  return null;
}

/** Check a single rule. Returns its evaluation outcome. */
async function checkRule(
  rule: GuardrailRule,
  text: string,
  pctx: GuardrailProjectCtx,
  log?: FastifyBaseLogger,
): Promise<RuleEval> {
  if (rule.type === 'regex') {
    const cfg = rule.config as RegexGuardConfig;
    for (const pattern of cfg.patterns) {
      try {
        if (new RegExp(pattern, 'gi').test(text)) return { rule: 'regex', outcome: 'triggered', reason: `regex:${pattern}` };
      } catch {
        // skip invalid regex
      }
    }
    return { rule: 'regex', outcome: 'passed' };
  }

  if (rule.type === 'semantic') {
    const cfg = rule.config as SemanticGuardConfig;
    const ruleId = `semantic:${cfg.embeddingModelId}`;
    const allModels = await readConfig('models');
    const model = allModels.find((m: { id: string }) => m.id === cfg.embeddingModelId);
    if (!model) {
      log?.warn({ embeddingModelId: cfg.embeddingModelId }, 'guardrail:semantic: model not found, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'model-not-found' };
    }
    // Budget pre-gate the embedding call like the judge path (#77 BUG-4 parity):
    // an over-limit project must fail before we spend the embedding, same as topic/moderation.
    await checkBudget(model, makeGuardrailCtx(pctx, log));
    const embType = model.provider === 'ollama' ? 'ollama' as const : 'openai' as const;
    try {
      // getEmbeddingProvider is used internally by classifyIntent; call here validates the config
      void getEmbeddingProvider(embType, model.endpoint, model.apiKey);
      const upstreamModel = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
      const result = await classifyIntent(text, {
        embedding_provider: embType,
        embedding_model: upstreamModel,
        absolute_threshold: cfg.threshold ?? 0.82,
        ambiguity_threshold: 0.05,
        // ponytail: exactOptionalPropertyTypes — only spread when defined
        ...(model.endpoint ? { embedding_endpoint: model.endpoint } : {}),
        ...(model.apiKey ? { embedding_api_key: model.apiKey } : {}),
        intents: {
          blocked: { examples: cfg.examples, candidate_models: [] },
        },
      });
      const { classification, inputTokens } = result;
      // Attribute the embedding call to the real project so it is counted in usage.
      if (inputTokens > 0) {
        await trackUsage({
          projectId: pctx.projectId,
          model,
          inputTokens,
          outputTokens: 0,
          latencyMs: 0,
          outcome: 'success',
          callType: 'guardrail',
        }).catch(() => {});
      }
      if (classification.status === 'confident' && classification.topIntent === 'blocked') {
        return { rule: ruleId, outcome: 'triggered', reason: `semantic:${Math.round((classification.topScore ?? 0) * 100)}%` };
      }
    } catch (err) {
      log?.warn({ err }, 'guardrail:semantic: embedding failed, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'embedding-failed' };
    }
    return { rule: ruleId, outcome: 'passed' };
  }

  if (rule.type === 'topic') {
    const cfg = rule.config as TopicGuardConfig;
    const ruleId = `topic:${cfg.modelId}`;
    const allModels = await readConfig('models');
    const model = allModels.find((m: { id: string }) => m.id === cfg.modelId);
    if (!model) {
      log?.warn({ modelId: cfg.modelId }, 'guardrail:topic: model not found, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'model-not-found' };
    }
    try {
      const response = await llmChat(
        {
          model: model.id,
          messages: [
            {
              role: 'system',
              content: `You are a topic classifier. Evaluate whether the following text is on-topic.\nAllowed topics: ${cfg.allowedTopics}\nRespond ONLY with a JSON object: {"score": <number between 0 and 1>} where 1 means completely on-topic and 0 means completely off-topic. Do not include any other text.`,
            },
            { role: 'user', content: text },
          ],
          max_tokens: 32,
          temperature: 0,
        },
        model,
        makeGuardrailCtx(pctx, log),
      );
      const raw = response.choices?.[0]?.message?.content;
      const rawStr = typeof raw === 'string' ? raw : '';
      const parsed = JSON.parse(rawStr) as { score?: unknown };
      const score = typeof parsed.score === 'number' ? parsed.score : 1;
      if (score < (cfg.threshold ?? 0.5)) {
        return { rule: ruleId, outcome: 'triggered', reason: `topic:score=${score.toFixed(2)}` };
      }
    } catch (err) {
      // Over-limit judge call must fail the request like an over-limit completion (BUG-4).
      if (err instanceof BudgetExceededError) throw err;
      log?.warn({ err }, 'guardrail:topic: judge call failed, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'judge-failed' };
    }
    return { rule: ruleId, outcome: 'passed' };
  }

  if (rule.type === 'moderation') {
    const cfg = rule.config as ModerationGuardConfig;
    const ruleId = `moderation:${cfg.modelId}`;
    const allModels = await readConfig('models');
    const model = allModels.find((m: { id: string }) => m.id === cfg.modelId);
    if (!model) {
      log?.warn({ modelId: cfg.modelId }, 'guardrail:moderation: model not found, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'model-not-found' };
    }
    try {
      const response = await llmChat(
        {
          model: model.id,
          messages: [
            {
              role: 'system',
              content: cfg.systemPrompt ? `${cfg.systemPrompt.trim()}\n${MODERATION_JSON_INSTRUCTION}` : DEFAULT_MODERATION_PROMPT,
            },
            { role: 'user', content: text },
          ],
          max_tokens: 32,
          temperature: 0,
        },
        model,
        makeGuardrailCtx(pctx, log),
      );
      const raw = response.choices?.[0]?.message?.content;
      const rawStr = typeof raw === 'string' ? raw : '';
      const parsed = JSON.parse(rawStr) as { score?: unknown };
      const score = typeof parsed.score === 'number' ? parsed.score : 0;
      if (score > (cfg.threshold ?? 0.5)) {
        return { rule: ruleId, outcome: 'triggered', reason: `moderation:score=${score.toFixed(2)}` };
      }
    } catch (err) {
      // Over-limit judge call must fail the request like an over-limit completion (BUG-4).
      if (err instanceof BudgetExceededError) throw err;
      log?.warn({ err }, 'guardrail:moderation: judge call failed, skipping');
      return { rule: ruleId, outcome: 'skipped', reason: 'judge-failed' };
    }
    return { rule: ruleId, outcome: 'passed' };
  }

  return { rule: String((rule as { type?: string }).type ?? 'unknown'), outcome: 'skipped', reason: 'unknown-type' };
}

/**
 * Checks text against all enabled guardrail rules for the given target.
 * Returns the first rule that fired (`triggered`) plus a per-rule `evaluated`
 * summary for trace observability (#77). All rules run even when one fires
 * (Promise.all), so the trace records the full evaluation, not just the hit.
 */
export async function checkGuardrails(
  target: GuardrailTarget,
  text: string,
  config: GuardrailConfig,
  pctx: GuardrailProjectCtx,
  log?: FastifyBaseLogger,
): Promise<GuardrailResult> {
  const evaluated: RuleEval[] = [];
  // Top-level injection flag always applies to request target
  if (config.detectInjection && target === 'request') {
    const hit = checkInjection(text);
    evaluated.push(hit ? { rule: 'injection', outcome: 'triggered', reason: hit } : { rule: 'injection', outcome: 'passed' });
    if (hit) return { triggered: hit, evaluated };
  }
  const activeRules = config.rules.filter(
    r => r.target === target || r.target === 'both',
  );
  if (activeRules.length === 0) return { evaluated };
  const results = await Promise.all(activeRules.map(rule => checkRule(rule, text, pctx, log)));
  evaluated.push(...results);
  const hit = results.find(r => r.outcome === 'triggered');
  return hit?.reason ? { triggered: hit.reason, evaluated } : { evaluated };
}
