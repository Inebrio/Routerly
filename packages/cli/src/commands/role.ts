import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';
import type { RoleConfig, Permission } from '@routerly/shared';

interface RoleWithBuiltin extends RoleConfig {
  builtin?: boolean;
}

export function makeRoleCommand(): Command {
  const cmd = new Command('role').description('Manage dashboard roles');

  // ── role list ──
  cmd.command('list')
    .description('List all roles')
    .action(async () => {
      try {
        const roles = await api<RoleWithBuiltin[]>('GET', '/api/roles');
        if (roles.length === 0) {
          console.log(chalk.yellow('No roles found.'));
          return;
        }
        const table = new Table({
          head: ['ID', 'Name', 'Permissions', 'Type'].map(h => chalk.cyan(h)),
        });
        for (const r of roles) {
          table.push([
            r.id,
            r.name,
            r.permissions.join(', ') || chalk.gray('(none)'),
            r.builtin ? chalk.gray('built-in') : chalk.green('custom'),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── role add ──
  cmd.command('add')
    .description('Create a custom role')
    .requiredOption('--id <id>', 'Role identifier (e.g. operator)')
    .requiredOption('--name <name>', 'Human-readable role name')
    .option('--permissions <perms>', 'Comma-separated list of permissions', '')
    .action(async (opts: { id: string; name: string; permissions: string }) => {
      const permissions = opts.permissions
        ? (opts.permissions.split(',').map(p => p.trim()).filter(Boolean) as Permission[])
        : [];

      try {
        const role = await api<RoleWithBuiltin>('POST', '/api/roles', { id: opts.id, name: opts.name, permissions });
        console.log(chalk.green(`✓ Role "${role.name}" (${role.id}) created.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── role edit ──
  cmd.command('edit <id>')
    .description('Edit a custom role')
    .option('--name <name>', 'New role name')
    .option('--permissions <perms>', 'New comma-separated permissions (replaces existing)')
    .action(async (id: string, opts: { name?: string; permissions?: string }) => {
      const body: { name?: string; permissions?: Permission[] } = {};
      if (opts.name) body.name = opts.name;
      if (opts.permissions !== undefined) {
        body.permissions = opts.permissions.split(',').map(p => p.trim()).filter(Boolean) as Permission[];
      }
      if (Object.keys(body).length === 0) {
        console.error(chalk.red('Error: provide at least --name or --permissions'));
        process.exit(1);
      }

      try {
        const role = await api<RoleWithBuiltin>('PUT', `/api/roles/${id}`, body);
        console.log(chalk.green(`✓ Role "${role.name}" (${role.id}) updated.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── role remove ──
  cmd.command('remove <id>')
    .description('Delete a custom role')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/roles/${id}`);
        console.log(chalk.green(`✓ Role "${id}" deleted.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  return cmd;
}
