import type { PiiConfig, PiiEntity } from '@routerly/shared';

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
  { entity: 'PHONE', re: /\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, placeholder: '[PHONE_NUMBER]' },
];

/**
 * Replaces PII entities in `text` with typed placeholders (#76).
 *
 * @param entities Entity types to scrub (e.g. ['EMAIL','PHONE']).
 * @returns the scrubbed text and the distinct entity types that were found.
 */
export function scrubPii(
  text: string,
  entities: string[],
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

  return { text: result, found: [...found] };
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
  config: PiiConfig,
): { messages: unknown[]; redacted: string[] } {
  const entities = config.entities ?? ALL_ENTITIES;
  const redacted = new Set<string>();

  const scrubbed = messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== 'string') return message;

    const { text, found } = scrubPii(content, entities);
    if (found.length === 0) return message;
    found.forEach((entity) => redacted.add(entity));
    return { ...(message as object), content: text };
  });

  return { messages: scrubbed, redacted: [...redacted] };
}
