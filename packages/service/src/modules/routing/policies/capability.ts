import type { PolicyFn } from './types.js';

/**
 * Policy: capability
 *
 * Filtro **hard**: assegna 0.0 ai modelli che non supportano una feature
 * richiesta dalla richiesta corrente, 1.0 a quelli compatibili.
 *
 * Feature rilevate automaticamente dalla richiesta:
 *  - vision         → uno o più messaggi contengono ContentPart di tipo image_url
 *  - functionCalling → la richiesta include `tools` o `functions`
 *  - json           → response_format.type === 'json_object'
 *
 * Le capability non presenti in ModelConfig vengono ignorate (nessuna penalità):
 * se un modello non dichiara esplicitamente `vision: false`, si assume compatibile.
 * La policy penalizza solo i modelli che dichiarano esplicitamente `false`.
 */
export const capabilityPolicy: PolicyFn = async ({ request, candidates }) => {
  // ── Rileva feature richieste ─────────────────────────────────────────────
  const needsVision = (request.messages ?? []).some((m: { content: unknown }) => {
    if (!Array.isArray(m.content)) return false;
    return (m.content as Array<{ type: string }>).some(p => p.type === 'image_url');
  });

  const tools: unknown[]     = (request as any).tools     ?? [];
  const functions: unknown[] = (request as any).functions ?? [];
  const needsFunctionCalling = tools.length > 0 || functions.length > 0;

  const responseFormat = (request as any).response_format as { type?: string } | undefined;
  const needsJson      = responseFormat?.type === 'json_object';

  const routing = candidates.map(c => {
    const cap = c.model.capabilities ?? {};

    const issues: string[] = [];

    // Solo penalizza se la capability è esplicitamente `false`
    if (needsVision && cap.vision === false)
      issues.push('vision_not_supported');
    if (needsFunctionCalling && cap.functionCalling === false)
      issues.push('function_calling_not_supported');
    if (needsJson && cap.json === false)
      issues.push('json_mode_not_supported');

    const point = issues.length > 0 ? 0.0 : 1.0;

    return {
      model:         c.model.id,
      point,
      needsVision,
      needsFunctionCalling,
      needsJson,
      ...(issues.length > 0 ? { incompatible: issues } : {}),
    };
  });

  const excludes = routing.filter(r => r.point === 0.0).map(r => r.model);
  return { routing, ...(excludes.length > 0 ? { excludes } : {}) };
};
