import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { getCurrentAccount, requireAccount } from '../store.js';
import type { Settings, UsageRetentionConfig } from '@routerly/shared';

interface SystemInfo {
  version: string;
  uptime: number;
  nodeVersion: string;
}

export function makeServiceCommand(): Command {
  const cmd = new Command('service').description('Control the Routerly service');

  cmd.command('status')
    .description('Show current service configuration')
    .addHelpText('after', `
Examples:
  # Show version, uptime, port, models, and routers
  routerly service status
`)
    .action(async () => {
      const account = await getCurrentAccount();
      if (!account) {
        console.log(chalk.yellow('Not logged in. Run: routerly auth login'));
        return;
      }

      try {
        const [info, settings, models, routers] = await Promise.all([
          api<SystemInfo>('GET', '/api/system/info').catch(() => null),
          api<Settings & { listeningAddresses?: string[] }>('GET', '/api/settings'),
          api<unknown[]>('GET', '/api/models'),
          api<unknown[]>('GET', '/api/routers'),
        ]);

        console.log(chalk.bold('\nRouterly Service Status\n'));
        console.log(`  ${chalk.cyan('Server:')}        ${account.serverUrl}`);
        if (info) {
          console.log(`  ${chalk.cyan('Version:')}       ${info.version}`);
          console.log(`  ${chalk.cyan('Uptime:')}        ${Math.floor(info.uptime / 60)}m ${info.uptime % 60}s`);
        }
        console.log(`  ${chalk.cyan('Port:')}          ${settings.port}`);
        console.log(`  ${chalk.cyan('Host:')}          ${settings.host}`);
        console.log(`  ${chalk.cyan('Dashboard:')}     ${settings.dashboardEnabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
        console.log(`  ${chalk.cyan('Log level:')}     ${settings.logLevel}`);
        const retention = settings.usageRetention;
        const retentionParts: string[] = [];
        if (retention?.maxAgeDays !== undefined) retentionParts.push(`${retention.maxAgeDays}d`);
        if (retention?.maxSizeMb !== undefined) retentionParts.push(`${retention.maxSizeMb}MB`);
        console.log(`  ${chalk.cyan('Usage retention:')} ${retentionParts.length > 0 ? retentionParts.join(', ') : chalk.gray('not configured')}`);
        console.log(`  ${chalk.cyan('Models:')}        ${models.length}`);
        console.log(`  ${chalk.cyan('Routers:')}      ${routers.length}`);
        for (const address of settings.listeningAddresses ?? []) {
          console.log(`  ${chalk.cyan('Listening at:')}  ${address}`);
        }
        console.log();
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('configure')
    .description('Update service settings')
    .addHelpText('after', `
Examples:
  # Change the listening port
  routerly service configure --port 8080

  # Increase log verbosity
  routerly service configure --log-level debug

  # Bind to all network interfaces
  routerly service configure --host 0.0.0.0

  # Production hardening: specific port, reduced logging
  routerly service configure \\
    --port 443 --host 0.0.0.0 --log-level warn

  # Enable Prometheus metrics endpoint
  routerly service configure --metrics true

  # Require a Bearer token to access /metrics
  routerly service configure --metrics-token mysecret

  # Remove the metrics token (open access)
  routerly service configure --metrics-token ""

  # Publish the URL clients should use, and require 2FA for every user
  routerly service configure --public-url https://routerly.example.com --require-mfa true

  # Drop usage history older than 30 days
  routerly service configure --usage-retention-days 30

  # Cap usage history at 500MB, dropping oldest records first
  routerly service configure --usage-retention-max-mb 500

  # Clear the age limit, keeping the size cap (empty string clears, same convention as --metrics-token)
  routerly service configure --usage-retention-days ""
`)
    .option('--port <port>', 'HTTP port to listen on')
    .option('--host <host>', 'Host to bind to')
    .option('--dashboard <bool>', 'Enable/disable dashboard (true|false)')
    .option('--log-level <level>', 'Log level: trace|debug|info|warn|error')
    .option('--metrics <bool>', 'Enable/disable Prometheus /metrics endpoint (true|false)')
    .option('--metrics-token <token>', 'Optional Bearer token to protect /metrics (empty string removes it)')
    .option('--public-url <url>', 'External URL clients use to reach the service')
    .option('--require-mfa <bool>', 'Require two-factor authentication for all users (true|false)')
    .option('--usage-retention-days <n>', 'Drop usage history records older than N days (empty string clears it)')
    .option('--usage-retention-max-mb <n>', 'Cap usage history file size in MB, dropping oldest records first (empty string clears it)')
    .action(async (opts: {
      port?: string; host?: string; dashboard?: string;
      logLevel?: string; metrics?: string; metricsToken?: string;
      publicUrl?: string; requireMfa?: string;
      usageRetentionDays?: string; usageRetentionMaxMb?: string;
    }) => {
      const patch: Partial<Settings> = {};
      if (opts.port) patch.port = parseInt(opts.port, 10);
      if (opts.host) patch.host = opts.host;
      if (opts.dashboard !== undefined) patch.dashboardEnabled = opts.dashboard === 'true';
      if (opts.logLevel) patch.logLevel = opts.logLevel as Settings['logLevel'];
      if (opts.metrics !== undefined) patch.metricsEnabled = opts.metrics === 'true';
      if (opts.metricsToken !== undefined) patch.prometheusAuthToken = opts.metricsToken || undefined;
      if (opts.publicUrl !== undefined) patch.publicUrl = opts.publicUrl;
      if (opts.requireMfa !== undefined) patch.requireMfa = opts.requireMfa === 'true';

      try {
        if (opts.usageRetentionDays !== undefined || opts.usageRetentionMaxMb !== undefined) {
          // Sub-fields are independent; merge over the current policy so setting
          // one flag doesn't wipe out the other.
          const current = await api<Settings>('GET', '/api/settings');
          const usageRetention: UsageRetentionConfig = { ...(current.usageRetention ?? {}) };
          if (opts.usageRetentionDays !== undefined) {
            if (opts.usageRetentionDays === '') delete usageRetention.maxAgeDays;
            else usageRetention.maxAgeDays = parseInt(opts.usageRetentionDays, 10);
          }
          if (opts.usageRetentionMaxMb !== undefined) {
            if (opts.usageRetentionMaxMb === '') delete usageRetention.maxSizeMb;
            else usageRetention.maxSizeMb = parseInt(opts.usageRetentionMaxMb, 10);
          }
          patch.usageRetention = usageRetention;
        }

        if (Object.keys(patch).length === 0) {
          console.log(chalk.yellow('No settings provided. Use --port, --host, --dashboard, --log-level, --metrics, --metrics-token, --public-url, --require-mfa, --usage-retention-days, or --usage-retention-max-mb.'));
          return;
        }

        await api<void>('PUT', '/api/settings', patch);
        console.log(chalk.green('✓ Settings updated.'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          console.error(chalk.red('Admin privileges required.'));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });


  // ── service health ──
  cmd.command('health')
    .description('Show provider health status')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const data = await api<Array<{
          modelId: string;
          provider: string;
          status: 'healthy' | 'degraded' | 'unavailable';
          errorRate?: number;
          p95LatencyMs?: number;
          requestsPerHour?: number;
          lastSuccess?: string;
        }>>('GET', '/api/health/providers');

        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

        if (data.length === 0) {
          console.log(chalk.yellow('No provider health data available.'));
          return;
        }

        const table = new Table({
          head: ['Model', 'Provider', 'Status', 'Error Rate', 'P95 Latency', 'Req/hr', 'Last Success'].map(h => chalk.cyan(h)),
        });

        for (const p of data) {
          const status = p.status === 'healthy'
            ? chalk.green(p.status)
            : p.status === 'degraded'
              ? chalk.yellow(p.status)
              : chalk.red(p.status);
          table.push([
            p.modelId,
            p.provider,
            status,
            p.errorRate != null ? `${(p.errorRate * 100).toFixed(1)}%` : chalk.gray('—'),
            p.p95LatencyMs != null ? `${p.p95LatencyMs}ms` : chalk.gray('—'),
            p.requestsPerHour ?? chalk.gray('—'),
            p.lastSuccess ? new Date(p.lastSuccess).toLocaleString() : chalk.gray('—'),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── service metrics ──
  cmd.command('metrics')
    .description('Show Prometheus metrics summary')
    .option('--raw', 'Print raw Prometheus text output')
    .action(async (opts: { raw?: boolean }) => {
      try {
        const account = await requireAccount();
        const url = `${account.serverUrl.replace(/\/$/, '')}/metrics`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${account.token}` },
        });
        if (!res.ok) {
          console.error(chalk.red(`Error: ${res.statusText}`));
          process.exit(1);
        }
        const text = await res.text();

        if (opts.raw) {
          console.log(text);
          return;
        }

        // Parse Prometheus text: extract non-comment, non-empty lines with a value
        const counters: Array<{ name: string; value: string }> = [];
        for (const line of text.split('\n')) {
          if (!line || line.startsWith('#')) continue;
          const spaceIdx = line.lastIndexOf(' ');
          if (spaceIdx === -1) continue;
          const name = line.slice(0, spaceIdx).trim();
          const value = line.slice(spaceIdx + 1).trim();
          if (name && value && !isNaN(Number(value))) {
            counters.push({ name, value });
          }
        }

        if (counters.length === 0) {
          console.log(chalk.yellow('No metrics available.'));
          return;
        }

        const table = new Table({
          head: ['Metric', 'Value'].map(h => chalk.cyan(h)),
        });
        for (const c of counters) {
          table.push([c.name, c.value]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
