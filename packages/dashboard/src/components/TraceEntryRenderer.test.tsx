import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceEntryRenderer } from './TraceEntryRenderer';

// ponytail: test only the new guardrail/PII rendering paths added in BUG-1

describe('TraceEntryRenderer — guardrail:triggered', () => {
  it('shows REQUEST header when target=request', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:competitor', target: 'request', action: 'block' },
      }} />
    );
    expect(screen.getByText(/REQUEST GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows RESPONSE header when target=response', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'response',
        details: { rule: 'topic:score=0.20', target: 'response', action: 'block' },
      }} />
    );
    expect(screen.getByText(/RESPONSE GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows RESPONSE header when target=both', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'semantic:safe', target: 'both', action: 'block' },
      }} />
    );
    expect(screen.getByText(/RESPONSE GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows rule and action', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:competitor', target: 'request', action: 'block' },
      }} />
    );
    expect(screen.getByText('regex:competitor')).toBeTruthy();
    expect(screen.getByText('block')).toBeTruthy();
  });

  it('shows fallbackMessage when present', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:x', target: 'request', action: 'block', fallbackMessage: 'Content blocked.' },
      }} />
    );
    expect(screen.getByText('Content blocked.')).toBeTruthy();
  });

  it('shows TRIGGERED (not BLOCKED) when action is not block', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:x', target: 'request', action: 'flag' },
      }} />
    );
    expect(screen.getByText(/REQUEST GUARDRAIL TRIGGERED/i)).toBeTruthy();
  });

  it('handles guardrail:response-triggered with context-aware header', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:response-triggered',
        panel: 'response',
        details: { rule: 'moderation:unsafe', target: 'response', action: 'block' },
      }} />
    );
    expect(screen.getByText(/RESPONSE GUARDRAIL BLOCKED/i)).toBeTruthy();
  });
});

describe('TraceEntryRenderer — guardrail:evaluated', () => {
  it('shows GUARDRAILS EVALUATED (REQUEST) header for target=request', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [
            { rule: 'regex:competitor', outcome: 'passed', reason: 'regex:/competitor/i' },
            { rule: 'injection',        outcome: 'skipped' },
            { rule: 'topic',            outcome: 'triggered', reason: 'topic:score=0.85' },
          ],
        },
      }} />
    );
    expect(screen.getByText(/GUARDRAILS EVALUATED \(REQUEST\)/i)).toBeTruthy();
  });

  it('shows GUARDRAILS EVALUATED (RESPONSE) header for target=response', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'response',
        details: {
          target: 'response',
          rules: [{ rule: 'moderation', outcome: 'passed' }],
        },
      }} />
    );
    expect(screen.getByText(/GUARDRAILS EVALUATED \(RESPONSE\)/i)).toBeTruthy();
  });

  it('renders each rule name', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [
            { rule: 'regex:bad', outcome: 'passed' },
            { rule: 'semantic',  outcome: 'triggered' },
            { rule: 'injection', outcome: 'skipped' },
          ],
        },
      }} />
    );
    expect(screen.getByText('regex:bad')).toBeTruthy();
    expect(screen.getByText('semantic')).toBeTruthy();
  });

  it('labels the injection rule as "Prompt injection"', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'injection', outcome: 'skipped' }],
        },
      }} />
    );
    expect(screen.getByText('Prompt injection')).toBeTruthy();
  });

  it('shows outcome chips: passed, triggered, skipped', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [
            { rule: 'a', outcome: 'passed' },
            { rule: 'b', outcome: 'triggered' },
            { rule: 'c', outcome: 'skipped' },
          ],
        },
      }} />
    );
    expect(screen.getByText('passed')).toBeTruthy();
    expect(screen.getByText('triggered')).toBeTruthy();
    expect(screen.getByText('skipped')).toBeTruthy();
  });

  it('shows reason text when present', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'semantic', outcome: 'triggered', reason: 'semantic:92%' }],
        },
      }} />
    );
    expect(screen.getByText('semantic:92%')).toBeTruthy();
  });

  it('renders without crashing when rules array is empty', () => {
    const { container } = render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: { target: 'request', rules: [] },
      }} />
    );
    expect(container).toBeTruthy();
  });
});

describe('TraceEntryRenderer — pii:evaluated', () => {
  it('shows "0 redacted" when redacted is empty', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:evaluated',
        panel: 'request',
        details: { redacted: [] },
      }} />
    );
    expect(screen.getByText(/PII SCANNED \(REQUEST\)/i)).toBeTruthy();
    expect(screen.getByText('0 redacted')).toBeTruthy();
  });

  it('shows count + entity types when redacted has items', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:evaluated',
        panel: 'response',
        details: { redacted: ['EMAIL', 'PHONE'] },
      }} />
    );
    expect(screen.getByText(/PII SCANNED \(RESPONSE\)/i)).toBeTruthy();
    expect(screen.getByText(/2 redacted/i)).toBeTruthy();
    expect(screen.getByText('EMAIL')).toBeTruthy();
    expect(screen.getByText('PHONE')).toBeTruthy();
  });
});

describe('TraceEntryRenderer — pii:scrubbed', () => {
  it('shows PII SCRUBBED header', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:scrubbed',
        panel: 'request',
        details: { entities: ['EMAIL'] },
      }} />
    );
    expect(screen.getByText('PII SCRUBBED')).toBeTruthy();
  });

  it('renders entity badges', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:scrubbed',
        panel: 'request',
        details: { entities: ['EMAIL', 'PHONE'] },
      }} />
    );
    expect(screen.getByText('EMAIL')).toBeTruthy();
    expect(screen.getByText('PHONE')).toBeTruthy();
  });

  it('renders with empty entities without crashing', () => {
    const { container } = render(
      <TraceEntryRenderer entry={{
        message: 'pii:scrubbed',
        panel: 'request',
        details: { entities: [] },
      }} />
    );
    expect(screen.getByText('PII SCRUBBED')).toBeTruthy();
    expect(container).toBeTruthy();
  });
});
