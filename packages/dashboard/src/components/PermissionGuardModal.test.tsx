import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionGuardModal } from './PermissionGuardModal';
import { fixPermissions } from '../api';

let mockCan = true;
vi.mock('../AuthContext', () => ({ useAuth: () => ({ can: () => mockCan }) }));
vi.mock('../api', () => ({ fixPermissions: vi.fn() }));

const mockFixPermissions = vi.mocked(fixPermissions as () => Promise<{ fixed: string[] }>);

const detail = { error: 'unsafe_permissions', message: 'users.json is unsafe', files: ['users', 'models'] };

describe('PermissionGuardModal', () => {
  beforeEach(() => { mockCan = true; });

  it('hides Fix now and shows guidance without settings:write', () => {
    mockCan = false;
    render(<PermissionGuardModal detail={detail} onFixed={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Fix now' })).toBeNull();
    expect(screen.getByText(/Ask an operator/)).toBeTruthy();
  });

  it('renders the message and the list of unsafe files', () => {
    render(<PermissionGuardModal detail={detail} onFixed={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('users.json is unsafe')).toBeTruthy();
    expect(screen.getByText('users')).toBeTruthy();
    expect(screen.getByText('models')).toBeTruthy();
  });

  it('calls onCancel and does not call fixPermissions when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    render(<PermissionGuardModal detail={detail} onFixed={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockFixPermissions).not.toHaveBeenCalled();
  });

  it('calls fixPermissions then onFixed when Fix now succeeds', async () => {
    mockFixPermissions.mockResolvedValue({ fixed: ['users'] });
    const onFixed = vi.fn();
    render(<PermissionGuardModal detail={detail} onFixed={onFixed} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fix now' }));
    await waitFor(() => expect(onFixed).toHaveBeenCalledTimes(1));
  });

  it('shows an error and does not call onFixed when the fix request fails', async () => {
    mockFixPermissions.mockRejectedValue(new Error('forbidden'));
    const onFixed = vi.fn();
    render(<PermissionGuardModal detail={detail} onFixed={onFixed} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fix now' }));
    await waitFor(() => expect(screen.getByText('forbidden')).toBeTruthy());
    expect(onFixed).not.toHaveBeenCalled();
  });
});
