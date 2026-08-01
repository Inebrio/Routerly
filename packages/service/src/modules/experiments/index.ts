import { defineModule } from '../../core/index.js';

export { resolveExperimentByToken, resolveExperimentRequest } from './resolve.js';
export type { ExperimentResolution } from './resolve.js';
export { pickVariant, stickyKeyFor, conversationPrefix, resetRotationState } from './rotation.js';
export type { RotationInput } from './rotation.js';

/**
 * Experiments module (T71). It owns experiments.json, the rotation state and
 * the token resolution that lets a client call a test instead of a project.
 *
 * There is no register() work: the auth preHandler calls resolve.ts directly
 * (the same way it calls the profiles store), and the management routes live in
 * the api module. Declaring the module is what makes the generic
 * `/api/modules` endpoint, the dashboard Modules page and `routerly modules`
 * able to turn the whole capability off.
 */
export const experimentsModule = defineModule({
  manifest: { id: 'experiments', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register() {
    // intentionally empty: see the note above
  },
});
