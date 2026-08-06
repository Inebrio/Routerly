import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readConfig, writeConfig, initConfigDirs } from './loader.js';
import { CONFIG_PATHS } from '../../lib/paths.js';

// Real-filesystem proof of the data-loss fix (no fs mocks). Runs against the
// isolated temp ROUTERLY_HOME forced by test-setup.ts, so it never touches real
// data. This reproduces the conditions of the projects.json wipe incident:
// many concurrent writers + readers on the same file, and asserts a populated
// file is never observed empty and never clobbered to the default.

describe('loader — real-FS concurrent safety (data-loss regression)', () => {
  it('round-trips data through the atomic write', async () => {
    await initConfigDirs();
    const projects = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] as any;
    await writeConfig('projects', projects);
    expect(await readConfig('projects')).toEqual(projects);
  });

  it('reads racing repeated writes never see an empty/clobbered file', async () => {
    await initConfigDirs();
    const populated = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` })) as any;
    await writeConfig('projects', populated);

    // 20 rounds: each round publishes the full set (atomic write) while a burst
    // of 5 reads runs concurrently with that write. A read must NEVER observe the
    // empty/truncated window the old non-atomic writeFile exposed. Writers are
    // serialized per round so this exercises the truncation race, not lock-retry
    // exhaustion (a separate concern — a failed lock throws, it never wipes data).
    const allReads: Promise<any>[] = [];
    for (let round = 0; round < 20; round++) {
      const write = writeConfig('projects', populated);
      const reads = Array.from({ length: 5 }, () => readConfig('projects'));
      allReads.push(...reads);
      await Promise.all([write, ...reads]);
    }

    for (const r of await Promise.all(allReads)) {
      expect(Array.isArray(r)).toBe(true);
      expect((r as unknown[]).length).toBe(populated.length); // never the empty default
    }
    // Final on-disk state is intact and parseable (not '', not '[]').
    const onDisk = await readFile(CONFIG_PATHS.projects, 'utf-8');
    expect(JSON.parse(onDisk)).toHaveLength(populated.length);
  });

  it('a burst of concurrent writes to the same key all resolve without throwing (lock-retry budget)', async () => {
    await initConfigDirs();
    // 10 concurrent writeConfig calls contend for the same lock — the transient
    // burst the budget bump targets (e.g. overlapping appendUsageRecord on the
    // request hot path). Under the old 5-retry budget the back-of-the-queue
    // writers exhausted retries and threw, dropping the write; the bumped budget
    // (10 retries, 500ms cap) lets them ride it out. A much larger simultaneous
    // burst can still exhaust any modest budget — that is the O(n) global-lock
    // ceiling named in writeConfig's ponytail comment (upgrade: append-only
    // NDJSON writes), not a case a bigger retry budget should chase. Each payload
    // is distinct so we confirm the file ends parseable holding one writer's value.
    const N = 10;
    const writes = Array.from({ length: N }, (_, i) =>
      writeConfig('projects', [{ id: `w${i}`, name: `Writer ${i}` }] as any),
    );
    // No call may reject.
    await expect(Promise.all(writes)).resolves.toHaveLength(N);

    // File parses and holds a valid last-writer value (one of the N payloads).
    const onDisk = JSON.parse(await readFile(CONFIG_PATHS.projects, 'utf-8'));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].id).toMatch(/^w\d+$/);
    // readConfig agrees with disk.
    expect(await readConfig('projects')).toEqual(onDisk);
  });

  it('a read of a truly-missing file creates it with defaults (first run unchanged)', async () => {
    // models.json under a fresh isolated home; readConfig must create it as [].
    const result = await readConfig('models');
    expect(Array.isArray(result)).toBe(true);
    // File now exists and is the empty default.
    expect(JSON.parse(await readFile(CONFIG_PATHS.models, 'utf-8'))).toEqual([]);
  });

  it('usage (NDJSON): a read of a truly-missing usage.ndjson returns [] WITHOUT creating the file', async () => {
    // Unlike every other config key, usage never eagerly writes a default on
    // a missing-file read (RTR-06) — the file is only ever created by an
    // append or an explicit write.
    const result = await readConfig('usage');
    expect(result).toEqual([]);
    await expect(readFile(CONFIG_PATHS.usage, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
