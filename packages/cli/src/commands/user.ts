import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import type { UserConfig } from '@routerly/shared';

export function makeUserCommand(): Command {
  const cmd = new Command('user').description('Manage dashboard users');

  // ── user list ──
  cmd.command('list')
    .description('List all users')
    .addHelpText('after', `
Examples:
  # Show all dashboard users with their roles and project access
  routerly user list
`)
    .action(async () => {
      try {
        const users = await api<UserConfig[]>('GET', '/api/users');
        if (users.length === 0) {
          console.log(chalk.yellow('No users yet. Use `routerly user add` to create one.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Email', 'Role', 'Projects'].map(h => chalk.cyan(h)),
        });
        for (const u of users) {
          table.push([u.id, u.email, u.roleId, u.projectIds.join(', ') || 'all']);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── user add ──
  cmd.command('add')
    .description('Create a new dashboard user')
    .addHelpText('after', `
Examples:
  # Create a viewer (default role)
  routerly user add --email alice@example.com --password secret

  # Create an admin user
  routerly user add --email admin@example.com --password secret --role admin

  # Create a user restricted to specific projects
  routerly user add \\
    --email dev@example.com --password secret \\
    --role developer --projects proj-1,proj-2
`)
    .requiredOption('--email <email>', 'User email')
    .option('--password <password>', 'Initial password')
    .option('--password-stdin', 'Read password from ROUTERLY_USER_PASSWORD env var')
    .option('--role <roleId>', 'Role ID to assign', 'viewer')
    .option('--projects <ids>', 'Comma-separated project IDs this user can access (empty = all)')
    .action(async (opts: { email: string; password?: string; passwordStdin?: boolean; role: string; projects?: string }) => {
      let password = opts.password;
      if (opts.passwordStdin) {
        password = process.env.ROUTERLY_USER_PASSWORD;
      }
      if (!password) {
        console.error(chalk.red('Error: --password or --password-stdin is required.'));
        process.exit(1);
      }
      const body = {
        email: opts.email,
        password,
        roleId: opts.role,
        projectIds: (opts.projects ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
      };

      try {
        await api<UserConfig>('POST', '/api/users', body);
        console.log(chalk.green(`✓ User "${opts.email}" created with role "${opts.role}".`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          console.error(chalk.red(`User "${opts.email}" already exists.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  // ── user remove ──
  cmd.command('remove <email>')
    .description('Remove a user by email')
    .addHelpText('after', `
Examples:
  # Remove a user by their email address
  routerly user remove alice@example.com
`)
    .action(async (email: string) => {
      try {
        // Resolve email → id first
        const users = await api<UserConfig[]>('GET', '/api/users');
        const user = users.find(u => u.email === email);
        if (!user) {
          console.error(chalk.red(`User "${email}" not found.`));
          process.exit(1);
          return;
        }
        await api<void>('DELETE', `/api/users/${encodeURIComponent(user.id)}`);
        console.log(chalk.green(`✓ User "${email}" removed.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
