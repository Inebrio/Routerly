import { describe, it, expect } from 'vitest'
import { buildKernel } from './bootstrap.js'
import { defineModule } from '../index.js'

describe('buildKernel', () => {
  it('assembles and starts the given modules', async () => {
    const started: string[] = []
    const probe = defineModule({
      manifest: { id: 'probe', version: '0.4.0' },
      register() {},
      start() {
        started.push('probe')
      },
    })

    const kernel = await buildKernel([probe])

    expect(started).toEqual(['probe'])
    expect(kernel.startedOrder).toEqual(['probe'])

    await kernel.stop()
  })
})
