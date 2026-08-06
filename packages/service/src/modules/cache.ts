import { defineModule, type RouterlyModule } from '../core/index.js'

// ponytail: no response cache exists in the codebase (only the intent-classifier and catalog
// fetch caches, neither of which short-circuits a request). This module is a pure predisposition:
// it holds the capability slot in the module map. Add a `cache.lookup` processor on
// request.preprocess (weight -100, shortCircuit on hit) only when a real response cache lands.
export const cacheModule: RouterlyModule = defineModule({
  manifest: { id: 'cache', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register() {
    // intentionally empty
  },
})
