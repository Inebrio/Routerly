import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError } from '../api.js';
import { getCurrentAccount } from '../store.js';
import type { Settings } from '@routerly/shared';

export function makeTelemetryCommand(): Command {
  const cmd = new Command('telemetry').description('Manage anonymous install metrics');

  cmd.command('status')
    .description('Show current telemetry preference')
    .action(async () => {
      const account = await getCurrentAccount();
      if (!account) {
        console.log(chalk.yellow('Not logged in. Run: routerly auth login'));
        return;
      }
      try {
        const settings = await api<Settings>('GET', '/api/settings');
        const t = settings.telemetry;
        if (!t) {
          console.log(chalk.dim('Telemetry: not configured (you have not been asked yet)'));
        } else if (t.enabled) {
          console.log(chalk.green('Telemetry: enabled') + chalk.dim(` (install ID: ${t.installId})`));
        } else {
          console.log(chalk.gray('Telemetry: disabled'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('on')
    .description('Opt in to anonymous install metrics')
    .action(async () => {
      const account = await getCurrentAccount();
      if (!account) {
        console.log(chalk.yellow('Not logged in. Run: routerly auth login'));
        return;
      }
      try {
        await api<Settings>('PUT', '/api/settings', { telemetry: { enabled: true } });
        console.log(chalk.green('✓ Anonymous metrics enabled. Thank you!'));
        console.log(chalk.dim('  Sends only: event type, version, platform, and a random ID. No personal data.'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          console.error(chalk.red('Admin privileges required.'));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('off')
    .description('Opt out of anonymous install metrics')
    .action(async () => {
      const account = await getCurrentAccount();
      if (!account) {
        console.log(chalk.yellow('Not logged in. Run: routerly auth login'));
        return;
      }
      try {
        await api<Settings>('PUT', '/api/settings', { telemetry: { enabled: false } });
        console.log(chalk.green('✓ Anonymous metrics disabled.'));
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
