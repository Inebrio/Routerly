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

export function makeModulesCommand(): Command {
  const cmd = new Command('modules').description('List Routerly modules (all modules are core and always active)');

  cmd.command('list')
    .description('List modules')
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

  return cmd;
}
