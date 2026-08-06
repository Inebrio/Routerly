import type { DiscordChannelConfig } from '@routerly/shared';
import type { NotificationPayload } from './slack.js';

const SEVERITY_COLOR: Record<string, number> = {
  critical: 0xED4245,
  warning:  0xFEE75C,
  info:     0x5865F2,
};

export async function sendDiscord(cfg: DiscordChannelConfig, payload: NotificationPayload): Promise<void> {
  const color = SEVERITY_COLOR[payload.severity] ?? 0x5865F2;
  const fields = payload.details
    ? Object.entries(payload.details).map(([name, value]) => ({
        name,
        value: String(value),
        inline: true,
      }))
    : undefined;

  const body = JSON.stringify({
    embeds: [
      {
        title:       `${payload.event} [${payload.severity.toUpperCase()}]`,
        color,
        timestamp:   payload.timestamp,
        footer:      { text: 'Routerly' },
        ...(fields?.length ? { fields } : {}),
      },
    ],
  });

  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
  }
}
