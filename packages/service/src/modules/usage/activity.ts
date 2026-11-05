import { readFile, appendFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { ActivityRecord, UsageRetentionConfig } from '@routerly/shared';
import { CONFIG_PATHS } from '../../lib/paths.js';
import { ensureFileExists, LOCK_RETRIES } from '../config/usageNdjson.js';

// Activity log (ROUT-563): what Usage does not hold — MCP tool calls and non-model
// proxy routes. Same lock / append / retention discipline as usageNdjson.ts, on its
// own file so Usage totals never see these events. Arguments, bodies and query
// strings are never recorded.

let tmpCounter = 0;

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Appends one event. `timestamp` is when the call ended, like a usage record's. */
export async function appendActivity(event: Omit<ActivityRecord, 'id' | 'timestamp'>): Promise<void> {
  const record: ActivityRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  };
  const filePath = CONFIG_PATHS.activity;
  await ensureFileExists(filePath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: LOCK_RETRIES });
    await appendFile(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } finally {
    if (release) await release();
  }
}

/** Reads every event. A malformed trailing line (interrupted write) is dropped; any other is corruption. */
export async function readActivity(): Promise<ActivityRecord[]> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATHS.activity, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const records: ActivityRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]!) as ActivityRecord);
    } catch (err) {
      if (i === lines.length - 1) break;
      throw new Error(`activity.ndjson is corrupted at line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return records;
}

/** Age- and/or size-based sweep under one lock, same policy as applyUsageRetention. Returns events removed. */
export async function applyActivityRetention(policy: UsageRetentionConfig): Promise<number> {
  if (!policy.maxAgeDays && !policy.maxSizeMb) return 0;
  const filePath = CONFIG_PATHS.activity;
  await ensureFileExists(filePath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, { retries: LOCK_RETRIES });
    const records = await readActivity();
    let kept = records;
    if (policy.maxAgeDays) {
      const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
      kept = kept.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
    }
    if (policy.maxSizeMb) {
      const maxBytes = policy.maxSizeMb * 1024 * 1024;
      let totalBytes = kept.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r), 'utf-8') + 1, 0);
      let start = 0;
      while (totalBytes > maxBytes && start < kept.length) {
        totalBytes -= Buffer.byteLength(JSON.stringify(kept[start]!), 'utf-8') + 1;
        start++;
      }
      kept = kept.slice(start);
    }
    const removed = records.length - kept.length;
    if (removed > 0) {
      const tmpPath = `${filePath}.tmp-${process.pid}-${tmpCounter++}`;
      try {
        await writeFile(tmpPath, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), { encoding: 'utf-8', mode: 0o600 });
        await rename(tmpPath, filePath);
      } catch (err) {
        await unlink(tmpPath).catch(() => {});
        throw err;
      }
    }
    return removed;
  } finally {
    if (release) await release();
  }
}
