import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';

interface PromptVersion {
  version: number;
  systemPrompt: string;
  createdAt: string;
  createdBy: string;
  notes?: string;
}

interface PromptEntry {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  versions: PromptVersion[];
  activeVersion: number;
}

export function makePromptCommand(): Command {
  const cmd = new Command('prompt').description('Manage stored prompts');

  // ── prompt list ──────────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List all stored prompts')
    .option('--project <id>', 'Filter by project ID')
    .option('--json', 'Output as JSON')
    .action(async (opts: { project?: string; json?: boolean }) => {
      try {
        const qs = opts.project ? `?projectId=${encodeURIComponent(opts.project)}` : '';
        const prompts = await api<PromptEntry[]>('GET', `/api/prompts${qs}`);
        if (opts.json) { console.log(JSON.stringify(prompts, null, 2)); return; }
        if (prompts.length === 0) { console.log(chalk.yellow('No prompts found.')); return; }
        const table = new Table({
          head: ['ID', 'Name', 'Scope', 'Active ver', 'Versions'].map(h => chalk.cyan(h)),
        });
        for (const p of prompts) {
          table.push([p.id, p.name, p.projectId ?? chalk.gray('global'), `v${p.activeVersion}`, String(p.versions.length)]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── prompt create ────────────────────────────────────────────────────────────
  cmd.command('create')
    .description('Create a new prompt')
    .requiredOption('--name <name>', 'Prompt name')
    .requiredOption('--system <text>', 'System prompt text')
    .option('--description <d>', 'Description')
    .option('--project <id>', 'Scope to a project ID')
    .option('--notes <n>', 'Version notes')
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; system: string; description?: string; project?: string; notes?: string; json?: boolean }) => {
      try {
        const created = await api<PromptEntry>('POST', '/api/prompts', {
          name: opts.name,
          systemPrompt: opts.system,
          ...(opts.description ? { description: opts.description } : {}),
          ...(opts.project ? { projectId: opts.project } : {}),
          ...(opts.notes ? { notes: opts.notes } : {}),
        });
        if (opts.json) { console.log(JSON.stringify(created, null, 2)); return; }
        console.log(chalk.green(`Prompt "${created.name}" created (ID: ${created.id}, v${created.activeVersion})`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── prompt show ──────────────────────────────────────────────────────────────
  cmd.command('show <id>')
    .description('Show a prompt with all versions')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const prompt = await api<PromptEntry>('GET', `/api/prompts/${id}`);
        if (opts.json) { console.log(JSON.stringify(prompt, null, 2)); return; }
        console.log(chalk.bold(`${prompt.name}`) + (prompt.description ? `  ${chalk.gray(prompt.description)}` : ''));
        console.log(`ID: ${prompt.id}  Scope: ${prompt.projectId ?? chalk.gray('global')}  Active: v${prompt.activeVersion}`);
        const table = new Table({ head: ['Version', 'Created', 'Notes'].map(h => chalk.cyan(h)) });
        for (const v of [...prompt.versions].sort((a, b) => b.version - a.version)) {
          const active = v.version === prompt.activeVersion ? chalk.green(' ✓') : '';
          table.push([`v${v.version}${active}`, new Date(v.createdAt).toLocaleDateString(), v.notes ?? '']);
        }
        console.log(table.toString());
        const activeVer = prompt.versions.find(v => v.version === prompt.activeVersion);
        if (activeVer) {
          console.log(chalk.bold('\nActive system prompt:'));
          console.log(chalk.gray(activeVer.systemPrompt));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── prompt activate ──────────────────────────────────────────────────────────
  cmd.command('activate <id> <version>')
    .description('Set the active version of a prompt')
    .action(async (id: string, version: string) => {
      try {
        const updated = await api<PromptEntry>('POST', `/api/prompts/${id}/activate/${version}`);
        console.log(chalk.green(`Prompt "${updated.name}" active version set to v${updated.activeVersion}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── prompt add-version ───────────────────────────────────────────────────────
  cmd.command('add-version <id>')
    .description('Add a new version to a prompt')
    .requiredOption('--system <text>', 'New system prompt text')
    .option('--notes <n>', 'Version notes')
    .action(async (id: string, opts: { system: string; notes?: string }) => {
      try {
        const version = await api<PromptVersion>('POST', `/api/prompts/${id}/versions`, {
          systemPrompt: opts.system,
          ...(opts.notes ? { notes: opts.notes } : {}),
        });
        console.log(chalk.green(`Added version v${version.version} to prompt ${id}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── prompt delete ────────────────────────────────────────────────────────────
  cmd.command('delete <id>')
    .description('Delete a prompt and all its versions')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, opts: { yes?: boolean }) => {
      if (!opts.yes) {
        const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>(resolve => rl.question(chalk.yellow(`Delete prompt ${id} and all versions? (y/N) `), ans => {
          rl.close();
          if (ans.toLowerCase() !== 'y') { console.log(chalk.gray('Aborted.')); process.exit(0); }
          resolve();
        }));
      }
      try {
        await api<void>('DELETE', `/api/prompts/${id}`);
        console.log(chalk.green(`Prompt ${id} deleted.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Prompt ${id} not found.`)); process.exit(1);
        }
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
