import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { readStore } from '../store.js';
import type { UsageRecord } from '@localrouter/shared';

type Period = 'daily' | 'weekly' | 'monthly' | 'all';

function startOf(period: Period): Date {
  const now = new Date();
  if (period === 'all') return new Date(0);
  if (period === 'daily') {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (period === 'weekly') {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    now.setHours(0, 0, 0, 0);
    return now;
  }
  // monthly
  now.setDate(1);
  now.setHours(0, 0, 0, 0);
  return now;
}

export function makeReportCommand(): Command {
  const cmd = new Command('report').description('View usage and cost reports');

  cmd.command('usage')
    .description('Show aggregated usage by model')
    .option('--period <period>', 'Period: daily | weekly | monthly | all', 'monthly')
    .option('--project <slug>', 'Filter by project ID or slug')
    .action(async (opts: { period: string; project?: string }) => {
      const records = await readStore('usage');
      const projects = await readStore('projects');
      const period = opts.period as Period;
      const since = startOf(period);

      let filtered = records.filter((r: UsageRecord) => new Date(r.timestamp) >= since && r.outcome === 'success');

      if (opts.project) {
        const project = projects.find(p => p.id === opts.project || p.slug === opts.project);
        if (!project) {
          console.error(chalk.red(`Project "${opts.project}" not found.`));
          process.exit(1);
        }
        filtered = filtered.filter((r: UsageRecord) => r.projectId === project.id);
      }

      if (filtered.length === 0) {
        console.log(chalk.yellow(`No usage records for period: ${period}`));
        return;
      }

      // Aggregate by model
      const byModel = new Map<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>();
      for (const r of filtered) {
        const existing = byModel.get(r.modelId) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
        byModel.set(r.modelId, {
          calls: existing.calls + 1,
          inputTokens: existing.inputTokens + r.inputTokens,
          outputTokens: existing.outputTokens + r.outputTokens,
          cost: existing.cost + r.cost,
        });
      }

      console.log(chalk.bold(`\nUsage Report — ${period.toUpperCase()}\n`));
      const table = new Table({
        head: ['Model', 'Calls', 'Input Tokens', 'Output Tokens', 'Cost (USD)'].map(h => chalk.cyan(h)),
      });

      let totalCost = 0;
      for (const [model, stats] of byModel.entries()) {
        table.push([model, stats.calls, stats.inputTokens.toLocaleString(), stats.outputTokens.toLocaleString(), `$${stats.cost.toFixed(6)}`]);
        totalCost += stats.cost;
      }

      console.log(table.toString());
      console.log(chalk.bold(`\nTotal: $${totalCost.toFixed(6)} USD`));
    });

  cmd.command('calls')
    .description('Show last N call records')
    .option('--limit <n>', 'Number of records to show', '20')
    .option('--project <slug>', 'Filter by project')
    .action(async (opts: { limit: string; project?: string }) => {
      const records = await readStore('usage');
      const projects = await readStore('projects');
      let filtered = [...records].reverse();

      if (opts.project) {
        const project = projects.find(p => p.id === opts.project || p.slug === opts.project);
        if (project) filtered = filtered.filter(r => r.projectId === project.id);
      }

      const limited = filtered.slice(0, parseInt(opts.limit, 10));

      const table = new Table({
        head: ['Timestamp', 'Project', 'Model', 'In Tokens', 'Out Tokens', 'Cost', 'Latency', 'Outcome'].map(h => chalk.cyan(h)),
      });

      const projectMap = new Map(projects.map(p => [p.id, p.slug]));
      for (const r of limited) {
        const outcome = r.outcome === 'success' ? chalk.green(r.outcome) : chalk.red(r.outcome);
        table.push([
          new Date(r.timestamp).toLocaleString(),
          projectMap.get(r.projectId) ?? r.projectId.slice(0, 8),
          r.modelId,
          r.inputTokens,
          r.outputTokens,
          `$${r.cost.toFixed(6)}`,
          `${r.latencyMs}ms`,
          outcome,
        ]);
      }

      console.log(table.toString());
    });

  return cmd;
}
