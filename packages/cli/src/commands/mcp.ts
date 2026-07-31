import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createRequire } from 'node:module';
import { api, ApiError } from '../api.js';
import { requireAccount } from '../store.js';
import { acquireToken } from '../clients/index.js';
import type { ProjectConfig } from '@routerly/shared';

// Row shape returned by GET /api/mcp/tools (management surface, Task 10).
interface ToolRow {
  name: string;
  description: string;
  scope: 'read' | 'write';
  sourceModule: string;
  enabled: boolean;
}

interface RpcResult {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RpcResponse {
  result?: RpcResult;
  // JSON-RPC protocol error is an object; the /mcp transport's HTTP auth errors
  // (401/403) send `error` as a string plus a top-level `message`.
  error?: { code?: number; message?: string } | string;
  message?: string;
}

// ─── Helper: resolve a project for token minting ─────────────────────────────
// Non-interactive on purpose: `serve` streams the MCP protocol over stdout, so a
// prompt would corrupt it. Explicit flag wins; otherwise use the sole project or
// require the flag when there is ambiguity.
async function resolveProject(explicit: string | undefined): Promise<ProjectConfig> {
  const projects = await api<ProjectConfig[]>('GET', '/api/projects');
  if (explicit) {
    const project = projects.find(p => p.id === explicit || p.name === explicit);
    if (!project) {
      console.error(chalk.red(`Project "${explicit}" not found. Run \`routerly project list\` to see available projects.`));
      process.exit(1);
    }
    return project;
  }
  if (projects.length === 0) {
    console.error(chalk.red('No projects found. Create one first: routerly project create --name <name>'));
    process.exit(1);
  }
  if (projects.length === 1) return projects[0]!;
  console.error(chalk.red('Multiple projects found. Specify one with --project <name|id>.'));
  process.exit(1);
}

export function makeMcpCommand(): Command {
  const cmd = new Command('mcp').description('Inspect and exercise the MCP (Model Context Protocol) surface');

  // ── mcp tools ──────────────────────────────────────────────────────────────
  cmd.command('tools')
    .description('List the MCP tools exposed by the server')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly mcp tools
  routerly mcp tools --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const tools = await api<ToolRow[]>('GET', '/api/mcp/tools');
        if (opts.json) {
          console.log(JSON.stringify(tools, null, 2));
          return;
        }
        if (tools.length === 0) {
          console.log(chalk.yellow('No MCP tools found.'));
          return;
        }
        const table = new Table({
          head: ['Name', 'Scope', 'Module', 'Enabled'].map(h => chalk.cyan(h)),
        });
        for (const t of tools) {
          table.push([t.name, t.scope, t.sourceModule, t.enabled ? 'yes' : 'no']);
        }
        console.log(table.toString());
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  // ── mcp test <tool> ──────────────────────────────────────────────────────────
  cmd.command('test <tool>')
    .description('Invoke an MCP tool over the live /mcp transport with a project token')
    .option('--input <json>', 'Tool arguments as a JSON object', '{}')
    .option('--project <id>', 'Project name or ID to mint a token for (defaults to the only project)')
    .option('--token <token>', 'Use an explicit project token instead of minting one')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly mcp test list_models
  routerly mcp test get_model --input '{"modelId":"gpt-4o"}'
  routerly mcp test list_models --project my-api --token sk-rt-...
`)
    .action(async (tool: string, opts: { input?: string; project?: string; token?: string; json?: boolean }) => {
      try {
        // Validate --input BEFORE any network or token minting.
        let args: unknown;
        try {
          args = JSON.parse(opts.input ?? '{}');
        } catch {
          console.error(chalk.red('Error: --input must be valid JSON.'));
          process.exit(1);
        }

        const account = await requireAccount();
        const project = await resolveProject(opts.project);
        const token = await acquireToken(
          opts.token
            ? { projectId: project.id, explicitToken: opts.token }
            : { projectId: project.id, scopes: ['mcp', 'mcp:write'] },
        );

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

        // HTTP-level failure (e.g. 403 no-mcp-scope): `error` is a string, the
        // actionable text is the top-level `message`. JSON-RPC protocol error:
        // `error` is an object carrying its own `message`. Surface whichever is present.
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
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  // ── mcp serve ────────────────────────────────────────────────────────────────
  cmd.command('serve')
    .description('Run the MCP server over stdio for local clients (e.g. Claude Desktop)')
    .option('--project <id>', 'Project name or ID to mint a token for (defaults to the only project)')
    .option('--token <token>', 'Use an explicit project token instead of minting one')
    .addHelpText('after', `
Examples:
  routerly mcp serve
  routerly mcp serve --project my-api
  routerly mcp serve --project my-api --token sk-rt-...
`)
    .action(async (opts: { project?: string; token?: string }) => {
      try {
        const project = await resolveProject(opts.project);
        const token = await acquireToken(
          opts.token
            ? { projectId: project.id, explicitToken: opts.token }
            : { projectId: project.id, scopes: ['mcp', 'mcp:write'] },
        );

        // Resolve the built service entry the same way a published dependency resolves.
        const require = createRequire(import.meta.url);
        const serviceEntry = require.resolve('@routerly/service');

        // Diagnostics to stderr only, before the child attaches. stdout is the protocol stream.
        console.error(chalk.gray(`Starting MCP stdio server for project "${project.name}"...`));

        const { spawn } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          const child = spawn('node', [serviceEntry], {
            stdio: 'inherit',
            env: { ...process.env, ROUTERLY_MCP_STDIO: '1', ROUTERLY_MCP_TOKEN: token },
          });
          child.on('error', reject);
          child.on('exit', code => {
            // Propagate the child's exit code so a failed start (e.g. token lacks
            // the mcp scope, thrown in the service's stdio bootstrap) is not reported as success.
            if (code && code !== 0) process.exitCode = code;
            resolve();
          });
        });
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  return cmd;
}
