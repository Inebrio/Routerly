import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ApiToken } from '@routerly/shared';

/** A stored API token as the API returns it: everything but the hash. */
type ApiTokenRow = Omit<ApiToken, 'tokenHash'>;

function fail(err: unknown): never {
  console.error(chalk.red(err instanceof ApiError ? `Error: ${err.message}` : String(err)));
  process.exit(1);
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('it-IT') : chalk.gray('—'));

export function makeApiTokenCommand(): Command {
  const cmd = new Command('api-token').description('Manage long-lived management API tokens for automations');

  cmd.command('list')
    .description('List your API tokens')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly auth api-token list
  routerly auth api-token list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const tokens = await api<ApiTokenRow[]>('GET', '/api/me/api-tokens');
        if (opts.json) {
          console.log(JSON.stringify(tokens, null, 2));
          return;
        }
        if (tokens.length === 0) {
          console.log(chalk.yellow('No API tokens yet. Create one: routerly auth api-token create <name> --permissions model:read'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Name', 'Snippet', 'Permissions', 'Created', 'Last used', 'Expires'].map(h => chalk.cyan(h)),
        });
        for (const t of tokens) {
          table.push([t.id, t.name, `${t.tokenSnippet}…`, t.permissions.join(', '), fmt(t.createdAt), fmt(t.lastUsedAt), fmt(t.expiresAt)]);
        }
        console.log(table.toString());
      } catch (err) {
        fail(err);
      }
    });

  cmd.command('create <name>')
    .description('Create an API token (shown only once)')
    .requiredOption('--permissions <list>', 'Comma-separated permissions the token may use (subset of yours)')
    .option('--days <n>', 'Validity in days, 1-365', '90')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
The token acts as you, limited to --permissions. It cannot create tokens or change credentials.
Use it with: routerly auth login --url <url> --token <token>

Examples:
  routerly auth api-token create ci --permissions model:read,router:read
  routerly auth api-token create nightly --permissions model:write --days 30 --json
`)
    .action(async (name: string, opts: { permissions: string; days: string; json?: boolean }) => {
      try {
        const days = Number(opts.days);
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          console.error(chalk.red('Error: --days must be an integer between 1 and 365.'));
          process.exit(1);
        }
        const permissions = opts.permissions.split(',').map(p => p.trim()).filter(Boolean);
        const created = await api<ApiTokenRow & { token: string }>('POST', '/api/me/api-tokens', {
          name,
          permissions,
          expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        });
        if (opts.json) {
          console.log(JSON.stringify(created, null, 2));
          return;
        }
        console.log(chalk.green(`✓ API token "${created.name}" created.`));
        console.log(chalk.bold('\nToken (save it now, it is shown only once):'));
        console.log(chalk.yellow(created.token));
        console.log(chalk.gray(`  ID:      ${created.id}`));
        console.log(chalk.gray(`  Expires: ${fmt(created.expiresAt)}`));
      } catch (err) {
        fail(err);
      }
    });

  cmd.command('revoke <token-id>')
    .description('Revoke one of your API tokens')
    .addHelpText('after', `
Examples:
  routerly auth api-token revoke <token-id>
`)
    .action(async (tokenId: string) => {
      try {
        await api<void>('DELETE', `/api/me/api-tokens/${encodeURIComponent(tokenId)}`);
        console.log(chalk.green('✓ API token revoked. Automations using it stop working immediately.'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`API token "${tokenId}" not found.`));
          process.exit(1);
        }
        fail(err);
      }
    });

  return cmd;
}
