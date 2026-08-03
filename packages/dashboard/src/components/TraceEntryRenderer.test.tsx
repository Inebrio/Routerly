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
        details: { rule: 'regex:competitor', target: 'request', block: true },
      }} />
    );
    expect(screen.getByText(/REQUEST GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows RESPONSE header when target=response', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'response',
        details: { rule: 'topic:score=0.20', target: 'response', block: true },
      }} />
    );
    expect(screen.getByText(/RESPONSE GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows RESPONSE header when target=both', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'semantic:safe', target: 'both', block: true },
      }} />
    );
    expect(screen.getByText(/RESPONSE GUARDRAIL BLOCKED/i)).toBeTruthy();
  });

  it('shows rule and block action summary', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:competitor', target: 'request', block: true, log: true },
      }} />
    );
    expect(screen.getByText('regex:competitor')).toBeTruthy();
    expect(screen.getByText('block+log')).toBeTruthy();
  });

  it('shows blockMessage when present', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:x', target: 'request', block: true, blockMessage: 'Content blocked.' },
      }} />
    );
    expect(screen.getByText('Content blocked.')).toBeTruthy();
  });

  it('shows TRIGGERED (not BLOCKED) when block is not true', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:x', target: 'request', log: true },
      }} />
    );
    expect(screen.getByText(/REQUEST GUARDRAIL TRIGGERED/i)).toBeTruthy();
  });

  it('handles guardrail:response-triggered with context-aware header', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:response-triggered',
        panel: 'response',
        details: { rule: 'moderation:unsafe', target: 'response', block: true },
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

describe('TraceEntryRenderer — guardrail:evaluated judgeRaw', () => {
  it('renders "Judge response" summary when judgeRaw is present', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'topic', outcome: 'triggered', judgeRaw: '{"score":0.9,"message":"off-topic"}' }],
        },
      }} />
    );
    expect(screen.getByText('Judge response')).toBeTruthy();
  });

  it('shows pretty-printed JSON inside details when judgeRaw is valid JSON', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'moderation', outcome: 'passed', judgeRaw: '{"score":0.1}' }],
        },
      }} />
    );
    // pretty-printed JSON contains the key on its own line
    expect(screen.getByText(/score/)).toBeTruthy();
  });

  it('shows raw string inside details when judgeRaw is non-JSON', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'topic', outcome: 'triggered', judgeRaw: 'not json at all' }],
        },
      }} />
    );
    expect(screen.getByText('not json at all')).toBeTruthy();
  });

  it('does not render "Judge response" when judgeRaw is absent', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          rules: [{ rule: 'regex:x', outcome: 'passed' }],
        },
      }} />
    );
    expect(screen.queryByText('Judge response')).toBeNull();
  });
});

describe('TraceEntryRenderer — pii:evaluated', () => {
  it('reports what was scanned when nothing was redacted', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:evaluated',
        panel: 'request',
        details: {
          target: 'request',
          policies: { configured: 3, active: 2 },
          entities: ['EMAIL', 'PHONE'],
          customPatterns: 1,
          scanned: 412,
          redacted: [],
          counts: {},
          ms: 4,
        },
      }} />
    );
    expect(screen.getByText(/PII SCANNED \(REQUEST\)/i)).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy();       // policies active/configured
    expect(screen.getByText('412')).toBeTruthy();       // characters scanned
    expect(screen.getByText('4 ms')).toBeTruthy();
    // Nothing redacted, so no chips — but the entity types are still listed, collapsed
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.getByText('entity types scanned')).toBeTruthy();
  });

  it('shows one chip per redacted entity with its occurrence count', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:evaluated',
        panel: 'response',
        details: {
          target: 'response',
          mode: 'stream',
          entities: ['EMAIL', 'PHONE'],
          redacted: ['EMAIL', 'PHONE'],
          counts: { EMAIL: 2, PHONE: 1 },
        },
      }} />
    );
    expect(screen.getByText(/PII SCANNED \(RESPONSE\)/i)).toBeTruthy();
    expect(screen.getByText('stream')).toBeTruthy();
    expect(screen.getByText('EMAIL ×2')).toBeTruthy();
    expect(screen.getByText('PHONE ×1')).toBeTruthy();
  });

  it('falls back to the panel when the entry carries no target', () => {
    render(
      <TraceEntryRenderer entry={{ message: 'pii:evaluated', panel: 'request', details: { redacted: [] } }} />
    );
    expect(screen.getByText(/PII SCANNED \(REQUEST\)/i)).toBeTruthy();
  });
});

describe('TraceEntryRenderer — guardrail:injected', () => {
  it('lists the rules that injected and how much text they added', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:injected',
        panel: 'request',
        details: { target: 'request', rules: ['tone', 'format'], chars: 128 },
        content: { injection: 'Answer politely.' },
      }} />
    );
    expect(screen.getByText('GUARDRAIL INJECTION')).toBeTruthy();
    expect(screen.getByText('tone')).toBeTruthy();
    expect(screen.getByText('format')).toBeTruthy();
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('injected text')).toBeTruthy();
    expect(screen.getByText('Answer politely.')).toBeTruthy();
  });

  it('names the rules when they arrive as { index, rule } objects', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:injected',
        panel: 'request',
        details: { target: 'request', rules: [{ index: 1, rule: 'moderation:gpt-4o-mini' }, { index: 3, rule: 'topic:judge' }], chars: 123 },
      }} />
    );
    expect(screen.getByText('moderation:gpt-4o-mini')).toBeTruthy();
    expect(screen.getByText('topic:judge')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('omits the injected text when the project did not opt into content capture', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:injected',
        panel: 'request',
        details: { rules: [], chars: 0 },
      }} />
    );
    expect(screen.getByText('GUARDRAIL INJECTION')).toBeTruthy();
    expect(screen.queryByText('injected text')).toBeNull();
  });
});

describe('TraceEntryRenderer — optimizer:step', () => {
  it('shows the token delta of an applied step', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'optimizer:step',
        panel: 'request',
        details: { id: 'caveman', outcome: 'applied', klass: 'compression', tokensBefore: 900, tokensAfter: 600, saved: 300, ms: 12 },
      }} />
    );
    expect(screen.getByText('OPTIMIZER caveman')).toBeTruthy();
    expect(screen.getByText('applied')).toBeTruthy();
    expect(screen.getByText('compression')).toBeTruthy();
    expect(screen.getByText('900 → 600')).toBeTruthy();
    expect(screen.getByText('300 tok')).toBeTruthy();
  });

  it('shows why a step rolled back', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'optimizer:step',
        panel: 'request',
        details: { id: 'caveman', outcome: 'rolled-back', reason: 'output longer than input' },
      }} />
    );
    expect(screen.getByText('rolled-back')).toBeTruthy();
    expect(screen.getByText(/output longer than input/)).toBeTruthy();
  });
});

describe('TraceEntryRenderer — budget:checked', () => {
  it('reads as OK when the call is within every limit', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'budget:checked',
        panel: 'request',
        details: { model: 'openai/gpt-4o', allowed: true, ms: 2 },
      }} />
    );
    expect(screen.getByText('BUDGET OK')).toBeTruthy();
    expect(screen.getByText('openai/gpt-4o')).toBeTruthy();
  });

  it('lists the violated limits when the call is blocked', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'budget:checked',
        panel: 'request',
        details: {
          model: 'openai/gpt-4o',
          allowed: false,
          violated: [{ metric: 'cost', window: 'day', limit: 5, current: 7.5 }],
        },
      }} />
    );
    expect(screen.getByText('BUDGET BLOCKED')).toBeTruthy();
    expect(screen.getByText('cost')).toBeTruthy();
    expect(screen.getByText('day')).toBeTruthy();
    expect(screen.getByText('7.5 / 5')).toBeTruthy();
  });
});

describe('TraceEntryRenderer — egress:sent', () => {
  it('shows what was written back to the client', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'egress:sent',
        panel: 'response',
        details: { kind: 'completion', protocol: 'openai', status: 200, encoding: 'sse', frames: 42, bytes: 1024 },
      }} />
    );
    expect(screen.getByText('EGRESS SENT')).toBeTruthy();
    expect(screen.getByText('completion')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('shows the error when the client got one', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'egress:sent',
        panel: 'response',
        details: { kind: 'error', status: 502, error: 'upstream unavailable' },
      }} />
    );
    expect(screen.getByText(/upstream unavailable/)).toBeTruthy();
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

// ── ScoreBar (lines 21-27) — string / null / NaN / color paths ───────────────
// ScoreBar is used inside router:recap for f.score/f.weight and p.winner.point
// Rendering via router:recap is the simplest surface that exercises the function.

describe('TraceEntryRenderer — ScoreBar numeric-string input (line 21)', () => {
  it('renders the bar when score is a numeric string (typeof value === string path)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'openai/gpt-4o', score: '0.85' }],
          policies: [],
        },
      }} />
    );
    // parseFloat('0.85') → valid → rendered as fixed(3)
    expect(screen.getByText('0.850')).toBeTruthy();
  });

  it('renders em-dash when score is null (validValue == null path)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'openai/gpt-4o', score: null }],
          policies: [],
        },
      }} />
    );
    // null → validValue null → renders —
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders em-dash when score is NaN string (isNaN guard path)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'openai/gpt-4o', score: 'not-a-number' }],
          policies: [],
        },
      }} />
    );
    // parseFloat('not-a-number') → NaN → validValue null → renders —
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders yellow bar when score is between 0.4 and 0.7 (line 26 yellow branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'model-a', score: 0.55 }],
          policies: [],
        },
      }} />
    );
    expect(screen.getByText('0.550')).toBeTruthy();
  });

  it('renders red bar when score is below 0.4 (line 26 red branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'model-b', score: 0.2 }],
          policies: [],
        },
      }} />
    );
    expect(screen.getByText('0.200')).toBeTruthy();
  });
});

// ── router:recap — empty final / no policies (lines 272-317) ─────────────────

describe('TraceEntryRenderer — router:recap fallback paths', () => {
  it('shows "No ranking data" when final array is empty (line 273-278)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: { final: [], policies: [] },
      }} />
    );
    expect(screen.getByText(/No ranking data/)).toBeTruthy();
  });

  it('shows "No policy data" when policies array is empty (line 315)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: { final: [], policies: [] },
      }} />
    );
    expect(screen.getByText(/No policy data/)).toBeTruthy();
  });

  it('renders policy type labels and winner with ScoreBar (lines 283-296)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'openai/gpt-4o', score: 0.9 }],
          policies: [
            {
              type: 'llm',
              weight: 1.0,
              winner: { model: 'openai/gpt-4o', point: 0.9 },
              scores: [{ model: 'openai/gpt-4o', point: 0.9 }],
            },
          ],
        },
      }} />
    );
    expect(screen.getByText('AI Routing')).toBeTruthy();
    expect(screen.getAllByText(/openai\/gpt-4o/).length).toBeGreaterThan(0);
  });

  it('renders all policy type label translations (rate-limit, budget-remaining, semantic-intent, model-preference)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [],
          policies: [
            { type: 'rate-limit',       weight: 1, scores: [] },
            { type: 'budget-remaining', weight: 1, scores: [] },
            { type: 'semantic-intent',  weight: 1, scores: [] },
            { type: 'model-preference', weight: 1, scores: [] },
            { type: 'custom-policy',    weight: 1, scores: [] },
          ],
        },
      }} />
    );
    expect(screen.getByText('Rate Limit')).toBeTruthy();
    expect(screen.getByText('Budget Remaining')).toBeTruthy();
    expect(screen.getByText('Semantic Intent')).toBeTruthy();
    expect(screen.getByText('Model Preference')).toBeTruthy();
    expect(screen.getByText('custom-policy')).toBeTruthy();
  });

  it('renders "all scores" details when policy has >1 scores (line 298-309)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [{ rank: 1, model: 'a', score: 0.8 }],
          policies: [
            {
              type: 'llm',
              weight: 0.5,
              winner: { model: 'a', point: 0.8 },
              scores: [
                { model: 'a', point: 0.8 },
                { model: 'b', point: 0.3 },
              ],
            },
          ],
        },
      }} />
    );
    expect(screen.getByText('all scores')).toBeTruthy();
  });
});

// ── router:intake — excludedByLimits rendering (lines 233-250) ───────────────

describe('TraceEntryRenderer — router:intake', () => {
  it('renders intake details section', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:intake',
        details: {
          model: 'openai/gpt-4o',
          messageCount: 3,
          projectId: 'proj-1',
          excludedByLimits: [],
        },
      }} />
    );
    expect(screen.getByText('details')).toBeTruthy();
  });

  it('renders EXCLUDED BY LIMITS section when excludedByLimits is non-empty (lines 234-250)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:intake',
        details: {
          model: 'openai/gpt-4o',
          messageCount: 1,
          projectId: 'proj-1',
          excludedByLimits: [
            {
              model: 'anthropic/claude-3',
              violated: [
                { metric: 'rpm', window: '1m', current: 60, limit: 60 },
              ],
            },
          ],
        },
      }} />
    );
    expect(screen.getByText(/EXCLUDED BY LIMITS/)).toBeTruthy();
    expect(screen.getByText('anthropic/claude-3')).toBeTruthy();
    expect(screen.getByText('rpm')).toBeTruthy();
    expect(screen.getByText('60 / 60')).toBeTruthy();
  });

  it('renders excluded model with empty violated array (exc.violated?.length falsy path)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:intake',
        details: {
          model: 'openai/gpt-4o',
          messageCount: 1,
          projectId: 'proj-1',
          excludedByLimits: [
            { model: 'anthropic/claude-3', violated: [] },
          ],
        },
      }} />
    );
    expect(screen.getByText('anthropic/claude-3')).toBeTruthy();
  });
});

// ── Remaining entry types — model:prompt, model:thinking, model:request, fallback pre ──

describe('TraceEntryRenderer — other entry types', () => {
  it('renders model:prompt with summary truncation at 100 chars', () => {
    const longPrompt = 'A'.repeat(120);
    render(
      <TraceEntryRenderer entry={{
        message: 'model:prompt',
        details: { modelId: 'openai/gpt-4o', prompt: longPrompt },
      }} />
    );
    // summary shows first 100 chars + ellipsis
    expect(screen.getByText(new RegExp(`${'A'.repeat(100)}…`))).toBeTruthy();
  });

  it('renders model:prompt without ellipsis when prompt <= 100 chars', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:prompt',
        details: { modelId: 'openai/gpt-4o', prompt: 'short prompt' },
      }} />
    );
    // appears in both <summary> and <pre> — just confirm at least one exists
    expect(screen.getAllByText('short prompt').length).toBeGreaterThan(0);
  });

  it('renders model:thinking with summary truncation at 80 chars', () => {
    const longText = 'B'.repeat(100);
    render(
      <TraceEntryRenderer entry={{
        message: 'model:thinking',
        details: { text: longText },
      }} />
    );
    expect(screen.getByText(new RegExp(`${'B'.repeat(80)}…`))).toBeTruthy();
  });

  it('renders model:thinking without ellipsis when text <= 80 chars', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:thinking',
        details: { text: 'short thinking' },
      }} />
    );
    // appears in both <summary> and <pre> — just confirm at least one exists
    expect(screen.getAllByText('short thinking').length).toBeGreaterThan(0);
  });

  it('renders model:request with technical details', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:request',
        details: { model: 'openai/gpt-4o', temperature: 0 },
      }} />
    );
    expect(screen.getByText('model:request')).toBeTruthy();
    expect(screen.getByText('technical details')).toBeTruthy();
  });

  it('renders model:success with systemPrompt and responseText', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:success',
        details: {
          inputTokens: 10,
          systemPrompt: 'Be helpful.',
          responseText: 'Hello!',
          responseJSON: { id: 'chatcmpl-1' },
        },
      }} />
    );
    expect(screen.getByText('system prompt')).toBeTruthy();
    expect(screen.getByText('Be helpful.')).toBeTruthy();
    expect(screen.getByText('response text')).toBeTruthy();
    expect(screen.getByText('Hello!')).toBeTruthy();
    expect(screen.getByText('response JSON')).toBeTruthy();
  });

  it('renders prompts and answers from the gated content field', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:success',
        details: { inputTokens: 10 },
        content: { systemPrompt: 'Be helpful.', responseText: 'Hello!', responseJSON: { id: 'chatcmpl-1' } },
      }} />
    );
    expect(screen.getByText('Be helpful.')).toBeTruthy();
    expect(screen.getByText('Hello!')).toBeTruthy();
    expect(screen.getByText('response JSON')).toBeTruthy();
  });

  it('renders model:thinking text from the content field', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:thinking',
        details: { modelId: 'gpt-4o' },
        content: { text: 'let me think' },
      }} />
    );
    expect(screen.getAllByText('let me think').length).toBeGreaterThan(0);
  });

  it('renders fallback pre block for unknown message types', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'unknown:event',
        details: { foo: 'bar' },
      }} />
    );
    expect(screen.getByText('unknown:event')).toBeTruthy();
    expect(screen.getByText('raw details')).toBeTruthy();
  });

  it('renders cache:embedding with fallback badge when fallback=true', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:embedding',
        details: {
          modelId: 'text-embedding-3-small',
          upstreamModelId: 'openai/gpt-4o',
          provider: 'openai',
          source: 'request',
          endpoint: 'https://api.openai.com/v1',
          fallback: true,
          attempt: 2,
        },
      }} />
    );
    expect(screen.getByText(/CACHE EMBEDDING CALL/)).toBeTruthy();
    expect(screen.getByText(/fallback #2/)).toBeTruthy();
  });

  it('renders cache:hit with TTL-extended badge when ttlExtended=true', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:hit',
        details: {
          modelId: 'openai/gpt-4o',
          similarity: 0.95,
          embeddingModel: 'text-embedding-3-small',
          ttlExtended: true,
        },
      }} />
    );
    expect(screen.getByText(/CACHE HIT/)).toBeTruthy();
    expect(screen.getByText(/TTL extended/)).toBeTruthy();
    expect(screen.getByText('text-embedding-3-small')).toBeTruthy();
  });

  it('renders cache:miss with embedding model when present', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:miss',
        details: { embeddingModel: 'text-embedding-3-small' },
      }} />
    );
    expect(screen.getByText(/CACHE MISS/)).toBeTruthy();
    expect(screen.getByText('text-embedding-3-small')).toBeTruthy();
  });

  it('renders cache:miss without embedding model (embeddingModel falsy branch)', () => {
    const { container } = render(
      <TraceEntryRenderer entry={{
        message: 'cache:miss',
        details: {},
      }} />
    );
    expect(screen.getByText(/CACHE MISS/)).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('renders cache:hit without embeddingModel (embeddingModel falsy branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:hit',
        details: { modelId: 'openai/gpt-4o', similarity: 0.9, ttlExtended: false },
      }} />
    );
    expect(screen.getByText(/CACHE HIT/)).toBeTruthy();
    // no TTL extended badge
    expect(screen.queryByText(/TTL extended/)).toBeNull();
  });

  it('renders cache:embedding without fallback badge when fallback=false (fallback falsy branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:embedding',
        details: {
          modelId: 'text-embedding-3-small',
          upstreamModelId: 'openai/gpt-4o',
          provider: 'openai',
          source: 'request',
          endpoint: 'https://api.openai.com/v1',
          fallback: false,
        },
      }} />
    );
    expect(screen.getByText(/CACHE EMBEDDING CALL/)).toBeTruthy();
    // No "fallback #N" badge span (only rawDetails may mention "fallback" as JSON key)
    expect(screen.queryByText(/fallback #/)).toBeNull();
  });

  it('renders cache:embedding with missing fields showing — fallbacks (line 167-183 ?? branches)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:embedding',
        details: {},
      }} />
    );
    expect(screen.getByText(/CACHE EMBEDDING CALL/)).toBeTruthy();
    // All ?? '—' fallbacks fire when fields are absent
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders cache:hit with missing modelId showing — fallback (line 200 ?? branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:hit',
        details: { similarity: 0.5 },
      }} />
    );
    expect(screen.getByText(/CACHE HIT/)).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders model:success without systemPrompt/responseText/responseJSON (null branches)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:success',
        details: { inputTokens: 5 },
      }} />
    );
    expect(screen.getByText('model:success')).toBeTruthy();
    expect(screen.getByText('technical details')).toBeTruthy();
    expect(screen.queryByText('system prompt')).toBeNull();
    expect(screen.queryByText('response text')).toBeNull();
    expect(screen.queryByText('response JSON')).toBeNull();
  });

  it('renders model:prompt with null prompt (line 93/96 ?? branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:prompt',
        details: { modelId: 'openai/gpt-4o', prompt: null },
      }} />
    );
    expect(screen.getByText('model:prompt')).toBeTruthy();
  });

  it('renders model:thinking with null text (line 103/107 ?? branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:thinking',
        details: { text: null },
      }} />
    );
    expect(screen.getByText('model:thinking')).toBeTruthy();
  });

  it('renders entry with null details (line 57 ?? branch)', () => {
    const { container } = render(
      <TraceEntryRenderer entry={{
        message: 'unknown:event',
        details: null,
      }} />
    );
    expect(container).toBeTruthy();
  });

  it('renders model:request without systemPrompt/responseText (rawDetails shows)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:request',
        details: { model: 'gpt-4', temperature: 1, extra: 'data' },
      }} />
    );
    expect(screen.getByText('technical details')).toBeTruthy();
  });

  it('renders model:error with red preStyle border and color (lines 53/62/65 isError branches)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'model:error',
        details: { error: 'timeout', code: 500 },
      }} />
    );
    expect(screen.getByText('model:error')).toBeTruthy();
    // preStyle isError → red border rendered (visual only, just verify no crash)
    expect(screen.getByText('raw details')).toBeTruthy();
  });

  it('renders cache:embedding with attempt absent (line 160 attempt ?? — branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'cache:embedding',
        details: { fallback: true }, // attempt absent → '—'
      }} />
    );
    expect(screen.getByText(/CACHE EMBEDDING CALL/)).toBeTruthy();
    expect(screen.getByText(/fallback #—/)).toBeTruthy();
  });

  it('renders router:intake with excludedByLimits absent (line 233 ?? branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:intake',
        details: { model: 'gpt-4', messageCount: 1, projectId: 'p1' },
      }} />
    );
    // excludedByLimits absent → ?? [] → length 0 → no EXCLUDED section
    expect(screen.queryByText(/EXCLUDED BY LIMITS/)).toBeNull();
  });

  it('renders router:intake with excluded model without violated field (line 240 ?? branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:intake',
        details: {
          model: 'gpt-4', messageCount: 1, projectId: 'p1',
          excludedByLimits: [{ model: 'anthropic/claude-3' }], // violated absent
        },
      }} />
    );
    expect(screen.getByText('anthropic/claude-3')).toBeTruthy();
  });

  it('renders router:recap with rank > 1 entries (line 264/265 rank !== 1 branches)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [
            { rank: 1, model: 'model-a', score: 0.9 },
            { rank: 2, model: 'model-b', score: 0.5 },
          ],
          policies: [],
        },
      }} />
    );
    expect(screen.getByText('#2')).toBeTruthy();
  });

  it('renders router:recap with policies absent (line 282 policies ?? [] branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: { final: [] }, // policies absent → ?? []
      }} />
    );
    expect(screen.getByText(/No policy data/)).toBeTruthy();
  });

  it('renders router:recap winner with score (not point) fallback (line 295 point ?? score)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [],
          policies: [{
            type: 'llm', weight: 1.0,
            winner: { model: 'model-a', score: 0.8 }, // point absent → use score
            scores: [],
          }],
        },
      }} />
    );
    expect(screen.getByText('AI Routing')).toBeTruthy();
  });

  it('renders router:recap all-scores with score fallback (line 305 s.point ?? s.score)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'router:recap',
        details: {
          final: [],
          policies: [{
            type: 'llm', weight: 1.0,
            winner: { model: 'a', score: 0.9 },
            scores: [
              { model: 'a', score: 0.9 },   // point absent → use score
              { model: 'b', score: 0.4 },
            ],
          }],
        },
      }} />
    );
    expect(screen.getByText('all scores')).toBeTruthy();
  });

  it('renders guardrail:triggered with missing target (line 330 target ?? — branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'regex:x', block: false, log: false },
        // target absent → ?? '—'
      }} />
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders guardrail:triggered with missing rule (line 336 rule ?? — branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { target: 'request' }, // rule absent → ?? '—'
      }} />
    );
    // '—' appears for both target span text fallback and rule value
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders guardrail:triggered with no block/log showing — action (line 340 && branches)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { target: 'request', rule: 'r', block: false, log: false },
      }} />
    );
    // [false && 'block', false && 'log'].filter(Boolean) → [] → '—'
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders guardrail:triggered without blockMessage (line 353 blockMessage falsy branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'guardrail:triggered',
        panel: 'request',
        details: { rule: 'r', target: 'request', block: true },
        // blockMessage absent → && false → no italic block
      }} />
    );
    expect(screen.getByText(/REQUEST GUARDRAIL BLOCKED/)).toBeTruthy();
  });

  it('renders pii:scrubbed with empty entities array (line 413 && false branch)', () => {
    render(
      <TraceEntryRenderer entry={{
        message: 'pii:scrubbed',
        panel: 'request',
        details: { entities: [] },
      }} />
    );
    expect(screen.getByText('PII SCRUBBED')).toBeTruthy();
    // entities empty → Array.isArray true && length 0 → && false → no badges
    expect(screen.queryByText('EMAIL')).toBeNull();
  });
});
