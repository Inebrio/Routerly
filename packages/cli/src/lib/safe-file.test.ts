import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, writeFile, rm, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// ROUTERLY_HOME is set to an isolated tmp dir by test-setup.ts before this
// file is imported.
const HOME = process.env.ROUTERLY_HOME!;
const BACKUPS_DIR = join(HOME, 'cli', 'client-backups');

// Always import after env is set (test-setup ran first).
import {
  backupFile,
  atomicWrite,
  restoreBackup,
  listBackups,
  type BackupManifest,
} from './safe-file.js';

const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
};

// Wipe backups between tests for isolation.
afterEach(async () => {
  try {
    await rm(BACKUPS_DIR, { recursive: true, force: true });
  } catch {
    // dir may not exist
  }
});

// ── backupFile ────────────────────────────────────────────────────────────

describe('backupFile', () => {
  it('(a) records SHA-256 checksum and existedBefore=true for existing file', async () => {
    const testFile = join(HOME, 'test.txt');
    const testContent = 'hello world';
    await mkdir(HOME, { recursive: true });
    await writeFile(testFile, testContent, 'utf-8');

    const manifest = await backupFile('test-client-1', testFile);

    expect(manifest).toMatchObject({
      clientId: 'test-client-1',
      originalPath: testFile,
      existedBefore: true,
    });
    expect(manifest.checksum).toBe(hashContent(testContent));
    expect(manifest.backupId).toBeDefined();
    expect(manifest.createdAt).toBeDefined();

    // Verify backup file exists
    const backupPath = join(BACKUPS_DIR, manifest.backupId, 'original');
    const backupContent = await readFile(backupPath, 'utf-8');
    expect(backupContent).toBe(testContent);
  });

  it('(e) honors explicit backupId from plan()', async () => {
    const testFile = join(HOME, 'test.txt');
    const testContent = 'stable id test';
    const stableBackupId = 'my-stable-backup-id';
    await mkdir(HOME, { recursive: true });
    await writeFile(testFile, testContent, 'utf-8');

    const manifest = await backupFile('test-client-1', testFile, stableBackupId);

    expect(manifest.backupId).toBe(stableBackupId);

    // Verify backup is under that stable id
    const backupPath = join(BACKUPS_DIR, stableBackupId, 'original');
    const backupContent = await readFile(backupPath, 'utf-8');
    expect(backupContent).toBe(testContent);
  });

  it('(d) yields existedBefore=false for missing path', async () => {
    const missingFile = join(HOME, 'does-not-exist.txt');

    const manifest = await backupFile('test-client-1', missingFile);

    expect(manifest).toMatchObject({
      clientId: 'test-client-1',
      originalPath: missingFile,
      existedBefore: false,
    });
    expect(manifest.backupId).toBeDefined();

    // No "original" file should exist in backup since source didn't exist
    const backupDir = join(BACKUPS_DIR, manifest.backupId);
    const backupPath = join(backupDir, 'original');
    await expect(access(backupPath)).rejects.toThrow();
  });
});

// ── atomicWrite ───────────────────────────────────────────────────────────

describe('atomicWrite', () => {
  it('(b) replaces content and never leaves .tmp sibling', async () => {
    const testFile = join(HOME, 'atomic.txt');
    const originalContent = 'original';
    const newContent = 'replaced';

    await mkdir(HOME, { recursive: true });
    await writeFile(testFile, originalContent, 'utf-8');

    await atomicWrite(testFile, newContent);

    // Content replaced
    const result = await readFile(testFile, 'utf-8');
    expect(result).toBe(newContent);

    // No .tmp sibling left behind
    const tmpFile = `${testFile}.tmp`;
    await expect(access(tmpFile)).rejects.toThrow();
  });

  it('creates file readable after write', async () => {
    const testFile = join(HOME, 'new-file.txt');
    const content = 'new file';

    await mkdir(HOME, { recursive: true });
    await atomicWrite(testFile, content);

    // Verify file is readable
    const result = await readFile(testFile, 'utf-8');
    expect(result).toBe(content);
  });
});

// ── restoreBackup ─────────────────────────────────────────────────────────

describe('restoreBackup', () => {
  it('(c) returns file to original bytes', async () => {
    const testFile = join(HOME, 'restore.txt');
    const originalContent = 'original content';
    const modifiedContent = 'modified';

    await mkdir(HOME, { recursive: true });
    await writeFile(testFile, originalContent, 'utf-8');

    // Backup the original
    const manifest = await backupFile('test-client-1', testFile);

    // Modify the file
    await atomicWrite(testFile, modifiedContent);
    let current = await readFile(testFile, 'utf-8');
    expect(current).toBe(modifiedContent);

    // Restore from backup
    await restoreBackup(manifest.backupId);

    // File should be back to original
    const restored = await readFile(testFile, 'utf-8');
    expect(restored).toBe(originalContent);
  });

  it('(d) deletes file if existedBefore was false', async () => {
    const missingFile = join(HOME, 'will-be-created.txt');

    // Backup the missing file (existedBefore: false)
    const manifest = await backupFile('test-client-1', missingFile);
    expect(manifest.existedBefore).toBe(false);

    // Create the file (simulating a write that happened after backup)
    await mkdir(HOME, { recursive: true });
    await writeFile(missingFile, 'new content', 'utf-8');

    // Restore should delete it
    await restoreBackup(manifest.backupId);

    // File should no longer exist
    await expect(access(missingFile)).rejects.toThrow();
  });
});

// ── listBackups ───────────────────────────────────────────────────────────

describe('listBackups', () => {
  it('returns empty array when no backups exist', async () => {
    const backups = await listBackups();
    expect(backups).toEqual([]);
  });

  it('lists all backups in order', async () => {
    const testFile1 = join(HOME, 'file1.txt');
    const testFile2 = join(HOME, 'file2.txt');

    await mkdir(HOME, { recursive: true });
    await writeFile(testFile1, 'content1', 'utf-8');
    await writeFile(testFile2, 'content2', 'utf-8');

    const manifest1 = await backupFile('client-1', testFile1);
    const manifest2 = await backupFile('client-2', testFile2);

    const backups = await listBackups();

    expect(backups).toHaveLength(2);
    expect(backups.some(b => b.backupId === manifest1.backupId)).toBe(true);
    expect(backups.some(b => b.backupId === manifest2.backupId)).toBe(true);
  });
});
