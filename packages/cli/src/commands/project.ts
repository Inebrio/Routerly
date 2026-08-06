import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { DEFAULT_PROJECT_TIMEOUT_MS } from '@routerly/shared';
import type { ProjectConfig, RoutingPolicy, RoutingPolicyType, TokenModelRef, Limit, LimitMetric, LimitPeriod, RollingUnit, UserConfig, GuardrailConfig, GuardrailRule, GuardrailRuleType, RegexGuardConfig, SemanticGuardConfig, TopicGuardConfig, ModerationGuardConfig, PiiConfig, PiiPolicy } from '@routerly/shared';

// ─── Helper: TTFT timeout display ────────────────────────────────────────────

/** 0 means "wait as long as the provider takes", which reads better than "0s". */
function formatTimeout(timeoutMs?: number): string {
  if (timeoutMs === 0) return 'off';
  return `${(timeoutMs ?? DEFAULT_PROJECT_TIMEOUT_MS) / 1000}s`;
}

/** Parses --timeout, rejecting anything that is not a non-negative integer. */
function parseTimeoutOption(raw: string): number {
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 0) {
    console.error(chalk.red('--timeout must be a non-negative integer in milliseconds (0 disables the timeout).'));
    process.exit(1);
  }
  return ms;
}

// ─── Helper: resolve project by name or ID ────────────────────────────────────

async function resolveProject(nameOrId: string): Promise<ProjectConfig> {
  const projects = await api<ProjectConfig[]>('GET', '/api/projects');
  const project = projects.find(p => p.id === nameOrId || p.name === nameOrId);
  if (!project) {
    console.error(chalk.red(`Project "${nameOrId}" not found. Run \`routerly project list\` to see available projects.`));
    process.exit(1);
  }
  return project;
}

// ─── Helper: resolve user email → id ─────────────────────────────────────────

async function resolveUserId(email: string): Promise<string> {
  const users = await api<UserConfig[]>('GET', '/api/users');
  const user = users.find(u => u.email === email);
  if (!user) {
    console.error(chalk.red(`User "${email}" not found.`));
    process.exit(1);
  }
  return user.id;
}

// ─── Helper: resolve userId → email ──────────────────────────────────────────

async function resolveUserEmail(userId: string, users: UserConfig[]): Promise<string> {
  return users.find(u => u.id === userId)?.email ?? chalk.gray(`(${userId.slice(0, 8)}…)`);
}

// ─── Helper: parse limit spec  ────────────────────────────────────────────────
// format: <model-id>:<metric>:<windowType>:<period-or-rolling>:<value>
// examples:
//   openai/gpt-5.2:cost:period:hourly:10
//   openai/gpt-5.2:calls:rolling:1:hour:100   (rolling window: amount + unit)

function parseTags(kvs: string[]): Record<string, string> | undefined {
  if (!kvs.length) return undefined;
  const out: Record<string, string> = {};
  for (const kv of kvs) {
    const eq = kv.indexOf('=');
    if (eq === -1) { out[kv] = ''; } else { out[kv.slice(0, eq)] = kv.slice(eq + 1); }
  }
  return out;
}

function parseLimitSpec(spec: string): { modelId: string; limit: Limit } {
  const parts = spec.split(':');
  // model can contain '/' but we split on ':' — use first segment as model, rest as limit fields
  // format: <modelId>:<metric>:<windowType>:(<period>|<rollingAmount>:<rollingUnit>):<value>
  if (parts.length < 5) {
    console.error(chalk.red(`Invalid limit spec "${spec}". Expected format:\n  <model>:<metric>:period:<period>:<value>\n  <model>:<metric>:rolling:<amount>:<unit>:<value>`));
    process.exit(1);
  }
  const [modelId, metric, windowType, ...rest] = parts as [string, string, string, ...string[]];
  let limit: Limit;
  if (windowType === 'period') {
    const [period, value] = rest as [string, string];
    limit = { metric: metric as LimitMetric, windowType: 'period', period: period as LimitPeriod, value: parseFloat(value!) };
  } else if (windowType === 'rolling') {
    const [rollingAmount, rollingUnit, value] = rest as [string, string, string];
    limit = { metric: metric as LimitMetric, windowType: 'rolling', rollingAmount: parseInt(rollingAmount!), rollingUnit: rollingUnit as RollingUnit, value: parseFloat(value!) };
  } else {
    console.error(chalk.red(`Unknown windowType "${windowType}". Use "period" or "rolling".`));
    process.exit(1);
  }
  return { modelId: modelId!, limit };
}

// ─── Routing subcommand group ─────────────────────────────────────────────────

function makeRoutingCommand(): Command {
  const cmd = new Command('routing').description('Manage project routing configuration');

  // routing show <project>
  cmd.command('show <project>')
    .description('Show routing configuration for a project')
    .addHelpText('after', `
Examples:
  routerly project routing show my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        console.log(chalk.bold(`\nRouting — ${project.name}`));
        console.log(chalk.gray(`  Auto-routing:    `) + (project.autoRouting ? chalk.green('enabled') : chalk.yellow('disabled')));
        console.log(chalk.gray(`  Routing model:   `) + (project.routingModelId ?? chalk.gray('(not set)')));
        const fallbacks = project.fallbackRoutingModelIds ?? [];
        console.log(chalk.gray(`  Fallback models: `) + (fallbacks.length ? fallbacks.join(', ') : chalk.gray('(none)')));

        const policies = project.policies ?? [];
        if (policies.length === 0) {
          console.log(chalk.gray('\n  No routing policies configured.'));
        } else {
          console.log('');
          const table = new Table({
            head: ['#', 'Policy', 'Enabled', 'Config'].map(h => chalk.cyan(h)),
          });
          policies.forEach((p, i) => {
            table.push([
              i + 1,
              p.type,
              p.enabled ? chalk.green('✓') : chalk.gray('—'),
              p.config ? JSON.stringify(p.config) : chalk.gray('—'),
            ]);
          });
          console.log(table.toString());
        }
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // routing update <project>
  cmd.command('update <project>')
    .description('Update routing model and auto-routing settings')
    .addHelpText('after', `
Examples:
  # Enable auto-routing with a specific routing model
  routerly project routing update my-api --routing-model ollama/qwen3.5:9b --auto-routing

  # Disable auto-routing
  routerly project routing update my-api --no-auto-routing

  # Set fallback routing models
  routerly project routing update my-api --fallback-models gpt-4o-mini,claude-3-5-haiku
`)
    .option('--routing-model <id>', 'Model ID to use for routing decisions')
    .option('--fallback-models <ids>', 'Comma-separated fallback routing model IDs')
    .option('--auto-routing', 'Enable auto-routing')
    .option('--no-auto-routing', 'Disable auto-routing')
    .action(async (nameOrId: string, opts: { routingModel?: string; fallbackModels?: string; autoRouting?: boolean }) => {
      try {
        const project = await resolveProject(nameOrId);
        const body: Record<string, unknown> = {
          name: project.name,
          models: project.models,
          timeoutMs: project.timeoutMs,
          policies: project.policies,
          autoRouting: opts.autoRouting !== undefined ? opts.autoRouting : project.autoRouting,
          routingModelId: opts.routingModel ?? project.routingModelId,
          fallbackRoutingModelIds: opts.fallbackModels
            ? opts.fallbackModels.split(',').map(s => s.trim()).filter(Boolean)
            : project.fallbackRoutingModelIds,
        };
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, body);
        console.log(chalk.green(`✓ Routing updated for "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── routing policy subgroup ──────────────────────────────────────────────────
  const policyCmd = new Command('policy').description('Manage routing policies for a project');

  policyCmd.command('list <project>')
    .description('List all routing policies')
    .addHelpText('after', `
Examples:
  routerly project routing policy list my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const policies = project.policies ?? [];
        if (policies.length === 0) {
          console.log(chalk.yellow('No routing policies configured.'));
          return;
        }
        const table = new Table({
          head: ['#', 'Type', 'Enabled', 'Config'].map(h => chalk.cyan(h)),
        });
        policies.forEach((p, i) => {
          table.push([
            i + 1,
            p.type,
            p.enabled ? chalk.green('✓') : chalk.gray('—'),
            p.config ? JSON.stringify(p.config) : chalk.gray('—'),
          ]);
        });
        console.log(table.toString());
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  policyCmd.command('enable <project> <type>')
    .description('Enable a routing policy (adds it if not present)')
    .addHelpText('after', `
Policy types: health, context, capability, budget-remaining, rate-limit, llm, performance, fairness, cheapest, semantic-intent, model-preference

Examples:
  routerly project routing policy enable my-api health
  routerly project routing policy enable my-api llm --config '{"memoryCount":3}'
  routerly project routing policy enable my-api model-preference --config '{"bonus":0.8}'
  routerly project routing policy enable my-api semantic-intent --config '{"embedding_provider":"openai","embedding_model":"text-embedding-3-small","absolute_threshold":0.60,"ambiguity_threshold":0.08,"intents":{"coding":{"examples":["write a python function"],"candidate_models":["qwen-coder"]}}}'
`)
    .option('--config <json>', 'Policy-specific configuration as JSON')
    .action(async (nameOrId: string, type: string, opts: { config?: string }) => {
      try {
        const project = await resolveProject(nameOrId);
        const policies: RoutingPolicy[] = project.policies ? [...project.policies] : [];
        const existing = policies.find(p => p.type === type as RoutingPolicyType);
        let parsedConfig: unknown;
        if (opts.config) {
          try { parsedConfig = JSON.parse(opts.config); } catch {
            console.error(chalk.red('Invalid JSON in --config'));
            process.exit(1);
          }
        }
        if (existing) {
          existing.enabled = true;
          if (parsedConfig !== undefined) existing.config = parsedConfig;
        } else {
          const newPolicy: RoutingPolicy = { type: type as RoutingPolicyType, enabled: true };
          if (parsedConfig !== undefined) newPolicy.config = parsedConfig;
          policies.push(newPolicy);
        }
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, models: project.models, timeoutMs: project.timeoutMs,
          autoRouting: project.autoRouting, routingModelId: project.routingModelId,
          fallbackRoutingModelIds: project.fallbackRoutingModelIds, policies,
        });
        console.log(chalk.green(`✓ Policy "${type}" enabled for "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  policyCmd.command('disable <project> <type>')
    .description('Disable a routing policy')
    .addHelpText('after', `
Examples:
  routerly project routing policy disable my-api cheapest
`)
    .action(async (nameOrId: string, type: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const policies: RoutingPolicy[] = project.policies ? [...project.policies] : [];
        const existing = policies.find(p => p.type === type as RoutingPolicyType);
        if (!existing) {
          console.log(chalk.yellow(`Policy "${type}" is not configured for "${project.name}".`));
          return;
        }
        existing.enabled = false;
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, models: project.models, timeoutMs: project.timeoutMs,
          autoRouting: project.autoRouting, routingModelId: project.routingModelId,
          fallbackRoutingModelIds: project.fallbackRoutingModelIds, policies,
        });
        console.log(chalk.green(`✓ Policy "${type}" disabled for "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  policyCmd.command('reorder <project> <types>')
    .description('Reorder routing policies (comma-separated list of types in desired order)')
    .addHelpText('after', `
Examples:
  routerly project routing policy reorder my-api health,context,budget-remaining,llm,cheapest
`)
    .action(async (nameOrId: string, typesStr: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const order = typesStr.split(',').map(s => s.trim()).filter(Boolean) as RoutingPolicyType[];
        const existing = project.policies ?? [];
        // Place policies matching the order first, then append any not mentioned
        const reordered: RoutingPolicy[] = [];
        for (const t of order) {
          const found = existing.find(p => p.type === t);
          if (found) reordered.push(found);
        }
        for (const p of existing) {
          if (!reordered.includes(p)) reordered.push(p);
        }
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, models: project.models, timeoutMs: project.timeoutMs,
          autoRouting: project.autoRouting, routingModelId: project.routingModelId,
          fallbackRoutingModelIds: project.fallbackRoutingModelIds, policies: reordered,
        });
        console.log(chalk.green(`✓ Policies reordered for "${project.name}".`));
        reordered.forEach((p, i) => console.log(chalk.gray(`  ${i + 1}. ${p.type} (${p.enabled ? 'enabled' : 'disabled'})`)));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.addCommand(policyCmd);
  return cmd;
}

// ─── Model subcommand group ───────────────────────────────────────────────────

function makeModelSubCommand(): Command {
  const cmd = new Command('model').description('Manage target models for a project');

  cmd.command('list <project>')
    .description('List target models in a project')
    .addHelpText('after', `
Examples:
  routerly project model list my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        if (project.models.length === 0) {
          console.log(chalk.yellow('No models configured for this project.'));
          return;
        }
        const table = new Table({
          head: ['Model ID', 'Prompt'].map(h => chalk.cyan(h)),
        });
        for (const m of project.models) {
          const prompt = m.prompt ? (m.prompt.length > 60 ? m.prompt.slice(0, 57) + '…' : m.prompt) : chalk.gray('—');
          table.push([m.modelId, prompt]);
        }
        console.log(table.toString());
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('add <project> <model-id>')
    .description('Add a target model to a project')
    .addHelpText('after', `
Examples:
  routerly project model add my-api openai/gpt-5.2
  routerly project model add my-api anthropic/claude-opus-4-6 --prompt "Use for complex reasoning tasks"
`)
    .option('--prompt <text>', 'System prompt hint used when this model is selected')
    .action(async (nameOrId: string, modelId: string, opts: { prompt?: string }) => {
      try {
        const project = await resolveProject(nameOrId);
        if (project.models.find(m => m.modelId === modelId)) {
          console.log(chalk.yellow(`Model "${modelId}" is already in project "${project.name}".`));
          return;
        }
        const updatedModels = [...project.models, opts.prompt ? { modelId, prompt: opts.prompt } : { modelId }];
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, timeoutMs: project.timeoutMs, autoRouting: project.autoRouting,
          routingModelId: project.routingModelId, fallbackRoutingModelIds: project.fallbackRoutingModelIds,
          policies: project.policies, models: updatedModels,
        });
        console.log(chalk.green(`✓ Model "${modelId}" added to project "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('remove <project> <model-id>')
    .description('Remove a target model from a project')
    .addHelpText('after', `
Examples:
  routerly project model remove my-api openai/gpt-5.2
`)
    .action(async (nameOrId: string, modelId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        if (!project.models.find(m => m.modelId === modelId)) {
          console.error(chalk.red(`Model "${modelId}" is not in project "${project.name}".`));
          process.exit(1);
        }
        const updatedModels = project.models.filter(m => m.modelId !== modelId);
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, timeoutMs: project.timeoutMs, autoRouting: project.autoRouting,
          routingModelId: project.routingModelId, fallbackRoutingModelIds: project.fallbackRoutingModelIds,
          policies: project.policies, models: updatedModels,
        });
        console.log(chalk.green(`✓ Model "${modelId}" removed from project "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('set-prompt <project> <model-id>')
    .description('Set or update the system prompt hint for a model in a project')
    .addHelpText('after', `
Examples:
  routerly project model set-prompt my-api openai/gpt-5.2 --prompt "Use for fast, simple tasks"

  # Clear the prompt
  routerly project model set-prompt my-api openai/gpt-5.2 --prompt ""
`)
    .requiredOption('--prompt <text>', 'New prompt text (use empty string to clear)')
    .action(async (nameOrId: string, modelId: string, opts: { prompt: string }) => {
      try {
        const project = await resolveProject(nameOrId);
        const entry = project.models.find(m => m.modelId === modelId);
        if (!entry) {
          console.error(chalk.red(`Model "${modelId}" is not in project "${project.name}".`));
          process.exit(1);
        }
        const updatedModels = project.models.map(m =>
          m.modelId === modelId
            ? opts.prompt ? { modelId, prompt: opts.prompt } : { modelId }
            : m
        );
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name, timeoutMs: project.timeoutMs, autoRouting: project.autoRouting,
          routingModelId: project.routingModelId, fallbackRoutingModelIds: project.fallbackRoutingModelIds,
          policies: project.policies, models: updatedModels,
        });
        console.log(chalk.green(`✓ Prompt updated for "${modelId}" in "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  return cmd;
}

// ─── Token subcommand group ───────────────────────────────────────────────────

function makeTokenSubCommand(): Command {
  const cmd = new Command('token').description('Manage project tokens');

  cmd.command('list <project>')
    .description('List all tokens for a project')
    .addHelpText('after', `
Examples:
  routerly project token list my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const tokens = project.tokens ?? [];
        if (tokens.length === 0) {
          console.log(chalk.yellow('No tokens found for this project.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Snippet', 'Labels', 'Tags', 'Created', 'Per-model limits'].map(h => chalk.cyan(h)),
        });
        for (const t of tokens) {
          const labels = t.labels?.join(', ') || chalk.gray('—');
          const tags = t.tags && Object.keys(t.tags).length
            ? Object.entries(t.tags).map(([k, v]) => `${k}=${v}`).join(', ')
            : chalk.gray('—');
          const created = new Date(t.createdAt).toLocaleString('it-IT');
          const limits = t.models?.length
            ? t.models.map(m => `${m.modelId}(${m.limits?.length ?? 0})`).join(', ')
            : chalk.gray('—');
          table.push([t.id, t.tokenSnippet + '…', labels, tags, created, limits]);
        }
        console.log(table.toString());
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('create <project>')
    .description('Create a new token for a project (token shown only once)')
    .addHelpText('after', `
Examples:
  routerly project token create my-api
  routerly project token create my-api --labels dev,staging
  routerly project token create my-api --scopes batch,internal
`)
    .option('--labels <tags>', 'Comma-separated labels for this token')
    .option('--scopes <list>', 'Comma-separated free-form scopes (e.g. batch,internal)')
    .option('--tag <kv>', 'Key=value tag metadata (repeatable)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (nameOrId: string, opts: { labels?: string; scopes?: string; tag: string[] }) => {
      try {
        const project = await resolveProject(nameOrId);
        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()).filter(Boolean) : undefined;
        const scopes = opts.scopes ? opts.scopes.split(',').map(s => s.trim()).filter(Boolean) : undefined;
        const tags = parseTags(opts.tag);
        const res = await api<{ token: string; tokenInfo: { id: string; tokenSnippet: string; createdAt: string } }>(
          'POST',
          `/api/projects/${encodeURIComponent(project.id)}/tokens`,
          { ...(labels ? { labels } : {}), ...(scopes ? { scopes } : {}), ...(tags ? { tags } : {}) }
        );
        console.log(chalk.green(`✓ Token created for project "${project.name}".`));
        console.log(chalk.bold('\nToken (save this — shown only once):'));
        console.log(chalk.yellow(res.token));
        console.log(chalk.gray(`  ID:      ${res.tokenInfo.id}`));
        console.log(chalk.gray(`  Snippet: ${res.tokenInfo.tokenSnippet}…`));
        if (labels?.length) console.log(chalk.gray(`  Labels:  ${labels.join(', ')}`));
        if (scopes?.length) console.log(chalk.gray(`  Scopes:  ${scopes.join(', ')}`));
        if (tags) console.log(chalk.gray(`  Tags:    ${Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(', ')}`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('edit <project> <token-id>')
    .description('Edit labels or per-model limits of a token')
    .addHelpText('after', `
Limit spec format:
  <model-id>:<metric>:period:<period>:<value>
  <model-id>:<metric>:rolling:<amount>:<unit>:<value>

Metrics:  cost | calls | input_tokens | output_tokens | total_tokens
Periods:  hourly | daily | weekly | monthly | yearly
Units:    second | minute | hour | day | week | month

Examples:
  # Update labels
  routerly project token edit my-api <token-id> --labels prod,v2

  # Update access scopes
  routerly project token edit my-api <token-id> --scopes batch,internal

  # Add a cost limit on a specific model
  routerly project token edit my-api <token-id> --add-limit "openai/gpt-5.2:cost:period:hourly:10"

  # Add a rolling calls limit
  routerly project token edit my-api <token-id> --add-limit "anthropic/claude-opus-4-6:calls:rolling:1:day:100"

  # Remove a limit
  routerly project token edit my-api <token-id> --remove-limit "openai/gpt-5.2:cost:period:hourly"
`)
    .option('--labels <tags>', 'Comma-separated labels (replaces existing labels)')
    .option('--scopes <list>', 'Comma-separated access scopes (replaces existing scopes)')
    .option('--tag <kv>', 'Key=value tag (repeatable; replaces all existing tags)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--add-limit <spec>', 'Add a per-model limit (repeatable)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option('--remove-limit <spec>', 'Remove a limit: <model>:<metric>:<windowType> (repeatable)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (nameOrId: string, tokenId: string, opts: { labels?: string; scopes?: string; tag: string[]; addLimit: string[]; removeLimit: string[] }) => {
      try {
        const project = await resolveProject(nameOrId);
        const token = (project.tokens ?? []).find(t => t.id === tokenId);
        if (!token) {
          console.error(chalk.red(`Token "${tokenId}" not found in project "${project.name}".`));
          process.exit(1);
        }

        // Build updated models (per-token limit overrides)
        let models: TokenModelRef[] = token.models ? JSON.parse(JSON.stringify(token.models)) : [];

        for (const spec of opts.addLimit) {
          const { modelId, limit } = parseLimitSpec(spec);
          let entry = models.find(m => m.modelId === modelId);
          if (!entry) { entry = { modelId, limits: [] }; models.push(entry); }
          if (!entry.limits) entry.limits = [];
          entry.limits.push(limit);
        }

        for (const spec of opts.removeLimit) {
          const parts = spec.split(':');
          const [rmModelId, rmMetric, rmWindowType] = parts as [string, string, string];
          const entry = models.find(m => m.modelId === rmModelId);
          if (entry?.limits) {
            entry.limits = entry.limits.filter(l =>
              !(l.metric === rmMetric && l.windowType === rmWindowType)
            );
            if (entry.limits.length === 0) delete (entry as Partial<TokenModelRef>).limits;
          }
        }

        // Remove entries with no limits left (and no other config)
        models = models.filter(m => m.limits && m.limits.length > 0);

        const labels = opts.labels ? opts.labels.split(',').map(s => s.trim()).filter(Boolean) : token.labels;
        const scopes = opts.scopes ? opts.scopes.split(',').map(s => s.trim()).filter(Boolean) : token.scopes;
        const tags = opts.tag.length ? parseTags(opts.tag) : token.tags;
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}/tokens/${encodeURIComponent(tokenId)}`, {
          models,
          ...(labels !== undefined ? { labels } : {}),
          ...(scopes !== undefined ? { scopes } : {}),
          ...(tags !== undefined ? { tags } : {}),
        });
        console.log(chalk.green(`✓ Token "${tokenId}" updated in project "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('remove <project> <token-id>')
    .description('Delete a token from a project')
    .addHelpText('after', `
Examples:
  routerly project token remove my-api <token-id>
`)
    .action(async (nameOrId: string, tokenId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        await api<void>('DELETE', `/api/projects/${encodeURIComponent(project.id)}/tokens/${encodeURIComponent(tokenId)}`);
        console.log(chalk.green(`✓ Token removed from project "${project.name}".`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Token "${tokenId}" not found.`));
        } else if (!(err instanceof ApiError)) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        } else {
          console.error(chalk.red(`Error: ${err.message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ─── Member subcommand group ──────────────────────────────────────────────────

function makeMemberCommand(): Command {
  const cmd = new Command('member').description('Manage project members');

  cmd.command('list <project>')
    .description('List members of a project')
    .addHelpText('after', `
Examples:
  routerly project member list my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const members = project.members ?? [];
        if (members.length === 0) {
          console.log(chalk.yellow('No members in this project.'));
          return;
        }
        const users = await api<UserConfig[]>('GET', '/api/users');
        const table = new Table({
          head: ['Email', 'Role', 'User ID'].map(h => chalk.cyan(h)),
        });
        for (const m of members) {
          const email = await resolveUserEmail(m.userId, users);
          table.push([email, m.role, chalk.gray(m.userId)]);
        }
        console.log(table.toString());
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('add <project>')
    .description('Add a user to a project')
    .addHelpText('after', `
Roles: viewer | editor | admin

Examples:
  routerly project member add my-api --email alice@example.com --role editor
  routerly project member add my-api --email bob@example.com --role viewer
`)
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--role <role>', 'Role to assign (viewer, editor, admin)')
    .action(async (nameOrId: string, opts: { email: string; role: string }) => {
      try {
        const [project, userId] = await Promise.all([
          resolveProject(nameOrId),
          resolveUserId(opts.email),
        ]);
        await api<void>('POST', `/api/projects/${encodeURIComponent(project.id)}/members`, {
          userId,
          role: opts.role,
        });
        console.log(chalk.green(`✓ "${opts.email}" added to "${project.name}" as ${opts.role}.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`User "${opts.email}" is already a member of this project.`));
        } else if (!(err instanceof ApiError)) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        } else {
          console.error(chalk.red(`Error: ${err.message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('set-role <project>')
    .description('Change the role of a project member')
    .addHelpText('after', `
Roles: viewer | editor | admin

Examples:
  routerly project member set-role my-api --email alice@example.com --role admin
`)
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--role <role>', 'New role (viewer, editor, admin)')
    .action(async (nameOrId: string, opts: { email: string; role: string }) => {
      try {
        const [project, userId] = await Promise.all([
          resolveProject(nameOrId),
          resolveUserId(opts.email),
        ]);
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(userId)}`, {
          role: opts.role,
        });
        console.log(chalk.green(`✓ "${opts.email}" role updated to "${opts.role}" in "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.command('remove <project>')
    .description('Remove a user from a project')
    .addHelpText('after', `
Examples:
  routerly project member remove my-api --email alice@example.com
`)
    .requiredOption('--email <email>', 'User email to remove')
    .action(async (nameOrId: string, opts: { email: string }) => {
      try {
        const [project, userId] = await Promise.all([
          resolveProject(nameOrId),
          resolveUserId(opts.email),
        ]);
        await api<void>('DELETE', `/api/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(userId)}`);
        console.log(chalk.green(`✓ "${opts.email}" removed from project "${project.name}".`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`"${opts.email}" is not a member of this project.`));
        } else if (!(err instanceof ApiError)) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        } else {
          console.error(chalk.red(`Error: ${err.message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}


// ─── Guardrail helpers ────────────────────────────────────────────────────────

function rulesSummary(rule: GuardrailRule): string {
  let detail: string;
  switch (rule.type) {
    case 'regex': detail = `${(rule.config as RegexGuardConfig).patterns.length} pattern(s)`; break;
    case 'semantic': {
      const c = rule.config as SemanticGuardConfig;
      const semFb = c.fallbackModelIds?.length ? ` (+${c.fallbackModelIds.length} fallback)` : '';
      detail = `model: ${c.embeddingModelId}, ${c.examples.length} example(s), threshold: ${c.threshold ?? 0.82}${semFb}`; break;
    }
    case 'topic': {
      const c = rule.config as TopicGuardConfig;
      const topicFb = c.fallbackModelIds?.length ? ` (+${c.fallbackModelIds.length} fallback)` : '';
      detail = c.modelId ? `model: ${c.modelId}, threshold: ${c.threshold ?? 0.5}${topicFb}` : `topics: ${c.allowedTopics.slice(0, 40)}`; break;
    }
    case 'moderation': {
      const c = rule.config as ModerationGuardConfig;
      const modFb = c.fallbackModelIds?.length ? ` (+${c.fallbackModelIds.length} fallback)` : '';
      detail = c.modelId ? `model: ${c.modelId}, threshold: ${c.threshold ?? 0.5}${modFb}` : 'inject-only'; break;
    }
  }
  // block/log/judge-response are fixed invariants for judged rules — no signal.
  // Only the inject flag varies independently of the Target column.
  const inj = rule.inject ? ' [inject]' : '';
  return `${detail}${inj}`;
}

async function runAddRuleWizard(): Promise<GuardrailRule> {
  const { default: inquirer } = await import('inquirer');

  // ponytail: Inquirer 13 prompt() has no generic overload — cast after
  const typeAns = await inquirer.prompt([{
    type: 'list',
    name: 'type',
    message: 'Rule type:',
    choices: [
      { name: 'regex       - Block requests/responses matching regex patterns', value: 'regex' },
      { name: 'semantic    - Block semantically similar content using embeddings', value: 'semantic' },
      { name: 'topic       - Block off-topic requests using LLM judge', value: 'topic' },
      { name: 'moderation  - Detect harmful content using LLM judge', value: 'moderation' },
    ],
  }]) as { type: GuardrailRuleType };
  const type = typeAns.type;

  // Scope. regex/semantic scan one side (request/response/both). topic/moderation use
  // three independent flags: request/response judge that side, inject steers the
  // outgoing system prompt. At least one required; inject-only omits the judge.
  let target: 'request' | 'response' | 'both' | undefined;
  let inject = false;
  if (type === 'topic' || type === 'moderation') {
    const scopeAns = await inquirer.prompt([{
      type: 'checkbox',
      name: 'scope',
      message: 'Apply to:',
      choices: [
        { name: 'request  - judge the request', value: 'request' },
        { name: 'inject   - inject the rule into the request system prompt (steer, no block)', value: 'inject' },
        { name: 'response - judge the response', value: 'response' },
      ],
      validate: (v: readonly string[]) => v.length > 0 || 'Select at least one',
    }]) as { scope: string[] };
    const req = scopeAns.scope.includes('request');
    const res = scopeAns.scope.includes('response');
    inject = scopeAns.scope.includes('inject');
    target = req && res ? 'both' : req ? 'request' : res ? 'response' : undefined;
  } else {
    const targetAns = await inquirer.prompt([{
      type: 'list',
      name: 'target',
      message: 'Apply to:',
      choices: ['request', 'response', 'both'],
    }]) as { target: 'request' | 'response' | 'both' };
    target = targetAns.target;
  }
  const judgeActive = !!target; // a side is judged/scanned
  const injectOnly = !judgeActive; // topic/moderation with inject only, no judge
  // Judged rules always block + log (fixed invariants). inject-only rules only steer.
  if (inject) {
    console.log(chalk.yellow('  Note: injection appends the rule instruction to the outgoing request payload. No extra model call is made and nothing is blocked; the serving model self-enforces.'));
  }

  let config: GuardrailRule['config'];

  if (type === 'regex') {
    const ans = await inquirer.prompt([{
      type: 'input',
      name: 'patterns',
      message: 'Patterns (comma-separated regex):',
      validate: (v: string) => v.trim().length > 0 || 'At least one pattern required',
    }]) as { patterns: string };
    const rc: RegexGuardConfig = { patterns: ans.patterns.split(',').map((s: string) => s.trim()).filter(Boolean) };
    config = rc;

  } else if (type === 'semantic') {
    const ans = await inquirer.prompt([
      { type: 'input', name: 'embeddingModelId', message: 'Embedding model ID:', validate: (v: string) => v.trim().length > 0 || 'Required' },
      { type: 'input', name: 'examples', message: 'Example texts to block (comma-separated):', validate: (v: string) => v.trim().length > 0 || 'At least one example required' },
      { type: 'input', name: 'threshold', message: 'Similarity threshold (0-1, default 0.82):', default: '0.82' },
    ]) as { embeddingModelId: string; examples: string; threshold: string };
    const sc: SemanticGuardConfig = {
      embeddingModelId: ans.embeddingModelId.trim(),
      examples: ans.examples.split(',').map((s: string) => s.trim()).filter(Boolean),
      threshold: parseFloat(ans.threshold),
    };
    const fbSemantic = await inquirer.prompt([{
      type: 'input',
      name: 'fallbackModelIds',
      message: 'Fallback embedding model IDs (comma-separated, leave empty for none):',
      default: '',
    }]) as { fallbackModelIds: string };
    const semFallbacks = fbSemantic.fallbackModelIds.split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== sc.embeddingModelId);
    if (semFallbacks.length) sc.fallbackModelIds = semFallbacks;
    config = sc;

  } else if (type === 'topic') {
    const topicAns = await inquirer.prompt([
      { type: 'input', name: 'allowedTopics', message: 'Allowed topics (describe in natural language):', validate: (v: string) => v.trim().length > 0 || 'Required' },
    ]) as { allowedTopics: string };
    const tc: TopicGuardConfig = { allowedTopics: topicAns.allowedTopics.trim() };
    if (!injectOnly) {
      const jAns = await inquirer.prompt([
        { type: 'input', name: 'modelId', message: 'Judge model ID:', validate: (v: string) => v.trim().length > 0 || 'Required' },
        { type: 'input', name: 'threshold', message: 'On-topic score threshold (0-1, default 0.5):', default: '0.5' },
        { type: 'input', name: 'fallbackModelIds', message: 'Fallback judge model IDs (comma-separated, leave empty for none):', default: '' },
      ]) as { modelId: string; threshold: string; fallbackModelIds: string };
      tc.modelId = jAns.modelId.trim();
      tc.threshold = parseFloat(jAns.threshold);
      const topicFallbacks = jAns.fallbackModelIds.split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== tc.modelId);
      if (topicFallbacks.length) tc.fallbackModelIds = topicFallbacks;
    }
    config = tc;

  } else {
    // moderation — instructions/policy required (inject-only injects it; judged uses it as
    // the classifier prompt). Mirrors the dashboard's mandatory Custom instructions field.
    const spAns = await inquirer.prompt([{
      type: 'input',
      name: 'systemPrompt',
      message: 'Custom moderation instructions:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    }]) as { systemPrompt: string };
    const mc: ModerationGuardConfig = { systemPrompt: spAns.systemPrompt.trim() };
    if (!injectOnly) {
      const jAns = await inquirer.prompt([
        { type: 'input', name: 'modelId', message: 'Judge model ID:', validate: (v: string) => v.trim().length > 0 || 'Required' },
        { type: 'input', name: 'threshold', message: 'Harm score threshold (0-1, default 0.5):', default: '0.5' },
        { type: 'input', name: 'fallbackModelIds', message: 'Fallback judge model IDs (comma-separated, leave empty for none):', default: '' },
      ]) as { modelId: string; threshold: string; fallbackModelIds: string };
      mc.modelId = jAns.modelId.trim();
      mc.threshold = parseFloat(jAns.threshold);
      const modFallbacks = jAns.fallbackModelIds.split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== mc.modelId);
      if (modFallbacks.length) mc.fallbackModelIds = modFallbacks;
    }
    config = mc;
  }

  const rule: GuardrailRule = { type, config };
  if (target) rule.target = target;
  if (judgeActive) { rule.block = true; rule.log = true; }
  if (judgeActive && (type === 'topic' || type === 'moderation')) rule.useJudgeResponse = true;
  if (inject) rule.inject = true;
  return rule;
}

// ─── Main project command ─────────────────────────────────────────────────────

export function makeProjectCommand(): Command {
  const cmd = new Command('project').description('Manage Routerly projects');

  // ── project list ─────────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List all projects')
    .addHelpText('after', `
Examples:
  routerly project list
`)
    .action(async () => {
      try {
        const projects = await api<ProjectConfig[]>('GET', '/api/projects');
        if (projects.length === 0) {
          console.log(chalk.yellow('No projects yet. Use `routerly project create` to create one.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Name', 'Models', 'Tokens', 'Members', 'Timeout'].map(h => chalk.cyan(h)),
        });
        for (const p of projects) {
          table.push([
            chalk.gray(p.id.slice(0, 8) + '…'),
            p.name,
            p.models.length,
            (p.tokens ?? []).length,
            (p.members ?? []).length,
            formatTimeout(p.timeoutMs),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── project show ─────────────────────────────────────────────────────────────
  cmd.command('show <project>')
    .description('Show full details of a project')
    .addHelpText('after', `
Examples:
  routerly project show my-api
  routerly project show a1b2c3d4-e5f6-7890-abcd-ef1234567890
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const users = await api<UserConfig[]>('GET', '/api/users');

        console.log(chalk.bold(`\n── ${project.name} ──────────────────────────────────`));
        console.log(chalk.gray(`  ID:      `) + project.id);
        console.log(chalk.gray(`  Timeout: `) + formatTimeout(project.timeoutMs));
        console.log(chalk.gray(`  Traces:  `) + (project.traceContent ? 'metadata + content' : 'metadata only'));

        // Routing
        console.log(chalk.bold('\n  Routing'));
        console.log(chalk.gray(`    Auto-routing:    `) + (project.autoRouting ? chalk.green('enabled') : chalk.yellow('disabled')));
        console.log(chalk.gray(`    Routing model:   `) + (project.routingModelId ?? chalk.gray('(not set)')));
        const fallbacks = project.fallbackRoutingModelIds ?? [];
        console.log(chalk.gray(`    Fallback models: `) + (fallbacks.length ? fallbacks.join(', ') : chalk.gray('(none)')));
        const policies = project.policies ?? [];
        const enabledPolicies = policies.filter(p => p.enabled).map(p => p.type);
        console.log(chalk.gray(`    Policies:        `) + (enabledPolicies.length ? enabledPolicies.join(', ') : chalk.gray('(none enabled)')));

        // Models
        console.log(chalk.bold('\n  Target Models'));
        if (project.models.length === 0) {
          console.log(chalk.gray('    (none)'));
        } else {
          for (const m of project.models) {
            const prompt = m.prompt ? chalk.gray(` — "${m.prompt.slice(0, 50)}${m.prompt.length > 50 ? '…' : ''}"`) : '';
            console.log(`    • ${m.modelId}${prompt}`);
          }
        }

        // Tokens
        console.log(chalk.bold('\n  Tokens'));
        const tokens = project.tokens ?? [];
        if (tokens.length === 0) {
          console.log(chalk.gray('    (none)'));
        } else {
          for (const t of tokens) {
            const labels = t.labels?.length ? chalk.gray(` [${t.labels.join(', ')}]`) : '';
            const limits = t.models?.length ? chalk.gray(` (${t.models.length} model override(s))`) : '';
            console.log(`    • ${t.tokenSnippet}… — ${new Date(t.createdAt).toLocaleDateString('it-IT')}${labels}${limits}`);
          }
        }

        // Members
        console.log(chalk.bold('\n  Members'));
        const members = project.members ?? [];
        if (members.length === 0) {
          console.log(chalk.gray('    (none)'));
        } else {
          for (const m of members) {
            const email = await resolveUserEmail(m.userId, users);
            console.log(`    • ${email} — ${m.role}`);
          }
        }
        console.log('');
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── project create ───────────────────────────────────────────────────────────
  cmd.command('create')
    .description('Create a new project')
    .addHelpText('after', `
Examples:
  # Minimal project
  routerly project create --name "My API"

  # With a custom TTFT timeout
  routerly project create --name "Production" --timeout 5000

  # No TTFT timeout: wait as long as the provider takes
  routerly project create --name "Batch jobs" --timeout 0

  # With auto-routing enabled and a routing model
  routerly project create --name "Smart API" --routing-model ollama/qwen3.5:9b --auto-routing
`)
    .requiredOption('--name <name>', 'Project name')
    .option('--timeout <ms>', `TTFT timeout per model attempt in milliseconds (default: ${DEFAULT_PROJECT_TIMEOUT_MS}). Aborts if the first response byte does not arrive in time; 0 disables it.`)
    .option('--routing-model <id>', 'Model ID for routing decisions')
    .option('--auto-routing', 'Enable auto-routing (default: true)')
    .option('--no-auto-routing', 'Disable auto-routing')
    .action(async (opts: { name: string; timeout?: string; routingModel?: string; autoRouting?: boolean }) => {
      try {
        const body: Record<string, unknown> = {
          name: opts.name,
          timeoutMs: opts.timeout !== undefined ? parseTimeoutOption(opts.timeout) : DEFAULT_PROJECT_TIMEOUT_MS,
          autoRouting: opts.autoRouting !== undefined ? opts.autoRouting : true,
          models: [],
        };
        if (opts.routingModel) body.routingModelId = opts.routingModel;

        const project = await api<ProjectConfig & { token: string }>('POST', '/api/projects', body);

        console.log(chalk.green(`✓ Project "${opts.name}" created.`));
        console.log(chalk.gray(`  ID: ${project.id}`));
        if (project.token) {
          console.log(chalk.bold('\nProject token (save this — shown only once):'));
          console.log(chalk.yellow(project.token));
        }
        console.log(chalk.gray(`\nNext steps:`));
        console.log(chalk.gray(`  Add models:   routerly project model add "${opts.name}" <model-id>`));
        console.log(chalk.gray(`  Set routing:  routerly project routing update "${opts.name}" --routing-model <id>`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`A project named "${opts.name}" already exists.`));
        } else if (!(err instanceof ApiError)) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        } else {
          console.error(chalk.red(`Error: ${err.message}`));
        }
        process.exit(1);
      }
    });

  // ── project edit ─────────────────────────────────────────────────────────────
  cmd.command('edit <project>')
    .description('Edit project name, timeout or trace content capture')
    .addHelpText('after', `
Examples:
  routerly project edit my-api --name "My Production API"
  routerly project edit my-api --timeout 5000
  routerly project edit my-api --timeout 0
  routerly project edit my-api --trace-content
  routerly project edit my-api --no-trace-content
`)
    .option('--name <name>', 'New project name')
    .option('--timeout <ms>', 'New TTFT timeout per model attempt in milliseconds (0 disables it)')
    .option('--trace-content', 'Record prompts and answers in traces (off by default: metadata only)')
    .option('--no-trace-content', 'Record metadata only, no prompts or answers')
    // --trace-content declared before --no-trace-content, so an untouched flag stays
    // undefined and leaves the stored value alone.
    .action(async (nameOrId: string, opts: { name?: string; timeout?: string; traceContent?: boolean }) => {
      const traceContent = opts.traceContent;
      if (!opts.name && opts.timeout === undefined && traceContent === undefined) {
        console.error(chalk.red('Provide at least --name, --timeout or --trace-content.'));
        process.exit(1);
      }
      try {
        const project = await resolveProject(nameOrId);
        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: opts.name ?? project.name,
          timeoutMs: opts.timeout !== undefined ? parseTimeoutOption(opts.timeout) : project.timeoutMs,
          autoRouting: project.autoRouting,
          routingModelId: project.routingModelId,
          fallbackRoutingModelIds: project.fallbackRoutingModelIds,
          policies: project.policies,
          models: project.models,
          ...(traceContent !== undefined ? { traceContent } : {}),
        });
        console.log(chalk.green(`✓ Project "${project.name}" updated.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`A project named "${opts.name}" already exists.`));
        } else if (!(err instanceof ApiError)) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        } else {
          console.error(chalk.red(`Error: ${err.message}`));
        }
        process.exit(1);
      }
    });

  // ── project remove ───────────────────────────────────────────────────────────
  cmd.command('remove <project>')
    .description('Remove a project by name or ID')
    .addHelpText('after', `
Examples:
  routerly project remove my-api
  routerly project remove a1b2c3d4-e5f6-7890-abcd-ef1234567890
`)
    .action(async (nameOrId: string) => {
      try {
        const project = await resolveProject(nameOrId);
        await api<void>('DELETE', `/api/projects/${encodeURIComponent(project.id)}`);
        console.log(chalk.green(`✓ Project "${project.name}" removed.`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── subgroups ────────────────────────────────────────────────────────────────
  cmd.addCommand(makeRoutingCommand());
  cmd.addCommand(makeModelSubCommand());
  cmd.addCommand(makeTokenSubCommand());
  cmd.addCommand(makeMemberCommand());  

  // ── project guardrails <project> ─────────────────────────────────────────────
  cmd.command('guardrails <project>')
    .description('Show or update guardrails config for a project')
    .option('--add-rule', 'Add a new rule (interactive wizard)')
    .option('--remove-rule <index>', 'Remove rule by 0-based index')
    .option('--json', 'Output raw JSON (show only)')
    .addHelpText('after', `
Examples:
  routerly project guardrails my-api
  routerly project guardrails my-api --add-rule
  routerly project guardrails my-api --remove-rule 2
`)
    .action(async (nameOrId: string, opts: {
      addRule?: boolean; removeRule?: string; json?: boolean;
    }) => {
      try {
        const project = await resolveProject(nameOrId);
        const current: GuardrailConfig = project.guardrails ?? { rules: [] };

        const isUpdate = opts.addRule || opts.removeRule !== undefined;

        if (!isUpdate) {
          // ── show ──────────────────────────────────────────────────────────────
          if (opts.json) {
            console.log(JSON.stringify(current, null, 2));
            return;
          }
          console.log(chalk.bold(`\nGuardrails — ${project.name}\n`));

          if (!current.rules.length) {
            console.log(chalk.dim('  No rules configured.'));
          } else {
            const col: [number, number, number, number] = [4, 12, 10, 0];
            const header = ['#', 'Type', 'Target', 'Summary'].map((h, i) => chalk.bold(h).padEnd(col[i] ?? 0));
            console.log('Rules:');
            console.log('  ' + header.join('  '));
            current.rules.forEach((rule, idx) => {
              const summary = rulesSummary(rule);
              const cells = [
                String(idx).padEnd(col[0]),
                rule.type.padEnd(col[1]),
                (rule.target ?? 'inject').padEnd(col[2]),
                summary,
              ];
              console.log('  ' + cells.join('  '));
            });
          }
          console.log('');
          return;
        }

        // ── mutate ───────────────────────────────────────────────────────────────
        const updated: GuardrailConfig = { ...current, rules: [...current.rules] };

        if (opts.removeRule !== undefined) {
          const idx = parseInt(opts.removeRule, 10);
          if (isNaN(idx) || idx < 0 || idx >= updated.rules.length) {
            console.error(chalk.red(`Error: rule index ${opts.removeRule} out of bounds (0-${updated.rules.length - 1})`));
            process.exit(1);
          }
          updated.rules.splice(idx, 1);
        }

        if (opts.addRule) {
          const newRule = await runAddRuleWizard();
          updated.rules.push(newRule);
        }

        await api<void>('PATCH', `/api/projects/${encodeURIComponent(project.id)}/guardrails`, { guardrails: updated });
        console.log(chalk.green(`Guardrails updated for "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── project pii <project> ────────────────────────────────────────────────────
  const piiCmd = new Command('pii').description('Manage PII detection policies for a project');

  piiCmd.command('list <project>')
    .description('List PII policies for a project')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly project pii list my-api
  routerly project pii list my-api --json
`)
    .action(async (nameOrId: string, opts: { json?: boolean }) => {
      try {
        const project = await resolveProject(nameOrId);
        const pii = (project as ProjectConfig & { pii?: PiiConfig }).pii ?? { policies: [] };
        const policies = pii.policies ?? [];
        if (opts.json) {
          console.log(JSON.stringify(pii, null, 2));
          return;
        }
        console.log(chalk.bold(`\nPII Policies — ${project.name}`));
        if (!policies.length) {
          console.log(chalk.dim('  No PII policies configured.'));
          console.log('');
          return;
        }
        const table = new Table({
          head: ['#', 'Enabled', 'Target', 'Entities', 'Patterns', 'Buffer'].map(h => chalk.cyan(h)),
        });
        policies.forEach((p, i) => {
          const enabled = p.enabled !== false ? chalk.green('yes') : chalk.dim('no');
          const entities = p.entities?.join(', ') || chalk.dim('(none)');
          const patterns = p.customPatterns?.length ? String(p.customPatterns.length) : chalk.dim('0');
          const buffer = p.outputBufferSize !== undefined ? String(p.outputBufferSize) : chalk.dim('30');
          table.push([i, enabled, p.target, entities, patterns, buffer]);
        });
        console.log(table.toString());
        console.log('');
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  piiCmd.command('add <project>')
    .description('Add a PII policy to a project (interactive wizard)')
    .addHelpText('after', `
Examples:
  routerly project pii add my-api
`)
    .action(async (nameOrId: string) => {
      try {
        const { default: inquirer } = await import('inquirer');
        const project = await resolveProject(nameOrId);
        const pii = (project as ProjectConfig & { pii?: PiiConfig }).pii ?? { policies: [] };
        const policies = [...(pii.policies ?? [])];

        const ans = await inquirer.prompt([
          { type: 'list', name: 'target', message: 'Apply to:', choices: ['request', 'response', 'both'] },
          { type: 'input', name: 'entities', message: 'Entity types to detect (comma-separated, e.g. EMAIL,PHONE,SSN — leave empty for none):', default: '' },
          { type: 'input', name: 'customPatterns', message: 'Custom regex patterns (comma-separated — leave empty for none):', default: '' },
        ]) as { target: 'request' | 'response' | 'both'; entities: string; customPatterns: string };

        let outputBufferSize: number | undefined;
        if (ans.target === 'response' || ans.target === 'both') {
          const bufAns = await inquirer.prompt([{
            type: 'input',
            name: 'outputBufferSize',
            message: 'Streaming output buffer size in chars (default 30):',
            default: '30',
            validate: (v: string) => { const n = parseInt(v); return (!isNaN(n) && n >= 10 && n <= 500) || 'Must be a number between 10 and 500'; },
          }]) as { outputBufferSize: string };
          const n = parseInt(bufAns.outputBufferSize);
          if (n !== 30) outputBufferSize = n;
        }

        const policy: PiiPolicy = { enabled: true, target: ans.target };
        const entities = ans.entities.split(',').map((s: string) => s.trim()).filter(Boolean) as PiiPolicy['entities'];
        if (entities?.length) policy.entities = entities;
        const patterns = ans.customPatterns.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (patterns.length) policy.customPatterns = patterns;
        if (outputBufferSize !== undefined) policy.outputBufferSize = outputBufferSize;

        policies.push(policy);
        await api<void>('PATCH', `/api/projects/${encodeURIComponent(project.id)}/guardrails`, { pii: { policies } });
        console.log(chalk.green(`PII policy added to "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  piiCmd.command('remove <project> <index>')
    .description('Remove a PII policy from a project by its index (see `pii list`)')
    .addHelpText('after', `
Examples:
  routerly project pii remove my-api 0
`)
    .action(async (nameOrId: string, indexStr: string) => {
      try {
        const project = await resolveProject(nameOrId);
        const pii = (project as ProjectConfig & { pii?: PiiConfig }).pii ?? { policies: [] };
        const before = pii.policies ?? [];
        const index = Number(indexStr);
        if (!Number.isInteger(index) || index < 0 || index >= before.length) {
          console.error(chalk.red(`Invalid index "${indexStr}". Use \`pii list\` to see valid indices (0 to ${Math.max(0, before.length - 1)}).`));
          process.exit(1);
        }
        const policies = before.filter((_, i) => i !== index);
        await api<void>('PATCH', `/api/projects/${encodeURIComponent(project.id)}/guardrails`, { pii: { policies } });
        console.log(chalk.green(`PII policy #${index} removed from "${project.name}".`));
      } catch (err) {
        if (!(err instanceof ApiError)) console.error(chalk.red(`Error: ${(err as Error).message}`));
        else console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd.addCommand(piiCmd);

  return cmd;
}
