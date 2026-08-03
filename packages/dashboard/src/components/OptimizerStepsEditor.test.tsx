import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OptimizerStepsEditor, type OptimizerRow } from './OptimizerStepsEditor';

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
});
