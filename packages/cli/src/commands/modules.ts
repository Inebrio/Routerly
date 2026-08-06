import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';

interface ModuleInfo {
  id: string;
  version: string;
  enabled: boolean;
  alwaysOn: boolean;
  dependsOn: string[];
}

interface ToggleResult {
  id: string;
  enabled: boolean;
  restartRequired: boolean;
}

const RESTART_HINT =
  'Restart the Routerly service for this to take effect (e.g. `docker restart <container>`, or stop and re-run the service process).';

export function makeModulesCommand(): Command {
  const cmd = new Command('modules').description('Enable or disable optional Routerly modules');

  cmd.command('list')
    .description('List modules and their enabled state')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const list = await api<ModuleInfo[]>('GET', '/api/modules');
        if (opts.json) {
          console.log(JSON.stringify(list, null, 2));
          return;
        }
        const table = new Table({
          head: ['ID', 'Version', 'Enabled', 'Always-on', 'Depends on'].map(h => chalk.cyan(h)),
        });
        for (const m of list) {
          table.push([
            m.id,
            m.version,
            m.enabled ? chalk.green('yes') : chalk.gray('no'),
            m.alwaysOn ? chalk.yellow('yes') : chalk.gray('no'),
            m.dependsOn.join(', ') || chalk.gray('-'),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('enable <id>')
    .description('Enable a module (requires a service restart)')
    .action(async (id: string) => {
      try {
        const res = await api<ToggleResult>('POST', `/api/modules/${encodeURIComponent(id)}/enable`);
        console.log(chalk.green(`Enabled: ${res.id}`));
        if (res.restartRequired) console.log(chalk.yellow(RESTART_HINT));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('disable <id>')
    .description('Disable a module (requires a service restart)')
    .action(async (id: string) => {
      try {
        const res = await api<ToggleResult>('POST', `/api/modules/${encodeURIComponent(id)}/disable`);
        console.log(chalk.green(`Disabled: ${res.id}`));
        if (res.restartRequired) console.log(chalk.yellow(RESTART_HINT));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
