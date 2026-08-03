import { defineModule, type RouterlyModule } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY } from '../../../core/tokens.js'
import type { Message, OptimizerResult, OptimizerStep } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { Optimizer } from '../registry.js'
import { messageText, readMessages, tokensOf, writeMessages } from '../messages.js'
// Namespace import so tests can spy on the model loader without a real ONNX
// runtime or checkpoint on disk.
import * as model from './model.js'

/** Default keep-ratio when the step sets no explicit `threshold`. */
const DEFAULT_KEEP_RATIO = 0.5

function stepOf(ctx: ProxyContext): OptimizerStep | undefined {
  return ctx.project.optimizers?.steps.find((s) => s.id === 'llmlingua-2')
}

/** Target fraction of tokens to KEEP, from the step's `threshold` (0..1). */
function ratioOf(ctx: ProxyContext): number {
  const t = stepOf(ctx)?.threshold
  return typeof t === 'number' && t > 0 && t < 1 ? t : DEFAULT_KEEP_RATIO
}

/** Checkpoint key this project's step selected, or undefined for the default. */
function modelKeyOf(ctx: ProxyContext): string | undefined {
  return stepOf(ctx)?.model
}

/**
 * Compress a message's own text via the ONNX model, structurally: string content
 * is compressed directly; array content only has its `type: 'text'` parts
 * compressed — every other part (image_url, tool_use, tool_result, ...) is left
 * byte-identical. Messages are never dropped, reordered, or merged.
 */
async function compressMessage(
  m: Message,
  ratio: number,
  modelKey?: string,
): Promise<{ message: Message; changed: boolean }> {
  if (typeof m.content === 'string') {
    const text = await model.compress(m.content, ratio, modelKey)
    if (text === m.content) return { message: m, changed: false }
    return { message: { ...m, content: text }, changed: true }
  }
  if (Array.isArray(m.content)) {
    let changed = false
    const content: unknown[] = []
    for (const p of m.content) {
      if (p.type === 'text' && typeof p.text === 'string') {
        const text = await model.compress(p.text, ratio, modelKey)
        if (text !== p.text) {
          changed = true
          content.push({ ...p, text })
          continue
        }
      }
      content.push(p)
    }
    if (!changed) return { message: m, changed: false }
    return { message: { ...m, content } as Message, changed: true }
  }
  return { message: m, changed: false }
}

/** Pre-optimize message array per context, read back by recover/validate. */
const originals = new WeakMap<ProxyContext, Message[]>()

export const llmlingua2Optimizer: Optimizer = {
  id: 'llmlingua-2',
  klass: 'lossy',

  // OFF by default: enabled step AND the checkpoint in the local cache AND the
  // optional @huggingface/transformers dependency installed. With neither (the
  // install default) this is a permanent no-op. isModelAvailable() is checked
  // first so the common path stays a cheap fs probe.
  supports(ctx) {
    const step = stepOf(ctx)
    if (!step?.enabled) return false
    return model.isModelAvailable(modelKeyOf(ctx)) && model.isRuntimeInstalled()
  },

  explain(ctx) {
    if (!model.isRuntimeInstalled()) {
      return 'Optional dependency @huggingface/transformers is not installed on the service host.'
    }
    const checkpoint = model.checkpointFor(modelKeyOf(ctx))
    if (!model.isModelAvailable(modelKeyOf(ctx))) {
      return `Checkpoint ${checkpoint.label} is not downloaded yet. Install it from the optimizer tab or with \`routerly optimizers model --install ${checkpoint.key}\`.`
    }
    return 'Step is not enabled on this project.'
  },

  // No inference in the sync preview: apply the keep-ratio as a cheap heuristic.
  estimate(ctx) {
    const before = tokensOf(readMessages(ctx.request))
    return {
      estimatedTokensBefore: before,
      estimatedTokensAfter: Math.round(before * ratioOf(ctx)),
    }
  },

  async optimize(ctx) {
    const messages = readMessages(ctx.request)
    originals.set(ctx, messages.slice())
    const before = tokensOf(messages)
    const ratio = ratioOf(ctx)
    const modelKey = modelKeyOf(ctx)

    let changed = false
    const newMessages: Message[] = []
    for (const m of messages) {
      const r = await compressMessage(m, ratio, modelKey)
      if (r.changed) changed = true
      newMessages.push(r.message)
    }

    if (!changed) {
      return { changed: false, estimatedTokensBefore: before, estimatedTokensAfter: before }
    }
    writeMessages(ctx.request, newMessages)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(newMessages) }
  },

  // Output-length acceptance backstop (in addition to the lossy safety gate in
  // core.ts / gate.ts): message count and roles unchanged, no message that had
  // text is emptied, and no message's text grew. Safe pass when nothing was
  // stashed. No inference needed.
  validate(ctx, _result: OptimizerResult) {
    const original = originals.get(ctx)
    if (!original) return true
    const now = readMessages(ctx.request)
    if (now.length !== original.length) return false
    for (let i = 0; i < original.length; i++) {
      if (original[i]!.role !== now[i]!.role) return false
      const before = messageText(original[i]!.content)
      const after = messageText(now[i]!.content)
      if (before.trim() !== '' && after.trim() === '') return false
      if (after.length > before.length) return false
    }
    return true
  },

  // core.ts calls recover() on any validate()===false OR a failed lossy safety
  // gate. ctx.request is already restored to the snapshot by then; this re-writes
  // the stash in place as a defensive backstop. Safe no-op when nothing stashed.
  recover(ctx) {
    const original = originals.get(ctx)
    if (!original) return
    writeMessages(ctx.request, original)
  },
}

/**
 * optimizer-llmlingua2 module. Resolves the registry created by optimizer-core
 * and self-registers the optimizer UNCONDITIONALLY (regardless of model/runtime
 * availability); `supports()` alone decides whether it ever runs.
 */
export const llmlingua2Module: RouterlyModule = defineModule({
  manifest: {
    id: 'optimizer-llmlingua2',
    version: '0.4.0',
    dependsOn: { 'optimizer-core': '^0.4.0' },
  },
  register({ container }) {
    container.resolve(OPTIMIZER_REGISTRY).register(llmlingua2Optimizer)
  },
})
