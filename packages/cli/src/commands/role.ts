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
    .addHelpText('after', `
Examples:
  # Show all built-in and custom roles
  routerly role list
`)
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
    .addHelpText('after', `
Examples:
  # Create a read-only role
  routerly role add --id read-only --name "Read Only" --permissions usage:read

  # Create a developer role with multiple permissions
  routerly role add \\
    --id developer --name "Developer" \\
    --permissions "usage:read,models:read,projects:read"

  # Create an operator role with full model and project access
  routerly role add \\
    --id operator --name "Operator" \\
    --permissions "usage:read,models:read,models:write,projects:read,projects:write"
`)
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
    .addHelpText('after', `
Examples:
  # Rename a role
  routerly role edit developer --name "Senior Developer"

  # Replace all permissions
  routerly role edit developer --permissions "usage:read,models:read"

  # Rename and update permissions at the same time
  routerly role edit developer \\
    --name "Engineer" --permissions "usage:read,models:read,projects:write"
`)
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
    .addHelpText('after', `
Examples:
  # Delete the "developer" role
  routerly role remove developer
`)
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
