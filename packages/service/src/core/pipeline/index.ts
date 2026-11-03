import { AlterableRegistry } from '../hooks/registry.js'
import { isShortCircuit, type ShortCircuit } from '../result.js'

export interface Processor<C> {
  id: string
  phase: string
  before?: string[]
  after?: string[]
  weight?: number
  run(context: C): void | Promise<void> | ShortCircuit | Promise<ShortCircuit | void>
}

export class ProcessorRegistry<C> {
  private readonly byPhase = new Map<string, AlterableRegistry<Processor<C>>>()

  private registryFor(phase: string): AlterableRegistry<Processor<C>> {
    let reg = this.byPhase.get(phase)
    if (!reg) {
      reg = new AlterableRegistry<Processor<C>>()
      this.byPhase.set(phase, reg)
    }
    return reg
  }

  contribute(p: Processor<C>): void {
    this.registryFor(p.phase).contribute({
      id: p.id,
      ...(p.before !== undefined ? { before: p.before } : {}),
      ...(p.after !== undefined ? { after: p.after } : {}),
      ...(p.weight !== undefined ? { weight: p.weight } : {}),
      value: p,
    })
  }

  override(phase: string, id: string, alter: (previous: Processor<C>) => Processor<C>): void {
    this.registryFor(phase).override(id, alter)
  }

  orderedFor(phase: string): Processor<C>[] {
    return this.byPhase.get(phase)?.ordered() ?? []
  }

  async runPhase(phase: string, context: C): Promise<void> {
    for (const p of this.orderedFor(phase)) {
      const outcome = await p.run(context)
      if (isShortCircuit(outcome)) return
    }
  }
}
