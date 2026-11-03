import { describe, it, expect } from 'vitest'
import { Kernel, defineModule } from './index.js'
import { CONTRIB_MODULES } from './contrib.js'

describe('CONTRIB_MODULES', () => {
  it('is empty (no contrib modules loaded in this phase)', () => {
    expect(CONTRIB_MODULES).toEqual([])
  })

  it('spreading it into a kernel does not change startedOrder', async () => {
    const base = [
      defineModule({ manifest: { id: 'a', version: '1.0.0' }, register() {} }),
      defineModule({ manifest: { id: 'b', version: '1.0.0' }, register() {} }),
    ]
    const k = new Kernel([...base, ...CONTRIB_MODULES])
    await k.start()
    expect(k.startedOrder).toEqual(['a', 'b'])
  })
})
