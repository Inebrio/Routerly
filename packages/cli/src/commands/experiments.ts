import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import {
  EXPERIMENT_ROTATIONS, STICKY_KEYS,
  ROTATION_CATALOG, STICKY_KEY_CATALOG,
} from '@routerly/shared';
import type {
  ExperimentConfig, ExperimentMetrics, ExperimentRotation,
  ExperimentStickyKey, ProjectConfig, ProjectToken,
} from '@routerly/shared';

interface VariantBody {
  id?: string;
  projectId: string;
  name?: string;
  weight?: number;
}

/** What `POST /api/experiments` and `PATCH /api/experiments/:id` accept. */
interface ExperimentBody {
  name?: string;
  description?: string;
  rotation?: ExperimentRotation;
  stickyKey?: ExperimentStickyKey;
  variants?: VariantBody[];
  judge?: { enabled: boolean; modelId: string; criteria: string[]; sampleRate: number };
  minSamplesPerVariant?: number;
}

/** One `--variant` occurrence, before its project is resolved to an id. */
interface VariantSpec {
  project: string;
  name?: string;
  weight?: number;
}

interface CommonOpts {
  name?: string;
  description?: string;
  rotation?: string;
  stickyKey?: string;
  variant?: VariantSpec[];
  judgeModel?: string;
  criteria?: string[];
  sampleRate?: string;
  /** `--no-judge` sets this to `false`; it is `undefined` on the commands that do not offer the flag. */
  judge?: boolean;
  minSamples?: string;
  json?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

function handleError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.message === 'module_disabled') {
      fail('The experiments module is disabled. Enable it with: routerly modules enable experiments');
    }
    fail(`Error: ${err.message}`);
  }
  return fail(String(err));
}

/** `<project>[:label][=weight]`, so one flag carries a whole arm of the test. */
function parseVariant(spec: string, previous: VariantSpec[] = []): VariantSpec[] {
  const eq = spec.lastIndexOf('=');
  const head = eq === -1 ? spec : spec.slice(0, eq);
  const colon = head.indexOf(':');
  const project = (colon === -1 ? head : head.slice(0, colon)).trim();
  const name = colon === -1 ? '' : head.slice(colon + 1).trim();
  if (!project) fail(`Invalid --variant "${spec}". Expected <project>[:label][=weight].`);

  let weight: number | undefined;
  if (eq !== -1) {
    weight = Number(spec.slice(eq + 1));
    if (!Number.isFinite(weight) || weight < 0) fail(`Invalid weight in --variant "${spec}". Expected a number >= 0.`);
  }
  return [...previous, { project, ...(name ? { name } : {}), ...(weight !== undefined ? { weight } : {}) }];
}

function collectCriteria(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) fail(`Unknown ${flag} "${value}". Expected one of: ${allowed.join(', ')}.`);
  return value as T;
}

function parseNumber(value: string, flag: string, { min, max, int }: { min: number; max: number; int?: boolean }): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(`Invalid ${flag} "${value}". Expected a number between ${min} and ${max}.`);
  if (int && !Number.isInteger(n)) fail(`Invalid ${flag} "${value}". Expected a whole number.`);
  return n;
}

async function resolveProjects(specs: VariantSpec[]): Promise<VariantBody[]> {
  const projects = await api<ProjectConfig[]>('GET', '/api/projects');
  return specs.map(s => {
    const project = projects.find(p => p.id === s.project || p.name === s.project);
    if (!project) fail(`Project "${s.project}" not found. Run \`routerly project list\` to see available projects.`);
    return {
      projectId: project.id,
      ...(s.name ? { name: s.name } : {}),
      ...(s.weight !== undefined ? { weight: s.weight } : {}),
    };
  });
}

/**
 * Builds the request body from the flags that were actually given, so `update`
 * never resends a field the user did not mention.
 */
async function buildBody(opts: CommonOpts): Promise<ExperimentBody> {
  const body: ExperimentBody = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.rotation !== undefined) body.rotation = parseEnum(opts.rotation, EXPERIMENT_ROTATIONS, '--rotation');
  if (opts.stickyKey !== undefined) body.stickyKey = parseEnum(opts.stickyKey, STICKY_KEYS, '--sticky-key');
  if (opts.minSamples !== undefined) body.minSamplesPerVariant = parseNumber(opts.minSamples, '--min-samples', { min: 1, max: 1_000_000, int: true });
  if (opts.variant?.length) body.variants = await resolveProjects(opts.variant);

  if (opts.judge === false && opts.judgeModel) fail('Error: --no-judge and --judge-model cannot be used together.');
  if (opts.judgeModel) {
    // The service takes a fraction, the flag takes a percentage, same as the dashboard field.
    const percent = opts.sampleRate !== undefined ? parseNumber(opts.sampleRate, '--sample-rate', { min: 0, max: 100 }) : 100;
    body.judge = { enabled: true, modelId: opts.judgeModel, criteria: opts.criteria ?? [], sampleRate: percent / 100 };
  } else if (opts.criteria?.length || opts.sampleRate !== undefined) {
    fail('Error: --criteria and --sample-rate need --judge-model.');
  }
  return body;
}

async function fetchExperiment(id: string): Promise<ExperimentConfig> {
  return api<ExperimentConfig>('GET', `/api/experiments/${encodeURIComponent(id)}`);
}

const fmtCost = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(5) : n.toFixed(2)}`;
const fmtMs = (n?: number) => (n === undefined ? '-' : `${Math.round(n)} ms`);

function printTokens(tokens: ProjectToken[]): void {
  const table = new Table({ head: ['ID', 'Token', 'Created', 'Last used'].map(h => chalk.cyan(h)) });
  for (const t of tokens) {
    table.push([t.id, t.tokenSnippet, new Date(t.createdAt).toLocaleString(), t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : chalk.gray('never')]);
  }
  console.log(table.toString());
}

const ROTATION_HELP = EXPERIMENT_ROTATIONS.map(r => `  ${r.padEnd(12)} ${ROTATION_CATALOG[r].description}`).join('\n');
const STICKY_HELP = STICKY_KEYS.map(k => `  ${k.padEnd(12)} ${STICKY_KEY_CATALOG[k].description}`).join('\n');

// ─── Command ──────────────────────────────────────────────────────────────────

export function makeExperimentsCommand(): Command {
  const cmd = new Command('experiments').description('Run A/B tests that route each call to one of several projects');

  // ── experiments list ─────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List experiments')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments list
  routerly experiments list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const experiments = await api<ExperimentConfig[]>('GET', '/api/experiments');
        if (opts.json) {
          console.log(JSON.stringify(experiments, null, 2));
          return;
        }
        if (experiments.length === 0) {
          console.log(chalk.yellow('No experiments found.'));
          return;
        }
        const table = new Table({ head: ['ID', 'Name', 'Rotation', 'Variants', 'Created'].map(h => chalk.cyan(h)) });
        for (const e of experiments) {
          table.push([e.id, e.name, ROTATION_CATALOG[e.rotation].label, String(e.variants.length), new Date(e.createdAt).toLocaleDateString()]);
        }
        console.log(table.toString());
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments show ─────────────────────────────────────────────────────────
  cmd.command('show <id>')
    .description('Show one experiment with its variants and tokens')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments show 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
  routerly experiments show 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --json
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const e = await fetchExperiment(id);
        if (opts.json) {
          console.log(JSON.stringify(e, null, 2));
          return;
        }
        // `--variant` takes project names, so the table shows names too; ids stay in --json.
        const projects = await api<ProjectConfig[]>('GET', '/api/projects');
        console.log(chalk.gray('id:          ') + e.id);
        console.log(chalk.gray('name:        ') + e.name);
        if (e.description) console.log(chalk.gray('description: ') + e.description);
        console.log(chalk.gray('rotation:    ') + `${ROTATION_CATALOG[e.rotation].label}${e.rotation === 'sticky' ? `, on ${STICKY_KEY_CATALOG[e.stickyKey ?? 'auto'].label.toLowerCase()}` : ''}`);
        console.log(chalk.gray('created:     ') + new Date(e.createdAt).toLocaleString());
        if (e.judge?.enabled) {
          console.log(chalk.gray('judge:       ') + `${e.judge.modelId}, ${Math.round(e.judge.sampleRate * 100)}% of calls`);
          for (const c of e.judge.criteria) console.log(chalk.gray('             - ') + c);
        }

        console.log(chalk.bold('\nVariants:'));
        if (e.variants.length === 0) {
          console.log(chalk.gray('  (none)'));
        } else {
          const table = new Table({ head: ['ID', 'Label', 'Project', 'Weight'].map(h => chalk.cyan(h)) });
          for (const v of e.variants) {
            const project = projects.find(p => p.id === v.projectId);
            table.push([
              v.id,
              v.name ?? chalk.gray(project?.name ?? '-'),
              project?.name ?? chalk.red(`${v.projectId} (deleted)`),
              v.weight !== undefined ? String(v.weight) : chalk.gray('1'),
            ]);
          }
          console.log(table.toString());
        }

        console.log(chalk.bold('\nTokens:'));
        if (e.tokens.length === 0) console.log(chalk.gray('  (none)'));
        else printTokens(e.tokens);
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments create ───────────────────────────────────────────────────────
  cmd.command('create')
    .description('Create an experiment with its first token. It routes traffic from the moment it exists')
    .requiredOption('--name <name>', 'Name of the experiment')
    .option('--description <text>', 'What this test is trying to settle')
    .option('--rotation <rotation>', `How a variant is picked: ${EXPERIMENT_ROTATIONS.join(', ')}`)
    .option('--sticky-key <key>', `What identifies the same caller for sticky rotation: ${STICKY_KEYS.join(', ')}`)
    .option('--variant <spec>', 'An arm of the test: <project>[:label][=weight]. Repeat for each variant', parseVariant)
    .option('--judge-model <modelId>', 'Score answers with this model')
    .option('--criteria <text>', 'One judge criterion. Repeat for each', collectCriteria)
    .option('--sample-rate <percent>', 'Share of calls the judge scores, 0-100 (default 100)')
    .option('--min-samples <n>', 'Calls per variant below which the comparison is not conclusive')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Rotations:
${ROTATION_HELP}

Sticky keys (sticky rotation only):
${STICKY_HELP}

Examples:
  routerly experiments create --name "Cheap vs premium" --variant cheap-api --variant premium-api
  routerly experiments create --name "Split 80/20" --rotation weighted --variant cheap-api=80 --variant premium-api=20
  routerly experiments create --name "Prompt test" --variant a:Baseline --variant b:Rewritten \\
    --judge-model gpt-4o --criteria "Answers the question asked" --sample-rate 20
`)
    .action(async (opts: CommonOpts & { name: string }) => {
      try {
        const body = await buildBody(opts);
        const created = await api<ExperimentConfig & { token: string }>('POST', '/api/experiments', body);
        if (opts.json) {
          console.log(JSON.stringify(created, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Experiment "${created.name}" created -> ${created.id}`));
        console.log(chalk.bold('\nToken (shown once, point your client at it instead of a project token):'));
        console.log(created.token);
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments update ───────────────────────────────────────────────────────
  cmd.command('update <id>')
    .description('Change an experiment. Every field stays editable for its whole life')
    .option('--name <name>', 'New name')
    .option('--description <text>', 'New description')
    .option('--rotation <rotation>', `How a variant is picked: ${EXPERIMENT_ROTATIONS.join(', ')}`)
    .option('--sticky-key <key>', `What identifies the same caller for sticky rotation: ${STICKY_KEYS.join(', ')}`)
    .option('--variant <spec>', 'An arm of the test: <project>[:label][=weight]. Repeat for each variant. Replaces the whole list', parseVariant)
    .option('--judge-model <modelId>', 'Score answers with this model')
    .option('--criteria <text>', 'One judge criterion. Repeat for each. Replaces the whole list', collectCriteria)
    .option('--sample-rate <percent>', 'Share of calls the judge scores, 0-100')
    .option('--no-judge', 'Stop scoring answers')
    .option('--min-samples <n>', 'Calls per variant below which the comparison is not conclusive')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments update 8f2c1d64 --name "Cheap vs premium, take 2"
  routerly experiments update 8f2c1d64 --rotation weighted --variant cheap-api=70 --variant premium-api=30
  routerly experiments update 8f2c1d64 --no-judge
`)
    .action(async (id: string, opts: CommonOpts) => {
      try {
        const body = await buildBody(opts);
        if (opts.judge === false) {
          // The service has no "remove the judge" verb, so the current judge is sent back disabled.
          const current = await fetchExperiment(id);
          if (!current.judge) fail('This experiment has no judge to disable.');
          body.judge = { ...current.judge, enabled: false };
        }
        if (Object.keys(body).length === 0) fail('Error: nothing to update. Pass at least one field.');
        const updated = await api<ExperimentConfig>('PATCH', `/api/experiments/${encodeURIComponent(id)}`, body);
        if (opts.json) {
          console.log(JSON.stringify(updated, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Experiment "${updated.name}" updated`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments delete ───────────────────────────────────────────────────────
  cmd.command('delete <id>')
    .description('Delete an experiment. Its tokens stop working immediately')
    .addHelpText('after', `
Examples:
  routerly experiments delete 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
`)
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/experiments/${encodeURIComponent(id)}`);
        console.log(chalk.green(`✓ Experiment "${id}" deleted`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments metrics ──────────────────────────────────────────────────────
  cmd.command('metrics <id>')
    .description('Compare the variants on cost, latency, errors and judge score')
    .option('--days <n>', 'Only the last N days (default: the whole history)')
    .option('--from <iso>', 'Start of the window, ISO 8601')
    .option('--to <iso>', 'End of the window, ISO 8601')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments metrics 8f2c1d64
  routerly experiments metrics 8f2c1d64 --days 7
  routerly experiments metrics 8f2c1d64 --from 2026-08-01T00:00:00Z --to 2026-08-02T00:00:00Z --json
`)
    .action(async (id: string, opts: { days?: string; from?: string; to?: string; json?: boolean }) => {
      try {
        const params = new URLSearchParams();
        if (opts.days !== undefined) {
          const days = parseNumber(opts.days, '--days', { min: 1, max: 3650, int: true });
          params.set('from', new Date(Date.now() - days * 86_400_000).toISOString());
        }
        if (opts.from) params.set('from', isoOrFail(opts.from, '--from'));
        if (opts.to) params.set('to', isoOrFail(opts.to, '--to'));
        const query = params.toString();
        const metrics = await api<ExperimentMetrics>('GET', `/api/experiments/${encodeURIComponent(id)}/metrics${query ? `?${query}` : ''}`);
        if (opts.json) {
          console.log(JSON.stringify(metrics, null, 2));
          return;
        }
        if (metrics.variants.length === 0 || metrics.totalCalls === 0) {
          console.log(chalk.yellow('No calls in this window yet. Point a client at the experiment token to start the comparison.'));
          return;
        }
        console.log(chalk.bold(`\n${metrics.totalCalls} call${metrics.totalCalls !== 1 ? 's' : ''} measured\n`));
        const table = new Table({
          head: ['Variant', 'Calls', 'Errors', 'Tokens in / out', 'Cost', 'Cost / call', 'Avg latency', 'p95', 'TTFT', 'Judge score'].map(h => chalk.cyan(h)),
          colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        });
        for (const v of metrics.variants) {
          table.push([
            (v.name ?? v.variantId) + (v.enoughSamples ? '' : chalk.yellow(' (low sample)')),
            String(v.calls),
            v.errors > 0 ? `${v.errors} (${(v.errorRate * 100).toFixed(1)}%)` : '0',
            `${v.inputTokens.toLocaleString()} / ${v.outputTokens.toLocaleString()}`,
            fmtCost(v.cost),
            fmtCost(v.avgCostPerCall),
            fmtMs(v.avgLatencyMs),
            fmtMs(v.p95LatencyMs),
            v.avgTtftMs !== undefined ? fmtMs(v.avgTtftMs) : chalk.gray('-'),
            v.avgScore !== undefined ? `${v.avgScore.toFixed(1)} / 10 (${v.judgedCalls})` : chalk.gray('-'),
          ]);
        }
        console.log(table.toString());
        if (!metrics.ready) {
          console.log(chalk.yellow(`\nNot conclusive yet: every variant needs at least ${metrics.minSamplesPerVariant} calls in this window.`));
        }
      } catch (err) {
        handleError(err);
      }
    });

  // ── experiments token ────────────────────────────────────────────────────────
  const token = cmd.command('token').description('Manage the tokens clients call the experiment with');

  token.command('list <id>')
    .description('List the tokens of an experiment')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments token list 8f2c1d64
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const experiment = await fetchExperiment(id);
        if (opts.json) {
          console.log(JSON.stringify(experiment.tokens, null, 2));
          return;
        }
        if (experiment.tokens.length === 0) {
          console.log(chalk.yellow('No tokens on this experiment.'));
          return;
        }
        printTokens(experiment.tokens);
      } catch (err) {
        handleError(err);
      }
    });

  token.command('create <id>')
    .description('Create another token for an experiment')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly experiments token create 8f2c1d64
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const result = await api<{ token: string; tokenInfo: ProjectToken }>('POST', `/api/experiments/${encodeURIComponent(id)}/tokens`);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green('✓ Token created. Copy it now, it will not be shown again:'));
        console.log(result.token);
      } catch (err) {
        handleError(err);
      }
    });

  token.command('revoke <id> <tokenId>')
    .description('Revoke a token. Clients using it stop working immediately')
    .addHelpText('after', `
Examples:
  routerly experiments token revoke 8f2c1d64 4d3b2a10-8c7e-4f21-9b0d-1e2f3a4b5c6d
`)
    .action(async (id: string, tokenId: string) => {
      try {
        await api<void>('DELETE', `/api/experiments/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}`);
        console.log(chalk.green(`✓ Token "${tokenId}" revoked`));
      } catch (err) {
        handleError(err);
      }
    });

  return cmd;
}

function isoOrFail(value: string, flag: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`Invalid ${flag} "${value}". Expected an ISO 8601 date, e.g. 2026-08-01T00:00:00Z.`);
  // A bare day is passed through: the service reads it as the whole day, the
  // same window the dashboard picker asks for. Expanding it here would cut it
  // at midnight instead.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : date.toISOString();
}
