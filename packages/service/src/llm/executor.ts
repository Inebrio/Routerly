/**
 * Centralized LLM executor.
 *
 * Ogni chiamata verso un modello — che sia per routing o per completion,
 * streaming o non-streaming — passa da qui. L'executor gestisce in modo
 * uniforme:
 *   • verifica del budget (token > project > global)
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
  ProjectConfig,
  ProjectToken,
  StreamChunk,
  CallType,
  MessagesRequest,
  MessagesResponse,
} from '@routerly/shared';
import { getProviderAdapter } from '../providers/index.js';
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../cost/budget.js';
import { trackUsage } from '../cost/tracker.js';
import { emitEvent } from '../notifications/emitter.js';
import type { TraceEntry, TracePanel } from '../routing/traceStore.js';

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
  projectId: string;
  project: ProjectConfig;
  /** Token associato alla richiesta, per la gerarchia token > project > global */
  token?: ProjectToken;
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
const budgetExceededKeys = new Set<string>(); // "${projectId}:${modelId}" — awaiting reset
const thresholdFiredKeys = new Set<string>(); // "${projectId}:${modelId}:${window}" — threshold already fired

function isRateLimitError(err: unknown): boolean {
  return /429|rate.?limit|too many/i.test(err instanceof Error ? err.message : String(err));
}

function handleProviderResult(modelId: string, provider: string, success: boolean, projectId: string, log: Logger | undefined): void {
  if (success) {
    providerFailCounts.set(modelId, 0);
    if (providerDegraded.delete(modelId)) {
      emitEvent('provider.recovered', 'info', { modelId, provider, projectId }, log ? { log } : {}).catch(() => {});
    }
  } else {
    const n = (providerFailCounts.get(modelId) ?? 0) + 1;
    providerFailCounts.set(modelId, n);
    if (n >= 3 && !providerDegraded.has(modelId)) {
      providerDegraded.add(modelId);
      emitEvent('provider.degraded', 'warning', { modelId, provider, consecutiveErrors: n, projectId }, log ? { log } : {}).catch(() => {});
    }
  }
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
  const { project, token, projectId, callType, traceId, emit } = ctx;
  const { res } = getPanels(callType);

  const isCandidate = project.models.some((m: { modelId: string }) => m.modelId === model.id);
  const allowed = isCandidate
    ? await isAllowed(model, project, token)
    : await isAllowedForRoutingModel(model, projectId);

  const budgetKey = `${projectId}:${model.id}`;

  if (!allowed) {
    const reason = 'budget_exhausted';
    emit?.({
      panel: res,
      message: 'model:skipped',
      details: { modelId: model.id, reason },
    });
    await trackUsage({
      projectId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      outcome: 'error',
      errorMessage: 'budget_exceeded',
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
    }).catch(() => {});
    budgetExceededKeys.add(budgetKey);
    emitEvent('budget.exceeded', 'critical', { projectId, modelId: model.id, reason }, { ...(ctx.log ? { log: ctx.log } : {}) }).catch(() => {});
    throw new BudgetExceededError(model.id);
  }

  // Budget is allowed — check if a previous period was exhausted (new period started)
  if (budgetExceededKeys.delete(budgetKey)) {
    // Clean up threshold dedup for this project:model so it fires again in new period
    for (const k of thresholdFiredKeys) {
      if (k.startsWith(budgetKey + ':')) thresholdFiredKeys.delete(k);
    }
    emitEvent('budget.reset', 'info', { projectId, modelId: model.id }, ctx.log ? { log: ctx.log } : {}).catch(() => {});
  }

  // Check if usage is near threshold (≥80%) — only for user-facing completion calls
  if (callType === 'completion' && isCandidate) {
    getLimitUsageSnapshot(model, project, token).then(snapshots => {
      for (const snap of snapshots) {
        if (snap.value > 0 && snap.current / snap.value >= 0.8) {
          const tKey = `${budgetKey}:${snap.window}`;
          if (!thresholdFiredKeys.has(tKey)) {
            thresholdFiredKeys.add(tKey);
            emitEvent('budget.threshold_reached', 'warning', {
              projectId, modelId: model.id, metric: snap.metric, window: snap.window,
              current: snap.current, limit: snap.value, pct: Math.round(snap.current / snap.value * 100),
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
  const { projectId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

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
      ...(systemMsg != null ? { systemPrompt: (systemMsg as { role: string; content: string }).content } : {}),
    },
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
    const plainInput = inputTokens - cachedTokens;
    const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
    const cachedCostUsd = (cachedTokens / 1_000_000) * (model.cost.cachePerMillion ?? model.cost.inputPerMillion);
    const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
    const totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

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
        ...(responseText != null ? { responseText } : {}),
        ...(responseJSON != null ? { responseJSON } : {}),
      },
    });

    const cachedInputTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheCreationInputTokens = (response.usage as any)?.prompt_tokens_details?.cache_creation_tokens ?? 0;
    await trackUsage({
      projectId,
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
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
    }).catch(() => {});

    handleProviderResult(model.id, model.provider, true, projectId, log);
    return response;
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);

    log?.warn({ err, modelId: model.id }, 'llm executor: chat call failed');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });

    const provEvt = isRateLimitError(err) ? 'provider.rate_limited' : 'provider.error';
    emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, projectId, error: msg }, log ? { log } : {}).catch(() => {});
    handleProviderResult(model.id, model.provider, false, projectId, log);

    await trackUsage({
      projectId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      outcome: 'error',
      errorMessage: msg,
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
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
  const { projectId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

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

  const ttftTimeoutMs = callType === 'completion' ? ctx.project.timeoutMs : undefined;

  // Attende il primo chunk per poter misurare il TTFT.
  // Se fallisce qui il chiamante può tentare il candidato successivo.
  let firstChunk: IteratorResult<StreamChunk>;
  try {
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
    emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, projectId, error: msg }, log ? { log } : {}).catch(() => {});
    handleProviderResult(model.id, model.provider, false, projectId, log);
    await trackUsage({
      projectId, model, inputTokens: 0, outputTokens: 0, latencyMs,
      outcome: isTtftTimeout ? 'timeout' : 'error',
      errorMessage: msg,
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
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
          details: { modelId: model.id, text: thinkingAccum },
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
          details: { modelId: model.id, text: thinkingAccum },
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
      emitEvent(provEvt, 'warning', { modelId: model.id, provider: model.provider, projectId, error: errorMessage }, log ? { log } : {}).catch(() => {});
      handleProviderResult(model.id, model.provider, false, projectId, log);
      throw err;
    } finally {
      const latencyMs = Date.now() - t0;
      if (outcome === 'success') {
        const tokensPerSec = latencyMs > 0 ? Math.round((inputTokens + outputTokens) / (latencyMs / 1000)) : 0;

        // Calculate costs
        const plainInput = inputTokens - cachedInputTokens;
        const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
        const cachedCostUsd = (cachedInputTokens / 1_000_000) * (model.cost.cachePerMillion ?? model.cost.inputPerMillion);
        const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
        const totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

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
      if (outcome === 'success') handleProviderResult(model.id, model.provider, true, projectId, log);
      await trackUsage({
        projectId, model, inputTokens, outputTokens, latencyMs, ttftMs,        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),        outcome,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        callType,
        ...(traceId !== undefined ? { traceId } : {}),
        ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...(ctx.tags ? { tags: ctx.tags } : {}),
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
  const { projectId, callType, traceId, emit, log } = ctx;
  const { req, res } = getPanels(callType);

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

    const plainInput = inputTokens - cachedInputTokens;
    const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion;
    const cachedCostUsd = (cachedInputTokens / 1_000_000) * (model.cost.cachePerMillion ?? model.cost.inputPerMillion);
    const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion;
    const totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

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
      projectId,
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
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
    }).catch(() => {});

    return response;
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err, modelId: model.id }, 'llm executor: messages call failed');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });
    await trackUsage({
      projectId,
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      outcome: 'error',
      errorMessage: msg,
      callType,
      ...(traceId !== undefined ? { traceId } : {}),
      ...(ctx.endUserId ? { endUserId: ctx.endUserId } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.tags ? { tags: ctx.tags } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted && ctx.piiRedacted.length > 0 ? { piiRedacted: ctx.piiRedacted } : {}),
    }).catch(() => {});
    throw err;
  }
}
