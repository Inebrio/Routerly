/**
 * Centralized LLM executor.
 *
 * Ogni chiamata verso un modello — che sia per routing o per completion,
 * streaming o non-streaming — passa da qui. L'executor gestisce in modo
 * uniforme:
 *   • verifica del budget (token > router > global)
 *   • selezione dell'adapter del provider
 *   • misurazione TTFT e latenza totale
 *   • emissione di trace entries
 *   • tracciamento usage (trackUsage)
 *
 * Il chiamante non deve più occuparsi di nessuno di questi aspetti.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  EffectiveModel,
  RouterConfig,
  RouterToken,
  StreamChunk,
  CallType,
  MessagesRequest,
  MessagesResponse,
  OptimizerCallStat,
  ResilienceFault,
} from '@routerly/shared';
import { getProviderAdapter } from '../provider/registry.js';
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../budget/budget.js';
import { trackUsage } from '../usage/tracker.js';
import { calculateCost } from '../../lib/cost.js';
import { emitEvent } from '../notifications/emitter.js';
import { readConfig } from '../config/loader.js';
import { resolveEffectiveModel } from '../provider/resolve.js';
import { getProviderDescriptor } from '../provider/descriptor.js';
import { resolveAnthropicOAuthCredential } from '../provider/anthropic-oauth.js';
import { resolveOpenAIOAuthCredential } from '../provider/openai-oauth.js';
import { resolveAnthropicWebCredential } from '../provider/anthropic-web.js';
import { resolveOpenAIWebCredential } from '../provider/openai-web.js';
import type { TraceEntry } from '@routerly/shared';
import type { TracePanel } from '../trace/store.js';
import { getResilienceStore } from '../resilience/index.js';
import { resilienceKeys } from '../resilience/keys.js';
import { recordFault } from '../resilience/record.js';
import { classifyUpstreamError, type UpstreamResponse } from '../resilience/classifier.js';

// ─── Tipi ────────────────────────────────────────────────────────────────────

type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

/**
 * Contesto condiviso per ogni chiamata LLM.
 * Deve essere popolato dal chiamante (route o policy).
 */
export interface LLMCallContext {
  routerId: string;
  router: RouterConfig;
  /** Token associato alla richiesta, per la gerarchia token > router > global */
  token?: RouterToken;
  callType: CallType;
  traceId?: string;
  emit?: (entry: TraceEntry) => void;
  log?: Logger;
  /** End-user id from the OpenAI `user` field (#96) */
  endUserId?: string;
  /** Session id (#94) */
  sessionId?: string;
  /** Tags (#95) */
  tags?: Record<string, string>;
  /** Name of the guardrail rule that triggered on this request, if any (#77) */
  guardrailTriggered?: string;
  /** PII entity types redacted before forwarding (#76) */
  piiRedacted?: string[];
  /** What each optimizer step removed from this prompt (T63) */
  optimizerStats?: OptimizerCallStat[];
  /** Experiment that routed this call, and the variant it drew (T71) */
  experiment?: { id: string; variantId: string };
  /** Set when this call was forwarded through an Orchestrator (RTR-02) — the Orchestrator's own id. */
  orchestratorId?: string;
}

/**
 * Errore specifico lanciato quando il budget è esaurito per il modello
 * richiesto. Il chiamante può catturarlo per passare al candidato successivo
 * senza dover ricontrollare il budget.
 */
export class BudgetExceededError extends Error {
  public readonly modelId: string;
  constructor(modelId: string) {
    super('budget_exceeded');
    this.name = 'BudgetExceededError';
    this.modelId = modelId;
  }
}

// ─── In-memory notification state ────────────────────────────────────────────

// Provider health tracking: keyed by model.id
const providerFailCounts = new Map<string, number>(); // consecutive failures
const providerDegraded   = new Set<string>();          // currently degraded model IDs

// Budget notification deduplication
const budgetExceededKeys = new Set<string>(); // "${routerId}:${modelId}" — awaiting reset
const thresholdFiredKeys = new Set<string>(); // "${routerId}:${modelId}:${window}" — threshold already fired

function isRateLimitError(err: unknown): boolean {
  return /429|rate.?limit|too many/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Extracts an UpstreamResponse-shaped view (status/headers/body) from a thrown provider SDK
 * error, for accurate resilience-fault classification. Both the OpenAI and Anthropic Node SDKs
 * throw an `APIError` exposing `.status`/`.headers`/`.error` (parsed JSON body) — this reads that
 * shared convention without importing either SDK's error class. Adapters may also throw a plain
 * Error with no such shape (network failure, timeout), in which case this returns undefined and
 * classifyUpstreamError falls back to Error-message sniffing.
 */
export function upstreamResponseFromError(err: unknown): UpstreamResponse | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; headers?: unknown; error?: unknown };
  if (typeof e.status !== 'number') return undefined;
  const headers = e.headers && typeof e.headers === 'object' ? (e.headers as Record<string, string>) : undefined;
  return { status: e.status, ...(headers ? { headers } : {}), ...(e.error !== undefined ? { body: e.error } : {}) };
}

// ponytail: providerFailCounts/providerDegraded are now a thin event-dedup shim over the
// resilience store — the store (when wired) is the source of truth for availability, this Map/Set
// pair only prevents re-emitting provider.degraded/provider.recovered every single call while the
// store stays in the same state. Delete them once every provider.degraded/.recovered consumer
// reads the resilience snapshot directly instead of these notification events.
function handleProviderResult(model: ModelConfig, success: boolean, fault: ResilienceFault | undefined, routerId: string, log: Logger | undefined): void {
  const modelId = model.id;
  const provider = model.provider;
  const store = getResilienceStore();
  const providerKey = resilienceKeys(model).provider;

  if (success) {
    store?.recordSuccess(providerKey);
    providerFailCounts.set(modelId, 0);
    if (providerDegraded.delete(modelId)) {
      emitEvent('provider.recovered', 'info', { modelId, provider, routerId }, log ? { log } : {}).catch(() => {});
    }
    return;
  }

  // Single authoritative fault recorder for every LLM path (SDK routing/guardrail + proxy lanes,
  // which all route their upstream calls through llmChat/llmStream → here). recordFault maps the
  // category to the correct level (provider/connection/model); the lane loop no longer records, so
  // a given fault is recorded exactly once. The degraded/recovered events below still key off the
  // PROVIDER breaker's availability — correct: a model-level lockout must not mark the provider down.
  if (fault) recordFault(store, model, fault);
  const n = (providerFailCounts.get(modelId) ?? 0) + 1;
  providerFailCounts.set(modelId, n);
  // Drive "degraded" off the store's real availability when a store is wired (production);
  // fall back to the legacy 3-consecutive-failure heuristic when no store is present (keeps
  // every pre-existing test that builds an LLMCallContext directly, without bootstrapping the
  // resilience module, passing unmodified — see resilience/index.ts's getResilienceStore()).
  const isOpen = store ? !store.isAvailable(providerKey) : n >= 3;
  if (isOpen && !providerDegraded.has(modelId)) {
    providerDegraded.add(modelId);
    emitEvent('provider.degraded', 'warning', { modelId, provider, consecutiveErrors: n, routerId }, log ? { log } : {}).catch(() => {});
  }
}

/**
 * Risolve un id di modello (ModelInstance) nell'EffectiveModel pronto per l'adapter,
 * via instance + connection. Ritorna undefined se l'instance non esiste o la sua
 * connection è dangling.
 */
export async function loadEffectiveModel(id: string): Promise<EffectiveModel | undefined> {
  // ponytail: `?? []` guards against a bare `vi.fn()` test double resolving to
  // `undefined` — readConfig() itself always resolves to an array in production.
  const instances = (await readConfig('instances')) ?? [];
  const instance = instances.find((i) => i.id === id);
  if (instance) {
    const connections = (await readConfig('connections')) ?? [];
    const connection = connections.find((c) => c.id === instance.connectionId);
    if (connection) {
      const supportLevel = getProviderDescriptor(connection.providerId)?.supportLevel;
      if (supportLevel === 'oauth') {
        const liveToken = connection.providerId === 'anthropic-oauth'
          ? await resolveAnthropicOAuthCredential(connection)
          : await resolveOpenAIOAuthCredential(connection);
        return resolveEffectiveModel(instance, {
          ...connection,
          credentials: { ...connection.credentials, apiKey: liveToken },
        });
      }
      if (supportLevel === 'web') {
        if (connection.providerId === 'anthropic-web') {
          const sessionKey = await resolveAnthropicWebCredential(connection);
          return resolveEffectiveModel(instance, {
            ...connection,
            credentials: { ...connection.credentials, apiKey: sessionKey },
          });
        }
        const { accessToken, cfClearance } = await resolveOpenAIWebCredential(connection);
        return resolveEffectiveModel(instance, {
          ...connection,
          credentials: { ...connection.credentials, apiKey: accessToken, ...(cfClearance ? { cfClearance } : {}) },
        });
      }
      return resolveEffectiveModel(instance, connection);
    }
  }
  return undefined;
}

// ─── Helpers interni ─────────────────────────────────────────────────────────

/** Mappa callType → panel SSE per le trace entry */
function getPanels(callType: CallType): { req: TracePanel; res: TracePanel } {
  // guardrail judge calls share the router panels (internal, not the user completion).
  return callType === 'routing' || callType === 'guardrail'
    ? { req: 'router-request', res: 'router-response' }
    : { req: 'request', res: 'response' };
}

/**
 * Verifica il budget per `model` nel contesto dato.
 * Se il modello è tra i candidati del progetto usa isAllowed (gerarchia completa),
 * altrimenti usa isAllowedForRoutingModel (solo globalThresholds).
 * Se il budget è esaurito: traccia l'evento, emette la trace entry e lancia
 * BudgetExceededError.
 */
export async function checkBudget(model: ModelConfig, ctx: LLMCallContext): Promise<void> {
  const { router, token, routerId, callType, traceId, emit } = ctx;
  const { res } = getPanels(callType);

  const isCandidate = router.models.some((m: { modelId: string }) => m.modelId === model.id);
  const allowed = isCandidate
    ? await isAllowed(model, router, token)
    : await isAllowedForRoutingModel(model, routerId);

  const budgetKey = `${routerId}:${model.id}`;

  if (!allowed) {
    const reason = 'budget_exhausted';
    emit?.({
      panel: res,
      message: 'model:skipped',
      details: { modelId: model.id, reason },
    });
    await trackUsage({
      routerId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      outcome: 'error',
      errorMessage: 'budget_exceeded',
      callType,
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});
    budgetExceededKeys.add(budgetKey);
    emitEvent('budget.exceeded', 'critical', { routerId, modelId: model.id, reason, ...(traceId !== undefined ? { traceId } : {}) }, { ...(ctx.log ? { log: ctx.log } : {}) }).catch(() => {});
    throw new BudgetExceededError(model.id);
  }

  // Budget is allowed — check if a previous period was exhausted (new period started)
  if (budgetExceededKeys.delete(budgetKey)) {
    // Clean up threshold dedup for this router:model so it fires again in new period
    for (const k of thresholdFiredKeys) {
      if (k.startsWith(budgetKey + ':')) thresholdFiredKeys.delete(k);
    }
    emitEvent('budget.reset', 'info', { routerId, modelId: model.id, ...(traceId !== undefined ? { traceId } : {}) }, ctx.log ? { log: ctx.log } : {}).catch(() => {});
  }

  // Check if usage is near threshold (≥80%) — only for user-facing completion calls
  if (callType === 'completion' && isCandidate) {
    getLimitUsageSnapshot(model, router, token).then(snapshots => {
      for (const snap of snapshots) {
        if (snap.value > 0 && snap.current / snap.value >= 0.8) {
          const tKey = `${budgetKey}:${snap.window}`;
          if (!thresholdFiredKeys.has(tKey)) {
            thresholdFiredKeys.add(tKey);
            emitEvent('budget.threshold_reached', 'warning', {
              routerId, modelId: model.id, metric: snap.metric, window: snap.window,
              current: snap.current, limit: snap.value, pct: Math.round(snap.current / snap.value * 100),
              ...(traceId !== undefined ? { traceId } : {}),
            }, ctx.log ? { log: ctx.log } : {}).catch(() => {});
          }
        }
      }
    }).catch(() => {});
  }
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Chiamata LLM non-streaming con lifecycle completo.
 *
 * Flusso: checkBudget → chatCompletion → trackUsage (success|error)
 *
 * @throws BudgetExceededError  se il budget è esaurito
 * @throws Error                se la chiamata al provider fallisce
 */
export async function llmChat(
  request: ChatCompletionRequest,
  model: ModelConfig,
  ctx: LLMCallContext,
): Promise<ChatCompletionResponse> {
  const { routerId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

  model = (await loadEffectiveModel(model.id)) ?? model;

  await checkBudget(model, ctx);

  const adapter = getProviderAdapter(model);
  const t0 = Date.now();

  const isRouting = callType === 'routing';
  const systemMsg = isRouting
    ? request.messages?.find((m: { role: string }) => m.role === 'system')
    : undefined;

  emit?.({
    panel: req,
    message: 'model:request',
    details: {
      modelId: model.id,
      provider: model.provider,
      stream: false,
      messageCount: request.messages?.length ?? 0,
      ...(request.max_completion_tokens != null ? { maxTokens: request.max_completion_tokens } : {}),
      ...(request.max_tokens != null ? { maxTokens: request.max_tokens } : {}),
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
    },
    // Prompt text: dropped by publishTrace unless the router opted in.
    ...(systemMsg != null
      ? { content: { systemPrompt: (systemMsg as { role: string; content: string }).content } }
      : {}),
  });

  try {
    const response = await adapter.chatCompletion(request, model);
    const latencyMs = Date.now() - t0;
    const responseText = isRouting
      ? (response.choices?.[0]?.message?.content ?? undefined)
      : undefined;
    const responseJSON = isRouting ? response : undefined;

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const tokensPerSec = latencyMs > 0 ? Math.round((inputTokens + outputTokens) / (latencyMs / 1000)) : 0;

    // Calculate costs
    const cacheCreationTokens = (response.usage as any)?.prompt_tokens_details?.cache_creation_tokens ?? 0;
    const plainInput = inputTokens - cachedTokens - cacheCreationTokens;
    // ponytail: input/output splits below are display-only for the trace panel; the
    // authoritative total is calculateCost (single cost implementation, cache-creation aware).
    const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
    const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
    const totalCostUsd = calculateCost(inputTokens, outputTokens, model, cachedTokens, cacheCreationTokens);

    emit?.({
      panel: res,
      message: 'model:success',
      details: {
        modelId: model.id,
        inputTokens,
        cachedInputTokens: cachedTokens,
        outputTokens,
        latencyMs,
        ttftMs: latencyMs,  // non-streaming: tutta la latenza ≡ TTFT
        tokensPerSec,
        // Cost information
        inputCostUsd,
        outputCostUsd,
        totalCostUsd,
        inputPerMillion: model.cost.inputPerMillion,
        outputPerMillion: model.cost.outputPerMillion,
      },
      // Answer text: dropped by publishTrace unless the router opted in.
      ...(responseText != null || responseJSON != null
        ? {
            content: {
              ...(responseText != null ? { responseText } : {}),
              ...(responseJSON != null ? { responseJSON } : {}),
            },
          }
        : {}),
    });

    const cachedInputTokens = cachedTokens;
    const cacheCreationInputTokens = cacheCreationTokens;
    await trackUsage({
      routerId,
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      ...(cacheCreationInputTokens > 0 ? { cacheCreationInputTokens } : {}),
      latencyMs,
      ttftMs: latencyMs,     // non-streaming: tutta la latenza ≡ TTFT
      outcome: 'success',
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.optimizerStats ? { optimizerStats: ctx.optimizerStats } : {}),
      ...(ctx.experiment ? { experimentId: ctx.experiment.id, experimentVariantId: ctx.experiment.variantId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});

    handleProviderResult(model, true, undefined, routerId, log);
    return response;
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);

    log?.warn({ err, modelId: model.id }, 'llm executor: chat call failed');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });

    const provEvt = isRateLimitError(err) ? 'provider.rate_limited' : 'provider.error';
    emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, routerId, error: msg, ...(traceId !== undefined ? { traceId } : {}) }, log ? { log } : {}).catch(() => {});
    handleProviderResult(model, false, classifyUpstreamError(err, upstreamResponseFromError(err)), routerId, log);

    await trackUsage({
      routerId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      outcome: 'error',
      errorMessage: msg,
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.optimizerStats ? { optimizerStats: ctx.optimizerStats } : {}),
      ...(ctx.experiment ? { experimentId: ctx.experiment.id, experimentVariantId: ctx.experiment.variantId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});

    throw err;
  }
}

/** Risultato di llmStream: TTFT già misurato + generator di chunk */
export interface StreamResult {
  /** Time-to-first-token in millisecondi */
  ttftMs: number;
  /**
   * AsyncGenerator che produce i chunk SSE.
   * Internamente gestisce il tracking di token, latenza e thinking.
   * Deve essere consumato sino alla fine; se interrotto, il finally
   * del generator garantisce comunque il tracciamento usage.
   */
  chunks: AsyncGenerator<StreamChunk>;
}

/**
 * Chiamata LLM streaming con lifecycle completo.
 *
 * Attende il primo chunk (misura TTFT), poi restituisce un generator
 * che emette tutti i chunk — incluso il primo. Il tracking viene
 * completato nel finally del generator (successo o errore mid-stream).
 *
 * @throws BudgetExceededError  se il budget è esaurito
 * @throws Error                se il primo chunk non arriva (errore pre-stream)
 */
export async function llmStream(
  request: ChatCompletionRequest,
  model: ModelConfig,
  ctx: LLMCallContext,
): Promise<StreamResult> {
  const { routerId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

  model = (await loadEffectiveModel(model.id)) ?? model;

  await checkBudget(model, ctx);

  const adapter = getProviderAdapter(model);
  const t0 = Date.now();

  emit?.({
    panel: req,
    message: 'model:request',
    details: {
      modelId: model.id,
      provider: model.provider,
      stream: true,
      messageCount: request.messages?.length ?? 0,
      ...(request.max_completion_tokens != null ? { maxTokens: request.max_completion_tokens } : {}),
      ...(request.max_tokens != null ? { maxTokens: request.max_tokens } : {}),
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
    },
  });

  // Inietta stream_options per ricevere i token usage nel chunk finale
  const streamRequest: ChatCompletionRequest = {
    ...request,
    stream_options: { include_usage: true },
  };

  const iter = adapter.streamCompletion(streamRequest, model)[Symbol.asyncIterator]();

  const ttftTimeoutMs = callType === 'completion' ? ctx.router.timeoutMs : undefined;

  // Attende il primo chunk per poter misurare il TTFT.
  // Se fallisce qui il chiamante può tentare il candidato successivo.
  let firstChunk: IteratorResult<StreamChunk>;
  try {
    // timeoutMs 0 means "no TTFT timeout" and falls through to the untimed await.
    if (ttftTimeoutMs) {
      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TTFT timeout after ${ttftTimeoutMs}ms`)), ttftTimeoutMs);
      });
      firstChunk = await Promise.race([iter.next(), timeoutPromise]).finally(() => clearTimeout(timer!));
    } else {
      firstChunk = await iter.next();
    }
  } catch (err: unknown) {
    void iter.return?.();
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const isTtftTimeout = msg.startsWith('TTFT timeout');
    log?.warn({ err, modelId: model.id }, isTtftTimeout ? 'llm executor: TTFT timeout' : 'llm executor: stream failed before first chunk');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });
    const provEvt = isRateLimitError(err) ? 'provider.rate_limited' : 'provider.error';
    emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, routerId, error: msg, ...(traceId !== undefined ? { traceId } : {}) }, log ? { log } : {}).catch(() => {});
    handleProviderResult(model, false, classifyUpstreamError(err, upstreamResponseFromError(err)), routerId, log);
    await trackUsage({
      routerId, model, inputTokens: 0, outputTokens: 0, latencyMs,
      outcome: isTtftTimeout ? 'timeout' : 'error',
      errorMessage: msg,
      callType,
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});
    throw err;
  }

  const ttftMs = Date.now() - t0;

  // ── Generator interno ────────────────────────────────────────────────────
  async function* makeGenerator(): AsyncGenerator<StreamChunk> {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationInputTokens = 0;
    let thinkingAccum = '';
    let thinkingEmitted = false;
    let contentAccum = '';
    let outcome: 'success' | 'error' = 'success';
    let errorMessage: string | undefined;

    function processChunk(chunk: StreamChunk): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (chunk as any).usage;
      if (u) {
        inputTokens = u.prompt_tokens ?? inputTokens;
        outputTokens = u.completion_tokens ?? outputTokens;
        cachedInputTokens = u.prompt_tokens_details?.cached_tokens ?? cachedInputTokens;
        cacheCreationInputTokens = u.prompt_tokens_details?.cache_creation_tokens ?? cacheCreationInputTokens;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delta = (chunk as any)?.choices?.[0]?.delta as any;
      if (delta?.thinking !== undefined) {
        thinkingAccum += delta.thinking as string;
      } else if (delta?.content !== undefined && !thinkingEmitted && thinkingAccum) {
        emit?.({
          panel: res,
          message: 'model:thinking',
          details: { modelId: model.id },
          // Reasoning text: dropped by publishTrace unless the router opted in.
          content: { text: thinkingAccum },
        });
        thinkingEmitted = true;
      }
      if (delta?.content) {
        contentAccum += delta.content as string;
      }
    }

    try {
      if (!firstChunk.done) {
        processChunk(firstChunk.value);
        yield firstChunk.value;

        let next = await iter.next();
        while (!next.done) {
          processChunk(next.value);
          yield next.value;
          next = await iter.next();
        }
      }

      // Emette thinking rimasto se il modello ha solo thought senza produrre testo
      if (thinkingAccum && !thinkingEmitted) {
        emit?.({
          panel: res,
          message: 'model:thinking',
          details: { modelId: model.id },
          // Reasoning text: dropped by publishTrace unless the router opted in.
          content: { text: thinkingAccum },
        });
      }
    } catch (err: unknown) {
      outcome = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      log?.error({ err, modelId: model.id }, 'llm executor: stream error mid-stream');
      emit?.({
        panel: res,
        message: 'model:error',
        details: { modelId: model.id, error: errorMessage, latencyMs: Date.now() - t0 },
      });
      const provEvt = isRateLimitError(err) ? 'provider.rate_limited' : 'provider.error';
      emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, routerId, error: errorMessage, ...(traceId !== undefined ? { traceId } : {}) }, log ? { log } : {}).catch(() => {});
      handleProviderResult(model, false, classifyUpstreamError(err, upstreamResponseFromError(err)), routerId, log);
      throw err;
    } finally {
      const latencyMs = Date.now() - t0;
      if (outcome === 'success') {
        const tokensPerSec = latencyMs > 0 ? Math.round((inputTokens + outputTokens) / (latencyMs / 1000)) : 0;

        // Calculate costs
        const plainInput = inputTokens - cachedInputTokens - cacheCreationInputTokens;
        const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
        const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
        const totalCostUsd = calculateCost(inputTokens, outputTokens, model, cachedInputTokens, cacheCreationInputTokens);

        emit?.({
          panel: res,
          message: 'model:success',
          details: {
            modelId: model.id,
            inputTokens,
            cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
            outputTokens,
            latencyMs,
            ttftMs,
            tokensPerSec,
            // Cost information
            inputCostUsd,
            outputCostUsd,
            totalCostUsd,
            inputPerMillion: model.cost.inputPerMillion,
            outputPerMillion: model.cost.outputPerMillion,
          },
        });
      }
      if (outcome === 'success') handleProviderResult(model, true, undefined, routerId, log);
      await trackUsage({
        routerId, model, inputTokens, outputTokens, latencyMs, ttftMs,        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),        outcome,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        callType,
        ...(traceId !== undefined ? { traceId } : {}),
        ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
        ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...(ctx.tags ? { tags: ctx.tags } : {}),
        ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
      }).catch(() => {});
    }
  }

  return { ttftMs, chunks: makeGenerator() };
}

/**
 * Anthropic Messages API call with full lifecycle management.
 *
 * Works with any provider (native Anthropic or OpenAI via adapter):
 *   • checkBudget → adapter.messages() → trackUsage → return response
 *
 * @throws BudgetExceededError  if the budget is exhausted
 * @throws Error                if the adapter does not support messages() or the call fails
 */
export async function llmMessages(
  request: MessagesRequest,
  model: ModelConfig,
  ctx: LLMCallContext,
): Promise<MessagesResponse> {
  const { routerId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

  model = (await loadEffectiveModel(model.id)) ?? model;

  await checkBudget(model, ctx);

  const adapter = getProviderAdapter(model);
  if (!adapter.messages) {
    throw new Error(`Provider "${model.provider}" does not support the Anthropic messages API.`);
  }

  const t0 = Date.now();

  emit?.({
    panel: req,
    message: 'model:request',
    details: {
      modelId: model.id,
      provider: model.provider,
      stream: false,
      messageCount: request.messages?.length ?? 0,
      maxTokens: request.max_tokens,
    },
  });

  try {
    const response = await adapter.messages(request, model);
    const latencyMs = Date.now() - t0;

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cachedInputTokens = response.usage.cache_read_input_tokens ?? 0;
    const cacheCreationInputTokens = response.usage.cache_creation_input_tokens ?? 0;
    const tokensPerSec = latencyMs > 0 ? Math.round((inputTokens + outputTokens) / (latencyMs / 1000)) : 0;

    const plainInput = inputTokens - cachedInputTokens - cacheCreationInputTokens;
    const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
    const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
    const totalCostUsd = calculateCost(inputTokens, outputTokens, model, cachedInputTokens, cacheCreationInputTokens);

    emit?.({
      panel: res,
      message: 'model:success',
      details: {
        modelId: model.id,
        inputTokens,
        cachedInputTokens: cachedInputTokens > 0 ? cachedInputTokens : undefined,
        outputTokens,
        latencyMs,
        ttftMs: latencyMs,
        tokensPerSec,
        inputCostUsd,
        outputCostUsd,
        totalCostUsd,
        inputPerMillion: model.cost.inputPerMillion,
        outputPerMillion: model.cost.outputPerMillion,
      },
    });

    await trackUsage({
      routerId,
      model,
      inputTokens,
      outputTokens,
      ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      ...(cacheCreationInputTokens > 0 ? { cacheCreationInputTokens } : {}),
      latencyMs,
      ttftMs: latencyMs,
      outcome: 'success',
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.optimizerStats ? { optimizerStats: ctx.optimizerStats } : {}),
      ...(ctx.experiment ? { experimentId: ctx.experiment.id, experimentVariantId: ctx.experiment.variantId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});

    // llmMessages never called handleProviderResult before Task 7 (no provider.degraded/.recovered
    // events on this path) — only wiring the success-side recordSuccess here (required so a
    // half-open breaker tripped by llmChat/llmStream failures can still close on an Anthropic
    // messages-API success against the same provider); a messages-API failure does NOT record a
    // fault, matching the pre-existing behavior of this function (out of Task 7's stated scope).
    getResilienceStore()?.recordSuccess(resilienceKeys(model).provider);

    return response;
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err, modelId: model.id }, 'llm executor: messages call failed');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });
    await trackUsage({
      routerId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      outcome: 'error',
      errorMessage: msg,
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.token?.id ? { tokenId: ctx.token.id } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.optimizerStats ? { optimizerStats: ctx.optimizerStats } : {}),
      ...(ctx.experiment ? { experimentId: ctx.experiment.id, experimentVariantId: ctx.experiment.variantId } : {}),
      ...(ctx.orchestratorId ? { orchestratorId: ctx.orchestratorId } : {}),
    }).catch(() => {});
    throw err;
  }
}
