import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { Profile, ProfileKind, ProjectConfig } from '@routerly/shared';

// ponytail: no interactive editor for profile bodies in CLI v1; edit via dashboard or clone+PATCH. Add when a headless-edit need is proven.

const KINDS: ProfileKind[] = ['routing', 'optimizer', 'security'];

/** Project field each kind binds to, mirroring the service (modules/api/profiles.ts). */
const PROJECT_FIELD: Record<ProfileKind, 'routingProfileId' | 'optimizerProfileId' | 'securityProfileId'> = {
  routing: 'routingProfileId',
  optimizer: 'optimizerProfileId',
  security: 'securityProfileId',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

function handleError(err: unknown): never {
  if (err instanceof ApiError) fail(`Error: ${err.message}`);
  return fail(String(err));
}

function parseKind(value: string): ProfileKind {
  if (!KINDS.includes(value as ProfileKind)) {
    fail(`Unknown kind "${value}". Expected one of: ${KINDS.join(', ')}.`);
  }
  return value as ProfileKind;
}

async function resolveProject(nameOrId: string): Promise<ProjectConfig> {
  const projects = await api<ProjectConfig[]>('GET', '/api/projects');
  const project = projects.find(p => p.id === nameOrId || p.name === nameOrId);
  if (!project) {
    fail(`Project "${nameOrId}" not found. Run \`routerly project list\` to see available projects.`);
  }
  return project;
}

async function fetchProfiles(kind?: ProfileKind): Promise<Profile[]> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return api<Profile[]>('GET', `/api/profiles${query}`);
}

/** One-line, kind-specific summary for the list table. */
function summarize(profile: Profile): string {
  switch (profile.kind) {
    case 'routing':
      return `${profile.policies.filter(p => p.enabled).length} active policies`;
    case 'optimizer':
      return `${profile.optimizers.steps.filter(s => s.enabled).length}/${profile.optimizers.steps.length} steps enabled`;
    case 'security':
      return `${profile.guardrails.rules.length} guardrail rules, ${profile.pii.policies.length} PII policies`;
  }
}

/** Kind-specific detail block for `profiles show`. */
function printDetails(profile: Profile): void {
  if (profile.kind === 'routing') {
    // Selector and fallback strategy are engine internals, not operator knobs (T112).
    console.log(chalk.bold('\nPolicies:'));
    if (profile.policies.length === 0) console.log(chalk.gray('  (none)'));
    for (const p of profile.policies) {
      console.log(`  - ${p.type} (${p.enabled ? 'enabled' : 'disabled'})`);
    }
    return;
  }
  if (profile.kind === 'optimizer') {
    console.log(chalk.bold('\nOptimizers (in execution order):'));
    if (profile.optimizers.steps.length === 0) console.log(chalk.gray('  (none)'));
    for (const s of profile.optimizers.steps) {
      const threshold = s.threshold !== undefined ? `, threshold ${s.threshold}` : '';
      console.log(`  - ${s.id} (${s.enabled ? 'enabled' : 'disabled'}${threshold})`);
    }
    return;
  }
  console.log(chalk.gray('detectInjection:  ') + (profile.guardrails.detectInjection ? 'yes' : 'no'));
  console.log(chalk.bold('\nGuardrail rules:'));
  if (profile.guardrails.rules.length === 0) console.log(chalk.gray('  (none)'));
  for (const r of profile.guardrails.rules) {
    const actions = [r.block ? 'block' : null, r.log ? 'log' : null].filter(Boolean).join('+') || 'monitor';
    console.log(`  - ${r.type} on ${r.target ?? 'request'}, ${actions} (${r.enabled === false ? 'disabled' : 'enabled'})`);
  }
  console.log(chalk.bold('\nPII policies:'));
  if (profile.pii.policies.length === 0) console.log(chalk.gray('  (none)'));
  for (const p of profile.pii.policies) {
    const entities = p.entities?.length ? p.entities.join(', ') : 'all';
    console.log(`  - ${entities} (${p.target}, ${p.enabled === false ? 'disabled' : 'enabled'})`);
  }
}

export function makeProfilesCommand(): Command {
  const cmd = new Command('profiles').description('Manage routing, optimizer and security profiles');

  // ── profiles list ────────────────────────────────────────────────────────────
  cmd.command('list')
    .description('List all profiles (built-in and user), optionally filtered by kind')
    .option('--kind <kind>', `Filter by kind: ${KINDS.join(', ')}`)
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles list
  routerly profiles list --kind optimizer
  routerly profiles list --json
`)
    .action(async (opts: { kind?: string; json?: boolean }) => {
      try {
        const kind = opts.kind ? parseKind(opts.kind) : undefined;
        const profiles = await fetchProfiles(kind);
        if (opts.json) {
          console.log(JSON.stringify(profiles, null, 2));
          return;
        }
        if (profiles.length === 0) {
          console.log(chalk.yellow('No profiles found.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Kind', 'Label', 'Builtin', 'Version', 'Summary'].map(h => chalk.cyan(h)),
        });
        for (const p of profiles) {
          table.push([p.id, p.kind, p.label, p.builtin ? 'yes' : 'no', p.version, summarize(p)]);
        }
        console.log(table.toString());
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles show ────────────────────────────────────────────────────────────
  cmd.command('show <id>')
    .description('Show details of a profile')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles show auto
  routerly profiles show auto --json
`)
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const profiles = await fetchProfiles();
        const profile = profiles.find(p => p.id === id);
        if (!profile) {
          fail(`Profile "${id}" not found. Run \`routerly profiles list\` to see available profiles.`);
        }
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.gray('id:               ') + profile.id);
        console.log(chalk.gray('kind:             ') + profile.kind);
        console.log(chalk.gray('label:            ') + profile.label);
        console.log(chalk.gray('builtin:          ') + (profile.builtin ? 'yes' : 'no'));
        console.log(chalk.gray('version:          ') + profile.version);
        if (profile.baseId) console.log(chalk.gray('baseId:           ') + profile.baseId);
        printDetails(profile);
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles create ──────────────────────────────────────────────────────────
  cmd.command('create')
    .description('Create an empty profile of the given kind, to be filled in from the dashboard')
    .requiredOption('--kind <kind>', `Profile kind: ${KINDS.join(', ')}`)
    .requiredOption('--label <label>', 'Label for the new profile')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles create --kind routing --label "My Routing"
  routerly profiles create --kind security --label "My Guardrails" --json
`)
    .action(async (opts: { kind: string; label: string; json?: boolean }) => {
      try {
        const kind = parseKind(opts.kind);
        const profile = await api<Profile>('POST', '/api/profiles', { kind, label: opts.label });
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Created ${profile.kind} profile "${profile.label}" -> ${profile.id}`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles clone ───────────────────────────────────────────────────────────
  cmd.command('clone <baseId>')
    .description('Clone a profile of any kind into a new user profile')
    .requiredOption('--label <label>', 'Label for the new profile')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles clone auto --label "My Routing"
  routerly profiles clone optimizer-aggressive --label "My Optimizers"
`)
    .action(async (baseId: string, opts: { label: string; json?: boolean }) => {
      try {
        const profile = await api<Profile>('POST', '/api/profiles/clone', { baseId, label: opts.label });
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Cloned ${profile.kind} profile "${baseId}" -> ${profile.id}`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles delete ──────────────────────────────────────────────────────────
  cmd.command('delete <id>')
    .description('Delete a user profile (built-ins cannot be deleted)')
    .addHelpText('after', `
Examples:
  routerly profiles delete 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
`)
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/profiles/${encodeURIComponent(id)}`);
        console.log(chalk.green(`✓ Profile "${id}" deleted`));
      } catch (err) {
        if (err instanceof ApiError && err.message === 'profile_in_use') {
          fail(`Cannot delete "${id}": it is still assigned to a project.`);
        }
        handleError(err);
      }
    });

  // ── profiles set ─────────────────────────────────────────────────────────────
  cmd.command('set <project> <kind> [profileId]')
    .description('Assign or clear the profile of one kind for a project')
    .option('--none', 'Clear the assignment for this kind, back to the project inline config')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles set my-api routing auto
  routerly profiles set my-api optimizer optimizer-aggressive
  routerly profiles set my-api security --none
`)
    .action(async (nameOrId: string, kindArg: string, profileId: string | undefined, opts: { none?: boolean; json?: boolean }) => {
      try {
        const kind = parseKind(kindArg);
        if (!opts.none && !profileId) {
          fail('Error: provide a profileId or --none.');
        }
        const project = await resolveProject(nameOrId);
        const result = await api<ProjectConfig>('PUT', `/api/projects/${encodeURIComponent(project.id)}/profiles`, {
          [kind]: opts.none ? null : profileId,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const what = opts.none ? 'cleared' : `set to "${profileId}"`;
        console.log(chalk.green(`✓ ${kind} profile ${what} on project "${project.name}"`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles get ─────────────────────────────────────────────────────────────
  cmd.command('get <project>')
    .description('Show which profile each kind is bound to for a project')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles get my-api
  routerly profiles get my-api --json
`)
    .action(async (nameOrId: string, opts: { json?: boolean }) => {
      try {
        const project = await resolveProject(nameOrId);
        const bound: Record<string, string | null> = {};
        for (const kind of KINDS) bound[kind] = project[PROJECT_FIELD[kind]] ?? null;
        if (opts.json) {
          console.log(JSON.stringify(bound, null, 2));
          return;
        }
        const table = new Table({ head: ['Kind', 'Profile'].map(h => chalk.cyan(h)) });
        for (const kind of KINDS) table.push([kind, bound[kind] ?? chalk.gray('custom')]);
        console.log(table.toString());
      } catch (err) {
        handleError(err);
      }
    });

  return cmd;
}
