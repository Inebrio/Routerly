import { defineModule, createRouteRegistry } from '../../core/index.js';
import { API_ROUTES } from '../../core/tokens.js';
import { apiRoutes } from './api.js';

export { apiRoutes };

/**
 * Api module: owns the dashboard REST API plugin (api.ts) and exposes the
 * route-contribution hook behind the API_ROUTES token. apiRoutes resolves the
 * registry via fastify.kernel.container and mounts each contribution as a real
 * Fastify route (see api.ts) — resilienceModule.register() is the first
 * consumer (resilience/routes.ts). apiRoutes itself is still one large
 * hand-written Fastify plugin for its own routes; server.ts still imports
 * apiRoutes directly by path to register it.
 */
export const apiModule = defineModule({
  manifest: { id: 'api', version: '0.4.0' },
  register({ container }) {
    container.register(API_ROUTES, createRouteRegistry());
  },
});
