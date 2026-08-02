import type {
  ChatCompletionRequest,
  Message,
  OptimizerId,
  OptimizerResult,
  OptimizerStep,
  ProjectConfig,
} from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { OptimizerRegistry } from './registry.js'
import { restoreInPlace } from './core.js'
import { passesSafetyGate } from './gate.js'
import { tokensOf } from './messages.js'

/** Per-step token delta produced by a dry-run preview. */
export interface PreviewStepResult {
  id: OptimizerId
  before: number
  after: number
  /**
   * The prompt as this step left it. Always present, including when the step
   * changed nothing, so a caller can diff consecutive states without tracking
   * which step was the last one to touch the prompt (T63).
   */
  messages: Message[]
  /**
   * Set when the step produced a change that was then rejected — by the lossy
   * safety gate or by its own `validate` — and rolled back. `before === after`
   * on its own cannot tell that apart from a step that simply had nothing to do,
   * and the difference is exactly what a threshold needs tuning for.
   */
  rolledBack?: boolean
}

/** Result of a dry-run optimizer preview over sample messages. */
export interface PreviewResult {
  estimatedTokensBefore: number
  estimatedTokensAfter: number
  perStep: PreviewStepResult[]
  /** The prompt the whole pipeline would forward. Diff it against the sample to see the net effect. */
  messages: Message[]
}

export interface PreviewInput {
  registry: OptimizerRegistry | undefined
  sampleMessages: Message[]
  steps: OptimizerStep[]
  /** Optional project the preview runs "as" — only its config is read; nothing is written. */
  project?: ProjectConfig
}

// A no-op logger: the pure runner never touches the network or a real request,
// but optimizers/core's decision path reads ctx.log on some branches.
const NOOP_LOG = {
  warn() {},
  error() {},
  info() {},
  debug() {},
  fatal() {},
  trace() {},
  child() {
    return NOOP_LOG
  },
} as unknown as ProxyContext['log']

/**
 * Build a minimal ProxyContext sufficient for an optimizer's supports/optimize/
 * validate/recover to run against sample messages. It carries no reply, no route,
 * and no upstream — optimizers only read ctx.request, ctx.project.optimizers, and
 * (headroom) ctx.attempt, which is intentionally absent here so context-window
 * optimizers stay inert in a preview, matching their live behavior.
 */
function buildPreviewContext(messages: Message[], project: ProjectConfig): ProxyContext {
  // Same object for request and original — the in-place mutation contract in core.ts
  // assumes ctx.request === ctx.original for the Anthropic lane. Cloning keeps the
  // caller's sampleMessages untouched.
  const request = { model: 'preview', messages: structuredClone(messages) } as ChatCompletionRequest
  return {
    protocol: 'openai',
    log: NOOP_LOG,
    project,
    projectId: project.id,
    traceId: 'preview',
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as unknown as ProxyContext
}

/**
 * Dry-run the given optimizer steps over sample messages and report per-step and
 * total token deltas. Pure: no upstream call, no config write, no reply. Mirrors
 * core.ts's applyProcessor decision logic exactly — snapshot → optimize → (lossy)
 * safety gate → validate → rollback-on-failure — so a lossy step that would fail
 * the gate is reported unchanged (before === after), just as it would be dropped live.
 */
export async function runPreview(input: PreviewInput): Promise<PreviewResult> {
  const { registry, sampleMessages, steps } = input
  // The fake project's optimizers.steps drives per-optimizer threshold lookup
  // (ccr/headroom/relevance read ctx.project.optimizers.steps.find(...)).
  const base = input.project ?? ({ id: 'preview' } as ProjectConfig)
  const project = { ...base, optimizers: { steps } }
  const ctx = buildPreviewContext(sampleMessages, project)
  const req = ctx.request

  const estimatedTokensBefore = tokensOf(req.messages ?? [])
  const perStep: PreviewStepResult[] = []

  for (const step of steps) {
    const before = tokensOf(req.messages ?? [])
    let after = before
    let rolledBack = false

    const optimizer = step.enabled ? registry?.get(step.id) : undefined
    if (optimizer && optimizer.supports(ctx)) {
      const snapshot = structuredClone(req)
      let result: OptimizerResult | undefined
      try {
        result = await optimizer.optimize(ctx)
      } catch {
        restoreInPlace(req, snapshot)
      }
      if (result) {
        const rejected =
          (optimizer.klass === 'lossy' && !passesSafetyGate(result)) ||
          !optimizer.validate(ctx, result)
        if (rejected) {
          restoreInPlace(req, snapshot)
          optimizer.recover?.(ctx, result)
          rolledBack = result.changed
        } else {
          after = tokensOf(req.messages ?? [])
        }
      }
    }

    perStep.push({
      id: step.id,
      before,
      after,
      messages: structuredClone(req.messages ?? []),
      ...(rolledBack ? { rolledBack: true } : {}),
    })
  }

  return {
    estimatedTokensBefore,
    estimatedTokensAfter: tokensOf(req.messages ?? []),
    perStep,
    messages: structuredClone(req.messages ?? []),
  }
}
