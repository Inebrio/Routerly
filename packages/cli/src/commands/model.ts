import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ModelConfig, TokenCost } from '@routerly/shared';

// ─── Known model pricing presets (cost per 1M tokens in USD) ─────────────────
const PRICING_PRESETS: Record<string, TokenCost> = {
  'gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 1, outputPerMillion: 5 },
  'claude-3-opus-20240229': { inputPerMillion: 15, outputPerMillion: 75 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
};

export function makeModelCommand(): Command {
  const cmd = new Command('model').description('Manage LLM provider models');

  // ── model list ──
  cmd.command('list')
    .description('List all registered models')
    .action(async () => {
      try {
        const models = await api<ModelConfig[]>('GET', '/api/models');
        if (models.length === 0) {
          console.log(chalk.yellow('No models registered yet. Use `routerly model add` to add one.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Provider', 'Endpoint', 'Input $/1M', 'Output $/1M'].map(h => chalk.cyan(h)),
        });
        for (const m of models) {
          table.push([m.id, m.provider, m.endpoint, `$${m.cost.inputPerMillion}`, `$${m.cost.outputPerMillion}`]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── model add ──
  cmd.command('add')
    .description('Register a new LLM model')
    .requiredOption('--id <id>', 'Unique model ID (e.g. gpt-4o)')
    .requiredOption('--provider <provider>', 'Provider: openai | anthropic | gemini | ollama | custom')
    .option('--endpoint <url>', 'Custom API endpoint (uses provider default if omitted)')
    .option('--api-key <key>', 'API key (stored plaintext; file permissions protect it)')
    .option('--input-price <usd>', 'Cost per 1M input tokens in USD')
    .option('--output-price <usd>', 'Cost per 1M output tokens in USD')
    .option('--daily-budget <usd>', 'Global daily spend limit in USD')
    .option('--monthly-budget <usd>', 'Global monthly spend limit in USD')
    .action(async (opts: {
      id: string; provider: string; endpoint?: string; apiKey?: string;
      inputPrice?: string; outputPrice?: string; dailyBudget?: string; monthlyBudget?: string;
    }) => {
      const preset = PRICING_PRESETS[opts.id];
      const cost: TokenCost = {
        inputPerMillion: opts.inputPrice ? parseFloat(opts.inputPrice) : (preset?.inputPerMillion ?? 0),
        outputPerMillion: opts.outputPrice ? parseFloat(opts.outputPrice) : (preset?.outputPerMillion ?? 0),
      };

      const providerEndpoints: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        ollama: 'http://localhost:11434/v1',
      };

      const body = {
        id: opts.id,
        name: opts.id,
        provider: opts.provider,
        endpoint: opts.endpoint ?? providerEndpoints[opts.provider] ?? '',
        apiKey: opts.apiKey,
        cost,
        globalThresholds: {
          daily: opts.dailyBudget ? parseFloat(opts.dailyBudget) : undefined,
          monthly: opts.monthlyBudget ? parseFloat(opts.monthlyBudget) : undefined,
        },
      };

      try {
        await api<ModelConfig>('POST', '/api/models', body);
        console.log(chalk.green(`✓ Model "${opts.id}" registered.`) + (preset ? chalk.gray(' (pricing from preset)') : ''));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`Model "${opts.id}" already exists. Use \`model remove\` first.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── model remove ──
  cmd.command('remove <id>')
    .description('Remove a registered model')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/models/${encodeURIComponent(id)}`);
        console.log(chalk.green(`✓ Model "${id}" removed.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Model "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
