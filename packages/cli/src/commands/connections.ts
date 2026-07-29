import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ProviderConnection } from '@routerly/shared';

export function makeConnectionsCommand(): Command {
  const cmd = new Command('connections').description('Manage provider connections (credentials shared by one or more model instances)');

  // ── connections list ──
  cmd.command('list')
    .description('List configured provider connections')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  routerly connections list
  routerly connections list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const connections = await api<ProviderConnection[]>('GET', '/api/connections');
        if (opts.json) {
          console.log(JSON.stringify(connections, null, 2));
          return;
        }
        if (connections.length === 0) {
          console.log(chalk.yellow('No connections configured yet. Use `routerly connections add` to add one.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Provider', 'Label', 'Endpoint', 'Enabled'].map(h => chalk.cyan(h)),
        });
        for (const c of connections) {
          table.push([
            c.id,
            c.providerId,
            c.label,
            c.endpoint ?? chalk.gray('-'),
            c.enabled ? chalk.green('yes') : chalk.gray('no'),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── connections add ──
  cmd.command('add')
    .description('Add a provider connection')
    .requiredOption('--provider-id <id>', 'Provider ID (e.g. openai, anthropic, ollama)')
    .requiredOption('--label <label>', 'Display label for this connection')
    .option('--endpoint <url>', 'Custom API endpoint (uses provider default if omitted)')
    .option('--api-key <key>', 'API key credential (stored plaintext; file permissions protect it)')
    .option('--credentials-json <json>', 'Full credentials object as JSON (advanced; overrides --api-key on conflict)')
    .option('--enabled', 'Enable immediately (default: true)')
    .option('--no-enabled', 'Add disabled')
    .addHelpText('after', `
Examples:
  routerly connections add --provider-id openai --label "Main OpenAI" --api-key sk-...
  routerly connections add --provider-id ollama --label "Local Ollama" --endpoint http://localhost:11434/v1
  routerly connections add --provider-id anthropic --label "Anthropic" \\
    --credentials-json '{"apiKey":"sk-ant-..."}'
`)
    .action(async (opts: {
      providerId: string; label: string; endpoint?: string;
      apiKey?: string; credentialsJson?: string; enabled?: boolean;
    }) => {
      // ponytail: `--enabled`/`--no-enabled` both declared without a shared default leaves
      // opts.enabled undefined when neither flag is passed; the POST schema requires a boolean.
      const enabled = opts.enabled ?? true;
      let credentials: Record<string, unknown> = {};
      if (opts.apiKey) credentials['apiKey'] = opts.apiKey;
      if (opts.credentialsJson) {
        try {
          credentials = { ...credentials, ...(JSON.parse(opts.credentialsJson) as Record<string, unknown>) };
        } catch {
          console.error(chalk.red('--credentials-json: invalid JSON'));
          process.exit(1);
        }
      }

      const body = {
        providerId: opts.providerId,
        label: opts.label,
        credentials,
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
        enabled,
      };

      try {
        const created = await api<ProviderConnection>('POST', '/api/connections', body);
        console.log(chalk.green(`✓ Connection "${created.label}" added (id: ${created.id}).`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── connections remove ──
  cmd.command('remove <id>')
    .description('Remove a provider connection')
    .addHelpText('after', `
Examples:
  routerly connections remove c1
`)
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/connections/${encodeURIComponent(id)}`);
        console.log(chalk.green(`✓ Connection "${id}" removed.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Connection "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
