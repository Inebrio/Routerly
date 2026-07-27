import { topologicalSort, type GraphNode } from '../graph.js'
import { KernelError, MissingDependencyError } from '../errors.js'

export interface Contribution<T> {
  id: string
  before?: string[]
  after?: string[]
  weight?: number
  value: T
}

export class AlterableRegistry<T> {
  private readonly items = new Map<string, Contribution<T>>()
  private readonly order: string[] = []

  contribute(c: Contribution<T>): void {
    if (this.items.has(c.id)) {
      throw new KernelError(`contribution already exists: ${c.id}`, 'DUPLICATE_CONTRIBUTION')
    }
    this.items.set(c.id, c)
    this.order.push(c.id)
  }

  override(id: string, alter: (previous: T) => T): void {
    const existing = this.items.get(id)
    if (!existing) {
      throw new MissingDependencyError(`no contribution registered: ${id}`)
    }
    this.items.set(id, { ...existing, value: alter(existing.value) })
  }

  ordered(): T[] {
    const ids = new Set(this.items.keys())
    const scoped = (refs: string[] | undefined): string[] => (refs ?? []).filter((r) => ids.has(r))
    const nodes: GraphNode[] = this.order.map((id) => {
      const c = this.items.get(id)
      if (!c) {
        throw new KernelError(`resolved contribution not found: ${id}`, 'CONTRIBUTION_NOT_FOUND')
      }
      return { id, before: scoped(c.before), after: scoped(c.after), weight: c.weight ?? 0 }
    })
    return topologicalSort(nodes).map((id) => {
      const c = this.items.get(id)
      if (!c) {
        throw new KernelError(`resolved contribution not found: ${id}`, 'CONTRIBUTION_NOT_FOUND')
      }
      return c.value
    })
  }
}
