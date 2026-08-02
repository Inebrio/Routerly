import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({
  createExperiment: vi.fn(),
  updateExperiment: vi.fn(),
  getProjects: vi.fn(),
  getModels: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./ExperimentLayout', () => ({ useExperiment: vi.fn() }));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange, ariaLabel, disabled }: {
    options: { value: string; label: string }[];
    value: string; onChange: (v: string) => void; ariaLabel?: string; disabled?: boolean;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { ExperimentConfigTab } from './ExperimentConfigTab';
import { createExperiment, updateExperiment, getProjects, getModels } from '../../api';
import { useAuth } from '../../AuthContext';
import { useExperiment } from './ExperimentLayout';

const mockCreate = vi.mocked(createExperiment as (...a: unknown[]) => Promise<unknown>);
const mockUpdate = vi.mocked(updateExperiment as (...a: unknown[]) => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);
const mockUseExperiment = vi.mocked(useExperiment);

const projects = [{ id: 'p1', name: 'Cheap' }, { id: 'p2', name: 'Premium' }];
const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];

const existing = {
  id: 'exp-1', name: 'Cheap vs premium', rotation: 'sticky', stickyKey: 'auto',
  variants: [{ id: 'v1', projectId: 'p1' }, { id: 'v2', projectId: 'p2', name: 'Arm B', weight: 3 }],
  tokens: [], createdAt: '2026-07-01T00:00:00.000Z',
};

const setExperiment = vi.fn();

function setContext(experiment: unknown) {
  mockUseExperiment.mockReturnValue({ experiment, setExperiment } as unknown as ReturnType<typeof useExperiment>);
}

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({ can: vi.fn((p: string) => perms.includes(p)) } as unknown as ReturnType<typeof useAuth>);
}

function renderTab() {
  return render(<MemoryRouter><ExperimentConfigTab /></MemoryRouter>);
}

beforeEach(() => {
  mockGetProjects.mockResolvedValue(projects);
  mockGetModels.mockResolvedValue(models);
  mockCreate.mockResolvedValue({ ...existing, token: 'sk-rt-secret' });
  mockUpdate.mockResolvedValue(existing);
  setAuth(['experiments:read', 'experiments:manage']);
  setContext(null);
});

afterEach(() => vi.clearAllMocks());

describe('ExperimentConfigTab: create', () => {
  it('starts with two empty variant rows', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    expect(screen.getByLabelText('Variant 2 project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create experiment/i })).toBeInTheDocument();
  });

  it('creates the experiment and reveals its token once', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'Cheap vs premium');
    await user.selectOptions(screen.getByLabelText('Variant 1 project'), 'p1');
    await user.selectOptions(screen.getByLabelText('Variant 2 project'), 'p2');
    await user.click(screen.getByRole('button', { name: /create experiment/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      name: 'Cheap vs premium',
      rotation: 'sticky',
      stickyKey: 'auto',
      variants: [{ projectId: 'p1' }, { projectId: 'p2' }],
    }));
    await waitFor(() => expect(screen.getByText('sk-rt-secret')).toBeInTheDocument());
    expect(setExperiment).toHaveBeenCalledWith(expect.objectContaining({ id: 'exp-1' }));
  });

  it('sends weights only under weighted rotation, and shows each share', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'Split');
    await user.selectOptions(screen.getByLabelText('Rotation'), 'weighted');
    await user.selectOptions(screen.getByLabelText('Variant 1 project'), 'p1');
    await user.selectOptions(screen.getByLabelText('Variant 2 project'), 'p2');
    await user.type(screen.getByLabelText('Variant 1 weight'), '3');
    await user.type(screen.getByLabelText('Variant 2 weight'), '1');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create experiment/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      rotation: 'weighted',
      variants: [{ projectId: 'p1', weight: 3 }, { projectId: 'p2', weight: 1 }],
    })));
    // stickyKey belongs to sticky rotation only
    expect(mockCreate.mock.calls[0]![0]).not.toHaveProperty('stickyKey');
  });

  it('hides the sticky key selector unless the rotation is sticky', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Sticky key')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Rotation'), 'round-robin');
    expect(screen.queryByLabelText('Sticky key')).not.toBeInTheDocument();
  });

  it('adds and removes variant rows', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add variant/i }));
    expect(screen.getByLabelText('Variant 3 project')).toBeInTheDocument();
    await user.click(screen.getByTitle('Remove variant 3'));
    expect(screen.queryByLabelText('Variant 3 project')).not.toBeInTheDocument();
  });

  it('sends the judge as a fraction with one criterion per line', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'Judged');
    await user.selectOptions(screen.getByLabelText('Variant 1 project'), 'p1');
    await user.click(screen.getByRole('checkbox'));
    await user.selectOptions(screen.getByLabelText('Judge model'), 'gpt-4o');
    await user.type(screen.getByLabelText('Criteria'), 'Answers the question\n\nStays factual');
    await user.clear(screen.getByLabelText(/share of calls judged/i));
    await user.type(screen.getByLabelText(/share of calls judged/i), '25');
    await user.click(screen.getByRole('button', { name: /create experiment/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      judge: { enabled: true, modelId: 'gpt-4o', criteria: ['Answers the question', 'Stays factual'], sampleRate: 0.25 },
    })));
  });

  it('drops variant rows with no project selected', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'Half filled');
    await user.selectOptions(screen.getByLabelText('Variant 1 project'), 'p1');
    await user.click(screen.getByRole('button', { name: /create experiment/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ variants: [{ projectId: 'p1' }] })));
  });

  it('reports a failed create', async () => {
    mockCreate.mockRejectedValue(new Error('An experiment named "X" already exists'));
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Variant 1 project')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.click(screen.getByRole('button', { name: /create experiment/i }));
    await waitFor(() => expect(screen.getByText('An experiment named "X" already exists')).toBeInTheDocument());
  });

  it('reports a failed project load', async () => {
    mockGetProjects.mockRejectedValue(new Error('offline'));
    renderTab();
    await waitFor(() => expect(screen.getByText('offline')).toBeInTheDocument());
  });
});

describe('ExperimentConfigTab: edit', () => {
  beforeEach(() => setContext(existing));

  it('prefills every field from the experiment', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Cheap vs premium'));
    expect(screen.getByLabelText('Variant 1 project')).toHaveValue('p1');
    expect(screen.getByLabelText('Variant 2 label')).toHaveValue('Arm B');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('saves the full body', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Cheap vs premium'));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('exp-1', expect.objectContaining({
      name: 'Renamed',
      variants: [{ id: 'v1', projectId: 'p1' }, { id: 'v2', projectId: 'p2', name: 'Arm B' }],
    })));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
  });

  it('reports a failed save', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Cheap vs premium'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });

  it('is read-only without the manage permission', async () => {
    setAuth(['experiments:read']);
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeDisabled());
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add variant/i })).not.toBeInTheDocument();
  });
});
