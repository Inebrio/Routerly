import type { ResilienceStore } from '@routerly/shared'
import { defineModule, type RouterlyModule } from '../../core/index.js'
import { RESILIENCE_STORE, API_ROUTES } from '../../core/tokens.js'
import { InMemoryResilienceStore } from './store.js'
import { getResilienceHandler, resetResilienceHandler } from './routes.js'

export const resilienceModule: RouterlyModule = defineModule({
  manifest: { id: 'resilience', version: '0.4.0', dependsOn: { api: '^0.4.0' } },
  register({ container }) {
    const store = new InMemoryResilienceStore()
    container.register(RESILIENCE_STORE, store)
    setResilienceStore(store)

    // container.resolve, not tryResolve: dependsOn: { api } above guarantees apiModule (which
    // creates the registry) has already registered by the time this runs, so a missing
    // registry here is a real bug worth throwing on.
    const routes = container.resolve(API_ROUTES)
    routes.contribute({ id: 'resilience.read', value: { method: 'GET', url: '/api/resilience', handler: getResilienceHandler } })
    routes.contribute({ id: 'resilience.reset', value: { method: 'POST', url: '/api/resilience/reset', handler: resetResilienceHandler } })
  },
})

// The executor (execute.ts) and lane processors (lanes/openai.ts, lanes/anthropic.ts) are plain
// module-scope functions / static processor arrays, not register()-time closures — they cannot
// see a container-resolved value, and the kernel's real registration order is a topological sort
// that does NOT guarantee `resilience` registers before them. This module-level singleton lets
// those call sites reach the store lazily, at request time (after Kernel.start() has run every
// module's register()), regardless of registration order. Mirrors reverse-proxy/run.ts's
// setProxyPipeline/getProxyPipeline. Unlike getProxyPipeline, this does NOT throw when unset:
// dozens of pre-existing execute.test.ts/lane tests construct LLMCallContext/ProxyContext
// directly without bootstrapping the resilience module, and must keep passing unmodified with
// resilience tracking as a no-op.
let current: ResilienceStore | undefined

export function setResilienceStore(store: ResilienceStore): void {
  current = store
}

export function getResilienceStore(): ResilienceStore | undefined {
  return current
}
