import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { ProjectConfig, RoutingProfile } from '@routerly/shared';

// ponytail: no interactive editor for policies in CLI v1; edit via dashboard or clone+PATCH. Add when a headless-edit need is proven.

// ─── Helper: resolve project by name or ID ────────────────────────────────────

async function resolveProject(nameOrId: string): Promise<ProjectConfig> {
  const projects = await api<ProjectConfig[]>('GET', '/api/projects');
  const project = projects.find(p => p.id === nameOrId || p.name === nameOrId);
  if (!project) {
    console.error(chalk.red(`Project "${nameOrId}" not found. Run \`routerly project list\` to see available projects.`));
    process.exit(1);
  }
  return project;
}

export function makeProfilesCommand(): Command {
  const cmd = new Command('profiles').description('Manage routing profiles');

  // ── profiles list ────────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List all routing profiles (built-in and user)')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles list
  routerly profiles list --json
`)
    .action(async (opts: { json?: boolean }) => {
      try {
        const profiles = await api<RoutingProfile[]>('GET', '/api/routing/profiles');
        if (opts.json) {
          console.log(JSON.stringify(profiles, null, 2));
          return;
        }
        if (profiles.length === 0) {
          console.log(chalk.yellow('No routing profiles found.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Label', 'Builtin', 'Selector', 'Version'].map(h => chalk.cyan(h)),
        });
        for (const p of profiles) {
          table.push([p.id, p.label, p.builtin ? 'yes' : 'no', p.selector, p.version]);
        }
        console.log(table.toString());
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  // ── profiles show ────────────────────────────────────────────────────────────
  cmd.command('show <id>')
    .description('Show details of a routing profile')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles show balanced
  routerly profiles show balanced --json
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const profiles = await api<RoutingProfile[]>('GET', '/api/routing/profiles');
        const profile = profiles.find(p => p.id === id);
        if (!profile) {
          console.error(chalk.red(`Profile "${id}" not found. Run \`routerly profiles list\` to see available profiles.`));
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.gray('id:               ') + profile.id);
        console.log(chalk.gray('label:            ') + profile.label);
        console.log(chalk.gray('builtin:          ') + (profile.builtin ? 'yes' : 'no'));
        console.log(chalk.gray('selector:         ') + profile.selector);
        console.log(chalk.gray('fallbackStrategy: ') + profile.fallbackStrategy);
        console.log(chalk.gray('version:          ') + profile.version);
        if (profile.baseId) console.log(chalk.gray('baseId:           ') + profile.baseId);
        console.log(chalk.bold('\nPolicies:'));
        if (profile.policies.length === 0) {
          console.log(chalk.gray('  (none)'));
        } else {
          for (const p of profile.policies) {
            console.log(`  - ${p.type} (${p.enabled ? 'enabled' : 'disabled'})`);
          }
        }
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  // ── profiles clone ───────────────────────────────────────────────────────────
  cmd.command('clone <baseId>')
    .description('Clone a routing profile into a new user profile')
    .requiredOption('--label <label>', 'Label for the new profile')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles clone balanced --label "My Custom Profile"
`)
    .action(async (baseId: string, opts: { label: string; json?: boolean }) => {
      try {
        const profile = await api<RoutingProfile>('POST', '/api/routing/profiles/clone', { baseId, label: opts.label });
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Cloned profile "${baseId}" -> ${profile.id}`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  // ── profiles set ─────────────────────────────────────────────────────────────
  cmd.command('set <project> [profileId]')
    .description('Assign or clear the routing profile for a project')
    .option('--none', 'Clear the profile assignment')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles set my-api balanced
  routerly profiles set my-api --none
`)
    .action(async (nameOrId: string, profileId: string | undefined, opts: { none?: boolean; json?: boolean }) => {
      try {
        if (!opts.none && !profileId) {
          console.error(chalk.red('Error: provide a profileId or --none.'));
          process.exit(1);
        }
        const project = await resolveProject(nameOrId);
        const result = await api<ProjectConfig>('PUT', `/api/projects/${encodeURIComponent(project.id)}/profile`, {
          profileId: opts.none ? null : profileId,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Profile ${opts.none ? 'cleared' : 'set to "' + profileId + '"'} on project "${project.name}"`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`Error: ${err.message}`));
        else console.error(chalk.red(String(err)));
        process.exit(1);
      }
    });

  return cmd;
}
