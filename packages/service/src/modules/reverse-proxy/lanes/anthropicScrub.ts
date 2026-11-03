import { Transform } from 'node:stream';
import { StreamingScrubber, scrubText, type EffectivePii } from '../../pii/piiScrubber.js';
import type { TraceEntry } from '@routerly/shared';

/**
 * Output-PII scrub for the verbatim Anthropic pass-through. Only text is touched:
 * `text` blocks of a JSON body, `text_delta` events of an SSE stream. Every other
 * byte of the provider response is forwarded as received.
 */
export function createAnthropicScrubTransform(
  contentType: string | null,
  effective: EffectivePii,
  emit?: (entry: TraceEntry) => void,
): Transform {
  const sse = (contentType ?? '').toLowerCase().includes('text/event-stream');
  const found = new Set<string>();
  const counts: Record<string, number> = {};
  const note = (f: string[], c: Record<string, number>): void => {
    f.forEach((e) => found.add(e));
    for (const [k, n] of Object.entries(c)) counts[k] = (counts[k] ?? 0) + n;
  };
  const report = (mode: 'json' | 'stream'): void => {
    const redacted = [...found];
    emit?.({
      panel: 'response', message: 'pii:evaluated',
      details: { target: 'response', mode, entities: effective.entities ?? [], customPatterns: effective.customPatterns?.length ?? 0, redacted, counts },
    });
    if (redacted.length > 0) emit?.({ panel: 'response', message: 'pii:scrubbed', details: { entities: redacted, counts } });
  };

  let pending = ''; // JSON: whole body; SSE: incomplete trailing event
  const scrubbers = new Map<number, StreamingScrubber>();
  const sseEvent = (raw: string, out: string[]): void => {
    const lines = raw.split('\n');
    const di = lines.findIndex((l) => l.startsWith('data:'));
    if (di < 0) { out.push(raw); return; }
    let data: { type?: string; index?: number; delta?: { type?: string; text?: string } };
    try { data = JSON.parse(lines[di]!.slice(5)); } catch { out.push(raw); return; }
    const idx = data.index ?? 0;
    const fmt = (d: unknown): string => [...lines.slice(0, di), `data: ${JSON.stringify(d)}`, ...lines.slice(di + 1)].join('\n');
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') {
      let s = scrubbers.get(idx);
      if (!s) scrubbers.set(idx, (s = new StreamingScrubber(effective)));
      out.push(fmt({ ...data, delta: { ...data.delta, text: s.push(data.delta.text) } }));
      return;
    }
    if (data.type === 'content_block_stop' && scrubbers.has(idx)) {
      const s = scrubbers.get(idx)!;
      const tail = s.flush();
      scrubbers.delete(idx);
      note([...s.found], s.counts);
      if (tail) out.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: tail } })}`);
    }
    out.push(raw);
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      pending += chunk.toString('utf8');
      if (!sse) return cb();
      const parts = pending.split('\n\n');
      pending = parts.pop() ?? '';
      const out: string[] = [];
      for (const p of parts) sseEvent(p, out);
      cb(null, out.length ? out.join('\n\n') + '\n\n' : undefined);
    },
    flush(cb) {
      if (sse) {
        const out: string[] = [];
        if (pending) sseEvent(pending, out);
        for (const [idx, s] of scrubbers) {
          const tail = s.flush(); // stream cut before content_block_stop: release the held tail
          note([...s.found], s.counts);
          if (tail) out.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: tail } })}`);
        }
        report('stream');
        return cb(null, out.length ? out.join('\n\n') : undefined);
      }
      try {
        const body = JSON.parse(pending) as { content?: Array<{ type?: string; text?: unknown }> };
        for (const b of Array.isArray(body.content) ? body.content : []) {
          if (b?.type !== 'text' || typeof b.text !== 'string') continue;
          const r = scrubText(b.text, effective);
          if (r.found.length > 0) { b.text = r.text; note(r.found, r.counts); }
        }
        report('json');
        cb(null, found.size > 0 ? JSON.stringify(body) : pending);
      } catch {
        cb(null, pending); // not JSON (e.g. upstream error page): forward as is
      }
    },
  });
}
