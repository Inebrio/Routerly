import { describe, it, expect } from 'vitest';
import { generateTotpSecret, getTotpCode, verifyTotp, generateBackupCodes } from './totp.js';

describe('generateTotpSecret', () => {
  it('returns a base32 string of length >= 32', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
  });

  it('returns a different secret each time', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('getTotpCode', () => {
  const SECRET = 'JBSWY3DPEHPK3PXP'; // well-known test vector

  it('returns a 6-digit string', () => {
    const code = getTotpCode(SECRET);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('is deterministic for the same time step', () => {
    const t = 1_700_000_000_000;
    expect(getTotpCode(SECRET, t)).toBe(getTotpCode(SECRET, t));
  });

  it('differs across time steps', () => {
    const t = 1_700_000_000_000;
    expect(getTotpCode(SECRET, t)).not.toBe(getTotpCode(SECRET, t + 30_000));
  });
});

describe('verifyTotp', () => {
  const SECRET = generateTotpSecret();

  it('accepts a valid code for current time', () => {
    const code = getTotpCode(SECRET, Date.now());
    expect(verifyTotp(SECRET, code)).toBe(true);
  });

  it('accepts code from -1 step (clock skew)', () => {
    const code = getTotpCode(SECRET, Date.now() - 30_000);
    expect(verifyTotp(SECRET, code)).toBe(true);
  });

  it('accepts code from +1 step (clock skew)', () => {
    const code = getTotpCode(SECRET, Date.now() + 30_000);
    expect(verifyTotp(SECRET, code)).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(verifyTotp(SECRET, '000000')).toBe(false);
  });

  it('rejects an expired code (t-2 window)', () => {
    const code = getTotpCode(SECRET, Date.now() - 60_000);
    expect(verifyTotp(SECRET, code)).toBe(false);
  });
});

describe('generateBackupCodes', () => {
  it('returns 8 codes by default', () => {
    const { plain, hashed } = generateBackupCodes();
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
  });

  it('plain codes are uppercase hex strings', () => {
    const { plain } = generateBackupCodes();
    for (const code of plain) {
      expect(code).toMatch(/^[0-9A-F]{8}$/);
    }
  });

  it('hashed codes are sha-256 hex strings', () => {
    const { hashed } = generateBackupCodes();
    for (const h of hashed) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('hashed codes differ from plain codes', () => {
    const { plain, hashed } = generateBackupCodes();
    for (let i = 0; i < plain.length; i++) {
      expect(hashed[i]).not.toBe(plain[i]);
    }
  });
});

import { hashBackupCode } from './totp.js';

describe('hashBackupCode', () => {
  it('returns a 64-char hex sha-256 hash and is case-insensitive', () => {
    const hash = hashBackupCode('abcd1234');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashBackupCode('ABCD1234'));
  });
});

describe('getTotpCode — base32 invalid char skip (line 12)', () => {
  it('ignores invalid base32 chars and still returns a 6-digit code', () => {
    // '!' is not in B32_ALPHABET → idx === -1 → continue (line 12 true branch)
    const secretWithInvalid = 'JBSWY3DP!EHPK3PXP';
    const code = getTotpCode(secretWithInvalid);
    expect(code).toMatch(/^\d{6}$/);
  });
});
