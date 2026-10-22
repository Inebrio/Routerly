import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({ can: (_p: string): boolean => true }));
vi.mock('../AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', () => ({ getProviderDescriptors: vi.fn() }));

import { getProviderDescriptors } from '../api';

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

describe('useProviderLabels', () => {
  it('skips the descriptors call without connections:read', async () => {
    auth.can = () => false;
    const { useProviderLabels } = await import('./useProviderLabels');
    const { result } = renderHook(() => useProviderLabels());
    await new Promise(r => setTimeout(r, 20));
    expect(getProviderDescriptors).not.toHaveBeenCalled();
    expect(result.current('anthropic')).toBe('anthropic');
  });
  it('loads labels with connections:read', async () => {
    auth.can = () => true;
    vi.mocked(getProviderDescriptors).mockResolvedValue([{ id: 'anthropic', label: 'Anthropic' }] as never);
    const { useProviderLabels } = await import('./useProviderLabels');
    const { result } = renderHook(() => useProviderLabels());
    await waitFor(() => expect(result.current('anthropic')).toBe('Anthropic'));
  });
});
