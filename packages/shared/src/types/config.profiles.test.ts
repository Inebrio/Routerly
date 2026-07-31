import { describe, it } from 'vitest';
import { SelectorType, FallbackStrategyType, RoutingProfile, Permission } from './config.js';

describe('type-checks', () => {
  it('type-checks', () => {
    // Type-level test: RoutingProfile construction
    const profile: RoutingProfile = {
      id: 'test-profile',
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
      version: 1,
      label: 'Custom Profile',
      policies: [],
      selector: 'weighted-random',
      fallbackStrategy: 'retry-after-cooldown',
      builtin: false,
      baseId: 'preset-id',
    };

    void profile;
    void permissionRead;
    void permissionManage;
    void profileWithBase;
  });
});
