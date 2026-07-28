import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getOrCreateSecret } from '../modules/config/loader.js';

/**
 * Encrypts OAuth credentials (access/refresh tokens) at rest, using a key
 * derived from the server's signing secret via HKDF. The `info` string below
 * domain-separates this key from the JWT-signing use of the same root secret
 * (see modules/auth/jwt.ts).
 */
const HKDF_INFO = 'routerly-credential-encryption';

let _key: Buffer | undefined;

/** Must be called at server startup, alongside loadSecret(), before any credential encrypt/decrypt. */
export async function loadCredentialKey(): Promise<void> {
  const secretHex = await getOrCreateSecret();
  _key = Buffer.from(hkdfSync('sha256', Buffer.from(secretHex, 'hex'), Buffer.alloc(0), HKDF_INFO, 32));
}

function getKey(): Buffer {
  if (!_key) throw new Error('Credential encryption key not initialised — call loadCredentialKey() at startup');
  return _key;
}

/** Encrypts a plaintext credential with aes-256-gcm. Returns base64(iv|tag|ciphertext). */
export function encryptCredential(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypts a credential produced by encryptCredential. Throws if the payload was tampered with. */
export function decryptCredential(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
