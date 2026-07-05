import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const _dir = dirname(fileURLToPath(import.meta.url));

// Never let a missing/malformed package.json crash the service at startup.
let pkgVersion = 'unknown';
try {
  const raw = JSON.parse(readFileSync(join(_dir, '../package.json'), 'utf-8')) as { version?: string };
  if (raw.version) pkgVersion = raw.version;
} catch { /* fallback to 'unknown' */ }

export const TELEMETRY_ENDPOINT = 'https://telemetry.routerly.ai/ping';

export type TelemetryEvent = 'install' | 'upgrade' | 'uninstall';

export async function pingTelemetry(installId: string, event: TelemetryEvent): Promise<boolean> {
  // ponytail: env guard prevents accidental real pings in test environments
  if (process.env['ROUTERLY_TELEMETRY_DISABLED']) return false;
  try {
    const payload = {
      event,
      version: pkgVersion,
      platform: process.platform,
      installId,
    };

    const res = await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    console.log(`[telemetry] ${event} sent → ${res.status}`);
    return res.ok;
  } catch (err) {
    console.log(`[telemetry] ${event} failed → ${(err as Error).message}`);
    return false;
  }
}
