// Minimal .env loader — reads .env from the package root at startup (dev only).
// In production, set env vars directly in the process environment.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Try multiple locations for the .env file
const envCandidates = [
  resolve(__dir, '../.env'),           // packages/service/.env
  resolve(__dir, '../../.env'),        // monorepo root .env
  resolve(__dir, '../../../.env'),     // fallback
];

function loadEnv(envPath: string): void {
  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // File not readable (EPERM, ENOENT, etc.) — silently skip
  }
}

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    loadEnv(candidate);
    break;
  }
}
