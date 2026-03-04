import nodemailer from 'nodemailer';
import type {
  SmtpChannelConfig,
  SesChannelConfig,
  SendGridChannelConfig,
  AzureChannelConfig,
  GoogleChannelConfig,
  WebhookChannelConfig,
  NotificationChannel,
} from '@localrouter/shared';

interface SendResult {
  ok: boolean;
  message: string;
  /** Set when test succeeded only after flipping the secure flag */
  fixedSecure?: boolean;
}

const TEST_SUBJECT = 'LocalRouter – Test notification';
const TEST_BODY    = 'This is a test message sent from LocalRouter to verify your notification channel is configured correctly.';

// ── SMTP ─────────────────────────────────────────────────────────────────────────────
async function sendSmtp(cfg: SmtpChannelConfig, to: string): Promise<SendResult> {
  const mail = {
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
    to,
    subject: TEST_SUBJECT,
    text: TEST_BODY,
  };

  const tryTransport = async (secure: boolean) => {
    const t = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure,
      tls:    { rejectUnauthorized: false },
      ...(cfg.username ? { auth: { user: cfg.username, pass: cfg.password ?? '' } } : {}),
    });
    await t.sendMail(mail);
  };

  try {
    await tryTransport(cfg.secure);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isSslMismatch = msg.includes('wrong version number') || msg.includes('ssl3_get_record') || msg.includes('ECONNRESET');
    if (isSslMismatch) {
      try {
        await tryTransport(!cfg.secure);
        const correctedSecure = !cfg.secure;
        const hint = correctedSecure
          ? `TLS setting auto-corrected: enable "Use TLS/SSL" in settings (port ${cfg.port} uses direct SSL).`
          : `TLS setting auto-corrected: disable "Use TLS/SSL" in settings (port ${cfg.port} uses STARTTLS).`;
        return { ok: true, message: hint, fixedSecure: correctedSecure };
      } catch {
        throw new Error(`Cannot connect to ${cfg.host}:${cfg.port} — tried both SSL and STARTTLS. Check host/port.`);
      }
    }
    throw e;
  }
  return { ok: true, message: 'Test email sent via SMTP.' };
}

// ── Amazon SES (via SMTP endpoint) ────────────────────────────────────────────────────
async function sendSes(cfg: SesChannelConfig, to: string): Promise<SendResult> {
  const host = `email-smtp.${cfg.region}.amazonaws.com`;
  const transport = nodemailer.createTransport({
    host,
    port:   465,
    secure: true,
    ...(cfg.accessKeyId ? { auth: { user: cfg.accessKeyId, pass: cfg.secretAccessKey ?? '' } } : {}),
  });
  await transport.sendMail({
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
    to,
    subject: TEST_SUBJECT,
    text: TEST_BODY,
  });
  return { ok: true, message: 'Test email sent via Amazon SES.' };
}

// ── SendGrid ────────────────────────────────────────────────────────────────────────
async function sendSendGrid(cfg: SendGridChannelConfig, to: string): Promise<SendResult> {
  const transport = nodemailer.createTransport({
    host:   'smtp.sendgrid.net',
    port:   587,
    secure: false,
    auth:   { user: 'apikey', pass: cfg.apiKey },
  });
  await transport.sendMail({
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
    to,
    subject: TEST_SUBJECT,
    text: TEST_BODY,
  });
  return { ok: true, message: 'Test email sent via SendGrid.' };
}

// ── Azure Communication Services ──────────────────────────────────────────────────
async function sendAzure(cfg: AzureChannelConfig, to: string): Promise<SendResult> {
  const parts = Object.fromEntries(
    cfg.connectionString.split(';').map((p: string) => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).toLowerCase().trim(), p.slice(idx + 1).trim()];
    })
  );
  const endpoint  = parts['endpoint']?.replace(/\/$/, '');
  const accessKey = parts['accesskey'];
  if (!endpoint || !accessKey) throw new Error('Invalid Azure connection string');

  const now    = new Date().toUTCString();
  const body   = JSON.stringify({
    senderAddress: cfg.fromAddress,
    content: { subject: TEST_SUBJECT, plainText: TEST_BODY },
    recipients: { to: [{ address: to }] },
  });

  const { createHmac, createHash } = await import('node:crypto');
  const contentHash = createHash('sha256').update(body).digest('base64');
  const url         = new URL(`${endpoint}/emails:send?api-version=2023-03-31`);
  const strToSign   = `POST\n${url.pathname}${url.search}\n${now};${url.hostname};${contentHash}`;
  const signature   = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(strToSign).digest('base64');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type':        'application/json',
      'x-ms-date':           now,
      'x-ms-content-sha256': contentHash,
      Authorization:         `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure API error ${res.status}: ${err}`);
  }
  return { ok: true, message: 'Test email sent via Azure Communication Services.' };
}

// ── Google / Gmail OAuth2 ──────────────────────────────────────────────────────────
async function sendGoogle(cfg: GoogleChannelConfig, to: string): Promise<SendResult> {
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type:         'OAuth2',
      user:         cfg.fromAddress,
      clientId:     cfg.clientId,
      clientSecret: cfg.clientSecret,
      refreshToken: cfg.refreshToken,
    },
  });
  await transport.sendMail({
    from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
    to,
    subject: TEST_SUBJECT,
    text: TEST_BODY,
  });
  return { ok: true, message: 'Test email sent via Google / Gmail.' };
}

// ── Webhook ───────────────────────────────────────────────────────────────────────────
async function sendWebhook(cfg: WebhookChannelConfig): Promise<SendResult> {
  const payload = { event: 'test', source: 'LocalRouter', timestamp: new Date().toISOString() };
  const body    = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.secret) {
    const { createHmac } = await import('node:crypto');
    headers['X-LocalRouter-Signature'] = `sha256=${createHmac('sha256', cfg.secret).update(body).digest('hex')}`;
  }
  const method = cfg.method ?? 'POST';
  const res = await fetch(cfg.url, {
    method,
    ...(method === 'POST' ? { headers, body } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook responded HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { ok: true, message: `Webhook ping OK — server responded HTTP ${res.status}.` };
}

// ── Public dispatcher ──────────────────────────────────────────────────────────────
export async function sendTestNotification(
  channel: NotificationChannel,
  to: string,
): Promise<SendResult> {
  switch (channel.provider) {
    case 'smtp':     return sendSmtp(channel, to);
    case 'ses':      return sendSes(channel, to);
    case 'sendgrid': return sendSendGrid(channel, to);
    case 'azure':    return sendAzure(channel, to);
    case 'google':   return sendGoogle(channel, to);
    case 'webhook':  return sendWebhook(channel);
    default:         throw new Error(`Unknown provider: ${String((channel as { provider: string }).provider)}`);
  }
}

