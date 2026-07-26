import { describe, it, expect } from 'vitest'
import { Kernel } from './kernel.js'
import { defineModule } from './module.js'
import { ModuleGraphError, MissingDependencyError } from './errors.js'

const trace = (log: string[], id: string) =>
  defineModule({
    manifest: { id, version: '1.0.0' },
    register() {
      log.push(`register:${id}`)
    },
    start() {
      log.push(`start:${id}`)
    },
    stop() {
      log.push(`stop:${id}`)
    },
  })

describe('Kernel', () => {
  it('registers then starts modules in dependency order', async () => {
    const log: string[] = []
    const a = trace(log, 'a')
    const b = defineModule({
      manifest: { id: 'b', version: '1.0.0', dependsOn: { a: '^1.0.0' } },
      register() {
        log.push('register:b')
      },
      start() {
        log.push('start:b')
      },
    })
    const k = new Kernel([b, a])
    await k.start()
    expect(k.startedOrder).toEqual(['a', 'b'])
    expect(log).toEqual(['register:a', 'register:b', 'start:a', 'start:b'])
  })

  it('stops modules in reverse start order', async () => {
    const log: string[] = []
    const k = new Kernel([trace(log, 'a'), trace(log, 'b')])
    await k.start()
    log.length = 0
    await k.stop()
    expect(log).toEqual(['stop:b', 'stop:a'])
  })

  it('rejects duplicate module ids', async () => {
    const k = new Kernel([
      defineModule({ manifest: { id: 'dup', version: '1.0.0' }, register() {} }),
      defineModule({ manifest: { id: 'dup', version: '2.0.0' }, register() {} }),
    ])
    await expect(k.start()).rejects.toThrow(ModuleGraphError)
  })

  it('rejects a missing declared dependency', async () => {
    const k = new Kernel([
      defineModule({
        manifest: { id: 'x', version: '1.0.0', dependsOn: { ghost: '^1.0.0' } },
        register() {},
      }),
    ])
    await expect(k.start()).rejects.toThrow(MissingDependencyError)
  })

  it('continues stopping when a stop handler throws', async () => {
    const log: string[] = []
    const boom = defineModule({
      manifest: { id: 'boom', version: '1.0.0' },
      register() {},
      stop() {
        throw new Error('nope')
      },
    })
    const k = new Kernel([trace(log, 'a'), boom])
    await k.start()
    log.length = 0
    await k.stop()
    expect(log).toEqual(['stop:a'])
  })
})
