import { describe, it, expect } from 'vitest';
import type { RoutingPolicy } from './config.js';

// Compile-time guard: orchestrate.ts reads policy-specific fields straight off `config`,
// so it must stay indexable (not `unknown`). tsc fails on this file if it regresses.
describe('RoutingPolicy.config', () => {
  it('exposes policy-specific settings without a cast', () => {
    const policy: RoutingPolicy = { type: 'rate-limit', enabled: true, config: { windowMinutes: 5 } };
    expect(policy.config.windowMinutes + 1).toBe(6);
  });
});
