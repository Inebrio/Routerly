import { readFile, writeFile, appendFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { UsageRecord, UsageRetentionConfig } from '@routerly/shared';
import { CONFIG_PATHS } from '../../lib/paths.js';

// Same retry budget as writeConfig()'s lock in loader.ts — this file shares
// the lock with that discipline: append and full-rewrite callers serialize
// through the same proper-lockfile lock on usage.ndjson, so a sweep never
// loses a concurrently-queued append (and vice versa).
const LOCK_RETRIES = { retries: 10, minTimeout: 50, maxTimeout: 500 };

let tmpCounter = 0;

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Creates the target file if missing, WITHOUT reading or altering any
 * existing content. proper-lockfile's lock() resolves the target with
 * fs.realpath, which requires the path to already exist — this is the
 * append path's only filesystem touch besides the lock + appendFile itself.
 */
async function ensureFileExists(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, '', { flag: 'a' });
}

/**
 * Reads every usage record from the NDJSON file, one JSON object per line.
 *
 * A malformed *trailing* line — the only line a mid-write crash can leave
 * partial, since appends are lock-serialized one write at a time (EC3) — is
 * dropped with a warning instead of failing the read. A malformed line
 * anywhere else is real corruption and throws (do not generalize the
 * trailing-line tolerance to "catch any parse error").
 */
export async function readUsageNdjson(): Promise<UsageRecord[]> {
  const filePath = CONFIG_PATHS.usage;
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const records: UsageRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      records.push(JSON.parse(line) as UsageRecord);
    } catch (err) {
      if (i === lines.length - 1) {
        // eslint-disable-next-line no-console
        console.warn(`[usage] dropped malformed trailing line in usage.ndjson (likely an interrupted write): ${line.slice(0, 200)}`);
        break;
      }
      throw new Error(`usage.ndjson is corrupted at line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return records;
}

/**
 * Temp file + rename publish, WITHOUT acquiring the lock itself — callers
 * that already hold the lock (applyUsageRetention's locked read-modify-write)
 * call this directly; writeUsageNdjson (below) wraps it with its own lock for
 * every other caller.
 */
async function publishUsageNdjson(filePath: string, records: UsageRecord[]): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    const content = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Full atomic rewrite of the usage history — temp file + rename, the same
 * publish pattern writeConfig() uses for every other config key. O(n): only
 * for the occasional full-rewrite callers (pruneOrphanUsage, the retention
 * sweep), never the per-request append path.
 */
export async function writeUsageNdjson(records: UsageRecord[]): Promise<void> {
  const filePath = CONFIG_PATHS.usage;
  await ensureFileExists(filePath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: LOCK_RETRIES });
    await publishUsageNdjson(filePath, records);
  } finally {
    if (release) await release();
  }
}

/**
 * Appends without ever reading or parsing the file's existing content — the
 * whole point of the NDJSON switch (AC2): each write's cost does not grow
 * with the total history size.
 */
export async function appendUsageRecordsNdjson(records: UsageRecord[]): Promise<void> {
  if (records.length === 0) return;
  const filePath = CONFIG_PATHS.usage;
  await ensureFileExists(filePath);
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: LOCK_RETRIES });
    await appendFile(filePath, lines, 'utf-8');
  } finally {
    if (release) await release();
  }
}

/**
 * Age- and/or size-based retention sweep (AC3). Drops the oldest records
 * first when trimming by size. Runs off the request hot path only (from
 * usageModule's start()/interval) — applying this per-append would
 * reintroduce the O(n)-per-write cost the NDJSON switch removes.
 *
 * The read and the conditional write both happen under ONE lock acquisition
 * (not read-then-separately-lock-to-write): appendUsageRecordsNdjson takes
 * the same lock, so without this an append landing between this function's
 * read and its write would be silently overwritten away by a rewrite based
 * on stale data — the exact race the blueprint calls out for this task.
 *
 * Returns the number of records removed.
 */
export async function applyUsageRetention(policy: UsageRetentionConfig): Promise<number> {
  if (!policy.maxAgeDays && !policy.maxSizeMb) return 0;
  const filePath = CONFIG_PATHS.usage;
  await ensureFileExists(filePath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: LOCK_RETRIES });
    const records = await readUsageNdjson();
    let kept = records;

    if (policy.maxAgeDays) {
      const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
      kept = kept.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
    }

    if (policy.maxSizeMb) {
      const maxBytes = policy.maxSizeMb * 1024 * 1024;
      // Records are appended in chronological order, so the oldest are at the
      // front — trim from there until the remaining set fits the budget.
      let totalBytes = kept.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r), 'utf-8') + 1, 0);
      let start = 0;
      while (totalBytes > maxBytes && start < kept.length) {
        totalBytes -= Buffer.byteLength(JSON.stringify(kept[start]!), 'utf-8') + 1;
        start++;
      }
      kept = kept.slice(start);
    }

    const removed = records.length - kept.length;
    if (removed > 0) await publishUsageNdjson(filePath, kept);
    return removed;
  } finally {
    if (release) await release();
  }
}
