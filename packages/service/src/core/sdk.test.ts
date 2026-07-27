import { describe, it, expect } from 'vitest'
import * as sdk from './sdk.js'

describe('module SDK barrel', () => {
  it('re-exports every runtime authoring symbol', () => {
    for (const name of [
      'defineModule',
      'ProcessorRegistry',
      'token',
      'EventBus',
      'ServiceContainer',
      'shortCircuit',
      'isShortCircuit',
      'KernelError',
      'ModuleGraphError',
      'MissingDependencyError',
      'DependencyCycleError',
    ] as const) {
      expect(sdk[name], name).toBeDefined()
    }
  })

  it('exposes a working authoring surface (defineModule + token round-trip)', () => {
    const mod = sdk.defineModule({
      manifest: { id: 'sample', version: '0.4.0' },
      register({ container }) {
        container.register(sdk.token<number>('sample.value'), 42)
      },
    })
    expect(mod.manifest.id).toBe('sample')
    const c = new sdk.ServiceContainer()
    void mod.register({ container: c, events: new sdk.EventBus() })
    expect(c.resolve(sdk.token<number>('sample.value'))).toBe(42)
  })
})
