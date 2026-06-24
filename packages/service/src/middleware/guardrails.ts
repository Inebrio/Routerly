import type { GuardrailConfig } from '@routerly/shared';

/** Built-in prompt-injection detection patterns (#77). */
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-instructions', re: /ignore\s+(previous|above|prior)\s+instructions?/i },
  { name: 'you-are-now', re: /you\s+are\s+now\s+/i },
  { name: 'disregard', re: /disregard\s+(your|all)\s+/i },
  { name: 'dan-mode', re: /DAN\s+mode/i },
  { name: 'jailbreak', re: /jailbreak/i },
];

/** Extracts the string content of a message, ignoring array (multimodal) content. */
function messageText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

/**
 * Checks each message's string content against the project's input blocklist
 * regexes and the built-in prompt-injection patterns (#77).
 *
 * Returns the name of the first rule that triggered, or null when clean.
 * Array (multimodal) message content is skipped.
 */
export function checkGuardrails(
  messages: unknown[],
  config: GuardrailConfig,
): { triggered: string } | null {
  const detectInjection = config.detectPromptInjection !== false;

  // Compile blocklist patterns once; skip invalid regexes rather than throwing.
  const blocklist = (config.inputBlocklist ?? [])
    .map((pattern) => {
      try {
        return { pattern, re: new RegExp(pattern, 'i') };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { pattern: string; re: RegExp } => entry !== null);

  for (const message of messages) {
    const text = messageText(message);
    if (text === null) continue;

    for (const entry of blocklist) {
      if (entry.re.test(text)) return { triggered: `blocklist:${entry.pattern}` };
    }

    if (detectInjection) {
      for (const { name, re } of INJECTION_PATTERNS) {
        if (re.test(text)) return { triggered: `injection:${name}` };
      }
    }
  }

  return null;
}
