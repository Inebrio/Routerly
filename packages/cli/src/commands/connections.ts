import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ProviderConnection, CatalogSyncSummary } from '@routerly/shared';
import { resolveConnection } from '../lib/model-status.js';

// Canonical flat credential field set the server understands (all optional strings).
// Keys are the camelCase Commander produces from the corresponding `--kebab` flags,
// so building the credentials object is a straight copy of whichever flags were set.
const CREDENTIAL_KEYS = [
  'apiKey', 'cfClearance',
  'azureResourceName', 'azureDeploymentId', 'azureApiVersion',
  'awsRegion', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken',
  'vertexProjectId', 'vertexLocation', 'vertexServiceAccountKey',
] as const;

type CredentialOpts = Partial<Record<(typeof CREDENTIAL_KEYS)[number], string>> & { credentialsJson?: string };

/** True if the user passed at least one credential flag (including --credentials-json). */
export function hasAnyCredentialFlag(opts: CredentialOpts): boolean {
  return CREDENTIAL_KEYS.some(k => opts[k] !== undefined) || opts.credentialsJson !== undefined;
}

/**
 * Build the flat credentials object from the flags the user actually passed.
 * `--credentials-json` merges last (advanced escape hatch). Throws on invalid JSON.
 */
export function buildCredentialsFromOpts(opts: CredentialOpts): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const key of CREDENTIAL_KEYS) {
    const v = opts[key];
    if (v !== undefined) credentials[key] = v;
  }
  if (opts.credentialsJson) {
    Object.assign(credentials, JSON.parse(opts.credentialsJson) as Record<string, unknown>);
  }
  return credentials;
}

/** Hint printed after a sync loaded models: they arrive disabled and need an explicit enable. */
function printLoadedHint(label: string, sync: CatalogSyncSummary | undefined): void {
  if (!sync || sync.added.length === 0) return;
  console.log(`${sync.added.length} model${sync.added.length === 1 ? '' : 's'} loaded from the catalog (disabled). Enable with: routerly model enable --connection ${label} --new`);
}

const catalogSyncLabel = (c: ProviderConnection) => (c.catalogSync ? chalk.green('on') : chalk.gray('off'));

/** Attach the provider-aware credential flags shared by `add` and `edit`. */
function addCredentialOptions(c: Command): Command {
  return c
    .option('--api-key <key>', 'API key credential (stored plaintext; file permissions protect it)')
    .option('--cf-clearance <value>', 'Cloudflare clearance token (web providers)')
    .option('--aws-region <region>', 'AWS region (Bedrock)')
    .option('--aws-access-key-id <id>', 'AWS access key ID (Bedrock)')
    .option('--aws-secret-access-key <key>', 'AWS secret access key (Bedrock)')
    .option('--aws-session-token <token>', 'AWS session token (Bedrock)')
    .option('--azure-resource-name <name>', 'Azure resource name')
    .option('--azure-deployment-id <id>', 'Azure deployment ID')
    .option('--azure-api-version <version>', 'Azure API version')
    .option('--vertex-project-id <id>', 'Vertex project ID')
    .option('--vertex-location <location>', 'Vertex location')
    .option('--vertex-service-account-key <json>', 'Vertex service account key (JSON)')
    .option('--credentials-json <json>', 'Full credentials object as JSON (advanced; merged last)');
}

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
          // ponytail: server already redacts credentials, but strip client-side too so
          // "credentials never printed" is a CLI-level guarantee, not just server trust.
          const safe = connections.map(({ credentials: _credentials, ...rest }) => rest);
          console.log(JSON.stringify(safe, null, 2));
          return;
        }
        if (connections.length === 0) {
          console.log(chalk.yellow('No connections configured yet. Use `routerly connections add` to add one.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Provider', 'Label', 'Endpoint', 'Enabled', 'Catalog sync'].map(h => chalk.cyan(h)),
        });
        for (const c of connections) {
          table.push([
            c.id,
            c.providerName ? `${c.providerId} (${c.providerName})` : c.providerId,
            c.label,
            c.endpoint ?? chalk.gray('-'),
            c.enabled ? chalk.green('yes') : chalk.gray('no'),
            catalogSyncLabel(c),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── connections add ──
  addCredentialOptions(
    cmd.command('add')
      .description('Add a provider connection')
      .requiredOption('--provider-id <id>', 'Provider ID (e.g. openai, anthropic, ollama, bedrock, typesafe)')
      .option('--label <label>', 'Unique name for this connection (default: generated from the provider, e.g. openai-2)')
      .option('--provider-name <name>', 'Upstream provider behind a custom connection (e.g. deepseek); used as the model ID prefix')
      .option('--endpoint <url>', 'Custom API endpoint (uses provider default if omitted)'),
  )
    .option('--enabled', 'Enable immediately (default: true)')
    .option('--no-enabled', 'Add disabled')
    .option('--catalog-sync', 'Load the provider models from the catalog, disabled (default: on, except ollama, custom and azure-openai)')
    .option('--no-catalog-sync', 'Do not load models from the catalog')
    .addHelpText('after', `
Examples:
  routerly connections add --provider-id openai --api-key sk-...
  routerly connections add --provider-id openai --label "Main OpenAI" --api-key sk-...
  routerly connections add --provider-id ollama --label "Local Ollama" --endpoint http://localhost:11434/v1
  routerly connections add --provider-id bedrock --label "AWS Bedrock" \\
    --aws-region us-east-1 --aws-access-key-id AKIA... --aws-secret-access-key ...
  routerly connections add --provider-id anthropic --label "Anthropic" \\
    --credentials-json '{"apiKey":"sk-ant-..."}'
  routerly connections add --provider-id custom --provider-name deepseek --label "DeepSeek" \\
    --endpoint https://api.deepseek.com/v1 --api-key sk-...
`)
    .action(async (opts: CredentialOpts & {
      providerId: string; label?: string; providerName?: string; endpoint?: string; enabled?: boolean; catalogSync?: boolean;
    }) => {
      // ponytail: `--enabled`/`--no-enabled` both declared without a shared default leaves
      // opts.enabled undefined when neither flag is passed; the POST schema requires a boolean.
      const enabled = opts.enabled ?? true;
      let credentials: Record<string, unknown>;
      try {
        credentials = buildCredentialsFromOpts(opts);
      } catch {
        console.error(chalk.red('--credentials-json: invalid JSON'));
        process.exit(1);
        return;
      }

      const body = {
        providerId: opts.providerId,
        ...(opts.providerName ? { providerName: opts.providerName } : {}),
        // Omitted entirely when not given: the server names the connection after its provider.
        ...(opts.label ? { label: opts.label } : {}),
        credentials,
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
        enabled,
        // Omitted when not given: the server picks the default for the provider.
        ...(opts.catalogSync !== undefined ? { catalogSync: opts.catalogSync } : {}),
      };

      try {
        const created = await api<ProviderConnection & { sync?: CatalogSyncSummary }>('POST', '/api/connections', body);
        console.log(chalk.green(`✓ Connection "${created.label}" added (id: ${created.id}).`));
        printLoadedHint(created.label, created.sync);
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── connections edit ──
  addCredentialOptions(
    cmd.command('edit <id>')
      .description('Edit a provider connection (only the fields you pass are changed)')
      .option('--label <label>', 'Display label for this connection')
      .option('--provider-name <name>', 'Upstream provider behind a custom connection (e.g. deepseek)')
      .option('--endpoint <url>', 'Custom API endpoint'),
  )
    .option('--enabled', 'Enable the connection')
    .option('--no-enabled', 'Disable the connection')
    .option('--catalog-sync', 'Track the provider catalog: load new models (disabled) and flag withdrawn ones')
    .option('--no-catalog-sync', 'Stop tracking the provider catalog (existing models are kept)')
    .addHelpText('after', `
Examples:
  routerly connections edit c1 --label "Renamed"
  routerly connections edit c1 --api-key sk-new
  routerly connections edit c1 --no-enabled
  routerly connections edit c1 --catalog-sync
  routerly connections edit c1 --aws-region us-west-2 --aws-access-key-id AKIA...
`)
    .action(async (id: string, opts: CredentialOpts & {
      label?: string; providerName?: string; endpoint?: string; enabled?: boolean; catalogSync?: boolean;
    }) => {
      const body: Record<string, unknown> = {};
      if (opts.label !== undefined) body['label'] = opts.label;
      if (opts.providerName !== undefined) body['providerName'] = opts.providerName;
      if (opts.endpoint !== undefined) body['endpoint'] = opts.endpoint;
      if (opts.enabled !== undefined) body['enabled'] = opts.enabled;
      if (opts.catalogSync !== undefined) body['catalogSync'] = opts.catalogSync;
      if (hasAnyCredentialFlag(opts)) {
        try {
          body['credentials'] = buildCredentialsFromOpts(opts);
        } catch {
          console.error(chalk.red('--credentials-json: invalid JSON'));
          process.exit(1);
          return;
        }
      }

      if (Object.keys(body).length === 0) {
        console.error(chalk.red('nothing to update; pass at least one field'));
        process.exit(1);
        return;
      }

      try {
        const updated = await api<(ProviderConnection & { sync?: CatalogSyncSummary }) | undefined>('PATCH', `/api/connections/${encodeURIComponent(id)}`, body);
        console.log(chalk.green(`✓ Connection "${id}" updated.`));
        printLoadedHint(updated?.label ?? id, updated?.sync);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Connection "${id}" not found.`));
        } else if (err instanceof ApiError) {
          console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── connections show ──
  cmd.command('show <id>')
    .description('Show a provider connection (credentials never printed)')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  routerly connections show c1
  routerly connections show c1 --json
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const connections = await api<ProviderConnection[]>('GET', '/api/connections');
        const found = connections.find(c => c.id === id);
        if (!found) {
          console.error(chalk.red(`Connection "${id}" not found.`));
          process.exit(1);
          return;
        }
        // Strip credentials client-side so they are never printed, matching `list`.
        const { credentials: _credentials, ...safe } = found;
        if (opts.json) {
          console.log(JSON.stringify(safe, null, 2));
          return;
        }
        const table = new Table();
        table.push(
          { [chalk.cyan('ID')]: safe.id },
          { [chalk.cyan('Provider')]: safe.providerId },
          ...(safe.providerName ? [{ [chalk.cyan('Provider name')]: safe.providerName }] : []),
          { [chalk.cyan('Label')]: safe.label },
          { [chalk.cyan('Endpoint')]: safe.endpoint ?? chalk.gray('-') },
          { [chalk.cyan('Enabled')]: safe.enabled ? chalk.green('yes') : chalk.gray('no') },
          { [chalk.cyan('Catalog sync')]: catalogSyncLabel(safe as ProviderConnection) },
        );
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── connections sync ──
  cmd.command('sync <idOrLabel>')
    .description('Re-sync one connection with the provider catalog (needs catalog sync on)')
    .option('--json', 'Output the sync summary as JSON')
    .addHelpText('after', `
Examples:
  routerly connections sync openai
  routerly connections sync c1 --json
`)
    .action(async (idOrLabel: string, opts: { json?: boolean }) => {
      try {
        const conn = await resolveConnection(idOrLabel);
        const sync = await api<CatalogSyncSummary>('POST', `/api/connections/${encodeURIComponent(conn.id)}/sync`);
        if (opts.json) {
          console.log(JSON.stringify(sync, null, 2));
          return;
        }
        if (!sync.catalogAvailable) {
          console.log(chalk.yellow(`The catalog has no models for "${conn.label ?? idOrLabel}"; nothing changed.`));
          return;
        }
        console.log(chalk.green(`✓ Connection "${conn.label ?? idOrLabel}" synced: ${sync.added.length} added, ${sync.unavailable.length} unavailable, ${sync.restored.length} restored, ${sync.skipped.length} skipped.`));
        if (sync.added.length) console.log(`  Added:       ${sync.added.join(', ')}`);
        if (sync.unavailable.length) console.log(`  Unavailable: ${sync.unavailable.join(', ')}`);
        if (sync.restored.length) console.log(`  Restored:    ${sync.restored.join(', ')}`);
        if (sync.skipped.length) console.log(`  Skipped:     ${sync.skipped.map(s => `${s.upstreamModelId} (${s.reason})`).join(', ')}`);
        printLoadedHint(conn.label ?? idOrLabel, sync);
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && err.message === 'catalog_sync_disabled') {
          console.error(chalk.red(`Catalog sync is off for "${idOrLabel}". Turn it on with: routerly connections edit ${idOrLabel} --catalog-sync`));
        } else if (err instanceof ApiError) {
          console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
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
