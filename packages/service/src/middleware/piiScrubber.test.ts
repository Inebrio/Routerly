import { describe, it, expect } from 'vitest';
import { scrubPii, scrubMessages, StreamingScrubber } from './piiScrubber.js';
import type { PiiConfig } from '@routerly/shared';

const ALL = ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'];

describe('scrubPii — single entity types', () => {
  it('redacts EMAIL', () => {
    const { text, found } = scrubPii('contact me at john.doe+spam@example.com please', ['EMAIL']);
    expect(text).toBe('contact me at [EMAIL] please');
    expect(found).toEqual(['EMAIL']);
  });

  it('redacts PHONE', () => {
    const { text, found } = scrubPii('call +1 415-555-1234 now', ['PHONE']);
    expect(text).toContain('[PHONE_NUMBER]');
    expect(found).toEqual(['PHONE']);
  });

  // BUG-3: international prefix + open paren must be fully masked, not left as "+1 (".
  it.each([
    ['+1 (415) 555-2671', 'call +1 (415) 555-2671 today'],
    ['+44 20 7946 0958', 'ring +44 20 7946 0958 please'],
    ['415 555 2671', 'dial 415 555 2671 now'],
  ])('fully redacts international/spaced phone %s', (_num, sentence) => {
    const { text, found } = scrubPii(sentence, ['PHONE']);
    expect(text).toContain('[PHONE_NUMBER]');
    expect(text).not.toMatch(/\d{3}/); // no digit run left in clear
    expect(text).not.toContain('+1 (');
    expect(found).toEqual(['PHONE']);
  });

  it('does not eat digits inside an IBAN when scrubbing PHONE only', () => {
    const { text, found } = scrubPii('iban DE89370400440532013000 ok', ['PHONE']);
    expect(text).toBe('iban DE89370400440532013000 ok');
    expect(found).toEqual([]);
  });

  it('redacts CREDIT_CARD', () => {
    const { text, found } = scrubPii('card 4111 1111 1111 1111', ['CREDIT_CARD']);
    expect(text).toBe('card [CREDIT_CARD]');
    expect(found).toEqual(['CREDIT_CARD']);
  });

  it('redacts SSN', () => {
    const { text, found } = scrubPii('ssn 123-45-6789', ['SSN']);
    expect(text).toBe('ssn [SSN]');
    expect(found).toEqual(['SSN']);
  });

  it('redacts IBAN', () => {
    const { text, found } = scrubPii('iban DE89370400440532013000.', ['IBAN']);
    expect(text).toBe('iban [IBAN].');
    expect(found).toEqual(['IBAN']);
  });
});

describe('scrubPii — selection and combinations', () => {
  it('only redacts requested entities', () => {
    const { text, found } = scrubPii('mail a@b.co ssn 123-45-6789', ['EMAIL']);
    expect(text).toBe('mail [EMAIL] ssn 123-45-6789');
    expect(found).toEqual(['EMAIL']);
  });

  it('redacts multiple entity types in one string', () => {
    const { text, found } = scrubPii('email a@b.com and ssn 123-45-6789', ALL);
    expect(text).toBe('email [EMAIL] and ssn [SSN]');
    expect(found.sort()).toEqual(['EMAIL', 'SSN']);
  });

  it('reports each entity type once even with multiple matches', () => {
    const { found } = scrubPii('a@b.com c@d.com', ['EMAIL']);
    expect(found).toEqual(['EMAIL']);
  });

  it('returns text unchanged and no findings when no PII present', () => {
    const { text, found } = scrubPii('just a normal sentence', ALL);
    expect(text).toBe('just a normal sentence');
    expect(found).toEqual([]);
  });
});

describe('scrubMessages', () => {
  const cfg: PiiConfig = {};

  it('scrubs string content across messages and aggregates redacted entities', () => {
    const messages = [
      { role: 'user', content: 'my email is a@b.com' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'my ssn is 123-45-6789' },
    ];
    const { messages: out, redacted } = scrubMessages(messages, cfg);
    expect((out[0] as any).content).toBe('my email is [EMAIL]');
    expect((out[2] as any).content).toBe('my ssn is [SSN]');
    expect(redacted.sort()).toEqual(['EMAIL', 'SSN']);
  });

  it('leaves array (multimodal) content untouched', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'a@b.com' }] }];
    const { messages: out, redacted } = scrubMessages(messages, cfg);
    expect(out[0]).toBe(messages[0]);
    expect(redacted).toEqual([]);
  });

  it('respects the entities filter', () => {
    const messages = [{ role: 'user', content: 'a@b.com 123-45-6789' }];
    const { messages: out, redacted } = scrubMessages(messages, { entities: ['SSN'] });
    expect((out[0] as any).content).toBe('a@b.com [SSN]');
    expect(redacted).toEqual(['SSN']);
  });

  it('returns no redactions for clean messages', () => {
    const messages = [{ role: 'user', content: 'hello world' }];
    const { redacted } = scrubMessages(messages, cfg);
    expect(redacted).toEqual([]);
  });

  it('applies customPatterns via scrubMessages', () => {
    const messages = [{ role: 'user', content: 'my token is tok-abc123' }];
    const { messages: out, redacted } = scrubMessages(messages, {
      customPatterns: ['tok-[a-z0-9]+'],
    });
    expect((out[0] as any).content).toBe('my token is [REDACTED]');
    expect(redacted).toContain('CUSTOM');
  });
});

describe('StreamingScrubber', () => {
  const cfg = (outputBufferSize?: number): import('@routerly/shared').PiiConfig =>
    ({ ...(outputBufferSize !== undefined ? { outputBufferSize } : {}) });

  it('catches a pattern wholly within one chunk', () => {
    const s = new StreamingScrubber(cfg(30));
    // push a short chunk — under N, so nothing emitted yet
    s.push('contact ');
    const out = s.push('a@b.com end');
    // flush emits the buffer
    const remaining = s.flush();
    expect((out + remaining)).toContain('[EMAIL]');
    expect((out + remaining)).not.toContain('a@b.com');
  });

  it('catches a pattern split across two pushes with N=30', () => {
    const s = new StreamingScrubber(cfg(30));
    // Split "mario@example.com" across two pushes, both halves < 30 chars
    s.push('contact mario@exa');
    const out2 = s.push('mple.com today');
    const remaining = s.flush();
    const full = out2 + remaining;
    expect(full).toContain('[EMAIL]');
    expect(full).not.toContain('mario@example.com');
  });

  it('documents expected miss: pattern split with first half > N chars', () => {
    // ponytail: known ceiling — if the first half of a PII token is longer than N,
    // it will be emitted before the second half arrives. Increase outputBufferSize to fix.
    const s = new StreamingScrubber(cfg(5)); // tiny buffer
    const out1 = s.push('mario@example.c'); // 15 chars > 5 → emits 10 chars un-scrubbed
    s.push('om');
    const remaining = s.flush();
    // The address is split at the N boundary so it won't be caught — this is documented behavior
    const full = out1 + remaining;
    // We just assert no crash and that output is a string
    expect(typeof full).toBe('string');
  });

  it('flush() scrubs and returns remaining buffer', () => {
    const s = new StreamingScrubber(cfg(30));
    s.push('hello ');
    // buffer is 6 chars < 30, nothing emitted
    const remaining = s.flush();
    expect(remaining).toBe('hello ');
  });

  it('empty push returns empty string', () => {
    const s = new StreamingScrubber(cfg(30));
    expect(s.push('')).toBe('');
  });

  it('flush() on fresh scrubber returns empty string', () => {
    const s = new StreamingScrubber(cfg(30));
    expect(s.flush()).toBe('');
  });

  it('resets buffer after flush', () => {
    const s = new StreamingScrubber(cfg(30));
    s.push('some text');
    s.flush();
    expect(s.flush()).toBe('');
  });
});

describe('piiScrubber — policy merging', () => {
  it('merges entities from enabled policies for input direction', () => {
    const messages = [{ role: 'user', content: 'ssn 123-45-6789 card 4111 1111 1111 1111' }];
    const config: PiiConfig = {
      // base: no scrubInput, no entities
      policies: [
        { name: 'strict', scrubInput: true, entities: ['SSN'] },
        { name: 'financial', scrubInput: true, entities: ['CREDIT_CARD'] },
      ],
    };
    const { messages: out, redacted } = scrubMessages(messages, config);
    expect((out[0] as any).content).toBe('ssn [SSN] card [CREDIT_CARD]');
    expect(redacted.sort()).toEqual(['CREDIT_CARD', 'SSN']);
  });

  it('skips disabled policies', () => {
    const messages = [{ role: 'user', content: 'ssn 123-45-6789 mail a@b.com' }];
    const config: PiiConfig = {
      policies: [
        { name: 'active', scrubInput: true, entities: ['SSN'] },
        { name: 'off', enabled: false, scrubInput: true, entities: ['EMAIL'] },
      ],
    };
    const { messages: out, redacted } = scrubMessages(messages, config);
    expect((out[0] as any).content).toBe('ssn [SSN] mail a@b.com');
    expect(redacted).toEqual(['SSN']);
  });

  it('does not merge output-only policy into input scrubbing', () => {
    const messages = [{ role: 'user', content: 'ssn 123-45-6789' }];
    const config: PiiConfig = {
      policies: [
        { name: 'output-only', scrubInput: false, scrubOutput: true, entities: ['SSN'] },
      ],
    };
    const { messages: out, redacted } = scrubMessages(messages, config);
    // policy only applies to output, so input is untouched
    expect((out[0] as any).content).toBe('ssn 123-45-6789');
    expect(redacted).toEqual([]);
  });
});

describe('scrubPii — customPatterns', () => {
  it('applies a custom regex and adds CUSTOM to found', () => {
    const { text, found } = scrubPii('my token is tok-abc123', [], ['tok-[a-z0-9]+']);
    expect(text).toBe('my token is [REDACTED]');
    expect(found).toContain('CUSTOM');
  });

  it('silently skips an invalid regex pattern', () => {
    expect(() =>
      scrubPii('hello world', [], ['[invalid('])
    ).not.toThrow();
    const { text } = scrubPii('hello world', [], ['[invalid(']);
    expect(text).toBe('hello world');
  });

  it('reports CUSTOM once for multiple matches of a single pattern', () => {
    const { found } = scrubPii('tok-aaa tok-bbb', [], ['tok-[a-z]+']);
    expect(found.filter((f) => f === 'CUSTOM')).toHaveLength(1);
  });

  it('runs custom patterns after built-in entities', () => {
    const { text, found } = scrubPii('a@b.com and tok-xyz', ['EMAIL'], ['tok-[a-z]+']);
    expect(text).toBe('[EMAIL] and [REDACTED]');
    expect(found.sort()).toEqual(['CUSTOM', 'EMAIL']);
  });
});

// ─── scrubMessages edge cases (line 151 branch=0, line 34 ?? ALL_ENTITIES) ────

describe('scrubMessages edge cases', () => {
  it('passes through null/non-object messages unchanged (line 151 branch=0)', () => {
    const config: PiiConfig = { entities: ['EMAIL'] };
    // Messages array contains null and a string → non-objects pass through
    const msgs: any[] = [null, 'string-message', { role: 'user', content: 'contact a@b.com' }];
    const { messages, redacted } = scrubMessages(msgs, config);
    expect(messages[0]).toBeNull();
    expect(messages[1]).toBe('string-message');
    expect(redacted).toContain('EMAIL');
  });

  it('uses ALL_ENTITIES when policy has no entities field (line 34 p.entities ?? ALL_ENTITIES)', () => {
    const config: PiiConfig = {
      scrubInput: true,
      policies: [
        { name: 'no-entities-policy', scrubInput: true }  // no entities field
      ],
    } as any;
    // Policy without entities → falls back to ALL_ENTITIES in loop
    const msgs = [{ role: 'user', content: 'call me at john@example.com or 555-1234' }];
    const { redacted } = scrubMessages(msgs, config);
    // Should redact EMAIL at minimum (ALL_ENTITIES includes EMAIL)
    expect(redacted.length).toBeGreaterThan(0);
  });
});
