import { createHash } from 'node:crypto';
import type { ExperimentConfig, ExperimentVariant } from '@routerly/shared';
import { variantShares } from '@routerly/shared';

/**
 * Everything the rotation is allowed to look at (T71). All of it is either
 * already in the connection or already in the payload the client sent: no
 * header selects a variant, and nothing is added to the request.
 */
export interface RotationInput {
  /** The standard `user` field, when the client sends one. Same field End Users reads. */
  endUserId?: string;
  /** System prompt plus first user message, flattened to text. Stable across the turns of one conversation. */
  conversationPrefix?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Sticky assignments and the round-robin cursor live in memory only, like the
 * optimizer traffic samples: a restart re-splits the traffic, which costs a
 * little balance and no correctness. Persisting them would mean a write per
 * request on the hot path.
 */
const stickyAssignments = new Map<string, string>();
const roundRobinCursors = new Map<string, number>();

/** Cap on remembered sticky callers, oldest evicted first (Map preserves insertion order). */
const STICKY_LIMIT = 10_000;

/** Test seam: drops all in-memory rotation state. */
export function resetRotationState(): void {
  stickyAssignments.clear();
  roundRobinCursors.clear();
}

/**
 * The identity the `sticky` rotation keys on, or null when this request carries
 * nothing stable enough to key on (and so falls back to a random pick).
 *
 * `auto` prefers the client's own `user` field and otherwise combines the
 * conversation prefix with the caller's IP and user agent: the prefix alone
 * would put two different users asking the same first question on the same
 * variant, and IP plus user agent alone would pin a whole office to one arm.
 */
export function stickyKeyFor(experiment: ExperimentConfig, input: RotationInput): string | null {
  const mode = experiment.stickyKey ?? 'auto';
  const client = [input.ip, input.userAgent].filter(Boolean).join('|') || null;

  let raw: string | null;
  switch (mode) {
    case 'end-user': raw = input.endUserId ?? null; break;
    case 'conversation': raw = input.conversationPrefix ?? null; break;
    case 'client': raw = client; break;
    case 'auto':
      raw = input.endUserId
        ?? (input.conversationPrefix ? [input.conversationPrefix, client].filter(Boolean).join('|') : client);
      break;
  }
  if (!raw) return null;
  return createHash('sha256').update(`${mode}:${raw}`).digest('hex').slice(0, 32);
}

/**
 * Pick the variant this request runs on. Returns null only when the experiment
 * declares no variant at all: every strategy always resolves to one otherwise.
 */
export function pickVariant(experiment: ExperimentConfig, input: RotationInput): ExperimentVariant | null {
  const variants = experiment.variants;
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0]!;

  switch (experiment.rotation) {
    case 'round-robin': {
      const cursor = roundRobinCursors.get(experiment.id) ?? 0;
      roundRobinCursors.set(experiment.id, cursor + 1);
      return variants[cursor % variants.length]!;
    }
    case 'weighted':
      return weightedPick(variants);
    case 'sticky': {
      const key = stickyKeyFor(experiment, input);
      // Nothing stable to key on: still serve the request, on a random variant.
      if (!key) return weightedPick(variants);
      const mapKey = `${experiment.id}:${key}`;
      const assigned = stickyAssignments.get(mapKey);
      const known = assigned ? variants.find(v => v.id === assigned) : undefined;
      // A remembered variant that has since been removed from the experiment
      // must not pin the caller to nothing: re-draw and remember the new one.
      if (known) return known;
      const picked = weightedPick(variants);
      if (stickyAssignments.size >= STICKY_LIMIT) {
        const oldest = stickyAssignments.keys().next().value;
        if (oldest !== undefined) stickyAssignments.delete(oldest);
      }
      stickyAssignments.set(mapKey, picked.id);
      return picked;
    }
  }
}

function weightedPick(variants: ExperimentVariant[]): ExperimentVariant {
  const shares = variantShares(variants);
  let roll = Math.random();
  for (let i = 0; i < variants.length; i++) {
    roll -= shares[i]!;
    if (roll <= 0) return variants[i]!;
  }
  return variants[variants.length - 1]!;
}

/**
 * The stable part of a conversation, for sticky keying: the system prompt plus
 * the first user message, which do not change as turns are appended. Reads both
 * wire formats (OpenAI `messages`, Anthropic `system` + `messages`) without
 * altering the body.
 */
export function conversationPrefix(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { system?: unknown; messages?: unknown };
  const parts: string[] = [];

  const system = flattenContent(b.system);
  if (system) parts.push(system);

  if (Array.isArray(b.messages)) {
    for (const m of b.messages) {
      if (!m || typeof m !== 'object') continue;
      const role = (m as { role?: unknown }).role;
      const text = flattenContent((m as { content?: unknown }).content);
      if (!text) continue;
      if (role === 'system' && parts.length === 0) parts.push(text);
      if (role === 'user') { parts.push(text); break; }
    }
  }

  const joined = parts.join('\n').trim();
  return joined ? joined.slice(0, 2000) : undefined;
}

/** Content can be a string, an array of parts, or absent, in both protocols. */
function flattenContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .map(part => (part && typeof part === 'object' ? (part as { text?: unknown }).text : undefined))
    .filter((t): t is string => typeof t === 'string');
  const joined = texts.join(' ').trim();
  return joined || undefined;
}
