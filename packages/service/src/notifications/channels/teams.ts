import type { TeamsChannelConfig } from '@routerly/shared';
import type { NotificationPayload } from './slack.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'attention',
  warning:  'warning',
  info:     'accent',
};

export async function sendTeams(cfg: TeamsChannelConfig, payload: NotificationPayload): Promise<void> {
  const color = SEVERITY_COLOR[payload.severity] ?? 'default';
  const facts = payload.details
    ? Object.entries(payload.details).map(([title, value]) => ({ title, value: String(value) }))
    : [];

  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body: [
            {
              type: 'TextBlock',
              text: `${payload.event} [${payload.severity.toUpperCase()}]`,
              weight: 'bolder',
              size: 'medium',
              color,
            },
            { type: 'TextBlock', text: payload.timestamp, isSubtle: true, spacing: 'none' },
            ...(facts.length > 0
              ? [{ type: 'FactSet', facts }]
              : []),
          ],
        },
      },
    ],
  };

  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!res.ok) {
    throw new Error(`Teams HTTP ${res.status}: ${await res.text()}`);
  }
}
