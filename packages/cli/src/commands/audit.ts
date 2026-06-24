import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  email: string;
  endpoint: string;
  action: string;
  result: 'success' | 'forbidden' | 'error';
  details?: Record<string, unknown>;
}

const RESULT_COLOR: Record<AuditEntry['result'], (s: string) => string> = {
  success:   chalk.green,
  forbidden: chalk.yellow,
  error:     chalk.red,
};

export function makeAuditCommand(): Command {
  const cmd = new Command('audit').description('View the audit log');

  cmd.command('list')
    .description('List audit log entries')
    .option('--user <email>', 'Filter by user email or ID')
    .option('--action <str>', 'Filter by action substring (e.g. model:create)')
    .option('--from <date>', 'Start date (ISO format, e.g. 2026-01-01)')
    .option('--to <date>', 'End date (ISO format, e.g. 2026-12-31)')
    .option('--limit <n>', 'Max entries to return', '50')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly audit list
  routerly audit list --user admin@example.com --limit 20
  routerly audit list --action model:create --json
`)
    .action(async (opts: { user?: string; action?: string; from?: string; to?: string; limit: string; json?: boolean }) => {
      const params = new URLSearchParams({ limit: opts.limit });
      if (opts.user)   params.set('userId', opts.user);
      if (opts.action) params.set('action', opts.action);
      if (opts.from)   params.set('from', opts.from);
      if (opts.to)     params.set('to', opts.to);

      try {
        const entries = await api<AuditEntry[]>('GET', `/api/audit?${params.toString()}`);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        if (entries.length === 0) {
          console.log(chalk.yellow('No audit entries found.'));
          return;
        }

        const table = new Table({
          head: ['Timestamp', 'User', 'Action', 'Result'].map(h => chalk.cyan(h)),
        });
        for (const e of entries) {
          const colorFn = RESULT_COLOR[e.result] ?? chalk.white;
          table.push([
            new Date(e.timestamp).toLocaleString(),
            e.email || e.userId,
            e.action,
            colorFn(e.result),
          ]);
        }
        console.log(table.toString());
        console.log(chalk.gray(`${entries.length} entries`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
