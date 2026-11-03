import { describe, it, expect } from 'vitest';
import { getProviderDescriptor, isKnownProvider } from './descriptor.js';

describe('providerDescriptorRegistry', () => {
  it('resolves a built-in provider id', () => {
    const d = getProviderDescriptor('anthropic');
    expect(d?.protocol).toBe('anthropic');
    expect(d?.supportLevel).toBe('native');
  });

  it('reports unknown ids', () => {
    expect(isKnownProvider('anthropic')).toBe(true);
    expect(isKnownProvider('not-a-provider')).toBe(false);
  });
});
