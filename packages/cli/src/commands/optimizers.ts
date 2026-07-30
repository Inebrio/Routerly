import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ProjectConfig, OptimizerStep, OptimizerId, Message } from '@routerly/shared';

interface InstalledOptimizer {
  id: string;
  klass: string;
  installed: boolean;
}

interface PreviewResult {
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  perStep: { id: string; before: number; after: number }[];
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
        if (opts.json) {
          console.log(JSON.stringify(optimizers, null, 2));
          return;
        }
        if (optimizers.length === 0) {
          console.log(chalk.yellow('No optimizers installed.'));
          return;
        }
        const table = new Table({ head: ['ID', 'Klass', 'Installed'].map(h => chalk.cyan(h)) });
        for (const o of optimizers) {
          table.push([o.id, o.klass, o.installed ? 'yes' : 'no']);
        }
        console.log(table.toString());
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
          const table = new Table({ head: ['#', 'ID', 'Enabled', 'Threshold'].map(h => chalk.cyan(h)) });
          finalSteps.forEach((s, i) => {
            table.push([String(i + 1), s.id, s.enabled ? 'yes' : 'no', s.threshold ?? '-']);
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
    .requiredOption('--message <text>', 'A user message to include (repeatable)', collect, [])
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers preview my-api --message "Summarize this thread"
  routerly optimizers preview my-api --message "first" --message "second" --json
`)
    .action(async (nameOrId: string, opts: { message: string[]; json?: boolean }) => {
      try {
        if (opts.message.length === 0) {
          console.error(chalk.red('Error: provide at least one --message.'));
          process.exit(1);
        }
        const project = await resolveProject(nameOrId);
        const sampleMessages: Message[] = opts.message.map(text => ({ role: 'user', content: text }));
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
        const table = new Table({ head: ['ID', 'Before', 'After'].map(h => chalk.cyan(h)) });
        for (const s of result.perStep) {
          table.push([s.id, String(s.before), String(s.after)]);
        }
        console.log('\n' + table.toString());
      } catch (err) {
        reportError(err);
      }
    });

  return cmd;
}
