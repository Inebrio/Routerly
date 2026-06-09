import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError } from '../api.js';

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  channel: string;
  releaseUrl?: string;
  checkedAt: string;
}

interface Settings {
  channel?: string;
  [key: string]: unknown;
}

export function makeUpdateCommand(): Command {
  const cmd = new Command('update')
    .description('Check for updates, view/change the update channel, or trigger an in-app update')
    .addHelpText('after', `
Examples:
  routerly update check            Check if a newer version is available
  routerly update channel          Show the current update channel
  routerly update channel stable   Switch to the stable channel
  routerly update run              Update to the latest version on the current channel
  routerly update run --version v0.2.0  Update to a specific version
`);

  // ── check ───────────────────────────────────────────────────────────────────
  cmd
    .command('check')
    .description('Check if a newer version of Routerly is available')
    .option('--json', 'Print output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const info = await api<UpdateInfo>('GET', '/api/system/update-check');
        if (opts.json) {
          console.log(JSON.stringify(info, null, 2));
          return;
        }
        console.log();
        if (info.available) {
          console.log(chalk.yellow(`  Update available: v${info.currentVersion} → v${info.latestVersion}`));
          if (info.releaseUrl) console.log(chalk.gray(`  Release notes: ${info.releaseUrl}`));
          console.log();
          console.log(chalk.gray(`  Run ${chalk.white('routerly update run')} to install it.`));
        } else {
          console.log(chalk.green(`  Routerly v${info.currentVersion} is up to date.`));
        }
        console.log(chalk.gray(`  Channel: ${info.channel}   Checked: ${new Date(info.checkedAt).toLocaleString()}`));
        console.log();
      } catch (e) {
        if (e instanceof ApiError) {
          console.error(chalk.red(`Error: ${e.message}`));
        } else {
          console.error(chalk.red('Failed to check for updates. Is the service running?'));
        }
        process.exit(1);
      }
    });

  // ── channel ─────────────────────────────────────────────────────────────────
  cmd
    .command('channel [name]')
    .description('Show or change the update channel (latest | stable | develop | vX.Y.Z)')
    .action(async (name: string | undefined) => {
      try {
        if (!name) {
          const settings = await api<Settings>('GET', '/api/settings');
          const current = settings.channel ?? 'latest';
          console.log();
          console.log(`  Current channel: ${chalk.cyan(current)}`);
          console.log(chalk.gray(`  Valid values: latest, stable, develop, or a specific tag (e.g. v0.2.0)`));
          console.log();
          return;
        }
        const updated = await api<Settings>('PUT', '/api/settings', { channel: name });
        console.log();
        console.log(chalk.green(`  Channel updated to ${chalk.bold(updated.channel ?? name)}`));
        console.log(chalk.gray(`  Run ${chalk.white('routerly update check')} to check for a newer version on this channel.`));
        console.log();
      } catch (e) {
        if (e instanceof ApiError) {
          console.error(chalk.red(`Error: ${e.message}`));
        } else {
          console.error(chalk.red('Failed to communicate with the service.'));
        }
        process.exit(1);
      }
    });

  // ── run ─────────────────────────────────────────────────────────────────────
  cmd
    .command('run')
    .description('Trigger an in-app update (admin only, not available in Docker or Windows)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes) {
        const { createInterface } = await import('node:readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve =>
          rl.question(chalk.yellow('  This will update Routerly and restart the service. Continue? [y/N] '), resolve)
        );
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.gray('  Aborted.'));
          return;
        }
      }

      try {
        const result = await api<{ message: string }>('POST', '/api/system/update');
        console.log();
        console.log(chalk.green(`  ${result.message}`));
        console.log(chalk.gray('  The service will restart. Polling for health…'));

        // Poll /health for up to 60 seconds
        const { getCurrentAccount } = await import('../store.js');
        const account = await getCurrentAccount();
        const base = account?.serverUrl.replace(/\/$/, '') ?? 'http://localhost:3000';
        let attempts = 0;
        while (attempts < 20) {
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
          try {
            const r = await fetch(`${base}/health`);
            if (r.ok) {
              console.log(chalk.green('  Service is back online. Update complete!'));
              return;
            }
          } catch { /* still restarting */ }
          process.stdout.write(chalk.gray(`.`));
        }
        console.log();
        console.log(chalk.yellow('  Service did not come back within 60 s. Check it manually.'));
      } catch (e) {
        if (e instanceof ApiError) {
          console.error(chalk.red(`Error: ${e.message}`));
        } else {
          console.error(chalk.red('Update request failed.'));
        }
        process.exit(1);
      }
    });

  return cmd;
}
