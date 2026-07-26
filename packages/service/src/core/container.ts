import { KernelError, MissingDependencyError } from './errors.js'

export interface Token<T> {
  readonly key: string
  readonly _type?: T
}

export function token<T>(key: string): Token<T> {
  return { key }
}

export class ServiceContainer {
  private readonly services = new Map<string, unknown>()

  register<T>(t: Token<T>, value: T): void {
    if (this.services.has(t.key)) {
      throw new KernelError(`service already registered: ${t.key}`, 'DUPLICATE_SERVICE')
    }
    this.services.set(t.key, value)
  }

  has(t: Token<unknown>): boolean {
    return this.services.has(t.key)
  }

  tryResolve<T>(t: Token<T>): T | undefined {
    return this.services.get(t.key) as T | undefined
  }

  resolve<T>(t: Token<T>): T {
    if (!this.services.has(t.key)) {
      throw new MissingDependencyError(`service not registered: ${t.key}`)
    }
    return this.services.get(t.key) as T
  }
}
