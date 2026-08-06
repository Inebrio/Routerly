import { createHmac, createHash, randomBytes } from 'node:crypto';

// ─── Base32 ───────────────────────────────────────────────────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue; // skip invalid chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; output.push((value >> bits) & 0xff); }
  }
  return Buffer.from(output);
}

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, output = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += B32_ALPHABET[(value >> bits) & 31]; }
  }
  return output;
}

// ─── TOTP (RFC 6238) ──────────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function getTotpCode(secret: string, time = Date.now()): string {
  const counter = Math.floor(time / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** Accepts ±1 step window (90 s tolerance) to handle clock skew. */
export function verifyTotp(secret: string, token: string): boolean {
  const now = Date.now();
  return [-1, 0, 1].some(d => getTotpCode(secret, now + d * 30_000) === token);
}

// ─── Backup codes ─────────────────────────────────────────────────────────────

export function generateBackupCodes(n = 8): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: n }, () =>
    randomBytes(4).toString('hex').toUpperCase()
  );
  const hashed = plain.map(c => createHash('sha256').update(c).digest('hex'));
  return { plain, hashed };
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
}
