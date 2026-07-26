import { topologicalSort, type GraphNode } from './graph.js'
import { KernelError } from './errors.js'

export interface Processor<C> {
  id: string
  phase: string
  before?: string[]
  after?: string[]
  weight?: number
  run(context: C): void | Promise<void>
}

export class ProcessorRegistry<C> {
  private readonly byPhase = new Map<string, Processor<C>[]>()

  contribute(p: Processor<C>): void {
    const list = this.byPhase.get(p.phase) ?? []
    list.push(p)
    this.byPhase.set(p.phase, list)
  }

  orderedFor(phase: string): Processor<C>[] {
    const list = this.byPhase.get(phase) ?? []
    const ids = new Set(list.map((p) => p.id))
    // Cross-phase before/after references are silently ignored: they refer
    // to processors outside this phase's node set, so they cannot express a
    // real ordering constraint here.
    const scoped = (refs: string[] | undefined): string[] =>
      (refs ?? []).filter((r) => ids.has(r))
    const nodes: GraphNode[] = list.map((p) => ({
      id: p.id,
      before: scoped(p.before),
      after: scoped(p.after),
      weight: p.weight ?? 0,
    }))
    const order = topologicalSort(nodes)
    const index = new Map(list.map((p) => [p.id, p]))
    return order.map((id) => {
      const found = index.get(id)
      if (!found) {
        // Unreachable: `order` is topologicalSort's output over the exact
        // same ids present in `list`/`index`. A miss here means the node set
        // and the graph diverged, which is a real bug, not a normal path.
        throw new KernelError(`resolved processor not found: ${id}`, 'PROCESSOR_NOT_FOUND')
      }
      return found
    })
  }

  async runPhase(phase: string, context: C): Promise<void> {
    for (const p of this.orderedFor(phase)) {
      await p.run(context)
    }
  }
}
