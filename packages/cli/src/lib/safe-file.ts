import { mkdir, readFile, writeFile, unlink, stat, open, chmod, rename, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── ROUTERLY_HOME resolution (same pattern as store.ts) ─────────────────
const HOME = process.env.ROUTERLY_HOME ?? join(homedir(), '.routerly');
const BACKUPS_DIR = join(HOME, 'cli', 'client-backups');

// ─── Types ────────────────────────────────────────────────────────────────

export interface BackupManifest {
  backupId: string;
  clientId: string;
  originalPath: string;
  checksum: string;
  existedBefore: boolean;
  createdAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
};

/** Write content to a file with a given mode, fsync-ing before close. */
const writeSync = async (path: string, content: string, mode: number): Promise<void> => {
  const fd = await open(path, 'w', mode);
  try {
    await fd.write(content);
    await fd.sync();
  } finally {
    await fd.close();
  }
};

// ─── API ──────────────────────────────────────────────────────────────────

/**
 * Backup a file (or record that it didn't exist) with SHA-256 checksum.
 * Creates backup at ${ROUTERLY_HOME}/cli/client-backups/<backupId>/ with:
 * - original file (if existedBefore)
 * - manifest.json
 * Both files have mode 0o600 and are fsync'd before the call returns.
 * All I/O is UTF-8.
 */
export async function backupFile(
  clientId: string,
  filePath: string,
  backupId?: string
): Promise<BackupManifest> {
  const id = backupId ?? randomUUID();
  const backupDir = join(BACKUPS_DIR, id);
  const manifestPath = join(backupDir, 'manifest.json');
  const originalPath = join(backupDir, 'original');

  // Ensure backup directory exists
  await mkdir(backupDir, { recursive: true, mode: 0o700 });

  // Read the source file. Only a genuine "missing file" (ENOENT) means
  // existedBefore=false; any other error (EACCES, EIO, ...) must fail loudly
  // rather than be mislabeled as "didn't exist" — otherwise a later rollback
  // would unlink a real file that was never actually backed up.
  let existedBefore = false;
  let checksum = '';
  try {
    const content = await readFile(filePath, 'utf-8');
    existedBefore = true;
    checksum = hashContent(content);
    await writeSync(originalPath, content, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // File truly doesn't exist; record existedBefore: false, no original file
  }

  const manifest: BackupManifest = {
    backupId: id,
    clientId,
    originalPath: filePath,
    checksum,
    existedBefore,
    createdAt: new Date().toISOString(),
  };

  await writeSync(manifestPath, JSON.stringify(manifest, null, 2), 0o600);

  return manifest;
}

/**
 * Atomically write content to a file.
 * Writes to <file>.<pid>.tmp, fsync, rename. Preserves the target's existing
 * mode (falls back to 0o644 for a new file). Removes the tmp file on any
 * failure. Content is written as UTF-8.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;

  // Preserve the target's existing mode, or use a sane default for a new file.
  let mode = 0o644;
  try {
    const stats = await stat(filePath);
    mode = stats.mode & 0o777;
  } catch {
    // File doesn't exist yet; keep the default mode.
  }

  try {
    const fd = await open(tempPath, 'w', mode);
    try {
      await fd.write(content);
      // fsync before rename IS the atomicity guarantee.
      await fd.sync();
    } finally {
      await fd.close();
    }
    // chmod after write: open()'s mode is masked by umask, so set it explicitly.
    await chmod(tempPath, mode);
    await rename(tempPath, filePath);
  } catch (err) {
    // Best-effort cleanup of the orphaned tmp file; keep the original error.
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Restore a file from backup (rollback / undo).
 * If existedBefore was true, verify the backed-up bytes against the recorded
 * SHA-256 checksum, then restore them. If existedBefore was false, delete the
 * file (undo creation).
 */
export async function restoreBackup(backupId: string): Promise<void> {
  const backupDir = join(BACKUPS_DIR, backupId);
  const manifestPath = join(backupDir, 'manifest.json');
  const originalPath = join(backupDir, 'original');

  const manifest: BackupManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

  if (manifest.existedBefore) {
    const backupContent = await readFile(originalPath, 'utf-8');
    // Verify integrity before restoring: a corrupted/tampered backup must not
    // be silently written over the live file.
    const actual = hashContent(backupContent);
    if (actual !== manifest.checksum) {
      throw new Error(
        `Backup ${backupId} is corrupt: checksum mismatch (expected ${manifest.checksum}, got ${actual})`
      );
    }
    await atomicWrite(manifest.originalPath, backupContent);
  } else {
    // File didn't exist before; delete it if a later write created it.
    await unlink(manifest.originalPath).catch(() => {});
  }
}

/**
 * List all backups by reading every manifest.json under the backups dir.
 */
export async function listBackups(): Promise<BackupManifest[]> {
  const backups: BackupManifest[] = [];

  let entries;
  try {
    entries = await readdir(BACKUPS_DIR, { withFileTypes: true });
  } catch {
    return backups; // Backups dir doesn't exist yet.
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(BACKUPS_DIR, entry.name, 'manifest.json');
    try {
      backups.push(JSON.parse(await readFile(manifestPath, 'utf-8')));
    } catch {
      // Skip if manifest can't be read/parsed.
    }
  }

  return backups;
}
