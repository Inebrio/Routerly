import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError } from '../api.js';
import { getCurrentAccount } from '../store.js';
import type { Settings } from '@routerly/shared';

interface SystemInfo {
  version: string;
  uptimeSeconds: number;
  nodeVersion: string;
}

export function makeStatusCommand(): Command {
  return new Command('status')
    .description('Show current session, service URL, dashboard address and health')
    .option('--json', 'Print output as JSON (useful for scripting)')
    .addHelpText('after', `
Examples:
  # Quick overview of the active account and service
  routerly status

  # Machine-readable output
  routerly status --json
`)
    .action(async (opts: { json?: boolean }) => {
      const account = await getCurrentAccount();

      // ── JSON output path ────────────────────────────────────────────────
      if (opts.json) {
        if (!account) {
          console.log(JSON.stringify({ loggedIn: false }, null, 2));
          return;
        }

        const expired = account.expiresAt < Date.now();
        const base = {
          loggedIn: true,
          account: {
            alias: account.alias,
            email: account.email,
            role: account.role ?? null,
            serverUrl: account.serverUrl,
            tokenValid: !expired,
            tokenExpiresAt: new Date(account.expiresAt).toISOString(),
          },
          service: null as unknown,
        };

        if (!expired) {
          try {
            const [info, settings, models, projects] = await Promise.all([
              api<SystemInfo>('GET', '/api/system/info').catch(() => null),
              api<Settings>('GET', '/api/settings').catch(() => null),
              api<unknown[]>('GET', '/api/models').catch(() => null),
              api<unknown[]>('GET', '/api/projects').catch(() => null),
            ]);

            base.service = {
              reachable: info !== null,
              version: info?.version ?? null,
              uptimeSeconds: info?.uptimeSeconds ?? null,
              host: settings?.host ?? null,
              port: settings?.port ?? null,
              listeningAddr: settings ? `${settings.host ?? '0.0.0.0'}:${settings.port ?? 3000}` : null,
              dashboardEnabled: settings?.dashboardEnabled ?? null,
              dashboardUrl: settings?.dashboardEnabled ? `${account.serverUrl}/dashboard/` : null,
              logLevel: settings?.logLevel ?? null,
              modelCount: models?.length ?? null,
              projectCount: projects?.length ?? null,
            };
          } catch {
            base.service = { reachable: false };
          }
        }

        console.log(JSON.stringify(base, null, 2));
        return;
      }

      // ── Human-readable output path ──────────────────────────────────────
      console.log(chalk.bold('\nRouterly Status\n'));

      if (!account) {
        console.log(`  ${chalk.cyan('Session:')}       ${chalk.yellow('not logged in')}  (run: routerly auth login)`);
        console.log();
        return;
      }

      const expired = account.expiresAt < Date.now();
      const expiryStr = expired
        ? chalk.red('expired')
        : new Date(account.expiresAt).toLocaleString();

      console.log(`  ${chalk.cyan('Account:')}       ${chalk.bold(account.alias)}  (${account.email}${account.role ? `, role: ${account.role}` : ''})`);
      console.log(`  ${chalk.cyan('Server URL:')}    ${account.serverUrl}`);
      console.log(`  ${chalk.cyan('Token:')}         ${expired ? chalk.red('expired') : chalk.green('valid')}  — expires ${expiryStr}`);

      if (expired) {
        console.log(chalk.yellow('\n  Session expired. Run: routerly auth login'));
        console.log();
        return;
      }

      // ── Server health + settings ────────────────────────────────────────
      try {
        const [info, settings, models, projects] = await Promise.all([
          api<SystemInfo>('GET', '/api/system/info').catch(() => null),
          api<Settings>('GET', '/api/settings').catch(() => null),
          api<unknown[]>('GET', '/api/models').catch(() => null),
          api<unknown[]>('GET', '/api/projects').catch(() => null),
        ]);

        // Connectivity
        console.log(`  ${chalk.cyan('Reachable:')}     ${info ? chalk.green('yes') : chalk.red('no — server did not respond')}`);

        if (info) {
          const uptimeSec = Math.floor(info.uptimeSeconds);
          const h = Math.floor(uptimeSec / 3600);
          const m = Math.floor((uptimeSec % 3600) / 60);
          const s = uptimeSec % 60;
          const uptimeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
          console.log(`  ${chalk.cyan('Version:')}       ${info.version}`);
          console.log(`  ${chalk.cyan('Uptime:')}        ${uptimeStr}`);
        }

        if (settings) {
          const listenAddr = `${settings.host ?? '0.0.0.0'}:${settings.port ?? 3000}`;
          console.log(`  ${chalk.cyan('Listening:')}     ${listenAddr}`);

          if (settings.dashboardEnabled) {
            const dashboardUrl = `${account.serverUrl}/dashboard/`;
            console.log(`  ${chalk.cyan('Dashboard:')}     ${chalk.green(dashboardUrl)}`);
          } else {
            console.log(`  ${chalk.cyan('Dashboard:')}     ${chalk.gray('disabled')}`);
          }

          console.log(`  ${chalk.cyan('Log level:')}     ${settings.logLevel}`);
        }

        if (models !== null)   console.log(`  ${chalk.cyan('Models:')}        ${models.length}`);
        if (projects !== null) console.log(`  ${chalk.cyan('Projects:')}      ${projects.length}`);

      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          console.log(`  ${chalk.cyan('Reachable:')}     ${chalk.red('unauthorized — session may have been revoked')}`);
        } else {
          console.log(`  ${chalk.cyan('Reachable:')}     ${chalk.red(`error — ${(err as Error).message}`)}`);
        }
      }

      console.log();
    });
}
