import { describe, it } from 'vitest';
import { SelectorType, FallbackStrategyType, OptimizerProfile, Profile, ProfileOfKind, RoutingProfile, SecurityProfile, Permission } from './config.js';

describe('type-checks', () => {
  it('type-checks', () => {
    // Type-level test: RoutingProfile construction
    const profile: RoutingProfile = {
      id: 'test-profile',
      kind: 'routing',
      version: 1,
      label: 'Test Profile',
      policies: [
        {
          type: 'context',
          enabled: true,
        },
      ],
      selector: 'argmax' as SelectorType,
      fallbackStrategy: 'next-best' as FallbackStrategyType,
      builtin: true,
    };

    // Type-level test: profiles:read permission assignment
    const permissionRead: Permission = 'profiles:read';
    const permissionManage: Permission = 'profiles:manage';

    // Type-level test: baseId field
    const profileWithBase: RoutingProfile = {
      id: 'custom-profile',
      kind: 'routing',
      version: 1,
      label: 'Custom Profile',
      policies: [],
      selector: 'weighted-random',
      fallbackStrategy: 'retry-after-cooldown',
      builtin: false,
      baseId: 'preset-id',
    };

    // Type-level test: the other two kinds and the kind -> type mapping
    const optimizerProfile: OptimizerProfile = {
      id: 'opt',
      kind: 'optimizer',
      version: 1,
      label: 'Opt',
      builtin: true,
      optimizers: { steps: [{ id: 'session-dedup', enabled: true }] },
    };
    const securityProfile: SecurityProfile = {
      id: 'sec',
      kind: 'security',
      version: 1,
      label: 'Sec',
      builtin: true,
      guardrails: { rules: [] },
      pii: { policies: [] },
    };
    const anyProfile: Profile = optimizerProfile;
    const mapped: ProfileOfKind<'security'> = securityProfile;

    void profile;
    void permissionRead;
    void permissionManage;
    void profileWithBase;
    void anyProfile;
    void mapped;
  });
});
