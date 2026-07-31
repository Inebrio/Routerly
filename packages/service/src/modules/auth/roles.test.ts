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

  it('admin includes optimizers permissions', () => {
    expect(ALL_PERMISSIONS).toContain('optimizers:read');
    expect(ALL_PERMISSIONS).toContain('optimizers:manage');
  });

  it('viewer can read optimizers but not manage them', () => {
    const viewer = BUILT_IN_ROLES.find(r => r.id === 'viewer')!;
    expect(viewer.permissions).toContain('optimizers:read');
    expect(viewer.permissions).not.toContain('optimizers:manage');
  });

  it('operator can read and manage optimizers', () => {
    const operator = BUILT_IN_ROLES.find(r => r.id === 'operator')!;
    expect(operator.permissions).toContain('optimizers:read');
    expect(operator.permissions).toContain('optimizers:manage');
  });

  it('admin includes mcp permissions', () => {
    expect(ALL_PERMISSIONS).toContain('mcp:read');
    expect(ALL_PERMISSIONS).toContain('mcp:manage');
  });

  it('viewer can read the mcp tool registry', () => {
    const viewer = BUILT_IN_ROLES.find(r => r.id === 'viewer')!;
    expect(viewer.permissions).toContain('mcp:read');
    // mcp:manage is reserved for a future enable/disable feature; no non-admin
    // role gets it yet (no route enforces it).
    expect(viewer.permissions).not.toContain('mcp:manage');
  });

  it('operator can read the mcp tool registry', () => {
    const operator = BUILT_IN_ROLES.find(r => r.id === 'operator')!;
    expect(operator.permissions).toContain('mcp:read');
    expect(operator.permissions).not.toContain('mcp:manage');
  });
});
