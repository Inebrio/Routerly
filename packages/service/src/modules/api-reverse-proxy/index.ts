import { defineModule } from '../../core/index.js';
import { API_REVERSE_PROXY } from '../../core/tokens.js';
import { openaiRoutes } from './openai.js';
import { anthropicRoutes } from './anthropic.js';
import { passthroughHandler } from './passthrough.js';

/**
 * Api-reverse-proxy module: owns the real HTTP-facing OpenAI/Anthropic
 * route plugins and the pass-through handler, exposed behind the
 * API_REVERSE_PROXY DI token. server.ts still imports openaiRoutes/
 * anthropicRoutes directly by path to register them as Fastify plugins;
 * this module additionally makes them reachable through the container.
 */
export const apiReverseProxyModule = defineModule({
  manifest: { id: 'api-reverse-proxy', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    container.register(API_REVERSE_PROXY, {
      openaiRoutes,
      anthropicRoutes,
      passthroughHandler,
    });
  },
});
