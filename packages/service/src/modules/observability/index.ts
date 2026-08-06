import { defineModule } from '../../core/index.js';
import { OBSERVABILITY } from '../../core/tokens.js';
import { getMetricsSnapshot } from './metrics-snapshot.js';
import { startIntegrationRunner } from './runner.js';
import { metricsRoutes } from './metrics.js';
import { exportTrace } from './traces-export.js';
import { TRACE_COMPLETED_TOPIC, type TraceCompletedEvent } from '../trace/publish.js';

/**
 * Observability module: owns the real integrations implementation
 * (metrics-snapshot.ts, runner.ts, metrics.ts, datadog/otel/influxdb/grafana/
 * webhook push functions) and exposes it behind the OBSERVABILITY DI token.
 * Other files still import these files directly by path; this module
 * additionally makes it reachable through the container.
 */
let runner: NodeJS.Timeout | null = null;

export const observabilityModule = defineModule({
  manifest: { id: 'observability', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container, events }) {
    container.register(OBSERVABILITY, {
      getMetricsSnapshot,
      startIntegrationRunner,
      metricsRoutes,
    });

    // Traces reach the integrations the same way everything else does: by
    // listening on the bus. The trace module neither knows nor imports this.
    events.subscribe(TRACE_COMPLETED_TOPIC, (_topic, payload) => {
      void exportTrace(payload as TraceCompletedEvent);
    });
  },

  // The 60s metric push runs for as long as this module does: turning the module
  // off has to stop the pushes too, not only the trace export.
  start() {
    // ponytail: unref'd — the listening socket is what keeps the process alive.
    runner ??= startIntegrationRunner().unref();
  },

  stop() {
    if (runner) clearInterval(runner);
    runner = null;
  },
});
