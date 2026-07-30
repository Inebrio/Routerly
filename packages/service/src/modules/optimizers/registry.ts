import type {
  OptimizerClass,
  OptimizerEstimate,
  OptimizerId,
  OptimizerResult,
} from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'

/**
 * Runtime contract of a single optimizer. Lives in the service (not shared)
 * because it references ProxyContext. All mutations an optimizer makes in
 * `optimize`/`recover` MUST be in-place on `ctx.request`'s fields (e.g.
 * `ctx.request.messages = ...`) — never reassign `ctx.request` wholesale, or
 * the Anthropic lane (which reads `ctx.original`, the same object) stops
 * seeing the change. See core.ts for the full rationale.
 */
export interface Optimizer {
  id: OptimizerId
  klass: OptimizerClass
  supports(ctx: ProxyContext): boolean
  estimate(ctx: ProxyContext): OptimizerEstimate
  // May be async: ONNX-backed optimizers (llmlingua-2) run Promise-based
  // inference. core.ts awaits the result; synchronous optimizers just return a
  // plain OptimizerResult (await on a non-Promise resolves immediately).
  optimize(ctx: ProxyContext): OptimizerResult | Promise<OptimizerResult>
  validate(ctx: ProxyContext, result: OptimizerResult): boolean
  recover?(ctx: ProxyContext, result: OptimizerResult): void
}

/** In-memory registry of installed optimizers, keyed by stable id. */
export class OptimizerRegistry {
  private readonly byId = new Map<OptimizerId, Optimizer>()

  register(o: Optimizer): void {
    if (this.byId.has(o.id)) {
      throw new Error(`optimizer already registered: ${o.id}`)
    }
    this.byId.set(o.id, o)
  }

  get(id: OptimizerId): Optimizer | undefined {
    return this.byId.get(id)
  }

  list(): Optimizer[] {
    return [...this.byId.values()]
  }
}
