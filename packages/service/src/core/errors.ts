export class KernelError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'KernelError'
    this.code = code
  }
}

export class ModuleGraphError extends KernelError {
  constructor(message: string) {
    super(message, 'MODULE_GRAPH')
    this.name = 'ModuleGraphError'
  }
}

export class MissingDependencyError extends KernelError {
  constructor(message: string) {
    super(message, 'MISSING_DEPENDENCY')
    this.name = 'MissingDependencyError'
  }
}

export class DependencyCycleError extends KernelError {
  readonly cycle: string[]
  constructor(message: string, cycle: string[]) {
    super(message, 'DEPENDENCY_CYCLE')
    this.name = 'DependencyCycleError'
    this.cycle = cycle
  }
}
