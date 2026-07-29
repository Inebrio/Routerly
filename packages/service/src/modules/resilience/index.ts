import { defineModule, type RouterlyModule } from '../../core/index.js'
import { RESILIENCE_STORE } from '../../core/tokens.js'
import { InMemoryResilienceStore } from './store.js'

export const resilienceModule: RouterlyModule = defineModule({
  manifest: { id: 'resilience', version: '0.4.0' },
  register({ container }) {
    container.register(RESILIENCE_STORE, new InMemoryResilienceStore())
  },
})
