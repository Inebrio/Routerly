import { describe, it, expect } from 'vitest';
import { NOTIFICATION_EVENTS } from './config.js';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_CATALOG,
  notificationTitle,
  notificationCategory,
  notificationCause,
} from './notifications.js';

describe('notification catalog', () => {
  it('covers every canonical event', () => {
    for (const event of NOTIFICATION_EVENTS) {
      const meta = NOTIFICATION_EVENT_CATALOG[event];
      expect(meta, event).toBeDefined();
      expect(meta.title.length, event).toBeGreaterThan(0);
      expect(NOTIFICATION_CATEGORIES).toContain(meta.category);
    }
  });

  it('has no entry for an event that is not canonical', () => {
    const canonical = new Set<string>(NOTIFICATION_EVENTS);
    for (const event of Object.keys(NOTIFICATION_EVENT_CATALOG)) {
      expect(canonical.has(event), event).toBe(true);
    }
  });

  it('titles a known event from the catalog', () => {
    expect(notificationTitle('provider.rate_limited')).toBe('Provider rate limited');
  });

  it('falls back to a readable slug for an unknown event', () => {
    expect(notificationTitle('cache.entry_evicted')).toBe('Cache entry evicted');
    expect(notificationTitle('')).toBe('');
  });

  it('resolves the category by prefix for an unknown event', () => {
    expect(notificationCategory('provider.timeout')).toBe('provider');
    expect(notificationCategory('auth.session_expired')).toBe('security');
    expect(notificationCategory('cache.entry_evicted')).toBe('system');
  });
});

describe('notification cause', () => {
  it('is empty when the details say nothing', () => {
    expect(notificationCause('system.startup')).toBe('');
    expect(notificationCause('provider.error', {})).toBe('');
  });

  it('carries the provider error verbatim after the model it hit', () => {
    expect(
      notificationCause('provider.error', {
        modelId: 'gpt-4o',
        provider: 'openai',
        error: '429 Too Many Requests: rate limit reached for gpt-4o',
      }),
    ).toBe('gpt-4o on openai · 429 Too Many Requests: rate limit reached for gpt-4o');
  });

  it('names the model alone when the provider is missing', () => {
    expect(notificationCause('provider.degraded', { modelId: 'sonnet', consecutiveErrors: 3 })).toBe(
      'sonnet · 3 consecutive failures',
    );
  });

  it('explains a routing failure', () => {
    expect(notificationCause('routing.no_candidates', { requestedModel: 'gpt-5' })).toBe(
      'requested gpt-5',
    );
    expect(notificationCause('routing.no_candidates', {})).toBe('no candidate left after filtering');
  });

  it('explains a fallback', () => {
    expect(
      notificationCause('routing.fallback_used', {
        primaryModelId: 'gpt-4o',
        fallbackModelId: 'sonnet',
      }),
    ).toBe('gpt-4o replaced by sonnet');
  });

  it('explains a budget threshold', () => {
    expect(
      notificationCause('budget.threshold_reached', { pct: 80, metric: 'cost', window: 'day' }),
    ).toBe('80% of the cost limit per day');
  });

  it('shows who failed to sign in', () => {
    expect(notificationCause('auth.login_failed', { email: 'nobody@example.com' })).toBe(
      'nobody@example.com',
    );
  });

  it('shows the router name on config events', () => {
    expect(notificationCause('config.router_deleted', { name: 'Staging' })).toBe('Staging');
  });

  it('turns a machine reason into words', () => {
    expect(notificationCause('auth.token_invalid', { reason: 'token_revoked' })).toBe(
      'token revoked',
    );
  });

  it('ignores blank and non-string details', () => {
    expect(notificationCause('provider.error', { modelId: '   ', provider: 42, error: '' })).toBe('');
  });
});
