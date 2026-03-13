import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError } from '../api.js';
import { getCurrentAccount } from '../store.js';
import type { Settings } from '@localrouter/shared';

interface SystemInfo {
  version: string;
  uptime: number;
  nodeVersion: string;
}

export function makeServiceCommand(): Command {
  const cmd = new Command('service').description('Control the LocalRouter service');

  cmd.command('status')
    .description('Show current service configuration')
    .action(async () => {
      const account = await getCurrentAccount();
      if (!account) {
        console.log(chalk.yellow('Not logged in. Run: localrouter auth login'));
        return;
      }

      try {
        const [info, settings, models, projects] = await Promise.all([
          api<SystemInfo>('GET', '/api/system/info').catch(() => null),
          api<Settings>('GET', '/api/settings'),
          api<unknown[]>('GET', '/api/models'),
          api<unknown[]>('GET', '/api/projects'),
        ]);

        console.log(chalk.bold('\nLocalRouter Service Status\n'));
        console.log(`  ${chalk.cyan('Server:')}        ${account.serverUrl}`);
        if (info) {
          console.log(`  ${chalk.cyan('Version:')}       ${info.version}`);
          console.log(`  ${chalk.cyan('Uptime:')}        ${Math.floor(info.uptime / 60)}m ${info.uptime % 60}s`);
        }
        console.log(`  ${chalk.cyan('Port:')}          ${settings.port}`);
        console.log(`  ${chalk.cyan('Host:')}          ${settings.host}`);
        console.log(`  ${chalk.cyan('Dashboard:')}     ${settings.dashboardEnabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
        console.log(`  ${chalk.cyan('Log level:')}     ${settings.logLevel}`);
        console.log(`  ${chalk.cyan('Timeout:')}       ${settings.defaultTimeoutMs}ms`);
        console.log(`  ${chalk.cyan('Models:')}        ${models.length}`);
        console.log(`  ${chalk.cyan('Projects:')}      ${projects.length}`);
        console.log();
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('configure')
    .description('Update service settings')
    .option('--port <port>', 'HTTP port to listen on')
    .option('--host <host>', 'Host to bind to')
    .option('--dashboard <bool>', 'Enable/disable dashboard (true|false)')
    .option('--log-level <level>', 'Log level: trace|debug|info|warn|error')
    .option('--timeout <ms>', 'Default per-model timeout in ms')
    .action(async (opts: {
      port?: string; host?: string; dashboard?: string;
      logLevel?: string; timeout?: string;
    }) => {
      const patch: Partial<Settings> = {};
      if (opts.port) patch.port = parseInt(opts.port, 10);
      if (opts.host) patch.host = opts.host;
      if (opts.dashboard !== undefined) patch.dashboardEnabled = opts.dashboard === 'true';
      if (opts.logLevel) patch.logLevel = opts.logLevel as Settings['logLevel'];
      if (opts.timeout) patch.defaultTimeoutMs = parseInt(opts.timeout, 10);

      if (Object.keys(patch).length === 0) {
        console.log(chalk.yellow('No settings provided. Use --port, --host, --dashboard, --log-level, or --timeout.'));
        return;
      }

      try {
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

  return cmd;
}
