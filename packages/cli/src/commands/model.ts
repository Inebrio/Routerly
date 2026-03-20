import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ModelConfig, TokenCost, Limit, PricingTier } from '@routerly/shared';

// ─── Interactive wizard helpers ───────────────────────────────────────────────

async function promptLimits(existing: Limit[] = []): Promise<Limit[]> {
  const { default: inquirer } = await import('inquirer');
  const limits: Limit[] = [...existing];

  const display = () => limits.length === 0
    ? chalk.gray('  (none)')
    : limits.map((l, i) => `  ${i + 1}. ${l.metric} ${l.windowType === 'period' ? l.period : `rolling ${l.rollingAmount} ${l.rollingUnit}`} ≤ ${l.value}`).join('\n');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log(chalk.bold('\nCurrent limits:'));
    console.log(display());

    const { action } = await inquirer.prompt([{
      type: 'list', name: 'action', message: 'Limits:',
      choices: [
        { name: 'Add a limit', value: 'add' },
        ...(limits.length ? [{ name: 'Remove a limit', value: 'remove' }] : []),
        { name: 'Done', value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'remove') {
      const { idx } = await inquirer.prompt([{
        type: 'list', name: 'idx', message: 'Which limit to remove?',
        choices: limits.map((l, i) => ({ name: `${l.metric} ${l.windowType === 'period' ? l.period : `rolling ${l.rollingAmount} ${l.rollingUnit}`} ≤ ${l.value}`, value: i })),
      }]);
      limits.splice(idx, 1);
      continue;
    }

    const { metric, windowType } = await inquirer.prompt([
      { type: 'list', name: 'metric', message: 'Metric:', choices: ['cost', 'calls', 'input_tokens', 'output_tokens', 'total_tokens'] },
      { type: 'list', name: 'windowType', message: 'Window type:', choices: [{ name: 'period (calendar boundary)', value: 'period' }, { name: 'rolling (sliding window)', value: 'rolling' }] },
    ]);

    let limitEntry: Limit;
    if (windowType === 'period') {
      const { period } = await inquirer.prompt([
        { type: 'list', name: 'period', message: 'Period:', choices: ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] },
      ]);
      const { value } = await inquirer.prompt([
        { type: 'input', name: 'value', message: `Max ${metric} per ${period}:`, validate: (v: string) => !isNaN(parseFloat(v)) || 'Must be a number' },
      ]);
      limitEntry = { metric, windowType: 'period', period, value: parseFloat(value) };
    } else {
      const { rollingAmount, rollingUnit, value } = await inquirer.prompt([
        { type: 'input', name: 'rollingAmount', message: 'Window size (number):', validate: (v: string) => !isNaN(parseInt(v)) || 'Must be an integer' },
        { type: 'list', name: 'rollingUnit', message: 'Window unit:', choices: ['second', 'minute', 'hour', 'day', 'week', 'month'] },
        { type: 'input', name: 'value', message: `Max ${metric}:`, validate: (v: string) => !isNaN(parseFloat(v)) || 'Must be a number' },
      ]);
      limitEntry = { metric, windowType: 'rolling', rollingAmount: parseInt(rollingAmount), rollingUnit, value: parseFloat(value) };
    }
    limits.push(limitEntry);
  }
  return limits;
}

async function promptPricingTiers(existing: PricingTier[] = []): Promise<PricingTier[]> {
  const { default: inquirer } = await import('inquirer');
  const tiers: PricingTier[] = [...existing];

  const display = () => tiers.length === 0
    ? chalk.gray('  (none)')
    : tiers.map((t, i) => `  ${i + 1}. ${t.metric} > ${t.above}: $${t.inputPerMillion}/$${t.outputPerMillion} per 1M`).join('\n');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log(chalk.bold('\nCurrent pricing tiers:'));
    console.log(display());

    const { action } = await inquirer.prompt([{
      type: 'list', name: 'action', message: 'Pricing tiers:',
      choices: [
        { name: 'Add a tier', value: 'add' },
        ...(tiers.length ? [{ name: 'Remove a tier', value: 'remove' }] : []),
        { name: 'Done', value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'remove') {
      const { idx } = await inquirer.prompt([{
        type: 'list', name: 'idx', message: 'Which tier to remove?',
        choices: tiers.map((t, i) => ({ name: `${t.metric} > ${t.above}: $${t.inputPerMillion}/$${t.outputPerMillion}`, value: i })),
      }]);
      tiers.splice(idx, 1);
      continue;
    }

    const answers = await inquirer.prompt([
      { type: 'input', name: 'metric', message: 'Metric (e.g. context_tokens):', default: 'context_tokens' },
      { type: 'input', name: 'above', message: 'Apply when metric exceeds:', validate: (v: string) => !isNaN(parseInt(v)) || 'Must be a number' },
      { type: 'input', name: 'inputPerMillion', message: 'Input price $/1M:', validate: (v: string) => !isNaN(parseFloat(v)) || 'Must be a number' },
      { type: 'input', name: 'outputPerMillion', message: 'Output price $/1M:', validate: (v: string) => !isNaN(parseFloat(v)) || 'Must be a number' },
    ]);
    tiers.push({
      metric: answers.metric,
      above: parseInt(answers.above),
      inputPerMillion: parseFloat(answers.inputPerMillion),
      outputPerMillion: parseFloat(answers.outputPerMillion),
    });
  }
  return tiers;
}

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
    .addHelpText('after', `
Examples:
  routerly model list
`)
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
    .addHelpText('after', `
Examples:
  # OpenAI with automatic pricing preset
  routerly model add --id gpt-4o --provider openai --api-key sk-...

  # Anthropic
  routerly model add --id claude-3-5-sonnet-20241022 --provider anthropic --api-key sk-ant-...

  # Ollama local model (no API key, no cost)
  routerly model add --id llama3 --provider ollama --input-price 0 --output-price 0

  # Custom endpoint with monthly budget cap
  routerly model add --id my-model --provider custom \\
    --endpoint https://inference.example.com/v1 \\
    --input-price 1.0 --output-price 3.0 --monthly-budget 50

  # With full limits JSON (monthly cost cap + per-minute call rate)
  routerly model add --id gpt-4o --provider openai --api-key sk-... \\
    --limits-json '[{"metric":"cost","windowType":"period","period":"monthly","value":100},{"metric":"calls","windowType":"rolling","rollingAmount":1,"rollingUnit":"minute","value":60}]'

  # Interactive wizard for limits and pricing tiers
  routerly model add --id gpt-4o --provider openai --api-key sk-... --interactive
`)
    .requiredOption('--id <id>', 'Unique model ID (e.g. gpt-4o)')
    .requiredOption('--provider <provider>', 'Provider: openai | anthropic | gemini | ollama | custom')
    .option('--endpoint <url>', 'Custom API endpoint (uses provider default if omitted)')
    .option('--api-key <key>', 'API key (stored plaintext; file permissions protect it)')
    .option('--input-price <usd>', 'Cost per 1M input tokens in USD')
    .option('--output-price <usd>', 'Cost per 1M output tokens in USD')
    .option('--daily-budget <usd>', 'Global daily spend limit in USD (shorthand for --limits-json)')
    .option('--monthly-budget <usd>', 'Global monthly spend limit in USD (shorthand for --limits-json)')
    .option('--limits-json <json>', 'Limits array as JSON string')
    .option('--pricing-tiers-json <json>', 'Pricing tiers array as JSON string')
    .option('--interactive', 'Open interactive wizard for limits and pricing tiers')
    .action(async (opts: {
      id: string; provider: string; endpoint?: string; apiKey?: string;
      inputPrice?: string; outputPrice?: string; dailyBudget?: string; monthlyBudget?: string;
      limitsJson?: string; pricingTiersJson?: string; interactive?: boolean;
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

      let limits: Limit[] | undefined;
      let pricingTiers: PricingTier[] | undefined;

      if (opts.interactive) {
        limits = await promptLimits();
        pricingTiers = await promptPricingTiers();
      } else {
        if (opts.limitsJson) {
          try { limits = JSON.parse(opts.limitsJson) as Limit[]; }
          catch { console.error(chalk.red('--limits-json: invalid JSON')); process.exit(1); }
        } else if (opts.dailyBudget || opts.monthlyBudget) {
          limits = [
            ...(opts.dailyBudget   ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'daily'   as const, value: parseFloat(opts.dailyBudget)   }] : []),
            ...(opts.monthlyBudget ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'monthly' as const, value: parseFloat(opts.monthlyBudget) }] : []),
          ];
        }
        if (opts.pricingTiersJson) {
          try { pricingTiers = JSON.parse(opts.pricingTiersJson) as PricingTier[]; }
          catch { console.error(chalk.red('--pricing-tiers-json: invalid JSON')); process.exit(1); }
        }
      }

      if (pricingTiers?.length) cost.pricingTiers = pricingTiers;

      const body = {
        id: opts.id,
        name: opts.id,
        provider: opts.provider,
        endpoint: opts.endpoint ?? providerEndpoints[opts.provider] ?? '',
        apiKey: opts.apiKey,
        cost,
        ...(limits?.length ? { limits } : {}),
      };

      try {
        await api<ModelConfig>('POST', '/api/models', body);
        console.log(chalk.green(`✓ Model "${opts.id}" registered.`) + (preset ? chalk.gray(' (pricing from preset)') : ''));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`Model "${opts.id}" already exists. Use \`model remove\` first or \`model edit\`.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── model remove ──
  cmd.command('remove <id>')
    .description('Remove a registered model')
    .addHelpText('after', `
Examples:
  routerly model remove gpt-4o
  routerly model remove my-custom-model
`)
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

  // ── model edit ──
  cmd.command('edit <id>')
    .description('Edit a registered model')
    .addHelpText('after', `
Examples:
  # Update only the API key
  routerly model edit gpt-4o --api-key sk-new-key...

  # Change pricing
  routerly model edit gpt-4o --input-price 2.50 --output-price 10.00

  # Add a monthly cost limit
  routerly model edit gpt-4o \\
    --limits-json '[{"metric":"cost","windowType":"period","period":"monthly","value":200}]'

  # Rename a model
  routerly model edit old-id --new-id new-id

  # Edit limits and pricing tiers interactively
  routerly model edit gpt-4o --interactive
`)
    .option('--new-id <id>', 'Change the model ID')
    .option('--provider <provider>', 'Change provider')
    .option('--endpoint <url>', 'Change API endpoint')
    .option('--api-key <key>', 'Update API key')
    .option('--input-price <usd>', 'Cost per 1M input tokens in USD')
    .option('--output-price <usd>', 'Cost per 1M output tokens in USD')
    .option('--cache-price <usd>', 'Cache cost per 1M tokens in USD')
    .option('--context-window <tokens>', 'Context window size in tokens')
    .option('--limits-json <json>', 'Limits array as JSON string (replaces existing limits)')
    .option('--pricing-tiers-json <json>', 'Pricing tiers as JSON string (replaces existing tiers)')
    .option('--interactive', 'Open interactive wizard for limits and pricing tiers')
    .action(async (id: string, opts: {
      newId?: string; provider?: string; endpoint?: string; apiKey?: string;
      inputPrice?: string; outputPrice?: string; cachePrice?: string; contextWindow?: string;
      limitsJson?: string; pricingTiersJson?: string; interactive?: boolean;
    }) => {
      // Fetch existing model
      let existing: ModelConfig;
      try {
        const models = await api<ModelConfig[]>('GET', '/api/models');
        const found = models.find((m) => m.id === id);
        if (!found) {
          console.error(chalk.red(`Model "${id}" not found.`));
          process.exit(1);
        }
        existing = found;
      } catch (err) {
        console.error(chalk.red(`Error fetching models: ${(err as Error).message}`));
        process.exit(1);
      }

      // Resolve limits
      let limits: Limit[] | undefined;
      if (opts.interactive) {
        limits = await promptLimits((existing as ModelConfig & { limits?: Limit[] }).limits ?? []);
      } else if (opts.limitsJson) {
        try { limits = JSON.parse(opts.limitsJson) as Limit[]; }
        catch { console.error(chalk.red('--limits-json: invalid JSON')); process.exit(1); }
      }

      // Resolve pricing tiers
      let pricingTiers: PricingTier[] | undefined;
      if (opts.interactive) {
        pricingTiers = await promptPricingTiers(existing.cost?.pricingTiers ?? []);
      } else if (opts.pricingTiersJson) {
        try { pricingTiers = JSON.parse(opts.pricingTiersJson) as PricingTier[]; }
        catch { console.error(chalk.red('--pricing-tiers-json: invalid JSON')); process.exit(1); }
      }

      const updatedCost: TokenCost = {
        inputPerMillion:  opts.inputPrice  ? parseFloat(opts.inputPrice)  : (existing.cost?.inputPerMillion  ?? 0),
        outputPerMillion: opts.outputPrice ? parseFloat(opts.outputPrice) : (existing.cost?.outputPerMillion ?? 0),
        ...(opts.cachePrice ? { cachePerMillion: parseFloat(opts.cachePrice) } : existing.cost?.cachePerMillion !== undefined ? { cachePerMillion: existing.cost.cachePerMillion } : {}),
        ...(pricingTiers?.length ? { pricingTiers } : pricingTiers === undefined && existing.cost?.pricingTiers?.length ? { pricingTiers: existing.cost.pricingTiers } : {}),
      };

      const body: Record<string, unknown> = {
        provider:      opts.provider      ?? existing.provider,
        endpoint:      opts.endpoint      ?? existing.endpoint,
        cost:          updatedCost,
        ...(opts.newId        ? { id: opts.newId }                                           : {}),
        ...(opts.apiKey       ? { apiKey: opts.apiKey }                                      : {}),
        ...(opts.contextWindow ? { contextWindow: parseInt(opts.contextWindow, 10) }          : {}),
        ...(limits !== undefined ? { limits } : {}),
      };

      try {
        await api<ModelConfig>('PUT', `/api/models/${encodeURIComponent(id)}`, body);
        const newId = opts.newId ?? id;
        console.log(chalk.green(`✓ Model "${newId}" updated.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Model "${id}" not found.`));
        } else if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`A model with ID "${opts.newId}" already exists.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
