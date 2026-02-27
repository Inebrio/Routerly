import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { readStore, writeStore } from '../store.js';
import type { UserConfig } from '@localrouter/shared';

function hashPassword(password: string): string {
  // Simple SHA-256 hash for now (bcrypt would need a native dep)
  // In production, replace with bcrypt or argon2
  return createHash('sha256').update(password).digest('hex');
}

export function makeUserCommand(): Command {
  const cmd = new Command('user').description('Manage dashboard users');

  // ── user list ──
  cmd.command('list')
    .description('List all users')
    .action(async () => {
      const users = await readStore('users');
      if (users.length === 0) {
        console.log(chalk.yellow('No users yet. Use `localrouter user add` to create one.'));
        return;
      }
      const table = new Table({
        head: ['ID', 'Email', 'Role', 'Projects'].map(h => chalk.cyan(h)),
      });
      for (const u of users) {
        table.push([u.id, u.email, u.roleId, u.projectIds.join(', ') || 'all']);
      }
      console.log(table.toString());
    });

  // ── user add ──
  cmd.command('add')
    .description('Create a new dashboard user')
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--password <password>', 'Initial password (will be hashed)')
    .option('--role <roleId>', 'Role ID to assign', 'viewer')
    .option('--projects <ids>', 'Comma-separated project IDs this user can access (empty = all)')
    .action(async (opts: { email: string; password: string; role: string; projects?: string }) => {
      const users = await readStore('users');

      if (users.find(u => u.email === opts.email)) {
        console.error(chalk.red(`User "${opts.email}" already exists.`));
        process.exit(1);
      }

      const user: UserConfig = {
        id: uuidv4(),
        email: opts.email,
        passwordHash: hashPassword(opts.password),
        roleId: opts.role,
        projectIds: (opts.projects ?? '').split(',').map(s => s.trim()).filter(Boolean),
      };

      users.push(user);
      await writeStore('users', users);
      console.log(chalk.green(`✓ User "${opts.email}" created with role "${opts.role}".`));
    });

  // ── user remove ──
  cmd.command('remove <email>')
    .description('Remove a user by email')
    .action(async (email: string) => {
      const users = await readStore('users');
      const filtered = users.filter(u => u.email !== email);
      if (filtered.length === users.length) {
        console.error(chalk.red(`User "${email}" not found.`));
        process.exit(1);
      }
      await writeStore('users', filtered);
      console.log(chalk.green(`✓ User "${email}" removed.`));
    });

  return cmd;
}
