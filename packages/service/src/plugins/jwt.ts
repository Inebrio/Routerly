import { randomBytes, createHmac } from 'node:crypto';
import { getOrCreateSecret } from '../config/loader.js';

let _secret: string | undefined;

/** Must be called at server startup before any token operations. */
export async function loadSecret(): Promise<void> {
  _secret = await getOrCreateSecret();
}

function getSecret(): string {
  if (!_secret) throw new Error('JWT secret not initialised — call loadSecret() at startup');
  return _secret;
}

/** Create a simple signed token: base64(payload).signature */
export function signToken(payload: Record<string, unknown>): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Verify and parse a token. Returns null if invalid/expired. */
export function verifyToken(token: string): Record<string, unknown> | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as Record<string, unknown>;
    if (typeof payload['exp'] === 'number' && payload['exp'] < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Generate a token expiring in `hours` hours */
export function createSessionToken(userId: string, role: string, hours = 1): string {
  return signToken({ sub: userId, role, exp: Date.now() + hours * 3600_000 });
}

/** Generate a random hex token (for project tokens, not JWT) */
export function generateRawToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
