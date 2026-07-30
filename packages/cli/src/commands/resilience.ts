import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ResilienceEntry, ResilienceSnapshot, ResilienceState } from '@routerly/shared';

const STATE_COLOR: Record<ResilienceState, (s: string) => string> = {
  closed:     chalk.green,
  'half-open': chalk.yellow,
  open:       chalk.red,
};

function fmtTime(ms: number | undefined): string {
  return ms === undefined ? chalk.gray('-') : new Date(ms).toLocaleString();
}

export function makeResilienceCommand(): Command {
  const cmd = new Command('resilience').description('View and manage circuit-breaker resilience state');

  cmd.command('status')
    .description('Show current resilience (circuit-breaker) state per provider, connection, and model')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly resilience status
  routerly resilience status --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const snapshot = await api<ResilienceSnapshot>('GET', '/api/resilience');

        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        if (snapshot.entries.length === 0) {
          console.log(chalk.yellow('No resilience entries recorded yet.'));
          return;
        }

        const table = new Table({
          head: ['Level', 'ID', 'State', 'Last Fault', 'Failures', 'Opened At', 'Cooldown Until', 'Lockout Until']
            .map(h => chalk.cyan(h)),
        });
        for (const e of snapshot.entries as ResilienceEntry[]) {
          const colorFn = STATE_COLOR[e.state] ?? chalk.white;
          table.push([
            e.key.level,
            e.key.id,
            colorFn(e.state),
            e.lastFault ?? chalk.gray('-'),
            String(e.failureCount),
            fmtTime(e.openedAt),
            fmtTime(e.cooldownUntil),
            fmtTime(e.lockoutUntil),
          ]);
        }
        console.log(table.toString());
        console.log(chalk.gray(`${snapshot.entries.length} entries — generated at ${new Date(snapshot.generatedAt).toLocaleString()}`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('reset')
    .description('Reset resilience state (circuit breaker) for a specific key, or all state if omitted')
    .option('--level <level>', 'Resilience level: provider, connection, or model (requires --id)')
    .option('--id <id>', 'ID within the given level (requires --level)')
    .addHelpText('after', `
Examples:
  routerly resilience reset
  routerly resilience reset --level provider --id openai
  routerly resilience reset --level model --id gpt-4
`)
    .action(async (opts: { level?: string; id?: string }) => {
      const body: { level?: string; id?: string } = {};
      if (opts.level) body.level = opts.level;
      if (opts.id) body.id = opts.id;

      try {
        await api<{ ok: true }>('POST', '/api/resilience/reset', body);
        if (opts.level && opts.id) {
          console.log(chalk.green(`✓ Reset resilience state for ${opts.level} "${opts.id}".`));
        } else {
          console.log(chalk.green('✓ Reset all resilience state.'));
        }
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
