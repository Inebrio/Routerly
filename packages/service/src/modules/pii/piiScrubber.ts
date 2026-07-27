import type { PiiEntity, PiiPolicy } from '@routerly/shared';

/** Detector for one PII entity type (#76). */
interface Detector {
  entity: PiiEntity;
  re: RegExp;
  placeholder: string;
}

const ALL_ENTITIES: PiiEntity[] = ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'];

// Order matters: more specific / longer patterns first so that, e.g., a
// credit-card number is not partially eaten by the phone matcher.
const DETECTORS: Detector[] = [
  { entity: 'CREDIT_CARD', re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, placeholder: '[CREDIT_CARD]' },
  { entity: 'IBAN', re: /\b[A-Z]{2}\d{2}[\sA-Z0-9]{11,30}\b/g, placeholder: '[IBAN]' },
  { entity: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, placeholder: '[EMAIL]' },
  { entity: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g, placeholder: '[SSN]' },
  // Two alternatives: international (+CC then 2-4 digit groups, captures the "+1 (" prefix
  // a leading \b would miss) | bare US-style 3-3-4. Lookbehind/ahead keep it from
  // eating digits inside longer alphanumeric tokens (e.g. IBANs).
  { entity: 'PHONE', re: /(?<![\w])\+\d{1,3}[\s.-]?\(?\d{2,4}\)?(?:[\s.-]?\d{2,4}){2,4}|(?<![\w+])\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/g, placeholder: '[PHONE_NUMBER]' },
];

/**
 * Effective PII config derived from merging one or more policies for a direction.
 * Passed to scrubText / scrubMessages / StreamingScrubber instead of the raw PiiConfig.
 */
export interface EffectivePii {
  entities?: PiiEntity[];
  customPatterns?: string[];
  outputBufferSize?: number;
}

/**
 * Merges enabled policies for the given direction into a flat EffectivePii.
 * A policy is included when enabled!==false AND target matches direction:
 *   input  => target 'request' or 'both'
 *   output => target 'response' or 'both'
 * outputBufferSize = max across matched policies (default 30 when none specify).
 */
export function mergePolicies(policies: PiiPolicy[], direction: 'input' | 'output'): EffectivePii {
  const entitySet = new Set<PiiEntity>();
  const patternSet = new Set<string>();
  let bufferSize: number | undefined;

  for (const p of policies) {
    if (p.enabled === false) continue;
    const matches = direction === 'input'
      ? (p.target === 'request' || p.target === 'both')
      : (p.target === 'response' || p.target === 'both');
    if (!matches) continue;
    for (const e of (p.entities ?? ALL_ENTITIES)) entitySet.add(e);
    for (const pat of (p.customPatterns ?? [])) patternSet.add(pat);
    if (p.outputBufferSize !== undefined) {
      bufferSize = bufferSize === undefined ? p.outputBufferSize : Math.max(bufferSize, p.outputBufferSize);
    }
  }

  const result: EffectivePii = {
    entities: [...entitySet],
    customPatterns: [...patternSet],
  };
  if (bufferSize !== undefined) result.outputBufferSize = bufferSize;
  return result;
}

/**
 * Replaces PII entities in `text` with typed placeholders (#76).
 *
 * @param entities Entity types to scrub (e.g. ['EMAIL','PHONE']).
 * @returns the scrubbed text and the distinct entity types that were found.
 */
export function scrubPii(
  text: string,
  entities: string[],
  customPatterns?: string[],
): { text: string; found: string[] } {
  const active = new Set(entities);
  const found = new Set<string>();
  let result = text;

  for (const detector of DETECTORS) {
    if (!active.has(detector.entity)) continue;
    result = result.replace(detector.re, () => {
      found.add(detector.entity);
      return detector.placeholder;
    });
  }

  for (const pattern of (customPatterns ?? [])) {
    try {
      const re = new RegExp(pattern, 'gi');
      const before = result;
      result = result.replace(re, '[REDACTED]');
      if (result !== before) found.add('CUSTOM');
    } catch { /* skip invalid regex */ }
  }

  return { text: result, found: [...found] };
}

/**
 * Scrubs PII from a single string using the effective config (output direction).
 */
export function scrubText(text: string, effective: EffectivePii): { text: string; found: string[] } {
  const entities = effective.entities !== undefined ? effective.entities : ALL_ENTITIES;
  const patterns = effective.customPatterns ?? [];
  return scrubPii(text, entities, patterns);
}

/**
 * Streaming PII scrubber using suffix buffering.
 *
 * Holds back the last N chars of accumulated text so that patterns split
 * across chunk boundaries are caught. Call push() per chunk, flush() at
 * stream end. N=30 covers most emails, phone numbers, and short IBANs.
 */
export class StreamingScrubber {
  private buffer = '';
  private readonly n: number;
  private readonly effective: EffectivePii;
  /** Distinct entity types redacted across all chunks — for the response trace (#76). */
  readonly found = new Set<string>();

  constructor(effective: EffectivePii) {
    this.n = effective.outputBufferSize ?? 30;
    this.effective = effective;
  }

  /** Push a new text chunk. Returns the portion safe to emit (scrubbed). */
  push(text: string): string {
    this.buffer += text;
    if (this.buffer.length <= this.n) return '';
    // Cut at last whitespace so PII tokens (emails, phone numbers) are never split mid-token.
    const lastSpace = Math.max(
      this.buffer.lastIndexOf(' '),
      this.buffer.lastIndexOf('\n'),
      this.buffer.lastIndexOf('\t'),
    );
    if (lastSpace <= 0) return '';
    const safe = this.buffer.slice(0, lastSpace + 1);
    this.buffer = this.buffer.slice(lastSpace + 1);
    const { text: scrubbed, found } = scrubText(safe, this.effective);
    found.forEach((e) => this.found.add(e));
    return scrubbed;
  }

  /** Call at stream end. Scrubs and returns the remaining buffer. */
  flush(): string {
    const { text: result, found } = scrubText(this.buffer, this.effective);
    found.forEach((e) => this.found.add(e));
    this.buffer = '';
    return result;
  }
}

/**
 * Applies PII scrubbing to every message's string content (#76).
 * Array (multimodal) message content is left untouched.
 *
 * @returns the scrubbed messages array and the distinct entity types redacted
 *          across all messages.
 */
export function scrubMessages(
  messages: unknown[],
  effective: EffectivePii,
): { messages: unknown[]; redacted: string[] } {
  const entities = effective.entities !== undefined ? effective.entities : ALL_ENTITIES;
  const patterns = effective.customPatterns ?? [];
  const redacted = new Set<string>();

  const scrubbed = messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== 'string') return message;

    const { text, found } = scrubPii(content, entities, patterns);
    if (found.length === 0) return message;
    found.forEach((entity) => redacted.add(entity));
    return { ...(message as object), content: text };
  });

  return { messages: scrubbed, redacted: [...redacted] };
}
