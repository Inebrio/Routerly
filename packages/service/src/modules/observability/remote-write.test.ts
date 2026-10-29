import { describe, it, expect } from 'vitest';
import { encodeRemoteWrite, snappyLiteral } from './remote-write.js';

// Minimal snappy decoder for literal elements (all we emit).
function unsnappy(b: Buffer): Buffer {
  let i = 0, len = 0, shift = 0;
  for (;; i++) { len |= (b[i]! & 0x7f) << shift; shift += 7; if (!(b[i]! & 0x80)) { i++; break; } }
  const out: Buffer[] = [];
  while (i < b.length) {
    const tag = b[i++]!;
    expect(tag & 3).toBe(0);
    let n = tag >> 2;
    if (n >= 60) { const bytes = n - 59; n = 0; for (let k = 0; k < bytes; k++) n |= b[i++]! << (8 * k); }
    n += 1;
    out.push(b.subarray(i, i + n)); i += n;
  }
  const r = Buffer.concat(out);
  expect(r.length).toBe(len);
  return r;
}

describe('remote_write encoding', () => {
  it('round-trips large payloads through snappy literals', () => {
    const data = Buffer.alloc(70000, 7);
    expect(unsnappy(snappyLiteral(data)).equals(data)).toBe(true);
  });

  it('encodes a WriteRequest with sorted labels and a double sample', () => {
    const raw = unsnappy(encodeRemoteWrite([{ name: 'm', help: '', type: 'gauge', samples: [{ labels: { b: 'y', a: 'x' }, value: 1.5 }] }], 1000));
    const s = raw.toString('latin1');
    expect(s.indexOf('__name__')).toBeLessThan(s.indexOf('a'.repeat(1) + '\x12\x01x'));
    expect(raw.readDoubleLE(raw.indexOf(0x09, raw.length - 12) + 1)).toBe(1.5);
    expect(raw[0]).toBe(0x0a); // WriteRequest.timeseries
  });
});
