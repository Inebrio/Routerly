import type { Metric } from './metrics-snapshot.js';

// Prometheus remote_write 1.0: snappy-block-compressed protobuf WriteRequest.
// Hand-encoded to avoid a dependency; the schema is tiny and frozen.

function varint(n: number | bigint): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
  out.push(Number(v));
  return out;
}

function field(num: number, payload: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(varint((num << 3) | 2)), Buffer.from(varint(payload.length)), payload]);
}

function encodeSeries(labels: Record<string, string>, value: number, tsMs: number): Buffer {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => field(1, Buffer.concat([field(1, Buffer.from(k)), field(2, Buffer.from(v))])));
  const sample = Buffer.alloc(9);
  sample[0] = 0x09; // field 1, fixed64 (double)
  sample.writeDoubleLE(value, 1);
  const ts = Buffer.concat([sample, Buffer.from([0x10, ...varint(tsMs)])]); // field 2, varint
  parts.push(field(2, ts));
  return field(1, Buffer.concat(parts));
}

/** Snappy block format using literal elements only (valid for any decoder, no compression). */
export function snappyLiteral(data: Uint8Array): Buffer {
  const out: Buffer[] = [Buffer.from(varint(data.length))];
  for (let i = 0; i < data.length; i += 65536) {
    const chunk = data.subarray(i, i + 65536);
    const n = chunk.length - 1;
    out.push(Buffer.from(n < 60 ? [n << 2] : [61 << 2, n & 0xff, n >> 8]), Buffer.from(chunk));
  }
  return Buffer.concat(out);
}

export function encodeRemoteWrite(metrics: Metric[], tsMs = Date.now()): Buffer {
  const series: Buffer[] = [];
  for (const m of metrics) {
    for (const s of m.samples) series.push(encodeSeries({ ...s.labels, __name__: m.name }, s.value, tsMs));
  }
  return snappyLiteral(Buffer.concat(series));
}

export function remoteWriteHeaders(username: string, apiKey: string): Record<string, string> {
  return {
    'Authorization': `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
    'Content-Type': 'application/x-protobuf',
    'Content-Encoding': 'snappy',
    'X-Prometheus-Remote-Write-Version': '0.1.0',
  };
}
