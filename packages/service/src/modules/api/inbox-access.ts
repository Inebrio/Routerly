/**
 * Who may see an inbox notification (T52).
 *
 * Three gates, all of which must pass:
 *  1. audience  — `recipients` set by the emitter (undefined = everyone), U5
 *  2. project   — an event about a project the user cannot reach is not theirs
 *  3. permission — an event about a subject the user cannot read is not theirs
 *
 * Project scoping follows the same rule MCP already uses (`accessibleProjects`):
 * a user with no explicit `projectIds` and no membership anywhere reaches every
 * project, so nothing changes for a single-admin install.
 */
import type { NotificationInboxItem, Permission } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { accessibleProjects } from '../mcp/tokens.js';

export interface InboxScope {
  /** Every project id in the config, used to tell "not mine" from "gone". */
  known: Set<string>;
  /** Project ids this user can reach. */
  mine: Set<string>;
}

/** Reads the user and resolves the projects they can reach. */
export async function loadInboxScope(userId: string): Promise<InboxScope> {
  const [users, projects] = await Promise.all([readConfig('users'), readConfig('projects')]);
  const known = new Set(projects.map(p => p.id));
  const user = users.find(u => u.id === userId);
  // Unknown user: no project of theirs to scope by, permissions still apply.
  if (!user) return { known, mine: new Set() };
  return { known, mine: new Set((await accessibleProjects(user)).map(p => p.id)) };
}

/**
 * Permission an event's subject is read through. Operational events
 * (provider, routing, budget) have none: they are scoped by project instead.
 */
export function requiredPermission(event: string): Permission | undefined {
  if (event.startsWith('auth.')) return 'audit:read';
  if (event.startsWith('config.model')) return 'model:read';
  if (event.startsWith('config.project')) return 'project:read';
  if (event.startsWith('system.')) return 'settings:read';
  return undefined;
}

export function isVisibleToUser(
  item: NotificationInboxItem,
  userId: string,
  permissions: Permission[],
  scope: InboxScope,
): boolean {
  if (item.recipients !== undefined && !item.recipients.includes(userId)) return false;
  const perm = requiredPermission(item.event);
  if (perm && !permissions.includes(perm)) return false;
  const projectId = item.details['projectId'];
  // A project that no longer exists stays visible: the deletion event itself is
  // often the reason the id is dangling.
  if (typeof projectId === 'string' && scope.known.has(projectId) && !scope.mine.has(projectId)) {
    return false;
  }
  return true;
}
