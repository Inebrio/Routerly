import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { OPTIMIZER_CATALOG, optimizerLabel, optimizerThreshold } from '@routerly/shared';
import type { ProjectConfig, OptimizerStep, OptimizerId, Message } from '@routerly/shared';

interface InstalledOptimizer {
  id: string;
  klass: string;
  installed: boolean;
}

interface PreviewResult {
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  perStep: { id: string; before: number; after: number; messages?: Message[]; rolledBack?: boolean }[];
  messages?: Message[];
}

interface TrafficSample {
  capturedAt: string;
  messages: Message[];
  estimatedTokens: number;
  truncated?: boolean;
}

/** The threshold of an optimizer as one cell: what it means and where it starts. */
function thresholdCell(id: string): string {
  const spec = optimizerThreshold(id);
  if (!spec) return '-';
  const range = `${spec.min}-${spec.max} ${spec.unit}`;
  return spec.default != null ? `${range}, default ${spec.default}` : `${range}, required`;
}

/** Plain text of a message, joining the text parts of a structured content array. */
function messageText(m: Message): string {
  if (typeof m.content === 'string') return m.content;
  if (!Array.isArray(m.content)) return '';
  return m.content
    .map(part => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .filter(Boolean)
    .join('\n');
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

  // ── optimizers samples ───────────────────────────────────────────────────────
  cmd.command('samples <project>')
    .description("List the project's recent prompts kept in memory by the service")
    .option('--show <index>', 'Print the full text of one sample (1-based)')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers samples my-api
  routerly optimizers samples my-api --show 1
  routerly optimizers samples my-api --json

Samples are captured after PII scrubbing, held in memory only, and lost when
the service restarts. Replay one with \`optimizers preview --sample\`.
`)
    .action(async (nameOrId: string, opts: { show?: string; json?: boolean }) => {
      try {
        const project = await resolveProject(nameOrId);
        const samples = await api<TrafficSample[]>('GET', `/api/projects/${encodeURIComponent(project.id)}/optimizers/samples`);

        if (opts.show !== undefined) {
          const index = Number(opts.show);
          const sample = Number.isInteger(index) ? samples[index - 1] : undefined;
          if (!sample) {
            console.error(chalk.red(`Error: no sample ${opts.show}. This project has ${samples.length}.`));
            process.exit(1);
          }
          if (opts.json) {
            console.log(JSON.stringify(sample, null, 2));
            return;
          }
          console.log(chalk.gray(`Captured ${sample.capturedAt} · ${sample.estimatedTokens} tokens${sample.truncated ? ' · excerpt' : ''}`));
          for (const m of sample.messages) console.log(`\n${chalk.cyan(m.role)}: ${messageText(m)}`);
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(samples, null, 2));
          return;
        }
        if (samples.length === 0) {
          console.log(chalk.yellow('No prompts captured yet. They appear once the project sends traffic.'));
          return;
        }
        const table = new Table({ head: ['#', 'Captured', 'Tokens', 'Messages', 'Excerpt'].map(h => chalk.cyan(h)) });
        samples.forEach((s, i) => {
          table.push([String(i + 1), s.capturedAt, String(s.estimatedTokens), String(s.messages.length), s.truncated ? 'yes' : 'no']);
        });
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
    .option('--sample <index>', 'Replay a prompt listed by `optimizers samples` (1-based)')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly optimizers preview my-api --message "Summarize this thread"
  routerly optimizers preview my-api --message "first" --message "second" --json
  routerly optimizers preview my-api --sample 1
`)
    .action(async (nameOrId: string, opts: { message: string[]; sample?: string; json?: boolean }) => {
      try {
        if (opts.message.length === 0 && opts.sample === undefined) {
          console.error(chalk.red('Error: provide at least one --message, or --sample <index>.'));
          process.exit(1);
        }
        if (opts.message.length > 0 && opts.sample !== undefined) {
          console.error(chalk.red('Error: --message and --sample are mutually exclusive.'));
          process.exit(1);
        }
        const project = await resolveProject(nameOrId);
        let sampleMessages: Message[];
        if (opts.sample !== undefined) {
          const samples = await api<TrafficSample[]>('GET', `/api/projects/${encodeURIComponent(project.id)}/optimizers/samples`);
          const index = Number(opts.sample);
          const picked = Number.isInteger(index) ? samples[index - 1] : undefined;
          if (!picked) {
            console.error(chalk.red(`Error: no sample ${opts.sample}. This project has ${samples.length}.`));
            process.exit(1);
          }
          sampleMessages = picked.messages;
        } else {
          sampleMessages = opts.message.map(text => ({ role: 'user', content: text }));
        }
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
        const table = new Table({ head: ['ID', 'Name', 'Before', 'After', 'Saved'].map(h => chalk.cyan(h)) });
        for (const s of result.perStep) {
          const saved = s.rolledBack ? chalk.yellow('rolled back') : String(s.before - s.after);
          table.push([s.id, optimizerLabel(s.id), String(s.before), String(s.after), saved]);
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
