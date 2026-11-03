import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../api.js';
import type { PermissionCheckStatus } from '@routerly/shared';

export function makePermissionsCommand(): Command {
  const cmd = new Command('permissions').description('Inspect and fix unsafe permissions on Routerly configuration files');

  cmd.command('fix')
    .description('Show unsafe configuration file permissions and optionally fix them')
    .option('--yes', 'Skip the confirmation prompt and fix immediately')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  routerly permissions fix            Show unsafe files, prompt before fixing
  routerly permissions fix --yes      Fix without prompting
  routerly permissions fix --json     Machine-readable output (requires --yes to actually fix)
`)
    .action(async (opts: { yes?: boolean; json?: boolean }) => {
      try {
        const status = await api<PermissionCheckStatus>('GET', '/api/system/permissions');

        if (status.unsafe.length === 0) {
          if (opts.json) {
            console.log(JSON.stringify({ unsafe: [], fixed: [] }, null, 2));
          } else {
            console.log(chalk.green('All Routerly configuration file permissions are safe.'));
          }
          return;
        }

        if (!opts.json) {
          console.log(chalk.yellow('The following configuration file(s) have unsafe permissions:'));
          for (const u of status.unsafe) {
            console.log(`  - ${u.file} (${u.path}) — mode ${u.mode} [${u.severity}]`);
          }
        }

        if (!opts.yes) {
          if (opts.json) {
            // ponytail: an interactive prompt would break piping; require an explicit --yes instead.
            console.error(JSON.stringify({ error: 'confirmation_required', unsafe: status.unsafe }));
            process.exit(1);
          }

          const { default: inquirer } = await import('inquirer');
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Fix these permissions now?',
            default: false,
          }]) as { confirm: boolean };

          if (!confirm) {
            console.log(chalk.gray('Aborted: permissions were not fixed.'));
            return;
          }
        }

        const result = await api<{ fixed: string[] }>('POST', '/api/system/permissions/fix', { confirm: true });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`Fixed permissions on: ${result.fixed.join(', ')}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
