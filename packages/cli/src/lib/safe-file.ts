import { mkdir, readFile, writeFile, unlink, access, stat, rm, open, chmod } from 'node:fs/promises';
import { fsync as fsSyncCallback, close as fsCloseCallback, rename as fsRenameCallback } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

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

const fsSync = promisify(fsSyncCallback);
const fsClose = promisify(fsCloseCallback);
const fsRename = promisify(fsRenameCallback);

// ─── API ──────────────────────────────────────────────────────────────────

/**
 * Backup a file (or record that it didn't exist) with SHA-256 checksum.
 * Creates backup at ${ROUTERLY_HOME}/cli/client-backups/<backupId>/ with:
 * - original file (if existedBefore)
 * - manifest.json
 * Both files have mode 0o600.
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

  // Check if source file exists
  let existedBefore = false;
  let checksum = '';
  let content = '';

  try {
    content = await readFile(filePath, 'utf-8');
    existedBefore = true;
    checksum = hashContent(content);

    // Write backup copy of the original file with mode 0o600
    await writeFile(originalPath, content, { mode: 0o600 });
  } catch {
    // File doesn't exist; record existedBefore: false, no original file
    existedBefore = false;
    checksum = ''; // no content to hash
  }

  // Write manifest with mode 0o600
  const manifest: BackupManifest = {
    backupId: id,
    clientId,
    originalPath: filePath,
    checksum,
    existedBefore,
    createdAt: new Date().toISOString(),
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });

  return manifest;
}

/**
 * Atomically write content to a file.
 * Writes to <file>.<pid>.tmp, fsync, rename.
 * Attempts to preserve existing file mode.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;

  // Get existing mode (if file exists) for later preservation
  let originalMode: number | null = null;
  try {
    const stats = await stat(filePath);
    originalMode = stats.mode & parseInt('0o777', 8);
  } catch {
    // File doesn't exist yet
  }

  // Write to temp file (use default permissions)
  await writeFile(tempPath, content, 'utf-8');

  // Preserve original mode if it existed and is valid
  // ponytail: mode preservation is best-effort; skip if chmod fails
  if (originalMode !== null && originalMode !== 0) {
    try {
      await chmod(tempPath, originalMode);
    } catch {
      // Ignore chmod errors; file is still writable and usable
    }
  }

  // Open for fsync to ensure data is on disk before rename
  const fd = await open(tempPath, 'r');

  try {
    // Sync to disk for atomicity guarantee
    await fsSync(fd.fd);
    await fd.close();
  } catch (err) {
    try {
      await fd.close();
    } catch {}
    throw err;
  }

  // Atomic rename
  await fsRename(tempPath, filePath);
}

/**
 * Restore a file from backup.
 * If existedBefore was true, restore the backed-up bytes.
 * If existedBefore was false, delete the file (undo creation).
 */
export async function restoreBackup(backupId: string): Promise<void> {
  const backupDir = join(BACKUPS_DIR, backupId);
  const manifestPath = join(backupDir, 'manifest.json');
  const originalPath = join(backupDir, 'original');

  // Read the manifest to know what to do
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifest: BackupManifest = JSON.parse(manifestContent);

  if (manifest.existedBefore) {
    // Restore the backed-up file
    const backupContent = await readFile(originalPath, 'utf-8');
    await atomicWrite(manifest.originalPath, backupContent);
  } else {
    // File didn't exist before; delete it if it exists now
    try {
      await unlink(manifest.originalPath);
    } catch {
      // File may not exist; ignore
    }
  }
}

/**
 * List all backups by reading all manifest.json files.
 */
export async function listBackups(): Promise<BackupManifest[]> {
  const backups: BackupManifest[] = [];

  try {
    // Try to read the backups directory
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(BACKUPS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = join(BACKUPS_DIR, entry.name, 'manifest.json');
      try {
        const content = await readFile(manifestPath, 'utf-8');
        const manifest: BackupManifest = JSON.parse(content);
        backups.push(manifest);
      } catch {
        // Skip if manifest can't be read
      }
    }
  } catch {
    // Backups dir doesn't exist yet
  }

  return backups;
}
