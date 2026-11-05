import { PASSTHROUGH_MODEL_ID, type PassthroughException, type RouterConfig } from '@routerly/shared'

/**
 * Exact, case-sensitive match where `*` stands for any sequence (including empty).
 * Iterative two-pointer scan with single-star backtracking: O(pattern x text) worst
 * case, no regex built from user input.
 */
export function globMatch(pattern: string, text: string): boolean {
  let p = 0
  let t = 0
  let starP = -1
  let starT = 0
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      starP = p++
      starT = t
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++
      t++
    } else if (starP !== -1) {
      p = starP + 1
      t = ++starT
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}

/**
 * First rule whose `match` fits `requestedModel`, with its index. A rule whose target is
 * no longer a real model of the router (hand-edited config) is skipped, so an exception
 * can never reach a model outside this router.
 */
export function matchException(
  router: RouterConfig,
  requestedModel: unknown,
  onStale?: (rule: PassthroughException, index: number) => void,
): { rule: PassthroughException; index: number } | undefined {
  if (typeof requestedModel !== 'string' || !router.exceptions?.length) return undefined
  for (const [index, rule] of router.exceptions.entries()) {
    if (!globMatch(rule.match, requestedModel)) continue
    if (rule.targetModelId === PASSTHROUGH_MODEL_ID || !router.models.some((m) => m.modelId === rule.targetModelId)) {
      onStale?.(rule, index)
      continue
    }
    return { rule, index }
  }
  return undefined
}
