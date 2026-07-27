import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import authPlugin from './modules/auth/auth.js';
import { loadSecret } from './modules/auth/jwt.js';
import { openaiRoutes } from './routes/openai.js';
import { anthropicRoutes } from './routes/anthropic.js';
import { apiRoutes } from './routes/api.js';
import { metricsRoutes } from './routes/metrics.js';
import { initConfigDirs, readConfig, writeConfig, pruneOrphanUsage } from './modules/config/loader.js';
import { migrateProjectConfigs } from './modules/config/migrate.js';
import { pingTelemetry } from './telemetry.js';
import { updateChecker } from './update-checker.js';
import { startIntegrationRunner } from './modules/observability/runner.js';
import { buildKernel } from './core/lifecycle/bootstrap.js';
import { configModule } from './modules/config/index.js';
import { providerModule } from './modules/provider/index.js';
import { catalogModule } from './modules/catalog/index.js';
import { reverseProxyModule } from './modules/reverse-proxy/index.js';
import { coreModules } from './modules/index.js';
import { CONTRIB_MODULES } from './core/contrib.js';
import type { Kernel } from './core/index.js';

// The modular kernel (0.4.0) is decorated onto the Fastify instance so later
// refactory plans can reach its container/events. Routes still call
// config/loader.ts directly; nothing depends on this decoration yet.
declare module 'fastify' {
  interface FastifyInstance {
    kernel: Kernel;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version: pkgVersion } = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };

export async function buildServer() {
  const settings = await readConfig('settings');

  const fastify = Fastify({
    logger: {
      level: settings.logLevel,
      ...(process.env['NODE_ENV'] !== 'production'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    disableRequestLogging: true,
    bodyLimit: 256 * 1024 * 1024, // 256 MB — support large files, vision, and 2M-token contexts
  });

  // ─── Modular kernel (0.4.0) ───────────────────────────────────────────────
  // Boots alongside Fastify; registers the config, provider, and catalog modules
  // so modules/config/loader.ts, modules/provider/registry.ts, and
  // modules/catalog/fetcher.ts+sync.ts are reachable via CONFIG_STORE,
  // PROVIDER_REGISTRY, and CATALOG for later plans. loadSecret()/
  // initConfigDirs() already ran in startServer() before buildServer(); none
  // of the three modules does IO at register time, so this is order-safe.
  // Additive only, no existing registration is touched.
  const kernel = await buildKernel([
    configModule,       // Plan 2
    providerModule,     // Plan 3  (manifest id 'provider')
    catalogModule,      // Step 5 (manifest id 'catalog')
    reverseProxyModule, // Plan 4  (owns PROXY_PIPELINE, transport-only, dark)
    ...coreModules,     // Plan 5  (concern processors)
    ...CONTRIB_MODULES, // Plan 6  (inert extension point, empty this phase)
  ]);
  fastify.decorate('kernel', kernel);
  fastify.addHook('onClose', async () => {
    await kernel.stop();
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

  // ─── Prometheus metrics (#93, public — in auth skip list) ─────────────────
  await fastify.register(metricsRoutes);

  // ─── Health check ─────────────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: pkgVersion,
    timestamp: new Date().toISOString(),
  }));

  return fastify;
}

export async function startServer() {
  await initConfigDirs();
  await loadSecret();
  const orphansRemoved = await pruneOrphanUsage();
  if (orphansRemoved > 0) {
    // eslint-disable-next-line no-console
    console.log(`[startup] pruned ${orphansRemoved} orphan usage record(s) (no matching project)`);
  }
  const migrated = await migrateProjectConfigs();
  if (migrated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[startup] migrated ${migrated} project(s) to new guardrails/PII config shape`);
  }
  const settings = await readConfig('settings');

  if (settings.telemetry?.enabled === true) {
    const { installId, lastPingedVersion } = settings.telemetry;
    const event: 'install' | 'upgrade' | null =
      !lastPingedVersion ? 'install' :
      lastPingedVersion !== pkgVersion ? 'upgrade' :
      null;

    if (event !== null) {
      const ok = await pingTelemetry(installId, event);
      if (ok) {
        await writeConfig('settings', {
          ...settings,
          telemetry: { ...settings.telemetry, lastPingedVersion: pkgVersion },
        });
      }
    }
  }

  const server = await buildServer();

  try {
    await server.listen({ port: settings.port, host: settings.host });
    updateChecker.start(pkgVersion, settings.channel ?? 'latest');
    startIntegrationRunner();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
