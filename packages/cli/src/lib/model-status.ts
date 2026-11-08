import { api } from '../api.js';

/** Availability state of a model as shown by the CLI (same rule as the MCP `status` field). */
export function modelStatus(m: { enabled?: boolean; isNew?: boolean; unavailable?: 'removed' | 'deprecated' }): string {
  if (m.unavailable) return `unavailable (${m.unavailable})`;
  if (m.enabled === false) return m.isNew ? 'new' : 'disabled';
  return 'enabled';
}

/** Resolve a connection by id or label. Without `connections:read` the value is returned unchanged
 * (assumed to be an id); an unknown value throws. */
export async function resolveConnection(idOrLabel: string): Promise<{ id: string; label?: string }> {
  let conns: { id: string; label?: string }[] | undefined;
  try { conns = await api<{ id: string; label?: string }[]>('GET', '/api/connections'); }
  catch { /* no connections:read — use the value as an id */ }
  if (!Array.isArray(conns)) return { id: idOrLabel };
  const match = conns.find(c => c.id === idOrLabel) ?? conns.find(c => c.label === idOrLabel);
  if (!match) throw new Error(`Connection '${idOrLabel}' not found, see \`routerly connections list\``);
  return match;
}
