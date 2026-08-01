import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { REQUEST_TYPES, requestTypeLabel, type RequestType } from '@routerly/shared';
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
    blockedCalls?: number;
    routingCalls?: number;
    completionCalls?: number;
    guardrailCalls?: number;
    routingCost?: number;
    completionCost?: number;
    guardrailCost?: number;
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
    callType?: string;
    requestType?: string;
  }>;
}

/**
 * Validate `--type` against the request types the service knows (T60). Rejecting
 * here keeps a typo from silently returning an empty report.
 */
function parseRequestType(value: string): string {
  if (!(REQUEST_TYPES as readonly string[]).includes(value)) {
    console.error(chalk.red(`Error: unknown type '${value}'. Expected one of: ${REQUEST_TYPES.join(', ')}`));
    process.exit(1);
  }
  return value;
}

export function makeReportCommand(): Command {
  const cmd = new Command('report').description('View usage and cost reports');

  cmd.command('usage')
    .description('Show aggregated usage by model')
    .addHelpText('after', `
Examples:
  # Monthly usage summary (default)
  routerly report usage

  # Weekly usage
  routerly report usage --period weekly

  # Usage for a specific project
  routerly report usage --project my-api

  # All-time usage across all projects
  routerly report usage --period all

  # Only embedding calls
  routerly report usage --type embedding
`)
    .option('--period <period>', 'Period: daily | weekly | monthly | all', 'monthly')
    .option('--project <id>', 'Filter by project ID')
    .option('--type <type>', `Filter by request type: ${REQUEST_TYPES.join(' | ')}`, parseRequestType)
    .option('--session-id <id>', 'Filter by session ID')
    .option('--end-user <id>', 'Filter by end-user ID')
    .option('--tag <key=value>', 'Filter by tag (key=value)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { period: string; project?: string; type?: string; sessionId?: string; endUser?: string; tag?: string; json?: boolean }) => {
      try {
        const params = new URLSearchParams({ period: opts.period });
        if (opts.project) params.set('projectId', opts.project);
        if (opts.type) params.set('requestType', opts.type);
        if (opts.sessionId) params.set('sessionId', opts.sessionId);
        if (opts.endUser) params.set('endUserId', opts.endUser);
        if (opts.tag) {
          const [key, value] = opts.tag.split('=');
          if (key && value) params.set(`tag[${key}]`, value);
        }

        const data = await api<UsageResponse>('GET', `/api/usage?${params.toString()}`);

        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

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
        const s = data.summary;
        const blockedSuffix = s.blockedCalls ? `, ${s.blockedCalls} blocked` : '';
        console.log(chalk.bold(`\nTotal: $${data.summary.totalCost.toFixed(6)} USD`) +
          chalk.gray(` (${s.successCalls} ok, ${s.errorCalls} errors${blockedSuffix})`));

        const breakdown: string[] = [];
        if (s.completionCalls !== undefined) breakdown.push(`completion: ${s.completionCalls} calls / $${(s.completionCost ?? 0).toFixed(6)}`);
        if (s.routingCalls !== undefined) breakdown.push(`routing: ${s.routingCalls} calls / $${(s.routingCost ?? 0).toFixed(6)}`);
        if (s.guardrailCalls !== undefined) breakdown.push(`guardrail: ${s.guardrailCalls} calls / $${(s.guardrailCost ?? 0).toFixed(6)}`);
        if (s.blockedCalls) breakdown.push(`blocked: ${s.blockedCalls} calls`);
        if (breakdown.length > 0) console.log(chalk.gray(`Breakdown — ${breakdown.join('  |  ')}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('calls')
    .description('Show last N call records')
    .addHelpText('after', `
Examples:
  # Show the last 20 calls (default)
  routerly report calls

  # Show the last 50 calls
  routerly report calls --limit 50

  # Show the last 100 calls for a specific project
  routerly report calls --limit 100 --project my-api

  # Only image generation calls
  routerly report calls --type image
`)
    .option('--limit <n>', 'Number of records to show', '20')
    .option('--project <id>', 'Filter by project ID')
    .option('--type <type>', `Filter by request type: ${REQUEST_TYPES.join(' | ')}`, parseRequestType)
    .action(async (opts: { limit: string; project?: string; type?: string }) => {
      try {
        const params = new URLSearchParams({ period: 'all' });
        if (opts.project) params.set('projectId', opts.project);
        if (opts.type) params.set('requestType', opts.type);

        const data = await api<UsageResponse>('GET', `/api/usage?${params.toString()}`);
        const limited = data.records.slice(0, parseInt(opts.limit, 10));

        const table = new Table({
          head: ['Timestamp', 'Project', 'Model', 'Type', 'In Tokens', 'Out Tokens', 'Cost', 'Latency', 'Outcome'].map(h => chalk.cyan(h)),
        });

        for (const r of limited) {
          const outcome = r.outcome === 'success' ? chalk.green(r.outcome) : chalk.red(r.outcome);
          table.push([
            new Date(r.timestamp).toLocaleString(),
            r.projectId.slice(0, 8),
            r.modelId,
            // Records written before requestType existed were all chat calls.
            requestTypeLabel((r.requestType ?? 'chat') as RequestType),
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

  // ── report leaderboard ──
  cmd.command('leaderboard')
    .description('Show model performance leaderboard')
    .option('--period <period>', 'Period: daily | weekly | monthly', 'weekly')
    .option('--project <id>', 'Filter by project ID')
    .option('--json', 'Output as JSON')
    .action(async (opts: { period: string; project?: string; json?: boolean }) => {
      try {
        const params = new URLSearchParams({ period: opts.period });
        if (opts.project) params.set('projectId', opts.project);

        const data = await api<Array<{
          modelId: string;
          provider: string;
          totalRequests: number;
          successRate: number;
          avgLatencyMs: number;
          avgCostPer1kTokens: number;
          totalCost: number;
        }>>('GET', `/api/leaderboard?${params.toString()}`);

        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

        if (data.length === 0) {
          console.log(chalk.yellow('No leaderboard data for this period.'));
          return;
        }

        console.log(chalk.bold(`\nModel Leaderboard — ${opts.period.toUpperCase()}\n`));
        const table = new Table({
          head: ['Rank', 'Model', 'Provider', 'Requests', 'Success%', 'Avg Latency', 'Cost/1K tokens', 'Total Cost'].map(h => chalk.cyan(h)),
        });

        data.forEach((row, i) => {
          const rank = i === 0 ? chalk.yellow('★ 1') : String(i + 1);
          table.push([
            rank,
            row.modelId,
            row.provider,
            row.totalRequests,
            `${(row.successRate * 100).toFixed(1)}%`,
            `${row.avgLatencyMs}ms`,
            `$${row.avgCostPer1kTokens.toFixed(4)}`,
            `$${row.totalCost.toFixed(6)}`,
          ]);
        });
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── report sessions ──
  cmd.command('sessions')
    .description('Show usage sessions')
    .option('--project <id>', 'Filter by project ID')
    .option('--limit <n>', 'Number of sessions to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project?: string; limit: string; json?: boolean }) => {
      try {
        const params = new URLSearchParams({ limit: opts.limit });
        if (opts.project) params.set('projectId', opts.project);

        const data = await api<Array<{
          sessionId: string;
          projectId: string;
          requests: number;
          totalCost: number;
          startedAt: string;
        }>>('GET', `/api/sessions?${params.toString()}`);

        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

        if (data.length === 0) {
          console.log(chalk.yellow('No sessions found.'));
          return;
        }

        const table = new Table({
          head: ['Session ID', 'Project', 'Requests', 'Total Cost', 'Started At'].map(h => chalk.cyan(h)),
        });

        for (const s of data) {
          table.push([
            chalk.gray(s.sessionId.slice(0, 12) + '…'),
            s.projectId.slice(0, 12),
            s.requests,
            `$${s.totalCost.toFixed(6)}`,
            new Date(s.startedAt).toLocaleString(),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── report end-users ──
  cmd.command('end-users')
    .description('Show per-end-user usage stats')
    .option('--project <id>', 'Filter by project ID')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project?: string; json?: boolean }) => {
      try {
        const params = new URLSearchParams();
        if (opts.project) params.set('projectId', opts.project);
        const qs = params.toString();

        const data = await api<Array<{
          userId: string;
          requests: number;
          totalCost: number;
        }>>('GET', `/api/end-users${qs ? `?${qs}` : ''}`);

        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

        if (data.length === 0) {
          console.log(chalk.yellow('No end-user data found.'));
          return;
        }

        const table = new Table({
          head: ['User ID', 'Requests', 'Total Cost'].map(h => chalk.cyan(h)),
        });

        for (const u of data) {
          table.push([u.userId, u.requests, `$${u.totalCost.toFixed(6)}`]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
