import { Transform } from 'node:stream';

export interface TappedUsage {
  /** Total input tokens, cache reads and writes included (same convention as the SDK adapters). */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  /** Assistant text seen in the response; only collected when the tap is asked to (trace content capture). */
  text?: string;
}

type RawUsage = Record<string, unknown> | undefined;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Fold one Anthropic `usage` object into the running totals; later values win. */
function merge(acc: Record<string, number>, u: RawUsage): void {
  if (!u) return;
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    const v = num(u[k]);
    if (v !== undefined) acc[k] = v;
  }
}

function collect(acc: Record<string, number>, json: unknown): void {
  if (!json || typeof json !== 'object') return;
  const o = json as { usage?: RawUsage; message?: { usage?: RawUsage } };
  merge(acc, o.usage); // non-stream body and message_delta
  merge(acc, o.message?.usage); // message_start
}

function toUsage(acc: Record<string, number>): TappedUsage {
  const cached = acc['cache_read_input_tokens'] ?? 0;
  const created = acc['cache_creation_input_tokens'] ?? 0;
  return {
    inputTokens: (acc['input_tokens'] ?? 0) + cached + created,
    outputTokens: acc['output_tokens'] ?? 0,
    cachedInputTokens: cached,
    cacheCreationInputTokens: created,
  };
}

/**
 * Pass-through Transform: every chunk is forwarded untouched, while a side copy
 * is parsed for the Anthropic `usage` block (SSE `message_start`/`message_delta`
 * or a plain JSON body). `onDone` fires exactly once, when the stream ends or
 * is torn down, with whatever usage was seen. Parse errors are swallowed: the
 * client's bytes are never affected.
 */
export function createUsageTap(contentType: string | null, onDone: (u: TappedUsage) => void, captureText = false): Transform {
  const sse = (contentType ?? '').toLowerCase().includes('text/event-stream');
  const acc: Record<string, number> = {};
  let text = '';
  const gather = (json: unknown): void => {
    const o = json as { delta?: { type?: string; text?: unknown }; content?: Array<{ type?: string; text?: unknown }> } | null;
    if (typeof o?.delta?.text === 'string' && o.delta.type === 'text_delta') text += o.delta.text;
    for (const b of Array.isArray(o?.content) ? o.content : []) if (b?.type === 'text' && typeof b.text === 'string') text += b.text;
  };
  let pending = ''; // SSE: incomplete trailing line; JSON: whole body. ponytail: JSON body buffered whole, fine for non-stream responses.
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    if (!sse && pending) {
      try { const j = JSON.parse(pending); collect(acc, j); if (captureText) gather(j); } catch { /* not JSON */ }
    }
    onDone({ ...toUsage(acc), ...(captureText && text ? { text } : {}) });
  };
  const eat = (line: string): void => {
    const wanted = line.includes('"usage"') || (captureText && line.includes('"text_delta"'));
    if (!line.startsWith('data:') || !wanted) return;
    try { const j = JSON.parse(line.slice(5)); collect(acc, j); if (captureText) gather(j); } catch { /* ignore */ }
  };
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        pending += chunk.toString('utf8');
        if (sse) {
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const l of lines) eat(l);
        }
      } catch { /* never break the stream */ }
      cb(null, chunk);
    },
    flush(cb) {
      if (sse) { eat(pending); pending = ''; }
      finish();
      cb();
    },
  });
  t.on('close', finish);
  return t;
}
