import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraceLog } from './TraceLog';
import type { TraceEntry } from '../api';

describe('TraceLog', () => {
  it('renders nothing when the trace is empty', () => {
    const { container } = render(<TraceLog entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the only entry is the recap the card already shows', () => {
    const { container } = render(<TraceLog entries={[{ message: 'trace:recap', panel: 'router-response', details: {} }]} />);
    expect(container.firstChild).toBeNull();
  });

  it('groups by phase, in the order the pipeline walked them', () => {
    const entries: TraceEntry[] = [
      { message: 'pii:evaluated', phase: 'request.preprocess', module: 'pii', panel: 'request', details: {}, at: 1000 },
      { message: 'router:result', phase: 'routing.prepare', module: 'router', panel: 'router-response', details: {}, at: 1080 },
      { message: 'model:request', phase: 'routing.execute', module: 'model', panel: 'request', details: {}, at: 1100 },
      { message: 'trace:recap', phase: 'finalize', module: 'trace', panel: 'router-response', details: {}, at: 1200 },
    ];
    render(<TraceLog entries={entries} />);

    const headers = screen.getAllByRole('button').map(b => b.textContent);
    expect(headers[0]).toContain('Request · Preprocess');
    expect(headers[1]).toContain('Routing · Prepare');
    expect(headers[2]).toContain('Routing · Execute');
    // The recap was the only entry of finalize, so that phase has nothing left.
    expect(headers).toHaveLength(3);
    // The module that spoke is on the header, so a phase is identifiable folded.
    expect(headers[0]).toContain('pii');
    expect(headers[1]).toContain('router');
  });

  it('stamps every entry with its offset from the start of the request', () => {
    render(<TraceLog entries={[
      { message: 'model:request', phase: 'routing.execute', module: 'model', panel: 'request', details: {}, at: 1000 },
      { message: 'model:success', phase: 'routing.execute', module: 'model', panel: 'response', details: {}, at: 1083 },
    ]} />);

    expect(screen.getByText('+0 ms')).toBeTruthy();
    expect(screen.getByText('+83 ms')).toBeTruthy();
    // The header carries how long the phase took.
    expect(screen.getByRole('button').textContent).toContain('2 events · 83 ms');
  });

  it('folds every phase when collapsed, and opens the one that is clicked', () => {
    const entries: TraceEntry[] = [
      { message: 'model:request', phase: 'routing.execute', module: 'model', panel: 'request', details: {}, at: 1000 },
    ];
    render(<TraceLog entries={entries} collapsed />);

    expect(screen.queryByText('+0 ms')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('+0 ms')).toBeTruthy();
  });

  it('falls back to the panel grouping for traces recorded before 0.4.0', () => {
    render(<TraceLog entries={[
      { message: 'router:result', panel: 'router-response', details: {} },
      { message: 'model:request', panel: 'request', details: {} },
    ]} />);

    expect(screen.getByText('Router Response')).toBeTruthy();
    expect(screen.getByText('Model Request')).toBeTruthy();
    // Panels nobody wrote to are left out.
    expect(screen.queryByText('Router Request')).toBeNull();
  });

  it('still shows an entry that belongs to no phase and no known panel', () => {
    render(<TraceLog entries={[
      { message: 'model:request', panel: 'request', details: {} },
      { message: 'guardrail:evaluated', panel: 'something-else', details: { target: 'request', rules: [{ rule: 'regex:secret', outcome: 'passed' }] } },
    ]} />);

    expect(screen.getByText('Model Request')).toBeTruthy();
    expect(screen.getByText(/regex:secret/)).toBeTruthy();
  });
});
