import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real filesystem and lock; only the path is redirected into a temp dir.
const pathState = vi.hoisted(() => ({ activity: '', usage: '' }));
vi.mock('../../lib/paths.js', () => ({ CONFIG_PATHS: pathState }));

const { appendActivity, readActivity, applyActivityRetention } = await import('./activity.js');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'activity-ndjson-'));
  pathState.activity = join(dir, 'activity.ndjson');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (id: string, at: number) =>
  JSON.stringify({ id, timestamp: new Date(at).toISOString(), kind: 'mcp', outcome: 'success', durationMs: 1, name: 't' }) + '\n';

describe('activity log', () => {
  it('readActivity returns [] when the file does not exist', async () => {
    expect(await readActivity()).toEqual([]);
  });

  it('appendActivity assigns id and an end timestamp and round-trips', async () => {
    const before = Date.now();
    await appendActivity({ kind: 'proxy', outcome: 'success', durationMs: 500, name: 'GET /v1/models', status: 200, routerId: 'r1' });
    const [rec] = await readActivity();
    expect(rec).toMatchObject({ kind: 'proxy', name: 'GET /v1/models', status: 200, routerId: 'r1', durationMs: 500 });
    expect(rec!.id).toBeTruthy();
    expect(new Date(rec!.timestamp).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(rec!.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('concurrent appends all land as intact lines', async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => appendActivity({ kind: 'mcp', outcome: 'success', durationMs: 1, name: `t${i}` })));
    expect(await readActivity()).toHaveLength(5);
  });

  it('drops a malformed trailing line but throws on a malformed middle line', async () => {
    await writeFile(pathState.activity, line('a', 1) + '{"id":"b"');
    expect((await readActivity()).map((r) => r.id)).toEqual(['a']);
    await writeFile(pathState.activity, line('a', 1) + 'garbage\n' + line('c', 3));
    await expect(readActivity()).rejects.toThrow(/corrupted at line 2/);
  });

  it('file is created with 0600 permissions', async () => {
    await appendActivity({ kind: 'mcp', outcome: 'success', durationMs: 1, name: 't' });
    const { stat } = await import('node:fs/promises');
    expect((await stat(pathState.activity)).mode & 0o777).toBe(0o600);
  });
});

describe('applyActivityRetention (AC9)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('is a no-op without a policy', async () => {
    await writeFile(pathState.activity, line('old', Date.now() - 400 * DAY));
    expect(await applyActivityRetention({})).toBe(0);
    expect(await readActivity()).toHaveLength(1);
  });

  it('prunes events older than maxAgeDays and keeps the rest', async () => {
    await writeFile(pathState.activity, line('old', Date.now() - 10 * DAY) + line('new', Date.now() - DAY));
    expect(await applyActivityRetention({ maxAgeDays: 5 })).toBe(1);
    expect((await readActivity()).map((r) => r.id)).toEqual(['new']);
  });

  it('trims the oldest events first when over maxSizeMb', async () => {
    const big = 'x'.repeat(600 * 1024);
    const rec = (id: string, at: number) => JSON.stringify({ id, timestamp: new Date(at).toISOString(), kind: 'mcp', outcome: 'success', durationMs: 1, name: big }) + '\n';
    await writeFile(pathState.activity, rec('a', 1) + rec('b', 2));
    await appendFile(pathState.activity, rec('c', 3));
    expect(await applyActivityRetention({ maxSizeMb: 1 })).toBe(2);
    expect((await readActivity()).map((r) => r.id)).toEqual(['c']);
    expect((await readFile(pathState.activity, 'utf-8')).endsWith('\n')).toBe(true);
  });
});
