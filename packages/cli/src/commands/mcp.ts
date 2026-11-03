import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createRequire } from 'node:module';
import { api, ApiError } from '../api.js';
import { requireAccount } from '../store.js';
import type { McpToken } from '@routerly/shared';

/** A stored MCP token as the API returns it: everything but the hash. */
type McpTokenRow = Omit<McpToken, 'tokenHash'>;

// Row shape returned by GET /api/me/mcp-tools: the tools the caller's own
// permissions expose, which is exactly what the caller's MCP tokens expose.
interface ToolRow {
  name: string;
  description: string;
  scope: 'read' | 'write';
  sourceModule: string;
  permission: string;
}

interface RpcResult {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RpcResponse {
  result?: RpcResult;
  // JSON-RPC protocol error is an object; the /mcp transport's HTTP auth errors
  // (401) send `error` as a string plus a top-level `message`.
  error?: { code?: number; message?: string } | string;
  message?: string;
}

/** Name of the personal MCP token the CLI mints for its own use. */
const CLI_TOKEN_NAME = 'routerly-cli';

/**
 * Resolves the MCP token to authenticate with: an explicit flag, the env var an
 * MCP client would already have set, or the CLI's own token.
 *
 * Personal tokens are stored hashed, so the CLI cannot read its own token back:
 * it revokes and re-mints it on every run that needs one. Pass --token (or set
 * ROUTERLY_MCP_TOKEN) to keep a long-lived token of your own instead.
 */
async function acquireMcpToken(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const fromEnv = process.env['ROUTERLY_MCP_TOKEN'];
  if (fromEnv) return fromEnv;

  const existing = await api<McpTokenRow[]>('GET', '/api/me/mcp-tokens');
  const prior = existing.find(t => t.name === CLI_TOKEN_NAME);
  if (prior) await api<void>('DELETE', `/api/me/mcp-tokens/${encodeURIComponent(prior.id)}`);
  const created = await api<McpTokenRow & { token: string }>('POST', '/api/me/mcp-tokens', { name: CLI_TOKEN_NAME });
  return created.token;
}

/** Reports an error the way every other command does, then exits non-zero. */
function fail(err: unknown): never {
  if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
  else console.error(chalk.red(String(err)));
  process.exit(1);
}

function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('it-IT') : chalk.gray('—');
}

export function makeMcpCommand(): Command {
  const cmd = new Command('mcp').description('Inspect and exercise the MCP (Model Context Protocol) surface');

  // ── mcp tools ──────────────────────────────────────────────────────────────
  cmd.command('tools')
    .description('List the MCP tools your permissions expose')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly mcp tools
  routerly mcp tools --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const tools = await api<ToolRow[]>('GET', '/api/me/mcp-tools');
        if (opts.json) {
          console.log(JSON.stringify(tools, null, 2));
          return;
        }
        if (tools.length === 0) {
          console.log(chalk.yellow('No MCP tool is available to your role.'));
          return;
        }
        const table = new Table({
          head: ['Name', 'Scope', 'Module', 'Permission'].map(h => chalk.cyan(h)),
        });
        for (const t of tools) {
          table.push([t.name, t.scope, t.sourceModule, t.permission]);
        }
        console.log(table.toString());
      } catch (err) {
        fail(err);
      }
    });

  // ── mcp test <tool> ──────────────────────────────────────────────────────────
  cmd.command('test <tool>')
    .description('Invoke an MCP tool over the live /mcp transport')
    .option('--input <json>', 'Tool arguments as a JSON object', '{}')
    .option('--token <token>', 'Use an explicit MCP token instead of the CLI one')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly mcp test list_models
  routerly mcp test get_model --input '{"modelId":"gpt-4o"}'
  routerly mcp test list_models --token sk-rt-mcp-...
`)
    .action(async (tool: string, opts: { input?: string; token?: string; json?: boolean }) => {
      try {
        // Validate --input BEFORE any network call or token minting.
        let args: unknown;
        try {
          args = JSON.parse(opts.input ?? '{}');
        } catch {
          console.error(chalk.red('Error: --input must be valid JSON.'));
          process.exit(1);
        }

        const account = await requireAccount();
        const token = await acquireMcpToken(opts.token);

        const res = await fetch(`${account.serverUrl.replace(/\/$/, '')}/mcp`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: tool, arguments: args },
          }),
        });

        const body = (await res.json()) as RpcResponse;

        // HTTP-level failure (e.g. 401 on an expired token): `error` is a string
        // and the actionable text is the top-level `message`. JSON-RPC protocol
        // error: `error` is an object carrying its own `message`. Surface either.
        const rpcErrorMessage =
          typeof body.error === 'object' && body.error ? body.error.message : undefined;
        if (!res.ok || body.error) {
          const msg = body.message ?? rpcErrorMessage ?? `MCP request failed (HTTP ${res.status})`;
          console.error(chalk.red(`Error: ${msg}`));
          process.exit(1);
        }
        if (body.result?.isError) {
          const text = body.result.content?.map(c => c.text).join('\n') ?? 'tool returned an error';
          console.error(chalk.red(`Error: ${text}`));
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(body.result, null, 2));
          return;
        }
        console.log(body.result?.content?.map(c => c.text).join('\n') ?? '');
      } catch (err) {
        fail(err);
      }
    });

  // ── mcp serve ────────────────────────────────────────────────────────────────
  cmd.command('serve')
    .description('Run the MCP server over stdio for local clients (e.g. Claude Desktop)')
    .option('--token <token>', 'Use an explicit MCP token instead of the CLI one')
    .addHelpText('after', `
Examples:
  routerly mcp serve
  routerly mcp serve --token sk-rt-mcp-...
`)
    .action(async (opts: { token?: string }) => {
      try {
        // No CLI login is needed when the token comes from --token or the env:
        // a desktop client spawns this command with ROUTERLY_MCP_TOKEN set and
        // never logs the CLI in. Minting one still requires an account.
        const token = await acquireMcpToken(opts.token);

        // Resolve the built service entry the same way a published dependency resolves.
        const require = createRequire(import.meta.url);
        const serviceEntry = require.resolve('@routerly/service');

        // Diagnostics to stderr only, before the child attaches. stdout is the protocol stream.
        console.error(chalk.gray('Starting MCP stdio server...'));

        const { spawn } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          const child = spawn('node', [serviceEntry], {
            stdio: 'inherit',
            env: { ...process.env, ROUTERLY_MCP_STDIO: '1', ROUTERLY_MCP_TOKEN: token },
          });
          child.on('error', reject);
          child.on('exit', code => {
            // Propagate the child's exit code so a failed start (e.g. a revoked
            // token, thrown in the service's stdio bootstrap) is not reported as success.
            if (code && code !== 0) process.exitCode = code;
            resolve();
          });
        });
      } catch (err) {
        fail(err);
      }
    });

  cmd.addCommand(makeMcpTokenCommand());

  return cmd;
}

// ─── Token subcommand group ───────────────────────────────────────────────────

function makeMcpTokenCommand(): Command {
  const cmd = new Command('token').description('Manage your personal MCP tokens');

  cmd.command('list')
    .description('List your MCP tokens')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly mcp token list
  routerly mcp token list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const tokens = await api<McpTokenRow[]>('GET', '/api/me/mcp-tokens');
        if (opts.json) {
          console.log(JSON.stringify(tokens, null, 2));
          return;
        }
        if (tokens.length === 0) {
          console.log(chalk.yellow('No MCP tokens yet. Create one: routerly mcp token create <name>'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Name', 'Snippet', 'Created', 'Last used', 'Expires'].map(h => chalk.cyan(h)),
        });
        for (const t of tokens) {
          table.push([t.id, t.name, t.tokenSnippet + '…', fmtDate(t.createdAt), fmtDate(t.lastUsedAt), fmtDate(t.expiresAt)]);
        }
        console.log(table.toString());
      } catch (err) {
        fail(err);
      }
    });

  cmd.command('create <name>')
    .description('Create an MCP token (shown only once)')
    .option('--expires <date>', 'Expiry date, e.g. 2027-01-01')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
An MCP token acts as you: it exposes exactly the tools your role permits.

Examples:
  routerly mcp token create laptop
  routerly mcp token create ci --expires 2027-01-01
  routerly mcp token create ci --json
`)
    .action(async (name: string, opts: { expires?: string; json?: boolean }) => {
      try {
        let expiresAt: string | undefined;
        if (opts.expires) {
          const parsed = new Date(opts.expires);
          if (Number.isNaN(parsed.getTime())) {
            console.error(chalk.red('Error: --expires must be a valid date, e.g. 2027-01-01.'));
            process.exit(1);
          }
          expiresAt = parsed.toISOString();
        }

        const created = await api<McpTokenRow & { token: string }>('POST', '/api/me/mcp-tokens', {
          name,
          ...(expiresAt ? { expiresAt } : {}),
        });

        if (opts.json) {
          console.log(JSON.stringify(created, null, 2));
          return;
        }
        console.log(chalk.green(`✓ MCP token "${created.name}" created.`));
        console.log(chalk.bold('\nToken (save it now, it is shown only once):'));
        console.log(chalk.yellow(created.token));
        console.log(chalk.gray(`  ID:      ${created.id}`));
        if (created.expiresAt) console.log(chalk.gray(`  Expires: ${fmtDate(created.expiresAt)}`));
      } catch (err) {
        fail(err);
      }
    });

  cmd.command('remove <token-id>')
    .description('Revoke one of your MCP tokens')
    .addHelpText('after', `
Examples:
  routerly mcp token remove <token-id>
`)
    .action(async (tokenId: string) => {
      try {
        await api<void>('DELETE', `/api/me/mcp-tokens/${encodeURIComponent(tokenId)}`);
        console.log(chalk.green(`✓ MCP token revoked. Clients using it stop working immediately.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`MCP token "${tokenId}" not found.`));
          process.exit(1);
        }
        fail(err);
      }
    });

  return cmd;
}
