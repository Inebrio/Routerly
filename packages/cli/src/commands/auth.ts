import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  listAccounts,
  saveAccount,
  removeAccount,
  renameAccount,
  switchAccount,
  getCurrentAccount,
  getAccount,
  getDefaultServiceUrl,
} from '../store.js';
import { apiWith, api, ApiError } from '../api.js';

interface LoginResponse {
  token: string;
  /** Permanent refresh token returned at login (absent when calling /api/auth/refresh) */
  refreshToken?: string;
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
    .addHelpText('after', `
Examples:
  # Interactive login (prompts for email and password)
  routerly auth login

  # Non-interactive login
  routerly auth login --email admin@example.com --password secret

  # Login to a specific server with a custom alias
  routerly auth login --url http://prod.example.com --email admin@example.com --alias prod

  # Login to a staging server
  routerly auth login --url http://staging.example.com --email dev@example.com --alias staging
`)
    .option('--url <url>', 'Server base URL (defaults to URL set during installation)')
    .option('--email <email>', 'Account email')
    .option('--password <password>', 'Account password')
    .option('--alias <alias>', 'Friendly name for this account (default: email address)')
    .action(async (opts: { url?: string; email?: string; password?: string; alias?: string }) => {
      let { email, password } = opts;
      const defaultUrl = opts.url ?? (await getDefaultServiceUrl()) ?? 'http://localhost:3000';
      const serverUrl = defaultUrl.replace(/\/$/, '');

      // Prompt for missing credentials
      if (!email || !password) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          ...(!email ? [{ type: 'input', name: 'email', message: 'Email:' }] : []),
          ...(!password ? [{ type: 'password', name: 'password', message: 'Password:', mask: '*' }] : []),
        ]);
        if (!email) email = answers.email as string;
        if (!password) password = answers.password as string;
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

        const { default: inquirer } = await import('inquirer');
        const accounts = await listAccounts();
        const existing = new Set(accounts.map(a => a.alias));

        // Helper: next free alias from a base string
        const nextFreeAlias = (base: string) => {
          let candidate = base;
          let counter = 2;
          while (existing.has(candidate)) candidate = `${base}-${counter++}`;
          return candidate;
        };

        const emailBase = email!.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
        const sameEmail = accounts.find(a => a.email === email);

        let alias: string;

        // Step 1: check if this email is already in use (regardless of --alias)
        if (sameEmail) {
          const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: `Email "${email}" is already saved as account "${sameEmail.alias}". What do you want to do?`,
            choices: [
              { name: `Overwrite "${sameEmail.alias}" (refresh token)`, value: 'overwrite' },
              { name: `Add as a new separate account`, value: 'add' },
            ],
          }]);

          if (action === 'overwrite') {
            // Keep the existing alias, ignore any --alias flag
            alias = sameEmail.alias;
          } else {
            // Add new: resolve alias from --alias or email-base, avoiding conflicts
            const base = opts.alias ?? emailBase;
            alias = existing.has(base) ? nextFreeAlias(base) : base;
          }
        } else if (accounts.length === 0) {
          // First account ever: always use "default"
          alias = 'default';
        } else if (opts.alias) {
          // New email, --alias provided: check alias conflict
          if (existing.has(opts.alias)) {
            const { action } = await inquirer.prompt([{
              type: 'list',
              name: 'action',
              message: `Alias "${opts.alias}" is already in use. What do you want to do?`,
              choices: [
                { name: `Overwrite "${opts.alias}"`, value: 'overwrite' },
                { name: `Add as new account (alias: "${nextFreeAlias(opts.alias)}")`, value: 'add' },
              ],
            }]);
            alias = action === 'overwrite' ? opts.alias : nextFreeAlias(opts.alias);
          } else {
            alias = opts.alias;
          }
        } else {
          // New email, no --alias: generate from email
          alias = nextFreeAlias(emailBase);
        }

        await saveAccount({ alias, serverUrl, email: email!, token: res.token, expiresAt, role: res.user.role, ...(res.refreshToken !== undefined ? { refreshToken: res.refreshToken } : {}) });

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

  // ── auth refresh ────────────────────────────────────────────────────────────
  cmd.command('refresh [alias]')
    .description('Refresh the session token for an account (token must not be expired)')
    .addHelpText('after', `
Examples:
  # Refresh the current account's token
  routerly auth refresh

  # Refresh a specific account by alias
  routerly auth refresh staging
`)
    .action(async (alias?: string) => {
      const account = alias ? await getAccount(alias) : await getCurrentAccount();
      if (!account) {
        console.error(chalk.red(alias
          ? `Account "${alias}" not found. Run \`routerly auth ps\` to list accounts.`
          : 'Not logged in. Run: routerly auth login'));
        process.exit(1);
      }
      if (!account.refreshToken) {
        console.error(chalk.red(`No refresh token for "${account.alias}". Run: routerly auth login`));
        process.exit(1);
      }
      try {
        const url = `${account.serverUrl.replace(/\/$/, '')}/api/auth/refresh`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: account.refreshToken }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new ApiError(res.status, body.error ?? res.statusText);
        }
        const data = await res.json() as LoginResponse;
        let expiresAt = Date.now() + 3600_000;
        try {
          const p = JSON.parse(Buffer.from(data.token.split('.')[0]!, 'base64url').toString()) as { exp?: number };
          if (p.exp) expiresAt = p.exp;
        } catch { /* keep default */ }
        await saveAccount({ ...account, token: data.token, expiresAt });
        console.log(chalk.green(`✓ Token refreshed for "${account.alias}".`));
        console.log(chalk.gray(`  Expires: ${new Date(expiresAt).toLocaleString('it-IT')}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          console.error(chalk.red('Refresh token revoked. Run: routerly auth login'));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── auth logout ─────────────────────────────────────────────────────────────
  cmd.command('logout [alias]')
    .description('Remove a saved account (defaults to current)')
    .addHelpText('after', `
Examples:
  # Log out the currently active account
  routerly auth logout

  # Log out a specific account by alias
  routerly auth logout staging
`)
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
    .addHelpText('after', `
Examples:
  # Show all saved accounts (* marks the active one)
  routerly auth ps
`)
    .action(async () => {
      const accounts = await listAccounts();
      const current = await getCurrentAccount();

      if (accounts.length === 0) {
        console.log(chalk.yellow('No accounts saved. Run: routerly auth login'));
        return;
      }

      const table = new Table({
        head: ['', 'Alias', 'Email', 'Role', 'Server', 'Expires'].map(h => chalk.cyan(h)),
      });

      for (const acc of accounts) {
        const isCurrent = acc.alias === current?.alias;
        const expired = acc.expiresAt < Date.now();
        const expStr = expired
          ? chalk.red('expired')
          : new Date(acc.expiresAt).toLocaleString('it-IT');

        table.push([
          isCurrent ? chalk.green('*') : '',
          isCurrent ? chalk.bold(acc.alias) : acc.alias,
          acc.email,
          acc.role ?? chalk.gray('—'),
          acc.serverUrl,
          expStr,
        ]);
      }

      console.log(table.toString());
    });

  // ── auth switch ─────────────────────────────────────────────────────────────
  cmd.command('switch <alias>')
    .description('Switch to a different saved account')
    .addHelpText('after', `
Examples:
  # Switch to the "prod" account
  routerly auth switch prod

  # Switch back to the default account
  routerly auth switch default
`)
    .action(async (alias: string) => {
      const ok = await switchAccount(alias);
      if (!ok) {
        console.error(chalk.red(`Account "${alias}" not found. Run \`routerly auth ps\` to list accounts.`));
        process.exit(1);
      }
      const acc = await getAccount(alias);
      console.log(chalk.green(`✓ Switched to "${alias}" (${acc?.email} @ ${acc?.serverUrl})`));
    });

  // ── auth rename ─────────────────────────────────────────────────────────────
  cmd.command('rename <old-alias> <new-alias>')
    .description('Rename a saved account alias')
    .addHelpText('after', `
Examples:
  # Rename the default account to "work"
  routerly auth rename default work

  # Rename the staging account to "prod"
  routerly auth rename staging prod
`)
    .action(async (oldAlias: string, newAlias: string) => {
      const result = await renameAccount(oldAlias, newAlias);
      if (result === 'not_found') {
        console.error(chalk.red(`Account "${oldAlias}" not found. Run \`routerly auth ps\` to list accounts.`));
        process.exit(1);
      }
      if (result === 'conflict') {
        console.error(chalk.red(`Alias "${newAlias}" is already in use. Choose a different name.`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Account renamed: "${oldAlias}" → "${newAlias}"`))
    });

  // ── auth whoami ─────────────────────────────────────────────────────────────
  cmd.command('whoami')
    .description('Show the currently logged-in user from the server')
    .addHelpText('after', `
Examples:
  # Show the current user's email, role, and session info
  routerly auth whoami
`)
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
        console.log(chalk.gray(`  Expires: ${new Date(current.expiresAt).toLocaleString('it-IT')}`));
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
