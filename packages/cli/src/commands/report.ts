import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';

interface UsageByModel {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  errors: number;
}

interface UsageResponse {
  summary: {
    totalCost: number;
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
  };
  byModel: Record<string, UsageByModel>;
  records: Array<{
    timestamp: string;
    projectId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    latencyMs: number;
    outcome: string;
  }>;
}

export function makeReportCommand(): Command {
  const cmd = new Command('report').description('View usage and cost reports');

  cmd.command('usage')
    .description('Show aggregated usage by model')
    .option('--period <period>', 'Period: daily | weekly | monthly | all', 'monthly')
    .option('--project <id>', 'Filter by project ID')
    .action(async (opts: { period: string; project?: string }) => {
      try {
        const params = new URLSearchParams({ period: opts.period });
        if (opts.project) params.set('projectId', opts.project);

        const data = await api<UsageResponse>('GET', `/api/usage?${params.toString()}`);

        if (data.summary.totalCalls === 0) {
          console.log(chalk.yellow(`No usage records for period: ${opts.period}`));
          return;
        }

        console.log(chalk.bold(`\nUsage Report — ${opts.period.toUpperCase()}\n`));
        const table = new Table({
          head: ['Model', 'Calls', 'Errors', 'Input Tokens', 'Output Tokens', 'Cost (USD)'].map(h => chalk.cyan(h)),
        });

        for (const [model, stats] of Object.entries(data.byModel)) {
          table.push([
            model,
            stats.calls,
            stats.errors > 0 ? chalk.red(String(stats.errors)) : '0',
            stats.inputTokens.toLocaleString(),
            stats.outputTokens.toLocaleString(),
            `$${stats.cost.toFixed(6)}`,
          ]);
        }

        console.log(table.toString());
        console.log(chalk.bold(`\nTotal: $${data.summary.totalCost.toFixed(6)} USD`) +
          chalk.gray(` (${data.summary.successCalls} ok, ${data.summary.errorCalls} errors)`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('calls')
    .description('Show last N call records')
    .option('--limit <n>', 'Number of records to show', '20')
    .option('--project <id>', 'Filter by project ID')
    .action(async (opts: { limit: string; project?: string }) => {
      try {
        const params = new URLSearchParams({ period: 'all' });
        if (opts.project) params.set('projectId', opts.project);

        const data = await api<UsageResponse>('GET', `/api/usage?${params.toString()}`);
        const limited = data.records.slice(0, parseInt(opts.limit, 10));

        const table = new Table({
          head: ['Timestamp', 'Project', 'Model', 'In Tokens', 'Out Tokens', 'Cost', 'Latency', 'Outcome'].map(h => chalk.cyan(h)),
        });

        for (const r of limited) {
          const outcome = r.outcome === 'success' ? chalk.green(r.outcome) : chalk.red(r.outcome);
          table.push([
            new Date(r.timestamp).toLocaleString(),
            r.projectId.slice(0, 8),
            r.modelId,
            r.inputTokens,
            r.outputTokens,
            `$${r.cost.toFixed(6)}`,
            `${r.latencyMs}ms`,
            outcome,
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
