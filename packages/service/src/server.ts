import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import authPlugin from './modules/auth/auth.js';
import { loadSecret } from './modules/auth/jwt.js';
import { loadCredentialKey } from './lib/crypto-cred.js';
import { openaiRoutes } from './modules/api-reverse-proxy/openai.js';
import { anthropicRoutes } from './modules/api-reverse-proxy/anthropic.js';
import { mcpHttpRoutes } from './modules/mcp/http.js';
import { apiRoutes } from './modules/api/api.js';
import { metricsRoutes } from './modules/observability/metrics.js';
import { initConfigDirs, readConfig, writeConfig, pruneOrphanUsage } from './modules/config/loader.js';
import { migrateRouterStorage } from './modules/config/migrate.js';
import { pingTelemetry } from './modules/telemetry/telemetry.js';
import { updateChecker } from './modules/update-checker/update-checker.js';
import { bootstrap } from './bootstrap/index.js';
import type { Kernel } from './core/index.js';

// The modular kernel (0.4.0) is decorated onto the Fastify instance so later
// refactory plans can reach its container/events. Routes still call
// config/loader.ts directly, but apiRoutes (modules/api/api.ts) reads
// fastify.kernel to mount route contributions from API_ROUTES.
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
  const kernel = await bootstrap();
  fastify.decorate('kernel', kernel);
  fastify.addHook('onClose', async () => {
    await kernel.stop();
  });

  // ─── Plugins ─────────────────────────────────────────────────────────────────
  await fastify.register(cors, { origin: true });

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

  // ─── MCP Streamable HTTP endpoint (self-authenticating, in auth skip list) ──
  await fastify.register(mcpHttpRoutes);

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

  // Runs here, before anything else touches CONFIG_PATHS.routers, and
  // deliberately NOT inside configModule.migrate() (which the kernel wraps in
  // a best-effort try/catch that logs and continues for every other
  // migration). On malformed projects.json this throws (EC3) and that throw
  // must propagate out of startServer() to stop the boot — a service that
  // silently starts with an empty routers.json also permanently defeats this
  // migration's own idempotency check ("routers.json already exists = already
  // migrated") on every future restart, even once the operator fixes the
  // file. See validator report .claude/specs/0.4.1/03-validation/RTR-01.md,
  // iteration 2, finding B2.
  const storageMigrated = await migrateRouterStorage();
  if (storageMigrated !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[startup] migrated ${storageMigrated} router(s) from projects.json to routers.json`);
  }

  await loadSecret();
  await loadCredentialKey();
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

  // migrateRouterStorage() already ran above, before anything could touch
  // CONFIG_PATHS.routers. pruneOrphanUsage() (called below) reads
  // 'routers' too, and readConfig auto-creates an empty routers.json on
  // first touch — if that ran before migrateRouterStorage(), the migration's
  // own idempotency check ("does routers.json already exist?") would see
  // that accidental empty file and skip the real migration, silently
  // dropping every pre-existing router (and every not-yet-renamed usage
  // record, which pruneOrphanUsage would then read as an orphan and
  // delete). Keeping pruneOrphanUsage() after buildServer() (and therefore
  // after the migration above) preserves that ordering.
  const server = await buildServer();

  const orphansRemoved = await pruneOrphanUsage();
  if (orphansRemoved > 0) {
    // eslint-disable-next-line no-console
    console.log(`[startup] pruned ${orphansRemoved} orphan usage record(s) (no matching router)`);
  }

  try {
    await server.listen({ port: settings.port, host: settings.host });
    // The 60s integration push is started by the observability module (kernel start).
    if (process.env['ROUTERLY_DISABLE_UPDATE_CHECK'] !== 'true') {
      updateChecker.start(pkgVersion, settings.channel ?? 'latest');
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
