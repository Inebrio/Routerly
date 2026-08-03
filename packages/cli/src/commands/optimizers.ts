import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { OPTIMIZER_CATALOG, OPTIMIZER_FIXTURES, optimizerFixture, optimizerLabel, optimizerThreshold } from '@routerly/shared';
import type { ProjectConfig, OptimizerStep, OptimizerId, Message } from '@routerly/shared';

interface InstalledOptimizer {
  id: string;
  klass: string;
  installed: boolean;
}

interface PreviewResult {
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  perStep: { id: string; before: number; after: number; messages?: Message[]; rolledBack?: boolean; skipReason?: string }[];
  messages?: Message[];
}

interface LlmLinguaModelState {
  state: 'absent' | 'downloading' | 'ready';
  modelId: string;
  dtype: string;
  runtimeInstalled: boolean;
  error?: string;
}

/** The threshold of an optimizer as one cell: what it means and where it starts. */
function thresholdCell(id: string): string {
  const spec = optimizerThreshold(id);
  if (!spec) return '-';
  const range = `${spec.min}-${spec.max} ${spec.unit}`;
  return spec.default != null ? `${range}, default ${spec.default}` : `${range}, required`;
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

// Commander collector for repeatable options.
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function reportError(err: unknown): never {
  if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
  else console.error(chalk.red(String(err)));
  return process.exit(1);
}

export function makeOptimizersCommand(): Command {
  const cmd = new Command('optimizers').description('Inspect and configure prompt/context optimizers');

  // ── optimizers list ──────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List installed optimizers')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers list
  routerly optimizers list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const optimizers = await api<InstalledOptimizer[]>('GET', '/api/optimizers');
        // The service reports what is installed; the catalog says what each one
        // means and what its threshold does, so both surfaces describe them alike.
        const described = optimizers.map(o => ({
          ...o,
          label: optimizerLabel(o.id),
          ...(OPTIMIZER_CATALOG[o.id as OptimizerId]
            ? { description: OPTIMIZER_CATALOG[o.id as OptimizerId]!.description }
            : {}),
          ...(optimizerThreshold(o.id) ? { threshold: optimizerThreshold(o.id) } : {}),
        }));
        if (opts.json) {
          console.log(JSON.stringify(described, null, 2));
          return;
        }
        if (described.length === 0) {
          console.log(chalk.yellow('No optimizers installed.'));
          return;
        }
        const table = new Table({ head: ['ID', 'Name', 'Klass', 'Installed', 'Threshold'].map(h => chalk.cyan(h)) });
        for (const o of described) {
          table.push([o.id, o.label, o.klass, o.installed ? 'yes' : 'no', thresholdCell(o.id)]);
        }
        console.log(table.toString());
      } catch (err) {
        reportError(err);
      }
    });

  // ── optimizers fixtures ──────────────────────────────────────────────────────
  cmd.command('fixtures')
    .description('List the sample conversations shipped with Routerly')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers fixtures
  routerly optimizers preview my-api --fixture support-chat-en

Routerly never records real prompts. These conversations are written for the
repo, are identical on every install, and are the only preview material.
`)
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        console.log(JSON.stringify(OPTIMIZER_FIXTURES, null, 2));
        return;
      }
      const table = new Table({ head: ['ID', 'Name', 'Lang', 'Turns', 'Exercises'].map(h => chalk.cyan(h)) });
      for (const f of OPTIMIZER_FIXTURES) {
        table.push([f.id, f.label, f.language, String(f.messages.length), f.description]);
      }
      console.log(table.toString());
    });

  // ── optimizers model ─────────────────────────────────────────────────────────
  cmd.command('model')
    .description('Show or install the optional LLMLingua-2 checkpoint on the service host')
    .option('--install', 'Start the download and return immediately')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers model
  routerly optimizers model --install
  routerly optimizers model --json

The checkpoint is hundreds of megabytes and downloads on the service host, not
here. --install returns as soon as the download starts; run the command again
to see its progress.
`)
    .action(async (opts: { install?: boolean; json?: boolean }) => {
      try {
        const state = opts.install
          ? await api<LlmLinguaModelState>('POST', '/api/optimizers/llmlingua2/model', {})
          : await api<LlmLinguaModelState>('GET', '/api/optimizers/llmlingua2/model');
        if (opts.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }
        console.log(`${chalk.gray('model:  ')} ${state.modelId} (${state.dtype})`);
        console.log(`${chalk.gray('runtime:')} ${state.runtimeInstalled ? 'installed' : 'not installed'}`);
        console.log(`${chalk.gray('state:  ')} ${state.state}`);
        if (state.error) console.error(chalk.red(`error:   ${state.error}`));
        if (state.state === 'downloading') {
          console.log(chalk.gray('Downloading. Run `routerly optimizers model` again to check progress.'));
        }
      } catch (err) {
        reportError(err);
      }
    });

  // ── optimizers config ────────────────────────────────────────────────────────
  cmd.command('config <project>')
    .description('Configure a project optimizer pipeline (read-modify-write)')
    .option('--enable <id>', 'Enable an optimizer step (repeatable)', collect, [])
    .option('--disable <id>', 'Disable an optimizer step (repeatable)', collect, [])
    .option('--threshold <id=val>', 'Set an optimizer step threshold (repeatable)', collect, [])
    .option('--order <ids>', 'Comma-separated optimizer ids controlling step order')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers config my-api --enable ccr
  routerly optimizers config my-api --enable ccr --threshold ccr=8
  routerly optimizers config my-api --disable rtk --order ccr,headroom,rtk
`)
    .action(async (nameOrId: string, opts: {
      enable: string[];
      disable: string[];
      threshold: string[];
      order?: string;
      json?: boolean;
    }) => {
      try {
        const project = await resolveProject(nameOrId);

        // Clone the current steps so we never mutate the fetched object.
        const steps: OptimizerStep[] = (project.optimizers?.steps ?? []).map(s => ({ ...s }));
        const byId = new Map(steps.map(s => [s.id, s]));

        const upsert = (id: string): OptimizerStep => {
          let step = byId.get(id as OptimizerId);
          if (!step) {
            step = { id: id as OptimizerId, enabled: false };
            byId.set(id as OptimizerId, step);
            steps.push(step);
          }
          return step;
        };

        for (const id of opts.enable) upsert(id).enabled = true;
        for (const id of opts.disable) upsert(id).enabled = false;
        for (const entry of opts.threshold) {
          const eq = entry.indexOf('=');
          if (eq === -1) {
            console.error(chalk.red(`Error: --threshold expects id=value, got "${entry}".`));
            process.exit(1);
          }
          const id = entry.slice(0, eq).trim();
          const raw = entry.slice(eq + 1).trim();
          const val = Number(raw);
          if (!id || raw === '' || Number.isNaN(val)) {
            console.error(chalk.red(`Error: invalid --threshold "${entry}" (expected id=number).`));
            process.exit(1);
          }
          upsert(id).threshold = val;
        }

        let ordered = steps;
        if (opts.order !== undefined) {
          const orderIds = opts.order.split(',').map(s => s.trim()).filter(Boolean);
          const rank = new Map(orderIds.map((id, i) => [id, i]));
          // Stable sort: mentioned ids first in given order; the rest keep their relative order at the end.
          ordered = [...steps].sort((a, b) => {
            const ra = rank.has(a.id) ? rank.get(a.id)! : Infinity;
            const rb = rank.has(b.id) ? rank.get(b.id)! : Infinity;
            return ra - rb;
          });
        }

        const updated = await api<ProjectConfig>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
          name: project.name,
          models: project.models,
          ...(project.routingModelId !== undefined ? { routingModelId: project.routingModelId } : {}),
          ...(project.autoRouting !== undefined ? { autoRouting: project.autoRouting } : {}),
          ...(project.fallbackRoutingModelIds !== undefined ? { fallbackRoutingModelIds: project.fallbackRoutingModelIds } : {}),
          ...(project.policies !== undefined ? { policies: project.policies } : {}),
          ...(project.timeoutMs !== undefined ? { timeoutMs: project.timeoutMs } : {}),
          optimizers: { steps: ordered },
        });

        if (opts.json) {
          console.log(JSON.stringify(updated, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Updated optimizer pipeline on project "${project.name}"`));
        const finalSteps = updated.optimizers?.steps ?? ordered;
        if (finalSteps.length === 0) {
          console.log(chalk.gray('  (no steps)'));
        } else {
          const table = new Table({ head: ['#', 'ID', 'Name', 'Enabled', 'Threshold'].map(h => chalk.cyan(h)) });
          finalSteps.forEach((s, i) => {
            const spec = optimizerThreshold(s.id);
            const threshold = s.threshold ?? (spec?.default != null ? `${spec.default} (default)` : '-');
            table.push([String(i + 1), s.id, optimizerLabel(s.id), s.enabled ? 'yes' : 'no', String(threshold)]);
          });
          console.log(table.toString());
        }
      } catch (err) {
        reportError(err);
      }
    });

  // ── optimizers preview ───────────────────────────────────────────────────────
  cmd.command('preview <project>')
    .description('Dry-run the project optimizer pipeline over sample messages')
    .option('--message <text>', 'A user message to include (repeatable)', collect, [])
    .option('--fixture <id>', 'Use a shipped sample conversation instead of --message')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers preview my-api --message "Summarize this thread"
  routerly optimizers preview my-api --message "first" --message "second" --json
  routerly optimizers preview my-api --fixture support-chat-en

Run \`routerly optimizers fixtures\` for the available conversations.
`)
    .action(async (nameOrId: string, opts: { message: string[]; fixture?: string; json?: boolean }) => {
      try {
        if (opts.message.length === 0 && opts.fixture === undefined) {
          console.error(chalk.red('Error: provide at least one --message, or --fixture <id>.'));
          process.exit(1);
        }
        if (opts.message.length > 0 && opts.fixture !== undefined) {
          console.error(chalk.red('Error: --message and --fixture are mutually exclusive.'));
          process.exit(1);
        }
        let sampleMessages: Message[];
        if (opts.fixture !== undefined) {
          const fixture = optimizerFixture(opts.fixture);
          if (!fixture) {
            console.error(chalk.red(`Error: unknown fixture "${opts.fixture}". Available: ${OPTIMIZER_FIXTURES.map(f => f.id).join(', ')}.`));
            process.exit(1);
          }
          sampleMessages = fixture.messages;
        } else {
          sampleMessages = opts.message.map(text => ({ role: 'user', content: text }));
        }
        const project = await resolveProject(nameOrId);
        const steps = project.optimizers?.steps ?? [];
        const result = await api<PreviewResult>('POST', '/api/optimizers/preview', {
          projectId: project.id,
          sampleMessages,
          steps,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.gray('Tokens before: ') + result.estimatedTokensBefore);
        console.log(chalk.gray('Tokens after:  ') + result.estimatedTokensAfter);
        console.log(chalk.gray('Saved:         ') + (result.estimatedTokensBefore - result.estimatedTokensAfter));
        if (result.perStep.length === 0) {
          console.log(chalk.yellow('\nNo optimizer steps configured on this project.'));
          return;
        }
        // "Saved 0" is the same cell whether a step ran and found nothing or never
        // ran at all, which is exactly what sends an operator hunting. The reason
        // column separates the two.
        const table = new Table({ head: ['ID', 'Name', 'Before', 'After', 'Saved', 'Note'].map(h => chalk.cyan(h)) });
        for (const s of result.perStep) {
          const saved = s.rolledBack ? chalk.yellow('rolled back') : String(s.before - s.after);
          table.push([s.id, optimizerLabel(s.id), String(s.before), String(s.after), saved, s.skipReason ? chalk.gray(s.skipReason) : '']);
        }
        console.log('\n' + table.toString());
        if (result.perStep.some(s => s.rolledBack)) {
          console.log(chalk.yellow('\nA rolled-back step produced a prompt the service judged unsafe, so its change was discarded.'));
        }
      } catch (err) {
        reportError(err);
      }
    });

  return cmd;
}
