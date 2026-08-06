import { defineModule } from '../../core/index.js';
import { AUTH } from '../../core/tokens.js';
import { signToken, verifyToken, createSessionToken, generateRawToken } from './jwt.js';
import { extractRouterToken, resolveRouterByToken } from './auth.js';
import { getEffectiveRoles } from './roles.js';

/**
 * Auth module: owns the real auth implementation (jwt.ts, auth.ts, roles.ts)
 * and exposes it behind the AUTH DI token. The Fastify `authPlugin` default
 * export from auth.ts is registered directly in server.ts, not through this
 * token; other files still import jwt.ts/auth.ts/roles.ts directly by path.
 */
export const authModule = defineModule({
  manifest: { id: 'auth', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(AUTH, {
      signToken,
      verifyToken,
      createSessionToken,
      generateRawToken,
      extractRouterToken,
      resolveRouterByToken,
      getEffectiveRoles,
    });
  },
});
