import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@routerly/shared';

/**
 * Word-level diff of two prompts (T63). Optimizers report how many tokens they
 * removed, which says nothing about *what* they removed: tuning a threshold
 * means reading the text that disappeared.
 */

export type DiffKind = 'same' | 'removed' | 'added';
export interface DiffPart {
  kind: DiffKind;
  text: string;
}

/**
 * Words of a prompt that stay in the middle after the common head and tail are
 * trimmed. Beyond this the quadratic pass is skipped and the changed region is
 * reported as one removal plus one addition.
 *
 * ponytail: no Myers diff. Optimizers cut contiguous blocks, so head/tail
 * trimming already resolves the common case; swap in a real diff only if a
 * prompt shape shows up that this renders uselessly.
 */
const MAX_DIFF_WORDS = 600;

/** Plain text of a message, joining the text parts of a structured content array. */
export function messageText(m: Message): string {
  if (typeof m.content === 'string') return m.content;
  if (!Array.isArray(m.content)) return '';
  return m.content
    .map(part => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .filter(Boolean)
    .join('\n');
}

/** A whole prompt as one diffable block, one paragraph per message. */
export function promptText(messages: Message[]): string {
  return messages.map(m => `${m.role}: ${messageText(m)}`).join('\n\n');
}

/** Words and the whitespace between them, so joining the pieces restores the text. */
function tokenize(text: string): string[] {
  return text.length === 0 ? [] : text.split(/(\s+)/).filter(t => t !== '');
}

/** Longest-common-subsequence diff of two token arrays. */
function lcsDiff(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(parts, 'same', a[i]!); i++; j++; }
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) { push(parts, 'removed', a[i]!); i++; }
    else { push(parts, 'added', b[j]!); j++; }
  }
  while (i < n) push(parts, 'removed', a[i++]!);
  while (j < m) push(parts, 'added', b[j++]!);
  return parts;
}

/** Append text to the trailing part when it has the same kind, so runs stay whole. */
function push(parts: DiffPart[], kind: DiffKind, text: string): void {
  if (text === '') return;
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

/** Diff two texts by word, as a flat list of runs in output order. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const parts: DiffPart[] = [];
  push(parts, 'same', a.slice(0, head).join(''));
  if (midA.length > MAX_DIFF_WORDS || midB.length > MAX_DIFF_WORDS) {
    push(parts, 'removed', midA.join(''));
    push(parts, 'added', midB.join(''));
  } else {
    for (const part of lcsDiff(midA, midB)) push(parts, part.kind, part.text);
  }
  push(parts, 'same', a.slice(a.length - tail).join(''));
  return parts;
}

const PART_STYLE: Record<DiffKind, CSSProperties> = {
  same: {},
  removed: { background: 'rgba(239, 68, 68, 0.18)', color: 'var(--danger)', textDecoration: 'line-through' },
  added: { background: 'rgba(34, 197, 94, 0.18)', color: 'var(--success)' },
};

interface TextDiffProps {
  before: string;
  after: string;
  /** Shown in place of the diff when the two texts are identical. */
  emptyLabel?: string;
}

/** Renders a word diff inline: removals struck through, additions highlighted. */
export function TextDiff({ before, after, emptyLabel = 'This step left the prompt unchanged.' }: TextDiffProps) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const changed = parts.some(p => p.kind !== 'same');

  if (!changed) {
    return (
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{emptyLabel}</p>
    );
  }

  return (
    <pre
      style={{
        margin: 0, padding: 12, maxHeight: 320, overflow: 'auto',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
        fontSize: '0.76rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {parts.map((p, i) => (
        <span key={i} style={PART_STYLE[p.kind]}>{p.text}</span>
      ))}
    </pre>
  );
}
