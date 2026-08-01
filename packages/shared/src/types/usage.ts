/**
 * Request types for usage records (T60).
 *
 * `callType` says who made the call (the client, the router, a guardrail).
 * `requestType` says what was asked for, derived from the path the client hit,
 * so a usage record can be read without opening its trace.
 */

export const REQUEST_TYPES = ['chat', 'completion', 'embedding', 'rerank', 'image', 'audio'] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

/**
 * The request type a path stands for, or `undefined` when the path is not a
 * model API call. Order matters: `/chat/completions` is chat, plain
 * `/completions` is the legacy text-completion API.
 *
 * Matching is on the path suffix rather than the full route because the same
 * endpoints are reached both directly (`/v1/embeddings`) and through the
 * pass-through proxy, which forwards whatever prefix the client used.
 */
export function requestTypeFromPath(path: string): RequestType | undefined {
  const clean = (path.split('?')[0] ?? '').toLowerCase();
  if (clean.includes('/chat/completions')) return 'chat';
  if (clean.includes('/responses')) return 'chat';
  if (clean.includes('/messages')) return 'chat';
  if (clean.includes('/completions')) return 'completion';
  if (clean.includes('/embeddings')) return 'embedding';
  if (clean.includes('/rerank')) return 'rerank';
  if (clean.includes('/images')) return 'image';
  if (clean.includes('/audio')) return 'audio';
  return undefined;
}

/**
 * Display label for a request type, for tables and filter buttons.
 *
 * `completion` reads as "Text Completion" so it never collides with the
 * `callType` label "completion", which means something else entirely (the
 * client's own call, as opposed to an internal routing or guardrail call).
 */
const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  chat: 'Chat',
  completion: 'Text Completion',
  embedding: 'Embedding',
  rerank: 'Rerank',
  image: 'Image',
  audio: 'Audio',
};

export function requestTypeLabel(type: RequestType): string {
  return REQUEST_TYPE_LABELS[type];
}
