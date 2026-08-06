import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceSummary } from './TraceSummary';
import type { TraceEntry } from '../api';

const recap = (details: Record<string, unknown>): TraceEntry[] => [
  { panel: 'router-response', message: 'trace:recap', details },
];

describe('TraceSummary', () => {
  it('renders nothing without a recap — a pre-0.4.0 trace has only the log', () => {
    const { container } = render(<TraceSummary trace={[{ panel: 'request', message: 'model:request', details: {} }]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there is no trace at all', () => {
    const { container } = render(<TraceSummary trace={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('is the turn itself when collapsible: the detail lives inside the card', () => {
    const { container } = render(
      <TraceSummary trace={recap({ outcome: 'ok', tokens: { input: 1, output: 1 } })} turn={2} collapsible>
        <div>trace log</div>
      </TraceSummary>,
    );
    const details = container.querySelector('details.trace-turn');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary')?.textContent).toContain('TURN #2');
    expect(details?.textContent).toContain('trace log');
  });

  it('opens only when asked — older turns start folded', () => {
    const { container, rerender } = render(
      <TraceSummary trace={recap({ outcome: 'ok' })} turn={1} collapsible defaultOpen />,
    );
    expect(container.querySelector('details')?.open).toBe(true);
    rerender(<TraceSummary trace={recap({ outcome: 'ok' })} turn={1} collapsible defaultOpen={false} />);
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it('still shows the turn while it is streaming, before the recap arrives', () => {
    render(
      <TraceSummary trace={[{ panel: 'request', message: 'model:request', details: {} }]} turn={1} collapsible>
        <div>trace log</div>
      </TraceSummary>,
    );
    expect(screen.getByText('TURN #1')).toBeTruthy();
    expect(screen.getByText('incomplete')).toBeTruthy();
    expect(screen.getByText('trace log')).toBeTruthy();
  });

  it('heads the card with outcome, model, provider, duration and cost', () => {
    render(<TraceSummary trace={recap({
      outcome: 'ok', model: 'gpt-4o', provider: 'openai', durationMs: 1200, costUsd: 0.0021,
      attempts: 1, tokens: { input: 1000, output: 250, cachedInput: 0 }, latencyMs: 1100,
    })} turn={3} />);

    expect(screen.getByText('TURN #3')).toBeTruthy();
    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.getByText('gpt-4o')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('1.20s')).toBeTruthy();
    expect(screen.getByText('1,000 / 250')).toBeTruthy();
    // One attempt is the normal case: no retry pill.
    expect(screen.queryByText(/attempts/)).toBeNull();
  });

  it('flags a retried request with the attempt count', () => {
    render(<TraceSummary trace={recap({ outcome: 'ok', attempts: 3, tokens: { input: 1, output: 1 } })} />);
    expect(screen.getByText('3 attempts')).toBeTruthy();
  });

  it('falls back to incomplete on an outcome it does not know', () => {
    render(<TraceSummary trace={recap({ outcome: 'something-else' })} />);
    expect(screen.getByText('incomplete')).toBeTruthy();
  });

  it('shows the cached tokens only when the provider served some', () => {
    const { rerender } = render(<TraceSummary trace={recap({ outcome: 'ok', tokens: { input: 10, output: 2, cachedInput: 0 } })} />);
    expect(screen.queryByText('Cached')).toBeNull();

    rerender(<TraceSummary trace={recap({ outcome: 'ok', tokens: { input: 10, output: 2, cachedInput: 512 } })} />);
    expect(screen.getByText('Cached')).toBeTruthy();
  });

  it('leaves out every section the pipeline had nothing to say about', () => {
    render(<TraceSummary trace={recap({ outcome: 'ok', tokens: { input: 1, output: 1 } })} />);
    expect(screen.queryByText('Guardrails')).toBeNull();
    expect(screen.queryByText('PII')).toBeNull();
    expect(screen.queryByText('Optimizers')).toBeNull();
    expect(screen.queryByText('Router overhead')).toBeNull();
  });

  it('reports guardrails, PII, optimizers and router overhead when they ran', () => {
    render(<TraceSummary trace={recap({
      outcome: 'blocked',
      guardrails: { rules: 4, triggered: 1, skipped: 1, injected: 2, blockedBy: 'topic:gpt-4o-mini' },
      pii: { request: 3, response: 1 },
      optimizers: { steps: 2, applied: 1, rolledBack: 1, savedTokens: 300 },
      overhead: { calls: 2, costUsd: 0.0004 },
    })} />);

    expect(screen.getByText('blocked')).toBeTruthy();
    expect(screen.getByText('Guardrails')).toBeTruthy();
    expect(screen.getByText('topic:gpt-4o-mini')).toBeTruthy();
    expect(screen.getByText('injected')).toBeTruthy();
    expect(screen.getByText('PII')).toBeTruthy();
    expect(screen.getByText('Optimizers')).toBeTruthy();
    expect(screen.getByText('rolled back')).toBeTruthy();
    expect(screen.getByText('300 tok')).toBeTruthy();
    expect(screen.getByText('Router overhead')).toBeTruthy();
  });

  it('hides injected and rolled back when they are zero', () => {
    render(<TraceSummary trace={recap({
      outcome: 'ok',
      guardrails: { rules: 2, triggered: 0, skipped: 0, injected: 0 },
      optimizers: { steps: 1, applied: 1, rolledBack: 0, savedTokens: 10 },
    })} />);
    expect(screen.queryByText('injected')).toBeNull();
    expect(screen.queryByText('rolled back')).toBeNull();
    expect(screen.queryByText('blocked by')).toBeNull();
  });

  it('lists one row per failed attempt', () => {
    render(<TraceSummary trace={recap({
      outcome: 'error',
      errors: [{ model: 'gpt-4o', error: 'timeout' }, { error: 'connection reset' }],
    })} />);
    expect(screen.getByText('gpt-4o')).toBeTruthy();
    expect(screen.getByText(/timeout/)).toBeTruthy();
    // A failure that named no model still gets its row.
    expect(screen.getByText('unknown')).toBeTruthy();
    expect(screen.getByText(/connection reset/)).toBeTruthy();
  });
});
