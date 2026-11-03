import type { FastifyPluginAsync } from 'fastify';
import { readConfig } from '../config/loader.js';
import { listEffectiveModelsIncludingDisabled } from '../provider/list-effective.js';
import type { PrometheusIntegration } from '@routerly/shared';
import {
  aggregate,
  percentile,
  routerBudgetRatio,
  renderMetric,
  type Metric,
  type Sample,
} from './metrics-snapshot.js';

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (request, reply) => {
    const settings = await readConfig('settings');
    const prometheusIntegration = (settings.integrations ?? []).find(
      (i: { type: string }) => i.type === 'prometheus',
    ) as PrometheusIntegration | undefined;

    if (prometheusIntegration) {
      if (!prometheusIntegration.enabled) {
        return reply.status(404).send('metrics disabled');
      }
      const authToken = prometheusIntegration.authToken;
      if (authToken) {
        const header = (request.headers['authorization'] as string | undefined) ?? '';
        if (header !== `Bearer ${authToken}`) {
          return reply.status(401).send('unauthorized');
        }
      }
    } else {
      // ponytail: legacy flat fields — backward compat
      if (settings.metricsEnabled === false) {
        return reply.status(404).send('metrics disabled');
      }
      const authToken = settings.prometheusAuthToken;
      if (authToken) {
        const header = (request.headers['authorization'] as string | undefined) ?? '';
        if (header !== `Bearer ${authToken}`) {
          return reply.status(401).send('unauthorized');
        }
      }
    }

    // observability: must still account for disabled-connection models
    const [usage, routers, models] = await Promise.all([
      readConfig('usage'),
      readConfig('routers'),
      listEffectiveModelsIncludingDisabled(),
    ]);

    const routerName = (id: string): string => routers.find((p) => p.id === id)?.name ?? id;
    const modelInfo = (id: string): { model: string; provider: string } => {
      const m = models.find((mm) => mm.id === id);
      return { model: id, provider: m?.provider ?? 'unknown' };
    };

    const agg = aggregate(usage, routerName, modelInfo);

    const requestsMetric: Metric = {
      name: 'routerly_requests_total',
      help: 'Total requests',
      type: 'counter',
      samples: [...agg.requests.values()].map((e) => ({ labels: e.labels, value: e.value })),
    };

    const tokensMetric: Metric = {
      name: 'routerly_tokens_total',
      help: 'Total tokens by type',
      type: 'counter',
      samples: [...agg.tokens.values()].map((e) => ({ labels: e.labels, value: e.value })),
    };

    const costMetric: Metric = {
      name: 'routerly_cost_usd_total',
      help: 'Total cost in USD',
      type: 'counter',
      samples: [...agg.cost.values()].map((e) => ({ labels: e.labels, value: +e.value.toFixed(6) })),
    };

    const p50Samples: Sample[] = [];
    const p95Samples: Sample[] = [];
    for (const d of agg.durations.values()) {
      const sorted = [...d.latencies].sort((a, b) => a - b);
      p50Samples.push({ labels: d.labels, value: percentile(sorted, 50) });
      p95Samples.push({ labels: d.labels, value: percentile(sorted, 95) });
    }

    const p50Metric: Metric = {
      name: 'routerly_request_duration_p50_ms',
      help: 'Request duration p50 in ms (last 100 records)',
      type: 'gauge',
      samples: p50Samples,
    };
    const p95Metric: Metric = {
      name: 'routerly_request_duration_p95_ms',
      help: 'Request duration p95 in ms (last 100 records)',
      type: 'gauge',
      samples: p95Samples,
    };

    const budgetSamples: Sample[] = [];
    for (const router of routers) {
      const ratio = await routerBudgetRatio(router, models);
      budgetSamples.push({ labels: { router: router.name }, value: +ratio.toFixed(6) });
    }
    const budgetMetric: Metric = {
      name: 'routerly_budget_used_ratio',
      help: 'Budget used ratio per router (0-1)',
      type: 'gauge',
      samples: budgetSamples,
    };

    const body = [requestsMetric, tokensMetric, costMetric, p50Metric, p95Metric, budgetMetric]
      .map(renderMetric)
      .join('\n\n')
      .concat('\n');

    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(body);
  });
};
