import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OptimizerStepsEditor,
  buildOptimizerSteps,
  mergeOptimizerRows,
  type OptimizerRow,
} from './OptimizerStepsEditor';

vi.mock('../api', () => ({
  getLlmLinguaModel: vi.fn(),
  installLlmLinguaModel: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('./SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange, ariaLabel, disabled }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { getLlmLinguaModel, installLlmLinguaModel } from '../api';

const mockGetModel = vi.mocked(getLlmLinguaModel as () => Promise<unknown>);
const mockInstall = vi.mocked(installLlmLinguaModel as (...a: unknown[]) => Promise<unknown>);

const checkpoint = {
  key: 'bert-multilingual-q8',
  label: 'BERT multilingual, quantized',
  repo: 'org/repo',
  dtype: 'q8',
  sizeMb: 182,
  license: 'Apache-2.0.',
  note: 'The default.',
  isDefault: true,
};
const other = { ...checkpoint, key: 'xlm-roberta-large-int8', label: 'XLM-RoBERTa large, int8', sizeMb: 579, isDefault: false };

describe('OptimizerStepsEditor', () => {
  const rows: OptimizerRow[] = [
    { id: 'ccr', enabled: true },
    { id: 'session-dedup', enabled: true },
  ];

  it('renders the threshold control inside the row body, not a side column', () => {
    render(<OptimizerStepsEditor rows={rows} setRows={vi.fn()} />);
    const input = screen.getByLabelText('Recent turns to keep');
    const body = document.querySelector('[data-testid="optimizer-row-body-ccr"]');
    expect(body).toContainElement(input as HTMLElement);
  });

  it('renders no threshold control for an optimizer that takes none', () => {
    render(<OptimizerStepsEditor rows={rows} setRows={vi.fn()} />);
    expect(document.getElementById('optimizer-threshold-session-dedup')).toBeNull();
  });

  it('reports a cleared threshold as removed, not as zero', () => {
    const setRows = vi.fn();
    render(<OptimizerStepsEditor rows={[{ id: 'ccr', enabled: true, threshold: 4 }]} setRows={setRows} />);
    fireEvent.change(screen.getByLabelText('Recent turns to keep'), { target: { value: '' } });
    const updater = setRows.mock.calls[0]![0] as (prev: OptimizerRow[]) => OptimizerRow[];
    expect(updater([{ id: 'ccr', enabled: true, threshold: 4 }])[0]).toEqual({ id: 'ccr', enabled: true });
  });

  it('asks the host about checkpoints only when the pipeline lists llmlingua-2', () => {
    render(<OptimizerStepsEditor rows={rows} setRows={vi.fn()} />);
    expect(mockGetModel).not.toHaveBeenCalled();
  });
});

describe('optimizer step round trip', () => {
  it('carries the checkpoint from a configured step and back out again', () => {
    const merged = mergeOptimizerRows([{ id: 'llmlingua-2', enabled: true, model: 'xlm-roberta-large-int8' }], []);
    expect(merged[0]).toEqual({ id: 'llmlingua-2', enabled: true, model: 'xlm-roberta-large-int8' });
    expect(buildOptimizerSteps(merged)).toEqual([{ id: 'llmlingua-2', enabled: true, model: 'xlm-roberta-large-int8' }]);
  });
});

// The step is inert without a downloaded checkpoint, so the download lives in
// the row rather than in a panel somewhere else on the page.
describe('OptimizerStepsEditor — llmlingua-2 checkpoints', () => {
  const llmRows: OptimizerRow[] = [{ id: 'llmlingua-2', enabled: false }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModel.mockResolvedValue({ runtimeInstalled: true, checkpoints: [{ ...checkpoint, state: 'absent' }] });
  });

  it('reports a missing runtime instead of offering a download', async () => {
    mockGetModel.mockResolvedValue({ runtimeInstalled: false, checkpoints: [{ ...checkpoint, state: 'absent' }] });
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/is not installed on the service host/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('keeps the step disabled until a checkpoint is downloaded', async () => {
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('enables the step once a checkpoint is on the host', async () => {
    mockGetModel.mockResolvedValue({ runtimeInstalled: true, checkpoints: [{ ...checkpoint, state: 'ready' }] });
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    expect(screen.getByText('Downloaded')).toBeInTheDocument();
  });

  it('starts the download for the checkpoint whose button was clicked', async () => {
    const user = userEvent.setup();
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'ready' }, { ...other, state: 'absent' }],
    });
    mockInstall.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'ready' }, { ...other, state: 'downloading', progress: 12 }],
    });
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /download/i }));
    expect(mockInstall).toHaveBeenCalledWith('xlm-roberta-large-int8');
  });

  it('shows how far a download has got, on a page loaded while it runs', async () => {
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'downloading', progress: 42, loadedBytes: 76_000_000, totalBytes: 182_000_000 }],
    });
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42% (76 of 182 MB)')).toBeInTheDocument();
  });

  it('surfaces the error the host reported, and offers a retry', async () => {
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'absent', error: 'disk full' }],
    });
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('disk full')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('writes the picked checkpoint onto the step', async () => {
    const user = userEvent.setup();
    const setRows = vi.fn();
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'ready' }, { ...other, state: 'ready' }],
    });
    render(<OptimizerStepsEditor rows={[{ id: 'llmlingua-2', enabled: true }]} setRows={setRows} />);
    await user.selectOptions(await screen.findByLabelText('LLMLingua-2 checkpoint'), 'xlm-roberta-large-int8');
    const updater = setRows.mock.calls[0]![0] as (prev: OptimizerRow[]) => OptimizerRow[];
    expect(updater([{ id: 'llmlingua-2', enabled: true }])[0]).toEqual({
      id: 'llmlingua-2', enabled: true, model: 'xlm-roberta-large-int8',
    });
  });

  it('warns when the step points at a checkpoint that is not downloaded', async () => {
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [{ ...checkpoint, state: 'absent' }, { ...other, state: 'ready' }],
    });
    render(<OptimizerStepsEditor rows={[{ id: 'llmlingua-2', enabled: true }]} setRows={vi.fn()} />);
    await waitFor(() => expect(
      screen.getByText(/BERT multilingual, quantized is not downloaded, so this step is skipped/i),
    ).toBeInTheDocument());
  });

  it('offers no checkpoint picker while nothing is downloaded', async () => {
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/checkpoints on the service host/i)).toBeInTheDocument());
    expect(screen.queryByLabelText('LLMLingua-2 checkpoint')).not.toBeInTheDocument();
  });

  it('gives up the download button in read-only mode', async () => {
    render(<OptimizerStepsEditor rows={llmRows} setRows={vi.fn()} disabled />);
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).toBeDisabled());
  });
});
