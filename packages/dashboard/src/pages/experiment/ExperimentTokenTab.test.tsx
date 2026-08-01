import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  createExperimentToken: vi.fn(),
  deleteExperimentToken: vi.fn(),
}));

vi.mock('../../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./ExperimentLayout', () => ({ useExperiment: vi.fn() }));

vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { ExperimentTokenTab } from './ExperimentTokenTab';
import { createExperimentToken, deleteExperimentToken } from '../../api';
import { writeToClipboard } from '../../utils/clipboard';
import { useAuth } from '../../AuthContext';
import { useExperiment } from './ExperimentLayout';

const mockCreate = vi.mocked(createExperimentToken as (...a: unknown[]) => Promise<unknown>);
const mockDelete = vi.mocked(deleteExperimentToken as (...a: unknown[]) => Promise<unknown>);
const mockCopy = vi.mocked(writeToClipboard);
const mockUseAuth = vi.mocked(useAuth);
const mockUseExperiment = vi.mocked(useExperiment);

const token = { id: 't1', tokenSnippet: 'sk-rt-abc', createdAt: '2026-07-01T00:00:00.000Z', lastUsedAt: '2026-07-20T00:00:00.000Z' };
const experiment = {
  id: 'exp-1', name: 'Cheap vs premium', status: 'running',
  variants: [], tokens: [token], createdAt: '2026-07-01T00:00:00.000Z',
};

const setExperiment = vi.fn();

function setContext(value: unknown) {
  mockUseExperiment.mockReturnValue({ experiment: value, setExperiment } as unknown as ReturnType<typeof useExperiment>);
}

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({ can: vi.fn((p: string) => perms.includes(p)) } as unknown as ReturnType<typeof useAuth>);
}

/** The component sends a state updater; run it to see what it would have stored. */
function lastUpdate(previous: unknown) {
  const calls = setExperiment.mock.calls;
  const fn = calls[calls.length - 1]![0] as (p: unknown) => unknown;
  return fn(previous) as { tokens: { id: string }[] };
}

beforeEach(() => {
  mockCreate.mockResolvedValue({ token: 'sk-rt-plaintext', tokenInfo: { id: 't2', tokenSnippet: 'sk-rt-xyz', createdAt: '2026-08-01T00:00:00.000Z' } });
  mockDelete.mockResolvedValue(undefined);
  mockCopy.mockResolvedValue(undefined);
  setAuth(['experiments:read', 'experiments:manage']);
  setContext(experiment);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentTokenTab', () => {
  it('lists the existing tokens with their snippet and usage dates', () => {
    render(<ExperimentTokenTab />);
    expect(screen.getByText('sk-rt-abc')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Last used')).toBeInTheDocument();
  });

  it('shows a dash for a token nobody has used', () => {
    setContext({ ...experiment, tokens: [{ ...token, lastUsedAt: undefined }] });
    render(<ExperimentTokenTab />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the empty state with no tokens', () => {
    setContext({ ...experiment, tokens: [] });
    render(<ExperimentTokenTab />);
    expect(screen.getByText(/No tokens on this experiment/)).toBeInTheDocument();
  });

  it('creates a token, reveals it once and appends it to the list', async () => {
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByRole('button', { name: /new token/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('exp-1'));
    expect(screen.getByText('sk-rt-plaintext')).toBeInTheDocument();
    expect(lastUpdate(experiment).tokens.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('copies the revealed token', async () => {
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByRole('button', { name: /new token/i }));
    await waitFor(() => expect(screen.getByText('sk-rt-plaintext')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('sk-rt-plaintext'));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('tells the user to copy by hand when the clipboard refuses', async () => {
    mockCopy.mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByRole('button', { name: /new token/i }));
    await waitFor(() => expect(screen.getByText('sk-rt-plaintext')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  });

  it('reports a failed create', async () => {
    mockCreate.mockRejectedValue(new Error('module_disabled'));
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByRole('button', { name: /new token/i }));
    await waitFor(() => expect(screen.getByText('module_disabled')).toBeInTheDocument());
  });

  it('revokes a token after confirmation', async () => {
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByTitle('Revoke Token'));
    expect(screen.getByText(/Revoke token "sk-rt-abc\.\.\."/)).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('exp-1', 't1'));
    expect(lastUpdate(experiment).tokens).toEqual([]);
  });

  it('cancels a revoke', async () => {
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByTitle('Revoke Token'));
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('reports a failed revoke', async () => {
    mockDelete.mockRejectedValue(new Error('Not found'));
    const user = userEvent.setup();
    render(<ExperimentTokenTab />);
    await user.click(screen.getByTitle('Revoke Token'));
    await user.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument());
  });

  it('offers no create or revoke without the manage permission', () => {
    setAuth(['experiments:read']);
    render(<ExperimentTokenTab />);
    expect(screen.queryByRole('button', { name: /new token/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Revoke Token')).not.toBeInTheDocument();
  });

  it('renders nothing until the layout has the experiment', () => {
    setContext(null);
    const { container } = render(<ExperimentTokenTab />);
    expect(container).toBeEmptyDOMElement();
  });
});
