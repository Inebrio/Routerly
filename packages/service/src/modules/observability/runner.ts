import { readConfig } from '../../modules/config/loader.js';
import { getMetricsSnapshot } from './metrics-snapshot.js';
import { pushOtel } from './otel.js';
import { pushDatadog } from './datadog.js';
import { pushGrafana } from './grafana.js';
import { pushInfluxDB } from './influxdb.js';
import { pushWebhook } from './webhook.js';

export function startIntegrationRunner(): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const settings = await readConfig('settings');
      const integrations = settings.integrations ?? [];
      const enabled = integrations.filter((i) => i.enabled && i.type !== 'prometheus');
      if (enabled.length === 0) return;

      const snapshot = await getMetricsSnapshot();

      await Promise.allSettled(
        enabled.map(async (integration) => {
          try {
            switch (integration.type) {
              case 'otel':     await pushOtel(integration, snapshot); break;
              case 'datadog':  await pushDatadog(integration, snapshot); break;
              case 'grafana':  await pushGrafana(integration, snapshot); break;
              case 'influxdb': await pushInfluxDB(integration, snapshot); break;
              case 'webhook':  await pushWebhook(integration, snapshot); break;
            }
          } catch (_) { /* ponytail: silent — push failures must not crash the server */ }
        }),
      );
    } catch (_) { /* ponytail: silent */ }
  }, 60_000);
}
