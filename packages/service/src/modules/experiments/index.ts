import { defineModule, type Processor } from '../../core/index.js';
import { PROXY_PIPELINE } from '../../core/tokens.js';
import type { ProxyContext } from '../reverse-proxy/context.js';
import { judgeExperimentCall } from './judge.js';

export { resolveExperimentByToken, resolveExperimentRequest } from './resolve.js';
export type { ExperimentResolution } from './resolve.js';
export { pickVariant, stickyKeyFor, conversationPrefix, resetRotationState } from './rotation.js';
export type { RotationInput } from './rotation.js';
export { computeExperimentMetrics } from './metrics.js';
export { judgeExperimentCall } from './judge.js';

/**
 * Experiments module (T71, T72). It owns experiments.json, the rotation state,
 * the token resolution that lets a client call a test instead of a project, and
 * the optional judge that scores the answers each variant produced.
 *
 * Token resolution needs no register() work: the auth preHandler calls resolve.ts
 * directly (the same way it calls the profiles store), and the management routes
 * live in the api module. Declaring the module is what makes the generic
 * `/api/modules` endpoint, the dashboard Modules page and `routerly modules`
 * able to turn the whole capability off.
 */
export const experimentsModule = defineModule({
  manifest: { id: 'experiments', version: '0.4.0', dependsOn: { config: '^0.4.0', 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    // finalize: the response has already left through egress, so scoring it here
    // costs the client nothing. judgeExperimentCall returns immediately unless an
    // experiment routed the call and its judge is on.
    const judge: Processor<ProxyContext> = {
      id: 'experiments.judge',
      phase: 'finalize',
      async run(ctx) {
        await judgeExperimentCall(ctx).catch(err => ctx.log?.warn({ err }, 'experiment judge failed'));
      },
    };

    container.resolve(PROXY_PIPELINE).contribute(judge);
  },
});
