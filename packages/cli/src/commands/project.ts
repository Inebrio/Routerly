import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { readStore, writeStore, encryptValue } from '../store.js';
import type { ProjectConfig, ProjectModelRef, BudgetThresholds } from '@localrouter/shared';

export function makeProjectCommand(): Command {
  const cmd = new Command('project').description('Manage LocalRouter projects');

  // ── project list ──
  cmd.command('list')
    .description('List all projects')
    .action(async () => {
      const projects = await readStore('projects');
      if (projects.length === 0) {
        console.log(chalk.yellow('No projects yet. Use `localrouter project add` to create one.'));
        return;
      }
      const table = new Table({
        head: ['ID', 'Name', 'Slug', 'Routing Model', 'Models'].map(h => chalk.cyan(h)),
      });
      for (const p of projects) {
        table.push([p.id, p.name, p.slug, p.routingModelId, p.models.map(m => m.modelId).join(', ')]);
      }
      console.log(table.toString());
    });

  // ── project add ──
  cmd.command('add')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .requiredOption('--slug <slug>', 'URL slug (alphanumeric + dashes, e.g. my-project)')
    .requiredOption('--routing-model <id>', 'Model ID to use for routing decisions')
    .option('--models <ids>', 'Comma-separated list of model IDs to associate')
    .action(async (opts: { name: string; slug: string; routingModel: string; models?: string }) => {
      const projects = await readStore('projects');

      if (projects.find(p => p.slug === opts.slug)) {
        console.error(chalk.red(`Slug "${opts.slug}" already in use.`));
        process.exit(1);
      }

      const rawToken = randomBytes(32).toString('hex');
      const modelRefs: ProjectModelRef[] = (opts.models ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(modelId => ({ modelId }));

      // Always include routing model in the models list if not already there
      if (!modelRefs.find(r => r.modelId === opts.routingModel)) {
        modelRefs.push({ modelId: opts.routingModel });
      }

      const project: ProjectConfig = {
        id: uuidv4(),
        name: opts.name,
        slug: opts.slug,
        encryptedToken: encryptValue(rawToken),
        routingModelId: opts.routingModel,
        models: modelRefs,
        timeoutMs: 30000,
      };

      projects.push(project);
      await writeStore('projects', projects);

      console.log(chalk.green(`✓ Project "${opts.name}" created.`));
      console.log(chalk.bold('\nProject token (save this, it won\'t be shown again):'));
      console.log(chalk.yellow(rawToken));
      console.log(chalk.gray(`\nEndpoint prefix: /projects/${opts.slug}/v1/`));
    });

  // ── project remove ──
  cmd.command('remove <id>')
    .description('Remove a project by ID')
    .action(async (id: string) => {
      const projects = await readStore('projects');
      const filtered = projects.filter(p => p.id !== id && p.slug !== id);
      if (filtered.length === projects.length) {
        console.error(chalk.red(`Project "${id}" not found (try slug or UUID).`));
        process.exit(1);
      }
      await writeStore('projects', filtered);
      console.log(chalk.green(`✓ Project "${id}" removed.`));
    });

  // ── project add-model ──
  cmd.command('add-model')
    .description('Add a model to an existing project')
    .requiredOption('--project <slug>', 'Project slug or ID')
    .requiredOption('--model <id>', 'Model ID to add')
    .option('--daily-budget <usd>', 'Daily spend limit for this model in this project')
    .option('--monthly-budget <usd>', 'Monthly spend limit for this model in this project')
    .action(async (opts: { project: string; model: string; dailyBudget?: string; monthlyBudget?: string }) => {
      const projects = await readStore('projects');
      const project = projects.find(p => p.id === opts.project || p.slug === opts.project);
      if (!project) {
        console.error(chalk.red(`Project "${opts.project}" not found.`));
        process.exit(1);
      }

      if (project.models.find(m => m.modelId === opts.model)) {
        console.error(chalk.yellow(`Model "${opts.model}" is already in this project.`));
        return;
      }

      const thresholds: BudgetThresholds | undefined =
        opts.dailyBudget || opts.monthlyBudget
          ? {
            daily: opts.dailyBudget ? parseFloat(opts.dailyBudget) : undefined,
            monthly: opts.monthlyBudget ? parseFloat(opts.monthlyBudget) : undefined,
          }
          : undefined;

      project.models.push({ modelId: opts.model, thresholds });
      await writeStore('projects', projects);
      console.log(chalk.green(`✓ Model "${opts.model}" added to project "${project.name}".`));
    });

  return cmd;
}
