import { DependencyCycleError, MissingDependencyError } from './errors.js'

export interface GraphNode {
  readonly id: string
  readonly dependsOn?: readonly string[]
  readonly before?: readonly string[]
  readonly after?: readonly string[]
  readonly weight?: number
}

/**
 * Kahn's algorithm with a weight-aware ready-set.
 *
 * Edge direction: `dependsOn` and `after` on node N mean "N runs after those
 * ids" (an edge from the referenced id into N). `before` on node N means
 * "N runs before those ids" (an edge from N into the referenced id).
 *
 * Among nodes with no remaining incoming constraints, the ready-set picks
 * lower `weight` first (default 0), then original insertion order.
 */
export function topologicalSort(nodes: readonly GraphNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id))
  const index = new Map<string, number>()
  const weight = new Map<string, number>()
  nodes.forEach((n, i) => {
    index.set(n.id, i)
    weight.set(n.id, n.weight ?? 0)
  })

  // outgoing.get(from) = set of ids that must run after `from`
  const outgoing = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  for (const id of ids) {
    outgoing.set(id, new Set())
    indegree.set(id, 0)
  }

  const requireKnown = (owner: string, ref: string): void => {
    if (!ids.has(ref)) {
      throw new MissingDependencyError(`node "${owner}" references unknown node "${ref}"`)
    }
  }

  const addEdge = (from: string, to: string): void => {
    const outs = outgoing.get(from)
    if (outs === undefined) return
    if (!outs.has(to)) {
      outs.add(to)
      indegree.set(to, (indegree.get(to) ?? 0) + 1)
    }
  }

  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      requireKnown(n.id, dep)
      addEdge(dep, n.id)
    }
    for (const a of n.after ?? []) {
      requireKnown(n.id, a)
      addEdge(a, n.id)
    }
    for (const b of n.before ?? []) {
      requireKnown(n.id, b)
      addEdge(n.id, b)
    }
  }

  const readyBetter = (a: string, b: string): number => {
    const wa = weight.get(a) ?? 0
    const wb = weight.get(b) ?? 0
    if (wa !== wb) return wa - wb
    return (index.get(a) ?? 0) - (index.get(b) ?? 0)
  }

  const ready: string[] = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0)
  const order: string[] = []
  while (ready.length > 0) {
    ready.sort(readyBetter)
    const next = ready.shift()
    if (next === undefined) break
    order.push(next)
    for (const to of outgoing.get(next) ?? []) {
      const d = (indegree.get(to) ?? 0) - 1
      indegree.set(to, d)
      if (d === 0) ready.push(to)
    }
  }

  if (order.length !== ids.size) {
    const resolved = new Set(order)
    const remaining = [...ids].filter((id) => !resolved.has(id))
    const cycle = findCycle(remaining, outgoing)
    throw new DependencyCycleError(`dependency cycle detected: ${cycle.join(' -> ')}`, cycle)
  }
  return order
}

/**
 * DFS over the unresolved subgraph to extract one concrete cycle path,
 * e.g. ['a', 'b', 'a']. `remaining` is guaranteed non-empty and every node
 * in it has at least one unresolved incoming edge, so a cycle must exist.
 */
function findCycle(remaining: string[], outgoing: Map<string, Set<string>>): string[] {
  const remainingSet = new Set(remaining)
  const visiting = new Set<string>()
  const path: string[] = []

  const visit = (id: string): string[] | undefined => {
    const cycleStart = path.indexOf(id)
    if (cycleStart !== -1) {
      return [...path.slice(cycleStart), id]
    }
    if (visiting.has(id)) return undefined
    visiting.add(id)
    path.push(id)
    for (const next of outgoing.get(id) ?? []) {
      if (!remainingSet.has(next)) continue
      const found = visit(next)
      if (found !== undefined) return found
    }
    path.pop()
    return undefined
  }

  for (const id of remaining) {
    const found = visit(id)
    if (found !== undefined) return found
  }
  // Should be unreachable: `remaining` only contains nodes with unresolved
  // constraints among themselves, so a cycle always exists.
  return remaining
}
