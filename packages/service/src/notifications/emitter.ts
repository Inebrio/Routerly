import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../config/loader.js';
import { dispatchNotification } from './sender.js';
import type {
  NotificationSeverity,
  NotificationInboxItem,
  NotificationRule,
  NotificationChannel,
} from '@routerly/shared';

/**
 * Notification event taxonomy (#89). The canonical set of system event names.
 * `emitEvent` accepts any string, but these are the events Routerly emits.
 */
export const NOTIFICATION_EVENTS = [
  'provider.error',
  'provider.degraded',
  'provider.recovered',
  'provider.rate_limited',
  'routing.no_candidates',
  'routing.fallback_used',
  'auth.login_failed',
  'auth.token_invalid',
  'config.model_added',
  'config.model_deleted',
  'config.project_created',
  'config.project_deleted',
  'system.startup',
  'system.shutdown',
] as const;

/** In-app inbox retention bounds (#91). */
const MAX_INBOX_ITEMS = 200;
const MAX_INBOX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** In-memory per-event-type last-dispatch timestamp for cooldown (#90, single-node). */
const lastDispatchAt = new Map<string, number>();

/** Test-only: reset cooldown state between tests. */
export function _resetCooldowns(): void {
  lastDispatchAt.clear();
}

/** Parse a duration like "15m", "1h", "30s", "2d" into milliseconds. Returns 0 if unparseable. */
export function parseDuration(d: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(d.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

/** True if event name matches a pattern: exact, `*`, or prefix glob like `budget.*`. */
export function matchesPattern(pattern: string, event: string): boolean {
  if (pattern === event || pattern === '*') return true;
  if (pattern.endsWith('.*')) return event.startsWith(pattern.slice(0, -1)); // "budget." prefix
  if (pattern.endsWith('*')) return event.startsWith(pattern.slice(0, -1));
  return false;
}

/** Resolve which channel IDs an event routes to, given the rules. */
function resolveChannelIds(event: string, rules: NotificationRule[]): string[] {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.events.some((p) => matchesPattern(p, event))) {
      for (const c of rule.channels) ids.add(c);
    }
  }
  return [...ids];
}

interface EmitOptions {
  /** Project ID — when set, the project's per-project channel override is merged in (#91). */
  projectId?: string;
  /** Optional logger for suppressed/failed dispatch diagnostics. */
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

/**
 * Emit a system notification event (#89/#90/#91).
 *  - Always appends to the in-app inbox (notifications.json), trimmed to retention bounds.
 *  - Dispatches to channels matched by notificationRules (+ per-project override), honoring cooldowns.
 * Never throws: notification failures must not break the request path.
 */
export async function emitEvent(
  event: string,
  severity: NotificationSeverity,
  details: Record<string, unknown> = {},
  opts: EmitOptions = {},
): Promise<void> {
  const timestamp = new Date().toISOString();
  try {
    await appendToInbox({ id: randomUUID(), event, severity, timestamp, details, readBy: [] });
  } catch (err) {
    opts.log?.warn({ err, event }, 'failed to append notification to inbox');
  }

  try {
    const settings = await readConfig('settings');
    const notif = settings.notifications;
    if (!notif?.channels?.length) return; // zero external channels: inbox only

    const rules = notif.notificationRules ?? [];
    const channelIds = new Set(resolveChannelIds(event, rules));

    // Per-project override (#91): merge the project's channels for its own events.
    if (opts.projectId) {
      const projects = await readConfig('projects');
      const project = projects.find((p) => p.id === opts.projectId);
      for (const c of project?.notifications?.channels ?? []) channelIds.add(c);
    }
    if (channelIds.size === 0) return;

    // Cooldown (#90): suppress repeated dispatches of the same event type.
    const cooldownMs = parseDuration(notif.cooldowns?.[event] ?? '');
    if (cooldownMs > 0) {
      const last = lastDispatchAt.get(event);
      if (last !== undefined && Date.now() - last < cooldownMs) {
        opts.log?.info({ event, cooldownMs }, 'notification suppressed by cooldown');
        return;
      }
    }
    lastDispatchAt.set(event, Date.now());

    const channels = notif.channels as NotificationChannel[];
    const payload = { event, severity, timestamp, details };
    await Promise.all(
      [...channelIds].map(async (id) => {
        const channel = channels.find((c) => c.id === id);
        if (!channel) return;
        try {
          await dispatchNotification(channel, payload);
        } catch (err) {
          opts.log?.warn({ err, event, channelId: id }, 'notification dispatch failed');
        }
      }),
    );
  } catch (err) {
    opts.log?.warn({ err, event }, 'notification dispatch error');
  }
}

/** Append one item to the inbox file, trimming to retention bounds (#91). */
async function appendToInbox(item: NotificationInboxItem): Promise<void> {
  const existing = await readConfig('notifications');
  existing.push(item);
  const cutoff = Date.now() - MAX_INBOX_AGE_MS;
  const trimmed = existing
    .filter((n) => Date.parse(n.timestamp) >= cutoff)
    .slice(-MAX_INBOX_ITEMS);
  await writeConfig('notifications', trimmed);
}
