import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { MCP_TOOLS } from '../../core/tokens.js'
import { mcpModule } from './index.js'

function runtime() {
  return { container: new ServiceContainer(), events: new EventBus() }
}

describe('mcp module', () => {
  it('has the frozen manifest', () => {
    expect(mcpModule.manifest.id).toBe('mcp')
    expect(mcpModule.manifest.version).toBe('0.4.0')
  })

  it('register() binds an empty MCP_TOOLS registry into the container', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    const registry = rt.container.resolve(MCP_TOOLS)
    expect(registry.ordered()).toEqual([])
  })

  it('start() on a container with no service tokens contributes no built-in tools', async () => {
    const rt = runtime()
    await mcpModule.register(rt)
    await mcpModule.start?.(rt)
    expect(rt.container.resolve(MCP_TOOLS).ordered()).toEqual([])
  })
})
