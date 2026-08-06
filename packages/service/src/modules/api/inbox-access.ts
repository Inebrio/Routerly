/**
 * Who may see an inbox notification (T52).
 *
 * Three gates, all of which must pass:
 *  1. audience  — `recipients` set by the emitter (undefined = everyone), U5
 *  2. router   — an event about a router the user cannot reach is not theirs
 *  3. permission — an event about a subject the user cannot read is not theirs
 *
 * Router scoping follows the same rule MCP already uses (`accessibleRouters`):
 * a user with no explicit `routerIds` and no membership anywhere reaches every
 * router, so nothing changes for a single-admin install.
 */
import type { NotificationInboxItem, Permission } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { accessibleRouters } from '../mcp/tokens.js';

export interface InboxScope {
  /** Every router id in the config, used to tell "not mine" from "gone". */
  known: Set<string>;
  /** Router ids this user can reach. */
  mine: Set<string>;
}

/** Reads the user and resolves the routers they can reach. */
export async function loadInboxScope(userId: string): Promise<InboxScope> {
  const [users, routers] = await Promise.all([readConfig('users'), readConfig('routers')]);
  const known = new Set(routers.map(p => p.id));
  const user = users.find(u => u.id === userId);
  // Unknown user: no router of theirs to scope by, permissions still apply.
  if (!user) return { known, mine: new Set() };
  return { known, mine: new Set((await accessibleRouters(user)).map(p => p.id)) };
}

/**
 * Permission an event's subject is read through. Operational events
 * (provider, routing, budget) have none: they are scoped by router instead.
 */
export function requiredPermission(event: string): Permission | undefined {
  if (event.startsWith('auth.')) return 'audit:read';
  if (event.startsWith('config.model')) return 'model:read';
  if (event.startsWith('config.router')) return 'router:read';
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
  const routerId = item.details['routerId'];
  // A router that no longer exists stays visible: the deletion event itself is
  // often the reason the id is dangling.
  if (typeof routerId === 'string' && scope.known.has(routerId) && !scope.mine.has(routerId)) {
    return false;
  }
  return true;
}
