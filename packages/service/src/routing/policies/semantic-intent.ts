import type { SemanticIntentConfig } from '@routerly/shared';
import { providersConf } from '@routerly/shared';
import { classifyIntent } from '../intent/classifier.js';
import { trackUsage } from '../../cost/tracker.js';
import type { PolicyFn } from './types.js';

/** Lookup input cost (per 1M tokens) for an embedding model from the static providers catalogue. */
function getEmbeddingInputCost(provider: string, modelId: string): number {
  const providerConf = (providersConf as Record<string, { models?: Array<{ id: string; input?: number }> }>)[provider];
  const modelConf = providerConf?.models?.find(m => m.id === modelId);
  return modelConf?.input ?? 0;
}

/**
 * Policy: semantic-intent
 *
 * Classifies the incoming request by semantic intent using embeddings,
 * then restricts the candidate pool to the models mapped to that intent.
 *
 * Classification outcomes:
 *  - `confident`  → hard-filter candidates to the matched intent's model pool.
 *  - `ambiguous`  → merge the candidate pools of the top-2 intents.
 *  - `unknown`    → pass all candidates through unchanged (no filtering).
 *
 * The policy emits trace entries with classification details so that
 * the routing decision is visible in the real-time trace stream.
 *
 * This policy is designed to run *before* scoring policies (cheapest,
 * performance, etc.) so that they operate only within the narrowed pool.
 */
export const semanticIntentPolicy: PolicyFn = async ({
  request,
  candidates,
  config,
  log,
  emit,
  projectId,
  traceId,
}) => {
  const cfg = config as SemanticIntentConfig | undefined;

  // ── Validate config ────────────────────────────────────────────────────────
  if (!cfg?.embedding_provider || !cfg?.embedding_model || !cfg?.intents) {
    log?.warn({ cfg }, 'semantic-intent policy: misconfigured, passing all candidates through');
    emit?.({
      panel: 'router-response',
      message: 'policy:semantic-intent:misconfigured',
      details: {
        reason: 'Missing embedding_provider, embedding_model, or intents — passing all candidates through.',
      },
    });
    return {
      routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })),
    };
  }

  // ── Extract user message text ──────────────────────────────────────────────
  const messages = request.messages ?? [];
  // Use the last user message for classification; fall back to a concatenation.
  const userText = [...messages]
    .reverse()
    .find(m => m.role === 'user' && typeof m.content === 'string')
    ?.content as string | undefined
    ?? messages
      .filter(m => typeof m.content === 'string')
      .map(m => m.content as string)
      .join(' ');

  if (!userText || userText.trim().length === 0) {
    // Nothing to classify — pass all candidates through.
    return {
      routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })),
    };
  }

  log?.info({
    candidates: candidates.map(c => ({ id: c.model.id, provider: c.model.provider })),
    intentCount: Object.keys(cfg.intents).length,
    embeddingModel: cfg.embedding_model,
  }, 'semantic-intent policy: input');

  // ── Classify ───────────────────────────────────────────────────────────────
  let classifyResult;
  try {
    const t0 = Date.now();
    classifyResult = await classifyIntent(userText, cfg);
    const latencyMs = Date.now() - t0;

    // Track the embedding API call as a routing-type usage record so it appears
    // in the dashboard alongside llm-policy routing calls.
    // The embedding model is not in models.json, so we build a synthetic ModelConfig.
    if (projectId) {
      const inputPerMillion = getEmbeddingInputCost(cfg.embedding_provider, cfg.embedding_model);
      await trackUsage({
        projectId,
        model: {
          id: cfg.embedding_model,
          name: cfg.embedding_model,
          provider: cfg.embedding_provider as any,
          endpoint: cfg.embedding_endpoint ?? '',
          cost: { inputPerMillion, outputPerMillion: 0 },
        },
        inputTokens: classifyResult.inputTokens,
        outputTokens: 0,
        latencyMs,
        outcome: 'success',
        callType: 'routing',
        ...(traceId !== undefined ? { traceId } : {}),
      }).catch(() => {});
    }
  } catch (err) {
    // Embedding call failed — degrade gracefully, pass all candidates.
    log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'semantic-intent policy: embedding error, passing all candidates through');
    emit?.({
      panel: 'router-response',
      message: 'policy:semantic-intent:error',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return {
      routing: candidates.map(c => ({ model: c.model.id, point: 1.0 })),
    };
  }

  const classification = classifyResult.classification;

  log?.info({
    topIntent: classification.topIntent,
    topScore: classification.topScore,
    status: classification.status,
  }, 'semantic-intent policy: classification');
  emit?.({
    panel: 'router-response',
    message: 'policy:semantic-intent:classification',
    details: {
      topIntent: classification.topIntent,
      topScore: classification.topScore,
      secondIntent: classification.secondIntent,
      secondScore: classification.secondScore,
      margin: classification.margin,
      status: classification.status,
    },
  });

  // ── Build the allowed model set ────────────────────────────────────────────
  const candidateIds = new Set(candidates.map(c => c.model.id));

  const resolvePool = (intentName: string | null): Set<string> => {
    if (!intentName) return candidateIds;
    const intentDef = cfg.intents[intentName];
    if (!intentDef) return candidateIds;
    // Only keep models that are both in the intent pool AND in the project's candidate list.
    const pool = new Set(intentDef.candidate_models.filter(id => candidateIds.has(id)));
    // If the intent's candidate_models are all unknown (not in project), fall back to all.
    return pool.size > 0 ? pool : candidateIds;
  };

  let allowedIds: Set<string>;

  switch (classification.status) {
    case 'confident': {
      allowedIds = resolvePool(classification.topIntent);
      break;
    }
    case 'ambiguous': {
      // Merge top-2 intent pools.
      const pool1 = resolvePool(classification.topIntent);
      const pool2 = resolvePool(classification.secondIntent);
      allowedIds = new Set([...pool1, ...pool2]);
      break;
    }
    case 'unknown':
    default: {
      // No filtering.
      allowedIds = candidateIds;
      break;
    }
  }

  const routing = candidates.map(c => ({
    model: c.model.id,
    point: allowedIds.has(c.model.id) ? 1.0 : 0.0,
    intent: classification.topIntent,
    intentStatus: classification.status,
  }));

  const excludes = routing.filter(r => r.point === 0.0).map(r => r.model);

  log?.info({
    allowed: [...allowedIds],
    excluded: excludes,
    status: classification.status,
  }, 'semantic-intent policy: result');
  emit?.({
    panel: 'router-response',
    message: 'policy:semantic-intent:result',
    details: {
      allowed: [...allowedIds],
      excluded: excludes,
      status: classification.status,
    },
  });

  return { routing, ...(excludes.length > 0 ? { excludes } : {}) };
};
