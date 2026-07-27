import { defineModule } from '../../core/index.js';
import { OBSERVABILITY } from '../../core/tokens.js';
import { getMetricsSnapshot } from './metrics-snapshot.js';
import { startIntegrationRunner } from './runner.js';
import { metricsRoutes } from './metrics.js';

/**
 * Observability module: owns the real integrations implementation
 * (metrics-snapshot.ts, runner.ts, metrics.ts, datadog/otel/influxdb/grafana/
 * webhook push functions) and exposes it behind the OBSERVABILITY DI token.
 * Other files still import these files directly by path; this module
 * additionally makes it reachable through the container.
 */
export const observabilityModule = defineModule({
  manifest: { id: 'observability', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(OBSERVABILITY, {
      getMetricsSnapshot,
      startIntegrationRunner,
      metricsRoutes,
    });
  },
});
