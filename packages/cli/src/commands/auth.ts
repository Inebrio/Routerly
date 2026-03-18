import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  listAccounts,
  saveAccount,
  removeAccount,
  switchAccount,
  getCurrentAccount,
  getAccount,
} from '../store.js';
import { apiWith, api, ApiError } from '../api.js';

interface LoginResponse {
  token: string;
  user: { id: string; email: string; role: string };
}

interface MeResponse {
  id: string;
  email: string;
  roleId: string;
}

export function makeAuthCommand(): Command {
  const cmd = new Command('auth').description('Manage Routerly server accounts');

  // ── auth login ──────────────────────────────────────────────────────────────
  cmd.command('login')
    .description('Log in to a Routerly server and save the session')
    .option('--url <url>', 'Server base URL', 'http://localhost:3000')
    .option('--email <email>', 'Account email')
    .option('--password <password>', 'Account password')
    .option('--alias <alias>', 'Friendly name for this account (default: "default")')
    .action(async (opts: { url: string; email?: string; password?: string; alias?: string }) => {
      let { email, password } = opts;
      const serverUrl = opts.url.replace(/\/$/, '');

      // Prompt for missing credentials
      if (!email || !password) {
        const { createInterface } = await import('node:readline/promises');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        if (!email) {
          email = await rl.question('Email: ');
        }
        if (!password) {
          // Hide password input on POSIX
          process.stdout.write('Password: ');
          process.stdin.setRawMode?.(true);
          password = await new Promise<string>((resolve) => {
            let buf = '';
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            process.stdin.once('data', function onData(char: string) {
              if (char === '\r' || char === '\n') {
                process.stdin.setRawMode?.(false);
                process.stdout.write('\n');
                resolve(buf);
              } else if (char === '\u0003') {
                process.stdout.write('\n');
                process.exit(1);
              } else {
                buf += char;
                process.stdin.once('data', onData);
              }
            });
          });
        }
        rl.close();
      }

      try {
        const fakeAccount = { alias: '', serverUrl, email: email!, token: '', expiresAt: 0 };
        const res = await apiWith<LoginResponse>(fakeAccount, 'POST', '/api/auth/login', { email, password });

        // Decode expiry from token payload (base64url(json).sig)
        let expiresAt = Date.now() + 24 * 3600_000;
        try {
          const payload = JSON.parse(Buffer.from(res.token.split('.')[0]!, 'base64url').toString()) as { exp?: number };
          if (payload.exp) expiresAt = payload.exp;
        } catch { /* keep default */ }

        const alias = opts.alias ?? 'default';
        await saveAccount({ alias, serverUrl, email: email!, token: res.token, expiresAt });

        console.log(chalk.green(`✓ Logged in as ${chalk.bold(res.user.email)} (role: ${res.user.role})`));
        console.log(chalk.gray(`  Account saved as "${alias}" → ${serverUrl}`));
      } catch (err) {
        if (err instanceof ApiError) {
          console.error(chalk.red(`Login failed: ${err.message}`));
        } else {
          console.error(chalk.red(`Cannot reach server at ${serverUrl}: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── auth logout ─────────────────────────────────────────────────────────────
  cmd.command('logout [alias]')
    .description('Remove a saved account (defaults to current)')
    .action(async (alias?: string) => {
      const target = alias ?? (await getCurrentAccount())?.alias;
      if (!target) {
        console.error(chalk.red('No account to log out from.'));
        process.exit(1);
      }
      const removed = await removeAccount(target);
      if (!removed) {
        console.error(chalk.red(`Account "${target}" not found.`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Logged out from "${target}".`));
    });

  // ── auth ps ─────────────────────────────────────────────────────────────────
  cmd.command('ps')
    .description('List all saved accounts')
    .action(async () => {
      const accounts = await listAccounts();
      const current = await getCurrentAccount();

      if (accounts.length === 0) {
        console.log(chalk.yellow('No accounts saved. Run: routerly auth login'));
        return;
      }

      const table = new Table({
        head: ['', 'Alias', 'Email', 'Server', 'Expires'].map(h => chalk.cyan(h)),
      });

      for (const acc of accounts) {
        const isCurrent = acc.alias === current?.alias;
        const expired = acc.expiresAt < Date.now();
        const expStr = expired
          ? chalk.red('expired')
          : new Date(acc.expiresAt).toLocaleString();

        table.push([
          isCurrent ? chalk.green('*') : '',
          isCurrent ? chalk.bold(acc.alias) : acc.alias,
          acc.email,
          acc.serverUrl,
          expStr,
        ]);
      }

      console.log(table.toString());
    });

  // ── auth switch ─────────────────────────────────────────────────────────────
  cmd.command('switch <alias>')
    .description('Switch to a different saved account')
    .action(async (alias: string) => {
      const ok = await switchAccount(alias);
      if (!ok) {
        console.error(chalk.red(`Account "${alias}" not found. Run \`routerly auth ps\` to list accounts.`));
        process.exit(1);
      }
      const acc = await getAccount(alias);
      console.log(chalk.green(`✓ Switched to "${alias}" (${acc?.email} @ ${acc?.serverUrl})`));
    });

  // ── auth whoami ─────────────────────────────────────────────────────────────
  cmd.command('whoami')
    .description('Show the currently logged-in user from the server')
    .action(async () => {
      const current = await getCurrentAccount();
      if (!current) {
        console.log(chalk.yellow('Not logged in. Run: routerly auth login'));
        return;
      }

      try {
        const me = await api<MeResponse>('GET', '/api/me');
        console.log(chalk.bold(`${me.email}`) + chalk.gray(` (role: ${me.roleId})`));
        console.log(chalk.gray(`  Server:  ${current.serverUrl}`));
        console.log(chalk.gray(`  Account: ${current.alias}`));
        console.log(chalk.gray(`  Expires: ${new Date(current.expiresAt).toLocaleString()}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          console.error(chalk.red('Session expired. Run: routerly auth login'));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
