import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { Integration } from '@routerly/shared';

function endpointSummary(i: Integration & Record<string, unknown>): string {
  switch (i.type) {
    case 'prometheus': return '(pull)';
    case 'otel':
    case 'grafana':
    case 'influxdb':
    case 'webhook':
      return String(i['endpoint'] ?? i['url'] ?? '');
    case 'datadog':
      return String(i['site'] ?? 'datadoghq.com');
    default:
      return '';
  }
}

export function makeIntegrationsCommand(): Command {
  const cmd = new Command('integrations').description('Manage metric integrations');

  cmd.command('list')
    .description('List configured integrations')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const integrations = await api<Integration[]>('GET', '/api/integrations');
        if (opts.json) {
          console.log(JSON.stringify(integrations, null, 2));
          return;
        }
        if (!integrations.length) {
          console.log(chalk.gray('No integrations configured.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Type', 'Enabled', 'Name/Endpoint'].map(h => chalk.cyan(h)),
        });
        for (const i of integrations) {
          const row = i as Integration & Record<string, unknown>;
          table.push([
            i.id.slice(0, 8),
            i.type,
            i.enabled ? chalk.green('yes') : chalk.gray('no'),
            String(row['name'] ?? '') || endpointSummary(row),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('add')
    .description('Add an integration')
    .requiredOption('--type <type>', 'Integration type: prometheus|otel|datadog|grafana|influxdb|webhook')
    .option('--name <name>', 'Optional display name')
    .option('--enabled', 'Enable immediately (default: true)')
    .option('--no-enabled', 'Add disabled')
    // prometheus
    .option('--auth-token <token>', 'Bearer auth token (prometheus)')
    // otel
    .option('--endpoint <url>', 'Endpoint URL (otel, required)')
    .option('--protocol <proto>', 'http|grpc (otel, default: http)')
    .option('--header <key=value>', 'Extra header (otel/webhook, repeatable)', collect, [])
    // datadog
    .option('--api-key <key>', 'API key (datadog/grafana)')
    .option('--site <site>', 'Datadog site (default: datadoghq.com)')
    // grafana
    .option('--url <url>', 'Remote write URL (grafana/influxdb/webhook)')
    .option('--username <id>', 'Numeric grafana instance ID')
    // influxdb
    .option('--token <token>', 'InfluxDB token')
    .option('--org <org>', 'InfluxDB org')
    .option('--bucket <bucket>', 'InfluxDB bucket')
    // webhook
    .option('--secret <secret>', 'HMAC secret (webhook)')
    // traces (otel/webhook only)
    .option('--traces', 'Also export request traces (otel/webhook)')
    .option('--trace-sample-rate <rate>', 'Fraction of traces to export, 0..1 (default: 1)')
    .action(async (opts: {
      type: string; name?: string; enabled: boolean;
      authToken?: string;
      endpoint?: string; protocol?: string; header: string[];
      apiKey?: string; site?: string;
      url?: string; username?: string;
      token?: string; org?: string; bucket?: string;
      secret?: string;
      traces?: boolean; traceSampleRate?: string;
    }) => {
      const base: Record<string, unknown> = { type: opts.type, enabled: opts.enabled };
      if (opts.name) base['name'] = opts.name;

      let body: Record<string, unknown>;
      switch (opts.type) {
        case 'prometheus':
          body = { ...base };
          if (opts.authToken) body['authToken'] = opts.authToken;
          break;
        case 'otel':
          if (!opts.endpoint) {
            console.error(chalk.red('--endpoint is required for otel'));
            process.exit(1);
          }
          body = { ...base, endpoint: opts.endpoint, protocol: opts.protocol ?? 'http' };
          if (opts.header.length) body['headers'] = parseHeaders(opts.header);
          break;
        case 'datadog':
          if (!opts.apiKey) {
            console.error(chalk.red('--api-key is required for datadog'));
            process.exit(1);
          }
          body = { ...base, apiKey: opts.apiKey, site: opts.site ?? 'datadoghq.com' };
          break;
        case 'grafana':
          if (!opts.url || !opts.username || !opts.apiKey) {
            console.error(chalk.red('--url, --username, and --api-key are required for grafana'));
            process.exit(1);
          }
          body = { ...base, url: opts.url, username: opts.username, apiKey: opts.apiKey };
          break;
        case 'influxdb':
          if (!opts.url || !opts.token || !opts.org || !opts.bucket) {
            console.error(chalk.red('--url, --token, --org, and --bucket are required for influxdb'));
            process.exit(1);
          }
          body = { ...base, url: opts.url, token: opts.token, org: opts.org, bucket: opts.bucket };
          break;
        case 'webhook':
          if (!opts.url) {
            console.error(chalk.red('--url is required for webhook'));
            process.exit(1);
          }
          body = { ...base, url: opts.url };
          if (opts.secret) body['secret'] = opts.secret;
          if (opts.header.length) body['headers'] = parseHeaders(opts.header);
          break;
        default:
          console.error(chalk.red(`Unknown type: ${opts.type}. Must be one of: prometheus, otel, datadog, grafana, influxdb, webhook`));
          process.exit(1);
      }

      if (opts.traces) {
        const traces = parseTraces(opts.type, opts.traceSampleRate);
        body['traces'] = traces;
      }

      try {
        const created = await api<Integration>('POST', '/api/integrations', body);
        console.log(chalk.green(`Integration added (id: ${created.id})`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('remove <id>')
    .description('Remove an integration by ID')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/integrations/${id}`);
        console.log(chalk.green(`Integration ${id} removed.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Integration "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('test <id>')
    .description('Send a test payload via the integration')
    .action(async (id: string) => {
      try {
        const result = await api<{ ok: boolean; message: string }>('POST', `/api/integrations/${id}/test`);
        if (result.ok) {
          console.log(chalk.green(`✓ ok: ${result.message}`));
        } else {
          console.error(chalk.red(`✗ failed: ${result.message}`));
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Integration "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('traces <id> <state>')
    .description('Turn request-trace export on or off for an integration (otel/webhook)')
    .option('--sample-rate <rate>', 'Fraction of traces to export, 0..1 (default: 1)')
    .action(async (id: string, state: string, opts: { sampleRate?: string }) => {
      if (state !== 'on' && state !== 'off') {
        console.error(chalk.red(`Unknown state: ${state}. Must be "on" or "off".`));
        process.exit(1);
      }
      const current = await api<Integration>('GET', `/api/integrations/${id}`).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) console.error(chalk.red(`Integration "${id}" not found.`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        return process.exit(1);
      });

      const traces = state === 'on' ? parseTraces(current.type, opts.sampleRate) : { enabled: false };

      try {
        await api<Integration>('PATCH', `/api/integrations/${id}`, { traces });
        console.log(chalk.green(`Trace export ${state === 'on' ? 'enabled' : 'disabled'} for integration ${id}.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('enable <id>')
    .description('Enable an integration')
    .action(async (id: string) => {
      try {
        await api<Integration>('PATCH', `/api/integrations/${id}`, { enabled: true });
        console.log(chalk.green(`Integration ${id} enabled.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('disable <id>')
    .description('Disable an integration')
    .action(async (id: string) => {
      try {
        await api<Integration>('PATCH', `/api/integrations/${id}`, { enabled: false });
        console.log(chalk.green(`Integration ${id} disabled.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

/**
 * Trace export is opt-in and only where a per-request payload can be delivered:
 * the metric-only sinks (datadog, grafana, influxdb, prometheus) cannot carry one.
 */
function parseTraces(type: string, sampleRate?: string): { enabled: true; sampleRate?: number } {
  if (type !== 'otel' && type !== 'webhook') {
    console.error(chalk.red(`Trace export is only available for otel and webhook integrations (got: ${type}).`));
    process.exit(1);
  }
  if (sampleRate === undefined) return { enabled: true };
  const rate = Number(sampleRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    console.error(chalk.red('Sample rate must be a number between 0 and 1.'));
    process.exit(1);
  }
  return { enabled: true, sampleRate: rate };
}

function parseHeaders(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const eq = h.indexOf('=');
    if (eq > 0) result[h.slice(0, eq)] = h.slice(eq + 1);
  }
  return result;
}
