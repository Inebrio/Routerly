import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../modules/config/loader.js';
import type { AuditEntry } from '../modules/config/loader.js';

export type { AuditEntry };

const MAX_ENTRIES = 10000;
const RETENTION_DAYS = 90;

export async function logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
  // ponytail: fire-and-forget, never throws — audit must not block the request path
  try {
    const existing = await readConfig('audit');
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    const pruned = existing.filter(e => e.timestamp > cutoff).slice(-MAX_ENTRIES + 1);
    pruned.push({ id: randomUUID(), timestamp: now, ...entry });
    await writeConfig('audit', pruned);
  } catch { /* never throw from audit */ }
}
