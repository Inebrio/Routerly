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
} from '@routerly/shared';
import { getProviderAdapter } from '../providers/index.js';
import { isAllowed, isAllowedForRoutingModel } from '../cost/budget.js';
import { trackUsage } from '../cost/tracker.js';
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

// ─── Helpers interni ─────────────────────────────────────────────────────────

/** Mappa callType → panel SSE per le trace entry */
function getPanels(callType: CallType): { req: TracePanel; res: TracePanel } {
  return callType === 'routing'
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
async function checkBudget(model: ModelConfig, ctx: LLMCallContext): Promise<void> {
  const { project, token, projectId, callType, traceId, emit } = ctx;
  const { res } = getPanels(callType);

  const isCandidate = project.models.some((m: { modelId: string }) => m.modelId === model.id);
  const allowed = isCandidate
    ? await isAllowed(model, project, token)
    : await isAllowedForRoutingModel(model, projectId);

  if (!allowed) {
    emit?.({
      panel: res,
      message: 'model:skipped',
      details: { modelId: model.id, reason: 'budget_exhausted' },
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
    throw new BudgetExceededError(model.id);
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
    }).catch(() => {});

    return response;
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);

    log?.warn({ err, modelId: model.id }, 'llm executor: chat call failed');
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

  // Attende il primo chunk per poter misurare il TTFT.
  // Se fallisce qui il chiamante può tentare il candidato successivo.
  let firstChunk: IteratorResult<StreamChunk>;
  try {
    firstChunk = await iter.next();
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err, modelId: model.id }, 'llm executor: stream failed before first chunk');
    emit?.({ panel: res, message: 'model:error', details: { modelId: model.id, error: msg, latencyMs } });
    await trackUsage({
      projectId, model, inputTokens: 0, outputTokens: 0, latencyMs,
      outcome: 'error',
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
      await trackUsage({
        projectId, model, inputTokens, outputTokens, latencyMs, ttftMs,        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),        outcome,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        callType,
        ...(traceId !== undefined ? { traceId } : {}),
      }).catch(() => {});
    }
  }

  return { ttftMs, chunks: makeGenerator() };
}
