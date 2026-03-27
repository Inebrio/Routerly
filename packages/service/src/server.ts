import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import authPlugin from './plugins/auth.js';
import { loadSecret } from './plugins/jwt.js';
import { openaiRoutes } from './routes/openai.js';
import { anthropicRoutes } from './routes/anthropic.js';
import { apiRoutes } from './routes/api.js';
import { initConfigDirs, readConfig } from './config/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const settings = await readConfig('settings');

  const fastify = Fastify({
    logger: {
      level: settings.logLevel,
      ...(process.env['NODE_ENV'] !== 'production'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  });

  // ─── Plugins ─────────────────────────────────────────────────────────────────
  await fastify.register(cors, { origin: true, exposedHeaders: ['x-routerly-trace-id'] });

  // ─── Dashboard static files (served before auth plugin) ───────────────────
  if (settings.dashboardEnabled) {
    const dashboardDist = join(__dirname, '../../dashboard/dist');
    try {
      // Encapsulated plugin: static files + SPA fallback scoped to /dashboard
      await fastify.register(async function dashboardPlugin(scope) {
        await scope.register(staticFiles, {
          root: dashboardDist,
          prefix: '/',
        });
        // SPA fallback: any /dashboard/* path that isn't a static file serves index.html
        scope.setNotFoundHandler(async (_req, reply) => {
          return reply.sendFile('index.html', dashboardDist);
        });
      }, { prefix: '/dashboard' });

      // Redirect /dashboard → /dashboard/
      fastify.get('/dashboard', async (_req, reply) => {
        return reply.redirect('/dashboard/');
      });
    } catch {
      fastify.log.warn('Dashboard dist not found — run `npm run build` in packages/dashboard first');
    }
  }

  // ─── Dashboard REST API (auth handled inside the plugin) ─────────────────
  await fastify.register(apiRoutes);

  // ─── LLM Proxy auth (only for /v1/* routes) ───────────────────────────────
  await fastify.register(authPlugin);

  // ─── LLM Proxy routes ────────────────────────────────────────────────────
  await fastify.register(openaiRoutes);
  await fastify.register(anthropicRoutes);

  // ─── Root redirect ────────────────────────────────────────────────────────
  fastify.get('/', async (_req, reply) => {
    return reply.redirect('/dashboard/');
  });

  // ─── Health check ─────────────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.0.1',
    timestamp: new Date().toISOString(),
  }));

  return fastify;
}

export async function startServer() {
  await initConfigDirs();
  await loadSecret();
  const settings = await readConfig('settings');
  const server = await buildServer();

  try {
    await server.listen({ port: settings.port, host: settings.host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
