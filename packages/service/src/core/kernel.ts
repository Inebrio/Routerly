import { ServiceContainer } from './container.js'
import { EventBus } from './events.js'
import { topologicalSort, type GraphNode } from './graph.js'
import { KernelError, ModuleGraphError } from './errors.js'
import type { RouterlyModule } from './module.js'

export class Kernel {
  readonly container = new ServiceContainer()
  readonly events = new EventBus()
  private readonly modules: readonly RouterlyModule[]
  private started: string[] = []

  constructor(modules: readonly RouterlyModule[]) {
    this.modules = modules
  }

  get startedOrder(): readonly string[] {
    return this.started
  }

  async start(): Promise<void> {
    const byId = new Map<string, RouterlyModule>()
    for (const mod of this.modules) {
      if (byId.has(mod.manifest.id)) {
        throw new ModuleGraphError(`duplicate module id: ${mod.manifest.id}`)
      }
      byId.set(mod.manifest.id, mod)
    }

    // topologicalSort validates that every dependsOn/before/after reference
    // resolves within the node set, throwing MissingDependencyError otherwise.
    const nodes: GraphNode[] = this.modules.map((m) => ({
      id: m.manifest.id,
      dependsOn: Object.keys(m.manifest.dependsOn ?? {}),
      before: m.manifest.before ?? [],
      after: m.manifest.after ?? [],
      weight: m.manifest.weight ?? 0,
    }))

    const order = topologicalSort(nodes)
    const ordered: RouterlyModule[] = []
    for (const id of order) {
      const mod = byId.get(id)
      if (!mod) {
        // Unreachable: `order` is topologicalSort's output over the exact
        // same ids present in `byId`. A miss here means the module set and
        // the graph diverged, which is a real bug, not a normal runtime path.
        throw new KernelError(`resolved module not found: ${id}`, 'MODULE_NOT_FOUND')
      }
      ordered.push(mod)
    }

    for (const mod of ordered) {
      await mod.register({ container: this.container, events: this.events })
    }
    for (const mod of ordered) {
      await mod.start?.({ container: this.container, events: this.events })
      this.started.push(mod.manifest.id)
    }
  }

  async stop(): Promise<void> {
    const byId = new Map(this.modules.map((m) => [m.manifest.id, m]))
    for (const id of [...this.started].reverse()) {
      const mod = byId.get(id)
      if (!mod) {
        // Unreachable: ids in `this.started` were pushed in start() only
        // after resolving through `byId`, built from the same `this.modules`.
        // If it ever happens, skip rather than throw: stop() is a best-effort
        // cleanup pass and one inconsistent id must not abort stopping the rest.
        continue
      }
      try {
        await mod.stop?.()
      } catch {
        // stop is best-effort; a failing module must not block the rest
      }
    }
    this.started = []
  }
}
