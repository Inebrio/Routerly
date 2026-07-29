import type { RoleConfig, Permission } from '@routerly/shared';

/**
 * Permissions union, kept in sync with the `Permission` type in
 * packages/shared/src/types/config.ts. Source of truth for the Admin role.
 */
export const ALL_PERMISSIONS: Permission[] = [
  'project:read', 'project:write',
  'model:read', 'model:write',
  'user:read', 'user:write',
  'report:read',
  'settings:read', 'settings:write',
  'notification:write',
  'token:read', 'token:write',
  'role:write',
  'audit:read',
  'modules:read', 'modules:manage',
  'connections:read', 'connections:manage',
  'resilience:read', 'resilience:manage',
];

export const BUILT_IN_ROLES: RoleConfig[] = [
  { id: 'admin',    name: 'Admin',    permissions: ALL_PERMISSIONS },
  { id: 'viewer',   name: 'Viewer',   permissions: ['project:read', 'model:read', 'report:read', 'settings:read', 'token:read', 'audit:read', 'modules:read', 'connections:read'] },
  { id: 'operator', name: 'Operator', permissions: ['project:read', 'project:write', 'model:read', 'model:write', 'report:read', 'user:read', 'settings:read', 'token:read', 'token:write', 'notification:write', 'modules:read', 'connections:read', 'connections:manage'] },
];

/** Merge built-in roles with custom roles (custom cannot shadow built-in IDs). */
export function getEffectiveRoles(customRoles: RoleConfig[]): RoleConfig[] {
  const builtInIds = new Set(BUILT_IN_ROLES.map(r => r.id));
  return [...BUILT_IN_ROLES, ...customRoles.filter(r => !builtInIds.has(r.id))];
}
