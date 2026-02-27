import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Returns the 32-byte encryption key derived from the environment variable.
 * Throws if the env var is not set.
 */
function getKey(): Buffer {
  const raw = process.env['LOCALROUTER_SECRET_KEY'];
  if (!raw) {
    throw new Error(
      'LOCALROUTER_SECRET_KEY environment variable is not set. ' +
      'Set it to a 32-character base64-encoded secret to enable credential encryption.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `LOCALROUTER_SECRET_KEY must decode to exactly ${KEY_LENGTH} bytes (256-bit). ` +
      `Got ${key.length} bytes. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv):base64(authTag):base64(ciphertext)
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Decrypts a string previously encrypted by `encrypt()`.
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format. Expected iv:authTag:ciphertext');
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encryptedData = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generates a random base64-encoded key suitable for LOCALROUTER_SECRET_KEY.
 */
export function generateKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64');
}
