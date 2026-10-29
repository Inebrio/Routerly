import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createAnthropicScrubTransform } from './anthropicScrub.js';

const effective = { entities: ['PHONE' as const] };
const run = async (ct: string, parts: string[]): Promise<string> => {
  const out: Buffer[] = [];
  for await (const c of Readable.from(parts.map((p) => Buffer.from(p))).pipe(createAnthropicScrubTransform(ct, effective))) out.push(c as Buffer);
  return Buffer.concat(out).toString();
};
const ev = (type: string, d: object): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`;

describe('createAnthropicScrubTransform', () => {
  it('masks phone in a non-stream JSON body, other fields untouched', async () => {
    const body = { id: 'msg_1', content: [{ type: 'text', text: 'call +39 333 123 4567 please' }], usage: { input_tokens: 1 } };
    const res = JSON.parse(await run('application/json', [JSON.stringify(body).slice(0, 20), JSON.stringify(body).slice(20)]));
    expect(res.content[0].text).toBe('call [PHONE_NUMBER] please');
    expect(res.id).toBe('msg_1');
    expect(res.usage).toEqual({ input_tokens: 1 });
  });

  it('masks phone split across SSE text_delta events and flushes the tail before content_block_stop', async () => {
    const text = (t: string): string => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } });
    const sse = ev('message_start', { message: { id: 'm' } }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + text('call me on +39 333 ') + text('123 4567') + ev('content_block_stop', { index: 0 }) + ev('message_stop', {});
    const out = await run('text/event-stream', [sse.slice(0, 77), sse.slice(77)]);
    const texts = [...out.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]).join('');
    expect(texts).toBe('call me on [PHONE_NUMBER]');
    expect(out).not.toContain('4567');
    expect(out.indexOf('content_block_stop')).toBeGreaterThan(out.lastIndexOf('text_delta'));
    expect(out).toContain('message_stop');
  });
});
