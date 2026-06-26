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
