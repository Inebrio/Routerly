import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../config/loader.js';
import { dispatchNotification } from './sender.js';
import { getEffectiveRoles } from '../auth/roles.js';
import type {
  NotificationSeverity,
  NotificationInboxItem,
  NotificationChannel,
  ChannelTargets,
  UserConfig,
  RoleConfig,
} from '@routerly/shared';

// Canonical event taxonomy lives in @routerly/shared (single source of truth).
export { NOTIFICATION_EVENTS } from '@routerly/shared';

/** In-app inbox retention bounds (#91). */
const MAX_INBOX_ITEMS = 200;
const MAX_INBOX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ponytail: in-memory per-channel cooldown; resets on restart, single-node only
const channelLastDispatch = new Map<string, number>(); // key: `${channelId}:${event}`

/** Test-only: reset cooldown state between tests. */
export function _resetCooldowns(): void {
  channelLastDispatch.clear();
}

/** True if event name matches a pattern: exact, `*`, or prefix glob like `budget.*`. */
export function matchesPattern(pattern: string, event: string): boolean {
  if (pattern === event || pattern === '*') return true;
  if (pattern.endsWith('.*')) return event.startsWith(pattern.slice(0, -1)); // "budget." prefix
  if (pattern.endsWith('*')) return event.startsWith(pattern.slice(0, -1));
  return false;
}

/** True if any pattern in the list matches the event. */
function anyPatternMatches(patterns: string[] | undefined, event: string): boolean {
  return !!patterns && patterns.length > 0 && patterns.some((p) => matchesPattern(p, event));
}

/**
 * Decide whether a single channel receives an event:
 *  1. channel.events non-empty → match against those patterns;
 *  2. else: dashboard channels receive all; external channels must opt-in via events[].
 */
function channelReceives(channel: NotificationChannel, event: string): boolean {
  if (channel.events && channel.events.length > 0) {
    return anyPatternMatches(channel.events, event);
  }
  // No filter: dashboard defaults to all; external defaults to silent.
  return channel.provider === 'dashboard';
}

/** True if targets is undefined or all three arrays empty (= everyone). */
function targetsEveryone(t: ChannelTargets | undefined): boolean {
  return (
    !t ||
    ((t.roles?.length ?? 0) === 0 &&
      (t.permissions?.length ?? 0) === 0 &&
      (t.users?.length ?? 0) === 0)
  );
}

/**
 * Resolve the set of users matching a channel's targets: roles ∪ permissions ∪ users.
 * Undefined/empty targets → all users. (U5)
 */
export function resolveTargetUsers(
  targets: ChannelTargets | undefined,
  users: UserConfig[],
  roles: RoleConfig[],
): UserConfig[] {
  if (targetsEveryone(targets)) return users;
  const wantRoles = new Set(targets!.roles ?? []);
  const wantUsers = new Set(targets!.users ?? []);
  const wantPerms = targets!.permissions ?? [];
  const permsByRole = new Map(roles.map((r) => [r.id, new Set(r.permissions)]));
  return users.filter((u) => {
    if (wantRoles.has(u.roleId)) return true;
    if (wantUsers.has(u.id)) return true;
    if (wantPerms.length > 0) {
      const rolePerms = permsByRole.get(u.roleId);
      if (rolePerms && wantPerms.some((p) => rolePerms.has(p))) return true;
    }
    return false;
  });
}

interface EmitOptions {
  /** Project ID — when set, the project's per-project channel override is merged in (#91). */
  projectId?: string;
  /** Optional logger for suppressed/failed dispatch diagnostics. */
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

const EMAIL_PROVIDERS = new Set(['smtp', 'ses', 'sendgrid', 'azure', 'google']);

/**
 * Emit a system notification event (#89/#90/#91, reworked U5).
 *  - In-app inbox is opt-in and driven solely by `dashboard` channels: an event
 *    lands in the inbox only when a dashboard channel matches it (audience = union
 *    of those channels' targets). If no dashboard channel exists, or none match the
 *    event, nothing is appended to the inbox.
 *  - External channels (email/webhook/native) receive an event per their own
 *    `events` patterns, falling back to notificationRules, then to receive-all.
 *  - Email channels send to their resolved target users' emails (or fromAddress
 *    when untargeted). Webhook/native delivery endpoints are fixed; targets only
 *    gate which events they receive.
 * Never throws: notification failures must not break the request path.
 */
export async function emitEvent(
  event: string,
  severity: NotificationSeverity,
  details: Record<string, unknown> = {},
  opts: EmitOptions = {},
): Promise<void> {
  const timestamp = new Date().toISOString();
  const settings = await readConfig('settings').catch(() => undefined);
  const notif = settings?.notifications;
  const channels = (notif?.channels ?? []) as NotificationChannel[];

  const dashboardChannels = channels.filter((c) => c.provider === 'dashboard');

  // ── Inbox (U5, opt-in) ────────────────────────────────────────────────────────
  try {
    const matching = dashboardChannels.filter((c) => channelReceives(c, event));
    if (matching.length > 0) {
      const recipients = await resolveInboxRecipients(matching);
      await appendToInbox({
        id: randomUUID(), event, severity, timestamp, details, readBy: [],
        ...(recipients === undefined ? {} : { recipients }),
      });
    }
  } catch (err) {
    opts.log?.warn({ err, event }, 'failed to append notification to inbox');
  }

  // ── External channels ────────────────────────────────────────────────────────
  try {
    const external = channels.filter((c) => c.provider !== 'dashboard');
    if (external.length === 0) return;

    const matched = new Set(
      external.filter((c) => channelReceives(c, event)).map((c) => c.id),
    );

    // Per-project override (#91): merge the project's channels for its own events.
    if (opts.projectId) {
      const projects = await readConfig('projects');
      const project = projects.find((p) => p.id === opts.projectId);
      for (const id of project?.notifications?.channels ?? []) {
        if (external.some((c) => c.id === id)) matched.add(id);
      }
    }
    if (matched.size === 0) return;

    const payload = { event, severity, timestamp, details };
    // Every id in `matched` came from `external` (directly or via the external.some
    // guard on the project override), so the lookup always resolves.
    const matchedChannels = external.filter((c) => matched.has(c.id));
    await Promise.all(
      matchedChannels.map(async (channel) => {
        // Per-channel cooldown: skip if within the configured interval.
        const cooldownMs = ((channel as any).cooldownSeconds ?? 0) * 1000;
        if (cooldownMs > 0) {
          const key = `${channel.id}:${event}`;
          const last = channelLastDispatch.get(key);
          if (last !== undefined && Date.now() - last < cooldownMs) {
            opts.log?.info({ event, channel: channel.id, cooldownMs }, 'notification suppressed by cooldown');
            return;
          }
          channelLastDispatch.set(key, Date.now());
        }
        try {
          const recipients = await resolveEmailRecipients(channel);
          await dispatchNotification(channel, payload, recipients);
        } catch (err) {
          opts.log?.warn({ err, event, channelId: channel.id }, 'notification dispatch failed');
        }
      }),
    );
  } catch (err) {
    opts.log?.warn({ err, event }, 'notification dispatch error');
  }
}

/**
 * Inbox audience for a set of matched dashboard channels (U5).
 * Returns undefined (everyone) if any channel is untargeted; otherwise the
 * union of resolved user IDs.
 */
async function resolveInboxRecipients(
  matching: NotificationChannel[],
): Promise<string[] | undefined> {
  if (matching.some((c) => targetsEveryone(c.targets))) return undefined;
  const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
  const roles = getEffectiveRoles(customRoles);
  const ids = new Set<string>();
  for (const c of matching) {
    for (const u of resolveTargetUsers(c.targets, users, roles)) ids.add(u.id);
  }
  return [...ids];
}

/**
 * Resolve target email addresses for an email channel (U5). Returns undefined
 * for non-email channels or when the channel is untargeted (sender falls back to
 * channel.fromAddress). Webhook/native channels ignore targets for delivery.
 */
async function resolveEmailRecipients(
  channel: NotificationChannel,
): Promise<string[] | undefined> {
  if (!EMAIL_PROVIDERS.has(channel.provider)) return undefined;
  if (targetsEveryone(channel.targets)) return undefined;
  const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
  const roles = getEffectiveRoles(customRoles);
  const emails = resolveTargetUsers(channel.targets, users, roles).map((u) => u.email);
  return emails.length > 0 ? emails : undefined;
}

/** Append one item to the inbox file, trimming to retention bounds (#91). */
export async function appendToInbox(item: NotificationInboxItem): Promise<void> {
  const existing = await readConfig('notifications');
  existing.push(item);
  const cutoff = Date.now() - MAX_INBOX_AGE_MS;
  const trimmed = existing
    .filter((n) => Date.parse(n.timestamp) >= cutoff)
    .slice(-MAX_INBOX_ITEMS);
  await writeConfig('notifications', trimmed);
}
