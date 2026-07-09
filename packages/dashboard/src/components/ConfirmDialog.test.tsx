import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders message and default Confirm label', () => {
    render(<ConfirmDialog message="Delete this?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Delete this?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom confirmLabel', () => {
    render(<ConfirmDialog message="?" onConfirm={vi.fn()} onCancel={vi.fn()} confirmLabel="Remove" />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  // Covers the branch on line 21: danger=false → btn-primary class
  it('uses btn-primary class when danger=false', () => {
    render(<ConfirmDialog message="?" onConfirm={vi.fn()} onCancel={vi.fn()} danger={false} />);
    const btn = screen.getByRole('button', { name: 'Confirm' });
    expect(btn.className).toContain('btn-primary');
    expect(btn.className).not.toContain('btn-danger');
  });

  it('uses btn-danger class when danger=true (default)', () => {
    render(<ConfirmDialog message="?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Confirm' });
    expect(btn.className).toContain('btn-danger');
  });
});
