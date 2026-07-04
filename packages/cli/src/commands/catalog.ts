import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';
import type { ProviderRepo, Settings } from '@routerly/shared';

async function getRepos(): Promise<ProviderRepo[]> {
  const settings = await api<Settings>('GET', '/api/settings');
  return settings.providerRepos ?? [];
}

async function putRepos(repos: ProviderRepo[]): Promise<void> {
  await api<Settings>('PUT', '/api/settings', { providerRepos: repos });
}

export function makeCatalogCommand(): Command {
  const cmd = new Command('catalog').description('Manage provider catalog repositories');

  const repos = cmd.command('repos').description('Manage catalog repository sources');

  repos.command('list')
    .description('List configured catalog repositories')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const list = await getRepos();
        if (opts.json) {
          console.log(JSON.stringify(list, null, 2));
          return;
        }
        if (!list.length) {
          console.log(chalk.gray('No catalog repositories configured.'));
          return;
        }
        const table = new Table({
          head: ['URL', 'Channel', 'Enabled'].map(h => chalk.cyan(h)),
        });
        for (const r of list) {
          table.push([r.url, r.channel ?? '', r.enabled ? chalk.green('yes') : chalk.gray('no')]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  repos.command('add <url>')
    .description('Add a catalog repository')
    .option('--channel <channel>', 'Release channel (e.g. stable, latest)')
    .action(async (url: string, opts: { channel?: string }) => {
      try {
        const list = await getRepos();
        if (list.some(r => r.url === url)) {
          console.error(chalk.red(`Repository already exists: ${url}`));
          process.exit(1);
        }
        const entry: ProviderRepo = { url, enabled: true };
        if (opts.channel) entry.channel = opts.channel;
        await putRepos([...list, entry]);
        console.log(chalk.green(`Added: ${url}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  repos.command('remove <url>')
    .description('Remove a catalog repository by URL')
    .action(async (url: string) => {
      try {
        const list = await getRepos();
        const next = list.filter(r => r.url !== url);
        if (next.length === list.length) {
          console.error(chalk.red(`Repository not found: ${url}`));
          process.exit(1);
        }
        await putRepos(next);
        console.log(chalk.green(`Removed: ${url}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  repos.command('enable <url>')
    .description('Enable a catalog repository')
    .action(async (url: string) => {
      try {
        const list = await getRepos();
        const repo = list.find(r => r.url === url);
        if (!repo) {
          console.error(chalk.red(`Repository not found: ${url}`));
          process.exit(1);
        }
        repo.enabled = true;
        await putRepos(list);
        console.log(chalk.green(`Enabled: ${url}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  repos.command('disable <url>')
    .description('Disable a catalog repository')
    .action(async (url: string) => {
      try {
        const list = await getRepos();
        const repo = list.find(r => r.url === url);
        if (!repo) {
          console.error(chalk.red(`Repository not found: ${url}`));
          process.exit(1);
        }
        repo.enabled = false;
        await putRepos(list);
        console.log(chalk.green(`Disabled: ${url}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('refresh')
    .description('Invalidate the server-side catalog cache')
    .action(async () => {
      try {
        await api<{ ok: boolean }>('POST', '/api/catalog/refresh');
        console.log(chalk.green('Catalog cache refreshed.'));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
