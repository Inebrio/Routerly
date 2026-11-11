import type { ChatCompletionRequest, ModelConfig } from '@routerly/shared';
import { getProviderDescriptor, type CompatProfile } from '../descriptor.js';

/** Maps whose keys are user-chosen names, not schema keywords. */
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

/**
 * Removes `keywords` from a JSON Schema. Keys of name maps (`properties`, `$defs`, …) are
 * never treated as keywords, so a tool argument called "pattern" survives.
 */
export function sanitizeSchema(node: unknown, keywords: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map(n => sanitizeSchema(n, keywords));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (keywords.includes(k) && (typeof v !== 'object' || v === null)) continue;
    if (NAME_MAPS.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([name, s]) => [name, sanitizeSchema(s, keywords)]));
    } else {
      out[k] = sanitizeSchema(v, keywords);
    }
  }
  return out;
}

function sanitizeTools(tools: unknown, keywords: readonly string[]): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map((t) => {
    const tool = t as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped client payload
    const fn = tool?.function;
    if (fn?.parameters === undefined) return t;
    return { ...tool, function: { ...fn, parameters: sanitizeSchema(fn.parameters, keywords) } };
  });
}

/**
 * Applies a provider's compat profile to an OpenAI-shaped request. Pure: the input is not
 * mutated and, when the profile asks for nothing that applies, the same object comes back.
 * Every transformation is data in the profile; default is a verbatim forward.
 */
export function normalizeRequest(request: ChatCompletionRequest, profile: CompatProfile | undefined): ChatCompletionRequest {
  if (!profile) return request;
  const r = request as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped client payload
  let out: Record<string, any> = r; // eslint-disable-line @typescript-eslint/no-explicit-any
  const set = (patch: Record<string, unknown>) => { out = { ...out, ...patch }; };

  if (profile.schemaDropKeywords?.length && Array.isArray(r.tools) && r.tools.length) {
    set({ tools: sanitizeTools(r.tools, profile.schemaDropKeywords) });
  }

  const pb = profile.reasoningPassback;
  if (pb && Array.isArray(r.tools) && r.tools.length
    && !pb.clientFields.some(f => r[f] !== undefined)
    && request.messages.some((m: any) => m.role === 'assistant' && typeof m[pb.field] !== 'string')) { // eslint-disable-line @typescript-eslint/no-explicit-any
    set(pb.disableWith);
  }

  if (profile.dropParams?.length && profile.dropParams.some(p => p in out)) {
    out = Object.fromEntries(Object.entries(out).filter(([k]) => !profile.dropParams!.includes(k)));
  }
  return out as ChatCompletionRequest;
}

/** Normalizes for the provider of `model`. Unknown provider → verbatim. */
export function normalizeForModel(request: ChatCompletionRequest, model: ModelConfig): ChatCompletionRequest {
  return normalizeRequest(request, getProviderDescriptor(model.provider)?.compat);
}
