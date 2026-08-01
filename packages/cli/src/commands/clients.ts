import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { requireAccount } from '../store.js';
import { INTEGRATIONS, acquireToken } from '../clients/index.js';
import type { ClientIntegration } from '../clients/index.js';
import { restoreBackup, listBackups } from '../lib/safe-file.js';
import { CLIENT_REGISTRY, buildSnippet, buildMcpSnippet } from '@routerly/shared';
import type { ClientMeta, ProjectConfig, SupportState } from '@routerly/shared';

const MCP_TOKEN_PLACEHOLDER = '<YOUR_MCP_TOKEN>';

function colorSupportState(state: SupportState): string {
  switch (state) {
    case 'auto-configurable':
    case 'launchable':
      return chalk.green(state);
    case 'documented':
      return chalk.gray(state);
    case 'partial':
    case 'stale':
      return chalk.yellow(state);
    default:
      return state;
  }
}

function resolveIntegration(id: string): ClientIntegration {
  const integration = INTEGRATIONS[id];
  if (!integration) {
    console.error(chalk.red(`Unknown client "${id}". Run \`routerly clients list\` to see supported clients.`));
    process.exit(1);
  }
  return integration;
}

async function resolveProjectForConfigure(explicit: string | undefined): Promise<ProjectConfig> {
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
  const { default: inquirer } = await import('inquirer');
  const { projectId } = await inquirer.prompt([{
    type: 'list',
    name: 'projectId',
    message: 'Select a project to configure:',
    choices: projects.map(p => ({ name: p.name, value: p.id })),
  }]) as { projectId: string };
  return projects.find(p => p.id === projectId)!;
}

/** Registry order, so every surface lists the clients the same way. */
function listIntegrations(): ClientIntegration[] {
  return CLIENT_REGISTRY.map(meta => INTEGRATIONS[meta.id]).filter((i): i is ClientIntegration => i !== undefined);
}

function isAutoConfigurable(integration: ClientIntegration): boolean {
  return integration.supportState === 'auto-configurable' || integration.supportState === 'launchable';
}

/** Prints the manual steps for a client this CLI cannot write a config for. */
function printManualSteps(meta: ClientMeta, steps: string, header: string): void {
  console.log(chalk.bold(`\n${meta.label}: ${header}`));
  if (meta.configKind !== 'ui' && meta.configKind !== 'env') {
    console.log(chalk.gray(`  Config file: ${meta.configPathHint}`));
  }
  console.log('');
  console.log(steps);
  console.log('');
  console.log(chalk.gray(`Docs: https://doc.routerly.ai/next/${meta.docSlug}`));
}

export function makeClientsCommand(): Command {
  const cmd = new Command('clients').description('Configure local AI coding clients (Claude Code, Claude Desktop, Codex, OpenCode, OpenClaw, Continue, Cursor, Cline, Zed) to use Routerly');

  // ── clients list ─────────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List supported clients and their support level')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  routerly clients list
  routerly clients list --json
`)
    .action(async (opts: { json?: boolean }) => {
      const integrations = listIntegrations();
      const modesOf = (id: string) => CLIENT_REGISTRY.find(c => c.id === id)?.modes ?? [];
      if (opts.json) {
        console.log(JSON.stringify(
          integrations.map(i => ({ id: i.id, label: i.label, supportState: i.supportState, modes: modesOf(i.id) })),
          null,
          2
        ));
        return;
      }
      const table = new Table({ head: ['ID', 'Label', 'Support', 'Modes'].map(h => chalk.cyan(h)) });
      for (const i of integrations) {
        table.push([i.id, i.label, colorSupportState(i.supportState), modesOf(i.id).join(', ')]);
      }
      console.log(table.toString());
    });

  // ── clients inspect ──────────────────────────────────────────────────────────
  cmd.command('inspect <id>')
    .description('Show detection and current configuration status for a client')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  routerly clients inspect claude-code
  routerly clients inspect codex --json
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      const integration = resolveIntegration(id);
      try {
        const [detected, inspected] = await Promise.all([integration.detect(), integration.inspect()]);
        if (opts.json) {
          console.log(JSON.stringify({
            id: integration.id,
            label: integration.label,
            supportState: integration.supportState,
            detect: detected,
            inspect: inspected,
          }, null, 2));
          return;
        }
        console.log(chalk.bold(`\n${integration.label}`));
        console.log(chalk.gray('  Support:    ') + colorSupportState(integration.supportState));
        console.log(chalk.gray('  Installed:  ') + (detected.installed ? chalk.green('yes') : chalk.gray('no'))
          + (detected.version ? chalk.gray(` (${detected.version})`) : ''));
        console.log(chalk.gray('  Config:     ') + inspected.configPath + (inspected.exists ? '' : chalk.gray(' (not found)')));
        console.log(chalk.gray('  Configured: ') + (inspected.routerlyConfigured ? chalk.green('yes') : chalk.gray('no')));
        if (inspected.currentBaseUrl) {
          console.log(chalk.gray('  Base URL:   ') + inspected.currentBaseUrl + (inspected.stale ? chalk.yellow(' (stale)') : ''));
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── clients configure ────────────────────────────────────────────────────────
  cmd.command('configure <id>')
    .description('Write Routerly connection settings into a client config file')
    .option('--project <id>', 'Project name or ID to use for the token (prompts if omitted)')
    .option('--token <token>', 'Use this token instead of minting a new one')
    .option('--yes', 'Skip the token-mint consent prompt')
    .option('--json', 'Output the plan/apply/validate result as JSON')
    .addHelpText('after', `
Examples:
  routerly clients configure claude-code --project my-api
  routerly clients configure codex --project my-api --token sk-rt-...
  routerly clients configure opencode --project my-api --yes
  routerly clients configure zed --project my-api --yes      # prints manual steps
  routerly clients configure claude-desktop                  # prints the MCP wiring
`)
    .action(async (id: string, opts: { project?: string; token?: string; yes?: boolean; json?: boolean }) => {
      const integration = resolveIntegration(id);
      const meta = CLIENT_REGISTRY.find(c => c.id === id)!;
      try {
        // MCP-only client: no chat traffic to route, so no project token to
        // mint. Print the MCP wiring with a placeholder instead.
        if (!meta.modes.includes('llm')) {
          const steps = buildMcpSnippet(meta, (await requireAccount()).serverUrl, MCP_TOKEN_PLACEHOLDER);
          if (opts.json) {
            console.log(JSON.stringify({ id: meta.id, label: meta.label, manual: true, mode: 'mcp', steps }, null, 2));
            return;
          }
          printManualSteps(meta, steps, 'connects over MCP only');
          console.log(chalk.gray(`Create the token with \`routerly mcp token create --label ${meta.id}\`.`));
          return;
        }

        const project = await resolveProjectForConfigure(opts.project);
        const account = await requireAccount();

        if (!opts.token && !opts.yes) {
          const { default: inquirer } = await import('inquirer');
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: `Mint a new Routerly token for project "${project.name}" to configure ${integration.label}?`,
            default: true,
          }]) as { proceed: boolean };
          if (!proceed) {
            console.log(chalk.yellow('Aborted.'));
            return;
          }
        }

        const token = await acquireToken({ projectId: project.id, ...(opts.token ? { explicitToken: opts.token } : {}) });

        // Documented client: no file this CLI can back up, write and roll
        // back. The token is still minted, the user needs it for the steps.
        if (!isAutoConfigurable(integration)) {
          const steps = buildSnippet(meta, account.serverUrl, token);
          if (opts.json) {
            console.log(JSON.stringify({ id: meta.id, label: meta.label, manual: true, mode: 'llm', steps }, null, 2));
            return;
          }
          printManualSteps(meta, steps, 'is configured by hand');
          return;
        }

        const target = { baseUrl: account.serverUrl, token, wireFormat: meta.wireFormat };
        const plan = await integration.plan(target);

        if (!opts.json) {
          console.log(chalk.bold(`\nPlan for ${integration.label} (${plan.filePath}):`));
          console.log(chalk.gray('--- before ---'));
          console.log(plan.before || chalk.gray('(file does not exist)'));
          console.log(chalk.gray('--- after ----'));
          console.log(plan.after);
        }

        const applied = await integration.apply(plan);
        const validated = await integration.validate();

        if (opts.json) {
          console.log(JSON.stringify({ plan, applied, validated }, null, 2));
          return;
        }

        console.log(chalk.green(`✓ ${integration.label} configured (${applied.filePath}).`));
        console.log(chalk.gray(`  Backup ID: ${applied.backupId} (undo with \`routerly clients undo ${applied.backupId}\`)`));
        if (validated.ok) {
          console.log(chalk.green(`✓ ${validated.message}`));
        } else {
          console.log(chalk.yellow(`⚠ ${validated.message}`));
        }
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── clients doctor ───────────────────────────────────────────────────────────
  cmd.command('doctor')
    .description('Check Routerly service reachability and client configurator module status')
    .addHelpText('after', `
Examples:
  routerly clients doctor
`)
    .action(async () => {
      let hadError = false;
      try {
        const info = await api<{ version: string }>('GET', '/api/system/info');
        console.log(chalk.green(`✓ Routerly service reachable (version ${info.version}).`));
      } catch (err) {
        console.error(chalk.red(`✗ Routerly service unreachable: ${(err as Error).message}`));
        hadError = true;
      }
      try {
        const res = await api<{ enabled: boolean; clients: unknown[] }>('GET', '/api/clients');
        console.log(chalk.green(`✓ Client configurator module enabled (${res.clients.length} client(s) registered).`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.log(chalk.yellow('  Client configurator module is disabled on the service.'));
        } else {
          console.error(chalk.red(`✗ Could not check client configurator module: ${(err as Error).message}`));
          hadError = true;
        }
      }
      if (hadError) process.exit(1);
    });

  // ── clients undo ─────────────────────────────────────────────────────────────
  cmd.command('undo <backupId>')
    .description('Restore a client config file from a backup created by `clients configure`')
    .addHelpText('after', `
Examples:
  routerly clients undo a1b2c3d4-e5f6-7890-abcd-ef1234567890
`)
    .action(async (backupId: string) => {
      try {
        const backups = await listBackups();
        const manifest = backups.find(b => b.backupId === backupId);
        if (!manifest) {
          console.error(chalk.red(`Backup "${backupId}" not found. Backup IDs are printed by \`routerly clients configure\`.`));
          process.exit(1);
        }
        await restoreBackup(backupId);
        console.log(chalk.green(`✓ Restored ${manifest.originalPath} (client: ${manifest.clientId}).`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── clients launch ───────────────────────────────────────────────────────────
  cmd.command('launch <id>')
    .description('Launch an installed client (only for clients that support it)')
    .addHelpText('after', `
Examples:
  routerly clients launch claude-code
`)
    .action(async (id: string) => {
      const integration = resolveIntegration(id);
      if (!integration.launch) {
        console.error(chalk.red(`${integration.label} does not support launching from Routerly.`));
        process.exit(1);
      }
      try {
        await integration.launch();
        console.log(chalk.green(`✓ ${integration.label} exited.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
