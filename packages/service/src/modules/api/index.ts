import { defineModule, createRouteRegistry } from '../../core/index.js';
import { API_ROUTES } from '../../core/tokens.js';
import { apiRoutes } from './api.js';

export { apiRoutes };

/**
 * Api module: owns the dashboard REST API plugin (api.ts) and exposes the
 * route-contribution hook behind the API_ROUTES token. The registry starts
 * empty - no in-tree or contrib module contributes routes through it yet;
 * apiRoutes itself is still one large hand-written Fastify plugin. server.ts
 * still imports apiRoutes directly by path to register it; this module
 * additionally makes the contribution point reachable through the container
 * for future modules that want to add REST routes without editing api.ts.
 */
export const apiModule = defineModule({
  manifest: { id: 'api', version: '0.4.0' },
  register({ container }) {
    container.register(API_ROUTES, createRouteRegistry());
  },
});
