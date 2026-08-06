import type { SlackChannelConfig } from '@routerly/shared';

export interface NotificationPayload {
  event: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  details?: Record<string, unknown>;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  warning:  ':warning:',
  info:     ':information_source:',
};

export async function sendSlack(cfg: SlackChannelConfig, payload: NotificationPayload): Promise<void> {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? ':bell:';
  const body = JSON.stringify({
    channel: cfg.channelId,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji} ${payload.event} [${payload.severity.toUpperCase()}]`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Time:*\n${payload.timestamp}` },
          ...(payload.details
            ? Object.entries(payload.details).map(([k, v]) => ({
                type: 'mrkdwn',
                text: `*${k}:*\n${String(v)}`,
              }))
            : []),
        ],
      },
    ],
  });

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.botToken}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Slack HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as { ok: boolean; error?: string };
  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error ?? 'unknown'}`);
  }
}
