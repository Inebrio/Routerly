import { describe, it, expect } from 'vitest'
import { optimizerModules } from './index.js'
import { optimizerCoreModule } from './core.js'

describe('optimizerModules', () => {
  it('includes the optimizer-core module', () => {
    expect(optimizerModules).toContain(optimizerCoreModule)
    expect(optimizerModules.map((m) => m.manifest.id)).toContain('optimizer-core')
  })
})
