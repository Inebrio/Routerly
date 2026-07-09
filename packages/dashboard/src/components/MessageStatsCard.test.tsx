import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageStatsCard } from './MessageStatsCard';
import type { MessageStats } from '../utils/traceUtils';

// ponytail: cover only the guardrail-blocked status path added with the token-surfacing fix

function baseStats(overrides: Partial<MessageStats> = {}): MessageStats {
  return {
    selectedModel: null,
    routerScore: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    latencyMs: null,
    ttftMs: null,
    tokensPerSec: null,
    inputCostUsd: null,
    outputCostUsd: null,
    totalCostUsd: null,
    inputPerMillion: null,
    outputPerMillion: null,
    hasError: false,
    fallbackUsed: false,
    guardrailBlocked: false,
    guardrailInputTokens: null,
    guardrailOutputTokens: null,
    guardrailCostUsd: null,
    ...overrides,
  };
}

describe('MessageStatsCard — guardrail blocked', () => {
  it('renders the GUARDRAIL BLOCKED card when a blocking rule triggered with no completion', () => {
    render(
      <MessageStatsCard
        turnNumber={2}
        stats={baseStats({
          guardrailBlocked: true,
          guardrailInputTokens: 878,
          guardrailOutputTokens: 111,
          guardrailCostUsd: 0.0060655,
        })}
      />,
    );
    expect(screen.getByText(/GUARDRAIL BLOCKED/i)).toBeTruthy();
    expect(screen.getByText(/See Technical Details for the triggered rule/i)).toBeTruthy();
    expect(screen.getByText(/Judge tokens/i)).toBeTruthy();
  });

  it('shows the judge cost in the header when there is no completion cost', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        stats={baseStats({ guardrailBlocked: true, guardrailInputTokens: 100, guardrailOutputTokens: 10, guardrailCostUsd: 0.00065 })}
      />,
    );
    // guardrail cost fallback span in the header (also repeated in the blocked body line)
    expect(screen.getAllByText('$0.00065000').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the judge token line when usage is present', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        stats={baseStats({ guardrailBlocked: true, guardrailInputTokens: 200, guardrailOutputTokens: 20, guardrailCostUsd: 0.0013 })}
      />,
    );
    expect(screen.getByText(/Judge tokens \(200 \/ 20\)/i)).toBeTruthy();
  });

  it('omits the judge token line when a block has no captured usage', () => {
    render(
      <MessageStatsCard turnNumber={1} stats={baseStats({ guardrailBlocked: true })} />,
    );
    expect(screen.getByText(/GUARDRAIL BLOCKED/i)).toBeTruthy();
    expect(screen.queryByText(/Judge tokens/i)).toBeNull();
  });

  it('does not render the blocked card for a normal successful turn', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        completionModel="gpt-4o"
        stats={baseStats({ latencyMs: 500, inputTokens: 10, outputTokens: 20, totalCostUsd: 0.001 })}
      />,
    );
    expect(screen.queryByText(/GUARDRAIL BLOCKED/i)).toBeNull();
  });
});

describe('MessageStatsCard — routing and completion', () => {
  it('renders routing model, score bar, and full completion + cost breakdown', () => {
    render(
      <MessageStatsCard
        turnNumber={3}
        completionModel="gpt-4o"
        stats={baseStats({
          selectedModel: 'openai/gpt-4o',
          routerScore: 0.85,
          latencyMs: 2500,
          ttftMs: 300,
          tokensPerSec: 120,
          inputTokens: 100,
          outputTokens: 500,
          cachedTokens: 20,
          inputCostUsd: 0.0001,
          outputCostUsd: 0.001,
          totalCostUsd: 0.0011,
        })}
      />,
    );
    expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
    expect(screen.getByText('0.850')).toBeTruthy(); // ScoreBar value
    expect(screen.getByText(/Routing/i)).toBeTruthy();
    expect(screen.getByText(/Completion/i)).toBeTruthy();
    expect(screen.getByText(/Total/i)).toBeTruthy();
    expect(screen.getByText(/Cached: 20 tokens/i)).toBeTruthy();
  });

  it('renders the null score bar placeholder when routerScore is absent', () => {
    render(
      <MessageStatsCard turnNumber={1} stats={baseStats({ selectedModel: 'openai/gpt-4o', routerScore: null })} />,
    );
    // routing block present, but no numeric score rendered
    expect(screen.getByText(/Routing/i)).toBeTruthy();
    expect(screen.queryByText(/^0\.\d{3}$/)).toBeNull();
  });

  it('renders the FALLBACK badge and warning when a fallback occurred', () => {
    render(
      <MessageStatsCard
        turnNumber={4}
        completionModel="claude-haiku-4-5"
        stats={baseStats({
          selectedModel: 'openai/gpt-4o',
          routerScore: 0.4,
          fallbackUsed: true,
          errorMessage: 'Connection refused',
          latencyMs: 1000,
          inputTokens: 50,
          outputTokens: 200,
        })}
      />,
    );
    expect(screen.getByText('FALLBACK')).toBeTruthy();
    expect(screen.getByText(/Connection refused/i)).toBeTruthy();
  });

  it('renders the fatal-error box when the turn errored with no completion', () => {
    render(
      <MessageStatsCard turnNumber={1} stats={baseStats({ hasError: true, errorMessage: 'EHOSTDOWN' })} />,
    );
    expect(screen.getByText('EHOSTDOWN')).toBeTruthy();
  });

  it('shows placeholders when a completion is present but token counts are missing', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        completionModel="gpt-4o"
        stats={baseStats({ latencyMs: 800, inputTokens: null, outputTokens: null, totalCostUsd: 0.002 })}
      />,
    );
    // tokens ternary + cost-breakdown Input/Output labels fall back to the em-placeholder
    expect(screen.getByText(/Input \(—\)/)).toBeTruthy();
    expect(screen.getByText(/Output \(—\)/)).toBeTruthy();
  });

  // Covers ScoreBar line 13: value in [0.4, 0.7) → '#facc15' (yellow) branch
  it('renders yellow ScoreBar for routerScore in the middle band [0.4, 0.7)', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        stats={baseStats({ selectedModel: 'openai/gpt-4o', routerScore: 0.55 })}
      />,
    );
    expect(screen.getByText('0.550')).toBeTruthy();
  });

  // Covers ScoreBar line 13: value < 0.4 → '#f87171' (red) branch
  it('renders red ScoreBar for routerScore below 0.4', () => {
    render(
      <MessageStatsCard
        turnNumber={1}
        stats={baseStats({ selectedModel: 'openai/gpt-4o', routerScore: 0.2 })}
      />,
    );
    expect(screen.getByText('0.200')).toBeTruthy();
  });
});
