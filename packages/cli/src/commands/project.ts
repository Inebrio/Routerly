import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ProjectConfig, BudgetThresholds } from '@localrouter/shared';

export function makeProjectCommand(): Command {
  const cmd = new Command('project').description('Manage LocalRouter projects');

  // ── project list ──
  cmd.command('list')
    .description('List all projects')
    .action(async () => {
      try {
        const projects = await api<ProjectConfig[]>('GET', '/api/projects');
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
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── project add ──
  cmd.command('add')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .requiredOption('--slug <slug>', 'URL slug (alphanumeric + dashes, e.g. my-project)')
    .requiredOption('--routing-model <id>', 'Model ID to use for routing decisions')
    .option('--models <ids>', 'Comma-separated list of model IDs to associate')
    .action(async (opts: { name: string; slug: string; routingModel: string; models?: string }) => {
      const modelIds = (opts.models ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      // Always include routing model
      if (!modelIds.includes(opts.routingModel)) {
        modelIds.push(opts.routingModel);
      }

      try {
        const project = await api<ProjectConfig & { plainToken?: string }>('POST', '/api/projects', {
          name: opts.name,
          slug: opts.slug,
          routingModelId: opts.routingModel,
          modelIds,
        });

        console.log(chalk.green(`✓ Project "${opts.name}" created.`));

        if (project.tokens?.[0]) {
          const tokenSnippet = project.tokens[0].tokenSnippet;
          console.log(chalk.bold('\nProject token (save this — shown only once):'));
          console.log(chalk.yellow(tokenSnippet ? `${tokenSnippet}...` : '(see server logs for token)'));
        }
        console.log(chalk.gray(`\nEndpoint prefix: /projects/${opts.slug}/v1/`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`Slug "${opts.slug}" already in use.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── project remove ──
  cmd.command('remove <id>')
    .description('Remove a project by ID or slug')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/projects/${encodeURIComponent(id)}`);
        console.log(chalk.green(`✓ Project "${id}" removed.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Project "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── project add-model ──
  cmd.command('add-model')
    .description('Add a model to an existing project')
    .requiredOption('--project <slug>', 'Project slug or ID')
    .requiredOption('--model <id>', 'Model ID to add')
    .option('--daily-budget <usd>', 'Daily spend limit for this model in this project')
    .option('--monthly-budget <usd>', 'Monthly spend limit for this model in this project')
    .action(async (opts: { project: string; model: string; dailyBudget?: string; monthlyBudget?: string }) => {
      const thresholds: BudgetThresholds | undefined =
        opts.dailyBudget || opts.monthlyBudget
          ? {
            ...(opts.dailyBudget ? { daily: parseFloat(opts.dailyBudget) } : {}),
            ...(opts.monthlyBudget ? { monthly: parseFloat(opts.monthlyBudget) } : {}),
          }
          : undefined;

      try {
        // Fetch current project, patch models list
        const projects = await api<ProjectConfig[]>('GET', '/api/projects');
        const project = projects.find(p => p.id === opts.project || p.slug === opts.project);
        if (!project) {
          console.error(chalk.red(`Project "${opts.project}" not found.`));
          process.exit(1);
          return;
        }

        if (project.models.find(m => m.modelId === opts.model)) {
          console.log(chalk.yellow(`Model "${opts.model}" is already in this project.`));
          return;
        }

        const updatedModels = [
          ...project.models,
          thresholds ? { modelId: opts.model, thresholds } : { modelId: opts.model },
        ];

        await api<void>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, { models: updatedModels });
        console.log(chalk.green(`✓ Model "${opts.model}" added to project "${project.name}".`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
