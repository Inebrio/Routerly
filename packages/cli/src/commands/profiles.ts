import { Command, Option } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { readCallConfigArg, printCallConfig } from '../lib/call-config.js';
import { DEFAULT_RANKING_ALGORITHM, RANKING_ALGORITHMS } from '@routerly/shared';
import type { FallbackStrategyType, Profile, ProfileKind, RouterConfig } from '@routerly/shared';

// ponytail: no interactive editor for profile bodies in CLI v1; edit via dashboard or clone+PATCH. Add when a headless-edit need is proven.

const KINDS: ProfileKind[] = ['routing', 'optimizer', 'security'];
const FALLBACK_STRATEGIES: FallbackStrategyType[] = ['next-best', 'retry-after-cooldown', 'abort'];
const DEFAULT_FALLBACK_STRATEGY: FallbackStrategyType = 'next-best';

/** Router field each kind binds to, mirroring the service (modules/api/profiles.ts). */
const ROUTER_FIELD: Record<ProfileKind, 'routingProfileId' | 'optimizerProfileId' | 'securityProfileId'> = {
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

function rankingOption(description: string): Option {
  return new Option('--ranking-algorithm <id>', description).choices(RANKING_ALGORITHMS);
}

function fallbackOption(description: string): Option {
  return new Option('--fallback-strategy <strategy>', description).choices(FALLBACK_STRATEGIES);
}

function warnIfAbort(strategy: string | undefined): void {
  if (strategy === 'abort') {
    console.error(chalk.yellow('Warning: "abort" fails the request on the first provider error, without trying other models.'));
  }
}

function parseKind(value: string): ProfileKind {
  if (!KINDS.includes(value as ProfileKind)) {
    fail(`Unknown kind "${value}". Expected one of: ${KINDS.join(', ')}.`);
  }
  return value as ProfileKind;
}

async function resolveRouter(nameOrId: string): Promise<RouterConfig> {
  const routers = await api<RouterConfig[]>('GET', '/api/routers');
  const router = routers.find(p => p.id === nameOrId || p.name === nameOrId);
  if (!router) {
    fail(`Router "${nameOrId}" not found. Run \`routerly router list\` to see available routers.`);
  }
  return router;
}

async function fetchProfiles(kind?: ProfileKind): Promise<Profile[]> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return api<Profile[]>('GET', `/api/profiles${query}`);
}

/** One-line, kind-specific summary for the list table. */
function summarize(profile: Profile): string {
  switch (profile.kind) {
    case 'routing':
      return `${profile.policies.filter(p => p.enabled).length} active policies, fallback ${profile.fallbackStrategy ?? DEFAULT_FALLBACK_STRATEGY}`;
    case 'optimizer':
      return `${profile.optimizers.steps.filter(s => s.enabled).length}/${profile.optimizers.steps.length} steps enabled`;
    case 'security':
      return `${profile.guardrails.rules.length} guardrail rules, ${profile.pii.policies.length} PII policies`;
  }
}

/** Kind-specific detail block for `profiles show`. */
function printDetails(profile: Profile): void {
  if (profile.kind === 'routing') {
    console.log(chalk.gray('ranking algorithm: ') + (profile.rankingAlgorithm ?? DEFAULT_RANKING_ALGORITHM));
    console.log(chalk.gray('fallback strategy: ') + (profile.fallbackStrategy ?? DEFAULT_FALLBACK_STRATEGY));
    console.log(chalk.bold('\nPolicies:'));
    if (profile.policies.length === 0) console.log(chalk.gray('  (none)'));
    for (const p of profile.policies) {
      console.log(`  - ${p.type} (${p.enabled ? 'enabled' : 'disabled'})`);
    }
    console.log(chalk.bold('\nCall configuration:'));
    printCallConfig(profile.callConfig);
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
    .option('--call-config <json|@file>', 'Call configuration (effort / max output tokens / verbosity by complexity), routing kind only: inline JSON or @path')
    .addOption(rankingOption('Ranking algorithm (routing profiles only)'))
    .addOption(fallbackOption('What to do when a model fails: next-best | retry-after-cooldown | abort (routing profiles only)'))
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles create --kind routing --label "My Routing"
  routerly profiles create --kind routing --label "Strict" --fallback-strategy abort
  routerly profiles create --kind routing --label "My Routing" --ranking-algorithm default
  routerly profiles create --kind routing --label "Capped" --call-config @call-config.json
  routerly profiles create --kind routing --label "Capped" --call-config '{"enabled":true,"tiers":{"low":{"maxOutputTokens":512}}}'
  routerly profiles create --kind security --label "My Guardrails" --json
`)
    .action(async (opts: { kind: string; label: string; rankingAlgorithm?: string; fallbackStrategy?: string; callConfig?: string; json?: boolean }) => {
      try {
        const kind = parseKind(opts.kind);
        if (opts.rankingAlgorithm !== undefined && kind !== 'routing') {
          fail('--ranking-algorithm is only valid with --kind routing.');
        }
        if (opts.fallbackStrategy !== undefined && kind !== 'routing') fail('--fallback-strategy is only valid with --kind routing.');
        if (opts.callConfig !== undefined && kind !== 'routing') fail('Error: --call-config only applies to routing profiles.');
        const callConfig = opts.callConfig !== undefined ? readCallConfigArg(opts.callConfig) : undefined;
        const profile = await api<Profile>('POST', '/api/profiles', {
          kind,
          label: opts.label,
          ...(opts.rankingAlgorithm !== undefined ? { rankingAlgorithm: opts.rankingAlgorithm } : {}),
          ...(opts.fallbackStrategy !== undefined ? { fallbackStrategy: opts.fallbackStrategy } : {}),
          ...(callConfig !== undefined ? { callConfig } : {}),
        });
        warnIfAbort(opts.fallbackStrategy);
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Created ${profile.kind} profile "${profile.label}" -> ${profile.id}`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles update ──────────────────────────────────────────────────────────
  cmd.command('update <id>')
    .description('Update a user profile (built-ins cannot be changed)')
    .option('--label <label>', 'New label')
    .addOption(rankingOption('Ranking algorithm (routing profiles only)'))
    .addOption(fallbackOption('What to do when a model fails: next-best | retry-after-cooldown | abort (routing profiles only)'))
    .option('--call-config <json|@file>', 'Replace the call configuration (routing profiles only): inline JSON or @path')
    .option('--clear-call-config', 'Remove the call configuration')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles update 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --ranking-algorithm default
  routerly profiles update 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --fallback-strategy retry-after-cooldown
  routerly profiles update 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --label "Renamed" --json
  routerly profiles update 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --call-config @call-config.json
  routerly profiles update 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 --clear-call-config
`)
    .action(async (id: string, opts: { label?: string; rankingAlgorithm?: string; fallbackStrategy?: string; callConfig?: string; clearCallConfig?: boolean; json?: boolean }) => {
      try {
        if (opts.callConfig !== undefined && opts.clearCallConfig) fail('Error: --call-config and --clear-call-config are mutually exclusive.');
        if (opts.label === undefined && opts.rankingAlgorithm === undefined && opts.fallbackStrategy === undefined && opts.callConfig === undefined && !opts.clearCallConfig) {
          fail('Error: provide --label, --ranking-algorithm, --fallback-strategy, --call-config and/or --clear-call-config.');
        }
        const callConfig = opts.clearCallConfig ? null : opts.callConfig !== undefined ? readCallConfigArg(opts.callConfig) : undefined;
        const profile = await api<Profile>('PATCH', `/api/profiles/${encodeURIComponent(id)}`, {
          ...(opts.label !== undefined ? { label: opts.label } : {}),
          ...(opts.rankingAlgorithm !== undefined ? { rankingAlgorithm: opts.rankingAlgorithm } : {}),
          ...(opts.fallbackStrategy !== undefined ? { fallbackStrategy: opts.fallbackStrategy } : {}),
          ...(callConfig !== undefined ? { callConfig } : {}),
        });
        warnIfAbort(opts.fallbackStrategy);
        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Updated ${profile.kind} profile "${profile.label}" (version ${profile.version})`));
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
          fail(`Cannot delete "${id}": it is still assigned to a router.`);
        }
        handleError(err);
      }
    });

  // ── profiles set ─────────────────────────────────────────────────────────────
  cmd.command('set <router> <kind> [profileId]')
    .description('Assign or clear the profile of one kind for a router')
    .option('--none', 'Clear the assignment for this kind, back to the router inline config')
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
        const router = await resolveRouter(nameOrId);
        const result = await api<RouterConfig>('PUT', `/api/routers/${encodeURIComponent(router.id)}/profiles`, {
          [kind]: opts.none ? null : profileId,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const what = opts.none ? 'cleared' : `set to "${profileId}"`;
        console.log(chalk.green(`✓ ${kind} profile ${what} on router "${router.name}"`));
      } catch (err) {
        handleError(err);
      }
    });

  // ── profiles get ─────────────────────────────────────────────────────────────
  cmd.command('get <router>')
    .description('Show which profile each kind is bound to for a router')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  routerly profiles get my-api
  routerly profiles get my-api --json
`)
    .action(async (nameOrId: string, opts: { json?: boolean }) => {
      try {
        const router = await resolveRouter(nameOrId);
        const bound: Record<string, string | null> = {};
        for (const kind of KINDS) bound[kind] = router[ROUTER_FIELD[kind]] ?? null;
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
