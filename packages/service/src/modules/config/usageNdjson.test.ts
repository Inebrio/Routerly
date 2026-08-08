import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsageRecord } from '@routerly/shared';

// Real filesystem, real proper-lockfile, real atomic rename — no full mock of
// node:fs/promises. readFile/appendFile are wrapped with vi.fn() around the
// real implementation (ESM module namespaces are not configurable, so a
// plain vi.spyOn on the import fails — wrapping at mock-factory time is the
// only way to keep call-count assertions while still hitting real disk I/O).
// Only CONFIG_PATHS is redirected into a throwaway temp directory per test,
// via a mutable holder the mock factory reads from (vi.mock is hoisted, so
// the holder itself must be created with vi.hoisted).
const pathState = vi.hoisted(() => ({ usage: '' }));
vi.mock('../../lib/paths.js', () => ({ CONFIG_PATHS: pathState }));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: vi.fn(actual.readFile), appendFile: vi.fn(actual.appendFile) };
});

const { readUsageNdjson, writeUsageNdjson, appendUsageRecordsNdjson, applyUsageRetention } = await import('./usageNdjson.js');

function makeRecord(id: string, at: number = Date.now()): UsageRecord {
  return {
    id,
    timestamp: new Date(at).toISOString(),
    routerId: 'p1',
    modelId: 'm1',
    inputTokens: 10,
    outputTokens: 20,
    cost: 0.001,
    latencyMs: 100,
    outcome: 'success',
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'usage-ndjson-'));
  pathState.usage = join(dir, 'usage.ndjson');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('read/write/append round-trip', () => {
  it('reads an empty array when the file does not exist yet', async () => {
    expect(await readUsageNdjson()).toEqual([]);
  });

  it('round-trips append then read, and full write then read', async () => {
    const r1 = makeRecord('u1');
    await appendUsageRecordsNdjson([r1]);
    expect(await readUsageNdjson()).toEqual([r1]);

    const r2 = makeRecord('u2');
    await appendUsageRecordsNdjson([r2]);
    expect(await readUsageNdjson()).toEqual([r1, r2]);

    await writeUsageNdjson([r2]);
    expect(await readUsageNdjson()).toEqual([r2]);
  });

  it('appendUsageRecordsNdjson([]) is a no-op', async () => {
    await appendUsageRecordsNdjson([]);
    expect(await readUsageNdjson()).toEqual([]);
  });
});

describe('malformed-line tolerance (EC3) vs real corruption', () => {
  it('drops a malformed TRAILING line with a warning instead of throwing', async () => {
    const r1 = makeRecord('u1');
    await appendUsageRecordsNdjson([r1]);
    // Simulate an interrupted write: a partial JSON object left dangling at
    // the end of the file, with no trailing newline.
    await appendFile(pathState.usage, '{"id":"broken", "timestamp"', 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const records = await readUsageNdjson();

    expect(records).toEqual([r1]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws on a malformed line that is NOT the trailing line (real corruption, not tolerated)', async () => {
    const r1 = makeRecord('u1');
    const r2 = makeRecord('u2');
    const content = `${JSON.stringify(r1)}\nNOT JSON AT ALL\n${JSON.stringify(r2)}\n`;
    await writeFile(pathState.usage, content, 'utf-8');

    await expect(readUsageNdjson()).rejects.toThrow(/corrupted/);
  });
});

describe('applyUsageRetention', () => {
  it('drops records older than maxAgeDays, keeps the rest', async () => {
    const old = makeRecord('old', Date.now() - 40 * 24 * 60 * 60 * 1000);
    const recent = makeRecord('recent', Date.now());
    await appendUsageRecordsNdjson([old, recent]);

    const removed = await applyUsageRetention({ maxAgeDays: 30 });

    expect(removed).toBe(1);
    expect((await readUsageNdjson()).map((r) => r.id)).toEqual(['recent']);
  });

  it('drops the oldest records first when trimming by size (oldest-first, independent of age)', async () => {
    // Same shape/length for every record (only the id/timestamp value differs,
    // both fixed-length) so each serializes to an identical byte length —
    // makes the size budget below exact and the test deterministic.
    const records = Array.from({ length: 5 }, (_, i) => makeRecord(`u${i}`, Date.now() - (5 - i) * 1000));
    await appendUsageRecordsNdjson(records);

    const fullBytes = Buffer.byteLength(await readFile(pathState.usage, 'utf-8'), 'utf-8');
    const perRecordBytes = fullBytes / records.length;
    const maxSizeMb = (perRecordBytes * 3 + 1) / (1024 * 1024); // budget for the newest 3 only

    const removed = await applyUsageRetention({ maxSizeMb });

    expect(removed).toBe(2);
    expect((await readUsageNdjson()).map((r) => r.id)).toEqual(['u2', 'u3', 'u4']);
  });

  it('is a no-op (no rewrite, returns 0) when neither knob is set', async () => {
    await appendUsageRecordsNdjson([makeRecord('u1')]);
    const removed = await applyUsageRetention({});
    expect(removed).toBe(0);
    expect((await readUsageNdjson()).map((r) => r.id)).toEqual(['u1']);
  });
});

describe('AC2 — append cost does not grow with history', () => {
  it('appendUsageRecordsNdjson calls appendFile but never readFile', async () => {
    vi.mocked(fsPromises.readFile).mockClear();
    vi.mocked(fsPromises.appendFile).mockClear();

    await appendUsageRecordsNdjson([makeRecord('u1')]);

    expect(fsPromises.appendFile).toHaveBeenCalled();
    expect(fsPromises.readFile).not.toHaveBeenCalled();
  });
});

describe('concurrency (risks called out in the blueprint)', () => {
  it('races multiple concurrent appends without losing any record (real lockfile serializes them)', async () => {
    // 8 concurrent writers: enough to exercise real lock contention/retry
    // without exceeding usageNdjson.ts's retry budget (10 retries, 50-500ms
    // backoff) under this environment's disk latency.
    const batches = Array.from({ length: 8 }, (_, i) => [makeRecord(`c${i}`)]);
    await Promise.all(batches.map((b) => appendUsageRecordsNdjson(b)));

    const records = await readUsageNdjson();
    expect(records).toHaveLength(8);
    expect(new Set(records.map((r) => r.id)).size).toBe(8);
  });

  it('a concurrent read never observes a partial file while a full rewrite is in flight (atomic rename)', async () => {
    const initial = Array.from({ length: 200 }, (_, i) => makeRecord(`init${i}`));
    await writeUsageNdjson(initial);

    const rewrite = writeUsageNdjson(Array.from({ length: 200 }, (_, i) => makeRecord(`new${i}`)));
    const reads = await Promise.all(Array.from({ length: 20 }, () => readUsageNdjson()));
    await rewrite;

    for (const records of reads) {
      // Every concurrent read sees a complete, well-formed array: either the
      // full old content or the full new content, never a truncated mix.
      expect(records).toHaveLength(200);
      const allOld = records.every((r) => r.id.startsWith('init'));
      const allNew = records.every((r) => r.id.startsWith('new'));
      expect(allOld || allNew).toBe(true);
    }
  });

  it('an append queued during a sweep is not lost — it lands once the sweep finishes (same lock serializes both)', async () => {
    const survivors = Array.from({ length: 50 }, (_, i) => makeRecord(`keep${i}`, Date.now()));
    const expired = makeRecord('expired', Date.now() - 40 * 24 * 60 * 60 * 1000);
    await appendUsageRecordsNdjson([expired, ...survivors]);

    const sweep = applyUsageRetention({ maxAgeDays: 30 });
    const queuedAppend = appendUsageRecordsNdjson([makeRecord('queued-during-sweep')]);
    await Promise.all([sweep, queuedAppend]);

    const ids = (await readUsageNdjson()).map((r) => r.id);
    expect(ids).not.toContain('expired');
    expect(ids).toContain('queued-during-sweep');
    expect(ids).toHaveLength(51); // 50 survivors + the queued append
  });
});
