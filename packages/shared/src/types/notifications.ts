/**
 * Human-readable catalog for the notification events (T51).
 *
 * The wire keeps the slug (`provider.rate_limited`): it is stable, greppable
 * and what channel filters match on. This module turns that slug into what a
 * person reads, and is shared by dashboard and CLI so both say the same thing.
 * Pure data and pure functions, safe in the browser.
 */
import type { NotificationEvent } from './config.js';

/** Broad area an event belongs to. Drives the category filter in the UI. */
export type NotificationCategory =
  | 'routing'
  | 'provider'
  | 'budget'
  | 'config'
  | 'security'
  | 'system';

export const NOTIFICATION_CATEGORIES = [
  'routing', 'provider', 'budget', 'config', 'security', 'system',
] as const;

export interface NotificationEventMeta {
  category: NotificationCategory;
  /** Short sentence describing what happened, no punctuation at the end. */
  title: string;
}

export const NOTIFICATION_EVENT_CATALOG: Record<NotificationEvent, NotificationEventMeta> = {
  'provider.error':           { category: 'provider', title: 'Provider call failed' },
  'provider.degraded':        { category: 'provider', title: 'Provider degraded' },
  'provider.recovered':       { category: 'provider', title: 'Provider recovered' },
  'provider.rate_limited':    { category: 'provider', title: 'Provider rate limited' },
  'routing.no_candidates':    { category: 'routing',  title: 'No model could serve the request' },
  'routing.fallback_used':    { category: 'routing',  title: 'Fallback model used' },
  'auth.login_failed':        { category: 'security', title: 'Failed sign-in' },
  'auth.token_invalid':       { category: 'security', title: 'Invalid API token' },
  'config.model_added':       { category: 'config',   title: 'Model added' },
  'config.model_deleted':     { category: 'config',   title: 'Model deleted' },
  'config.project_created':   { category: 'config',   title: 'Project created' },
  'config.project_deleted':   { category: 'config',   title: 'Project deleted' },
  'budget.threshold_reached': { category: 'budget',   title: 'Budget threshold reached' },
  'budget.exceeded':          { category: 'budget',   title: 'Budget exhausted' },
  'budget.reset':             { category: 'budget',   title: 'Budget period reset' },
  'system.startup':           { category: 'system',   title: 'Service started' },
  'system.shutdown':          { category: 'system',   title: 'Service stopped' },
};

/** Prefix to category, so an event added later still lands in the right group. */
const PREFIX_CATEGORY: Record<string, NotificationCategory> = {
  provider: 'provider',
  routing: 'routing',
  budget: 'budget',
  config: 'config',
  auth: 'security',
  system: 'system',
};

function meta(event: string): NotificationEventMeta | undefined {
  return NOTIFICATION_EVENT_CATALOG[event as NotificationEvent];
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Title for an event. Events outside the catalog fall back to their slug with
 * separators turned into spaces, so a new event is still readable before it
 * gets an entry here.
 */
export function notificationTitle(event: string): string {
  const known = meta(event);
  if (known) return known.title;
  const words = event.replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : event;
}

/** Category of an event, resolved by catalog first, then by prefix. */
export function notificationCategory(event: string): NotificationCategory {
  return meta(event)?.category ?? PREFIX_CATEGORY[event.split('.')[0] ?? ''] ?? 'system';
}

/**
 * One line explaining why the event fired, built from its details: what was
 * involved, then the provider's own error message when there is one. Empty
 * string when the details carry nothing worth showing.
 */
export function notificationCause(event: string, details: Record<string, unknown> = {}): string {
  const parts: string[] = [];
  const model = text(details['modelId']);
  const provider = text(details['provider']);
  if (model) parts.push(provider ? `${model} on ${provider}` : model);
  else if (provider) parts.push(provider);

  switch (event) {
    case 'routing.no_candidates': {
      const requested = text(details['requestedModel']);
      parts.push(requested ? `requested ${requested}` : 'no candidate left after filtering');
      break;
    }
    case 'routing.fallback_used': {
      const primary = text(details['primaryModelId']);
      const fallback = text(details['fallbackModelId']);
      if (primary && fallback) parts.push(`${primary} replaced by ${fallback}`);
      break;
    }
    case 'provider.degraded': {
      const errors = num(details['consecutiveErrors']);
      if (errors !== undefined) parts.push(`${errors} consecutive failures`);
      break;
    }
    case 'budget.threshold_reached': {
      const pct = num(details['pct']);
      const metric = text(details['metric']);
      const window = text(details['window']);
      if (pct !== undefined) parts.push(`${pct}% of the ${metric || 'budget'} limit${window ? ` per ${window}` : ''}`);
      break;
    }
    case 'auth.login_failed': {
      const email = text(details['email']);
      if (email) parts.push(email);
      break;
    }
    case 'config.project_created':
    case 'config.project_deleted': {
      const name = text(details['name']);
      if (name) parts.push(name);
      break;
    }
    default:
      break;
  }

  const reason = text(details['reason']);
  if (reason) parts.push(reason.replace(/_/g, ' '));
  const error = text(details['error']);
  if (error) parts.push(error);

  return parts.join(' · ');
}
