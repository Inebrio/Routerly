import type { ChatCompletionRequest, EffectiveModel } from '@routerly/shared';
import { getProviderAdapter } from '../provider/registry.js';
import { chunksToChatResponse, streamOpenAIOAuthChunks } from '../reverse-proxy/lanes/openaiOAuthForward.js';
import type { Invoker } from './corpus.js';

/** Calls one model through the production path (provider adapter, compat pipeline included). Runs are not tracked in usage. */
export function invokerFor(model: EffectiveModel, log: Parameters<typeof streamOpenAIOAuthChunks>[2]): Invoker {
  const upstream = model.upstreamModelId ?? model.id;
  const full = (r: Record<string, unknown>) => ({ ...r, model: upstream }) as ChatCompletionRequest;
  if (model.provider === 'openai-oauth') {
    const stream = (r: Record<string, unknown>) =>
      streamOpenAIOAuthChunks(full(r), model, log, { traceId: `conformance-${Date.now()}`, routerId: '' });
    return { stream, chat: r => chunksToChatResponse(stream(r), model.id) };
  }
  const adapter = getProviderAdapter(model);
  return {
    chat: r => adapter.chatCompletion(full(r), model),
    stream: r => adapter.streamCompletion({ ...full(r), stream: true }, model),
  };
}
