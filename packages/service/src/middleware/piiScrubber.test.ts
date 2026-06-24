import { describe, it, expect } from 'vitest';
import { scrubPii, scrubMessages } from './piiScrubber.js';
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
  const cfg: PiiConfig = { enabled: true };

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
    const { messages: out, redacted } = scrubMessages(messages, { enabled: true, entities: ['SSN'] });
    expect((out[0] as any).content).toBe('a@b.com [SSN]');
    expect(redacted).toEqual(['SSN']);
  });

  it('returns no redactions for clean messages', () => {
    const messages = [{ role: 'user', content: 'hello world' }];
    const { redacted } = scrubMessages(messages, cfg);
    expect(redacted).toEqual([]);
  });
});
