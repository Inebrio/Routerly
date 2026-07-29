import { describe, it, expect } from 'vitest';
import { ALL_PERMISSIONS, BUILT_IN_ROLES, getEffectiveRoles } from './roles.js';

describe('roles', () => {
  it('admin role holds every permission', () => {
    const admin = BUILT_IN_ROLES.find(r => r.id === 'admin')!;
    expect(admin.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('getEffectiveRoles merges custom roles', () => {
    const custom = [{ id: 'qa', name: 'QA', permissions: ['report:read' as const] }];
    const all = getEffectiveRoles(custom);
    expect(all.map(r => r.id)).toEqual(['admin', 'viewer', 'operator', 'qa']);
  });

  it('custom role cannot shadow a built-in id', () => {
    const custom = [{ id: 'admin', name: 'Fake', permissions: [] }];
    const all = getEffectiveRoles(custom);
    expect(all.filter(r => r.id === 'admin')).toHaveLength(1);
    expect(all.find(r => r.id === 'admin')!.name).toBe('Admin');
  });

  it('admin includes connections permissions', () => {
    expect(ALL_PERMISSIONS).toContain('connections:read');
    expect(ALL_PERMISSIONS).toContain('connections:manage');
  });

  it('admin includes resilience permissions', () => {
    expect(ALL_PERMISSIONS).toContain('resilience:read');
    expect(ALL_PERMISSIONS).toContain('resilience:manage');
  });
});
