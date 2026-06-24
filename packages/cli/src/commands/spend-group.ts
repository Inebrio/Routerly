import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';

interface SpendGroup {
  id: string;
  name: string;
  limits?: Array<{ metric: string; period: string; value: number }>;
  projectIds?: string[];
}

export function makeSpendGroupCommand(): Command {
  const cmd = new Command('spend-group').description('Manage hierarchical spend groups');

  cmd.command('list')
    .description('List all spend groups')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const groups = await api<SpendGroup[]>('GET', '/api/spend-groups');

        if (opts.json) {
          console.log(JSON.stringify(groups, null, 2));
          return;
        }

        if (groups.length === 0) {
          console.log(chalk.yellow('No spend groups configured.'));
          return;
        }

        const table = new Table({
          head: ['ID', 'Name', 'Limits', 'Projects'].map(h => chalk.cyan(h)),
        });

        for (const g of groups) {
          const limits = g.limits?.length
            ? g.limits.map(l => `${l.metric}/${l.period}:${l.value}`).join(', ')
            : chalk.gray('—');
          const projects = g.projectIds?.length
            ? g.projectIds.join(', ')
            : chalk.gray('—');
          table.push([chalk.gray(g.id.slice(0, 8) + '…'), g.name, limits, projects]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('add')
    .description('Create a spend group')
    .requiredOption('--name <name>', 'Group name')
    .option('--limit <spec>', 'Limit spec: <metric>:<period>:<value> (repeatable)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--projects <ids>', 'Comma-separated project IDs to include')
    .action(async (opts: { name: string; limit: string[]; projects?: string }) => {
      try {
        const limits = opts.limit.map(spec => {
          const [metric, period, value] = spec.split(':');
          if (!metric || !period || !value) {
            console.error(chalk.red(`Invalid limit spec "${spec}". Expected: <metric>:<period>:<value>`));
            process.exit(1);
          }
          return { metric, period, value: parseFloat(value) };
        });

        const projectIds = opts.projects
          ? opts.projects.split(',').map(s => s.trim()).filter(Boolean)
          : undefined;

        const body: Record<string, unknown> = { name: opts.name };
        if (limits.length) body.limits = limits;
        if (projectIds?.length) body.projectIds = projectIds;

        const group = await api<SpendGroup>('POST', '/api/spend-groups', body);
        console.log(chalk.green(`Spend group "${opts.name}" created.`) + chalk.gray(` ID: ${group.id}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`A spend group named "${opts.name}" already exists.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('delete <id>')
    .description('Delete a spend group by ID')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/spend-groups/${encodeURIComponent(id)}`);
        console.log(chalk.green(`Spend group "${id}" deleted.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Spend group "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
