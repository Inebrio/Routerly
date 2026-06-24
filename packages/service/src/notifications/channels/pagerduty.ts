import type { PagerDutyChannelConfig } from '@routerly/shared';
import type { NotificationPayload } from './slack.js';

const SEVERITY_MAP: Record<string, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning:  'warning',
  info:     'info',
};

export async function sendPagerDuty(cfg: PagerDutyChannelConfig, payload: NotificationPayload): Promise<void> {
  const severity = SEVERITY_MAP[payload.severity] ?? 'info';
  const body = JSON.stringify({
    routing_key:   cfg.integrationKey,
    event_action:  'trigger',
    payload: {
      summary:   `${payload.event} [${payload.severity.toUpperCase()}]`,
      timestamp: payload.timestamp,
      severity,
      source:    'Routerly',
      custom_details: payload.details ?? {},
    },
  });

  const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`PagerDuty HTTP ${res.status}: ${await res.text()}`);
  }
}
