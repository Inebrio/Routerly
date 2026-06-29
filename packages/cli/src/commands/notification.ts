import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';
import { CHANNEL_SECRET_FIELDS } from '@routerly/shared';

interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  event: string;
  timestamp: string;
  details?: Record<string, unknown>;
  read?: boolean;
}

interface NotificationInboxResponse {
  items: Notification[];
  unreadCount?: number;
  enabled?: boolean;
}

function severityColor(sev: Notification['severity']): string {
  return sev === 'critical' ? chalk.red(sev) : sev === 'warning' ? chalk.yellow(sev) : chalk.blue(sev);
}

function detailsSummary(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return chalk.gray('—');
  const s = JSON.stringify(details);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

interface ChannelBase { id: string; provider: string; name?: string; events?: string[]; targets?: { roles?: string[]; permissions?: string[]; users?: string[] } }

function providerSummary(ch: ChannelBase & Record<string, unknown>): string {
  switch (ch.provider) {
    case 'slack':     return `channelId=${String(ch['channelId'] ?? '')}`;
    case 'teams':
    case 'discord':   return `url=${String(ch['webhookUrl'] ?? '').slice(0, 40)}…`;
    case 'pagerduty': return `key=***`;
    case 'webhook':   return `url=${String(ch['url'] ?? '').slice(0, 40)}…`;
    case 'dashboard': return 'in-app inbox';
    default:          return `from=${String(ch['fromAddress'] ?? '')}`;
  }
}

function targetsSummary(t?: ChannelBase['targets']): string {
  if (!t) return '—';
  const parts: string[] = [];
  if (t.roles?.length)       parts.push(`roles:${t.roles.join(',')}`);
  if (t.permissions?.length) parts.push(`perms:${t.permissions.join(',')}`);
  if (t.users?.length)       parts.push(`users:${t.users.join(',')}`);
  return parts.length ? parts.join(' ') : 'everyone';
}

export function makeNotificationCommand(): Command {
  const cmd = new Command('notification').description('Manage inbox notifications and channels');

  cmd.command('list')
    .description('List recent notifications')
    .option('--json', 'Output as JSON')
    .option('--from <date>', 'Only notifications on/after this date (YYYY-MM-DD or ISO)')
    .option('--to <date>', 'Only notifications on/before this date (YYYY-MM-DD or ISO)')
    .action(async (opts: { json?: boolean; from?: string; to?: string }) => {
      try {
        const q = new URLSearchParams({ limit: '50' });
        if (opts.from) q.set('from', opts.from);
        if (opts.to) q.set('to', opts.to);
        const data = await api<NotificationInboxResponse | Notification[]>('GET', `/api/notifications/inbox?${q.toString()}`);
        const notifications = Array.isArray(data) ? data : data.items;

        if (opts.json) {
          console.log(JSON.stringify(notifications, null, 2));
          return;
        }

        if (notifications.length === 0) {
          console.log(chalk.yellow('No notifications.'));
          return;
        }

        const table = new Table({
          head: ['ID', 'Severity', 'Event', 'Timestamp', 'Details'].map(h => chalk.cyan(h)),
        });

        for (const n of notifications) {
          table.push([
            n.id,
            severityColor(n.severity),
            n.event,
            new Date(n.timestamp).toLocaleString(),
            detailsSummary(n.details),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('show <id>')
    .description('Show a single inbox notification with full details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const n = await api<Notification>('GET', `/api/notifications/inbox/${id}`);
        if (opts.json) {
          console.log(JSON.stringify(n, null, 2));
          return;
        }
        const table = new Table();
        table.push(
          { ID: n.id },
          { Event: n.event },
          { Severity: severityColor(n.severity) },
          { Status: n.read ? chalk.gray('read') : chalk.cyan('unread') },
          { Timestamp: new Date(n.timestamp).toLocaleString() },
        );
        console.log(table.toString());
        const entries = Object.entries(n.details ?? {});
        if (entries.length > 0) {
          console.log(chalk.cyan('\nDetails:'));
          const dt = new Table({ head: ['Key', 'Value'].map(h => chalk.cyan(h)) });
          for (const [k, v] of entries) dt.push([k, typeof v === 'string' ? v : JSON.stringify(v)]);
          console.log(dt.toString());
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Notification "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.command('read [id]')
    .description('Mark notification(s) as read. Omit <id> to mark all as read.')
    .action(async (id?: string) => {
      try {
        const body = id ? { ids: [id] } : { all: true };
        await api<void>('POST', '/api/notifications/inbox/read', body);
        console.log(chalk.green(id ? `Notification "${id}" marked as read.` : 'Marked all notifications as read.'));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('unread [id]')
    .description('Mark notification(s) as unread. Omit <id> to mark all as unread.')
    .action(async (id?: string) => {
      try {
        const body = id ? { ids: [id] } : { all: true };
        await api<void>('POST', '/api/notifications/inbox/unread', body);
        console.log(chalk.green(id ? `Notification "${id}" marked as unread.` : 'Marked all notifications as unread.'));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  cmd.command('delete [ids...]')
    .description('Delete one or more notifications from your inbox. Use --all to delete every notification.')
    .option('--all', 'Delete all notifications in your inbox')
    .option('--json', 'Output as JSON')
    .action(async (ids: string[], opts: { all?: boolean; json?: boolean }) => {
      try {
        if (!opts.all && ids.length === 0) {
          console.error(chalk.red('Provide one or more notification IDs, or use --all.'));
          process.exit(1);
        }
        const body = opts.all ? { all: true } : { ids };
        const res = await api<{ deleted: number }>('POST', '/api/notifications/inbox/delete', body);
        if (opts.json) {
          console.log(JSON.stringify(res, null, 2));
          return;
        }
        console.log(chalk.green(`Deleted ${res.deleted} notification${res.deleted === 1 ? '' : 's'}.`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const channel = new Command('channel').description('Notification channel sub-commands');

  channel
    .command('list')
    .description('List configured notification channels')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const channels = await api<ChannelBase[]>('GET', '/api/notifications/channels');
        if (opts.json) {
          console.log(JSON.stringify(channels, null, 2));
          return;
        }
        if (!channels.length) {
          console.log(chalk.gray('No notification channels configured.'));
          return;
        }
        const rows = channels.map(ch => ({
          Name:    ch.name ?? '(unnamed)',
          Type:    ch.provider,
          Config:  providerSummary(ch as ChannelBase & Record<string, unknown>),
          Events:  ch.events?.length ? ch.events.join(', ') : '*',
          Targets: targetsSummary(ch.targets),
        }));
        console.table(rows);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const add = new Command('add').description('Add a notification channel');
  add
    .requiredOption('--type <type>', 'Channel type: slack|teams|pagerduty|discord|dashboard')
    .requiredOption('--name <name>', 'Friendly name for this channel')
    .option('--bot-token <token>', 'Slack bot token (xoxb-…)')
    .option('--channel-id <id>', 'Slack channel ID')
    .option('--webhook-url <url>', 'Webhook URL (Teams or Discord)')
    .option('--integration-key <key>', 'PagerDuty integration key')
    .option('--events <patterns>', 'Comma-separated event patterns this channel receives (e.g. budget.*,model.added)')
    .option('--target-roles <roles>', 'Comma-separated role IDs to target')
    .option('--target-permissions <perms>', 'Comma-separated permission names to target')
    .option('--target-users <users>', 'Comma-separated user IDs to target')
    .action(async (opts: {
      type: string; name: string;
      botToken?: string; channelId?: string;
      webhookUrl?: string; integrationKey?: string;
      events?: string; targetRoles?: string; targetPermissions?: string; targetUsers?: string;
    }) => {
      // ponytail: build optional shared fields once, spread into provider body
      const shared: Record<string, unknown> = { name: opts.name };
      if (opts.events) shared['events'] = opts.events.split(',').map(s => s.trim()).filter(Boolean);
      const targets: Record<string, unknown> = {};
      if (opts.targetRoles)       targets['roles']       = opts.targetRoles.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.targetPermissions) targets['permissions'] = opts.targetPermissions.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.targetUsers)       targets['users']       = opts.targetUsers.split(',').map(s => s.trim()).filter(Boolean);
      if (Object.keys(targets).length) shared['targets'] = targets;

      let body: Record<string, unknown>;
      switch (opts.type) {
        case 'slack':
          if (!opts.botToken || !opts.channelId) {
            console.error(chalk.red('--bot-token and --channel-id are required for slack'));
            process.exit(1);
          }
          body = { provider: 'slack', ...shared, botToken: opts.botToken, channelId: opts.channelId };
          break;
        case 'teams':
          if (!opts.webhookUrl) { console.error(chalk.red('--webhook-url is required for teams')); process.exit(1); }
          body = { provider: 'teams', ...shared, webhookUrl: opts.webhookUrl };
          break;
        case 'pagerduty':
          if (!opts.integrationKey) { console.error(chalk.red('--integration-key is required for pagerduty')); process.exit(1); }
          body = { provider: 'pagerduty', ...shared, integrationKey: opts.integrationKey };
          break;
        case 'discord':
          if (!opts.webhookUrl) { console.error(chalk.red('--webhook-url is required for discord')); process.exit(1); }
          body = { provider: 'discord', ...shared, webhookUrl: opts.webhookUrl };
          break;
        case 'dashboard':
          body = { provider: 'dashboard', ...shared };
          break;
        default:
          console.error(chalk.red(`Unknown type: ${opts.type}. Must be one of: slack, teams, pagerduty, discord, dashboard`));
          process.exit(1);
      }
      try {
        const ch = await api<ChannelBase>('POST', '/api/notifications/channels', body);
        console.log(chalk.green(`Channel added (id: ${ch.id})`));
      } catch (err) {
        if (err instanceof ApiError) console.error(chalk.red(`API error ${err.status}: ${err.message}`));
        else console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
  channel.addCommand(add);

  channel
    .command('delete <id>')
    .description('Delete a notification channel by ID')
    .action(async (id: string) => {
      try {
        await api<void>('DELETE', `/api/notifications/channels/${id}`);
        console.log(chalk.green(`Channel ${id} deleted.`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Channel "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  channel
    .command('test <id>')
    .description('Send a test notification via the given channel ID')
    .option('--to <email>', 'Recipient address for email-provider channels (defaults to your account email)')
    .action(async (id: string, opts: { to?: string }) => {
      try {
        const result = await api<{ ok: boolean; message: string }>('POST', `/api/notifications/channels/${id}/test`, { to: opts.to });
        if (result.ok) {
          console.log(chalk.green(`Test sent: ${result.message}`));
        } else {
          console.error(chalk.red(`Test failed: ${result.message}`));
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Channel "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  channel
    .command('show <id>')
    .description('Show a notification channel by ID (secrets are masked)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const ch = await api<ChannelBase & Record<string, unknown>>('GET', `/api/notifications/channels/${id}`);
        if (opts.json) {
          console.log(JSON.stringify(ch, null, 2));
          return;
        }
        console.log(chalk.bold(`${ch.name ?? '(unnamed)'} [${ch.provider}]`));
        console.log(chalk.gray(`id: ${ch.id}`));
        if (ch.events?.length) {
          console.log(chalk.gray(`events: ${ch.events.join(', ')}`));
        } else {
          console.log(chalk.gray('events: all'));
        }
        if (ch.targets) console.log(chalk.gray(`targets: ${JSON.stringify(ch.targets)}`));
        // Print provider-specific fields; secrets shown as ***
        const secrets: string[] = CHANNEL_SECRET_FIELDS[ch.provider as keyof typeof CHANNEL_SECRET_FIELDS] ?? [];
        const skip = new Set(['id', 'provider', 'name', 'events', 'targets']);
        for (const [key, val] of Object.entries(ch)) {
          if (skip.has(key)) continue;
          const display = secrets.includes(key)
            ? (val ? chalk.yellow('*** (configured)') : chalk.gray('(not set)'))
            : String(val ?? '');
          console.log(`  ${chalk.cyan(key)}: ${display}`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Channel "${id}" not found.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  channel
    .command('edit <id>')
    .description('Edit a notification channel interactively')
    .option('--name <name>', 'New friendly name')
    .option('--events <patterns>', 'Comma-separated event patterns (empty string to clear)')
    .option('--target-roles <roles>', 'Comma-separated role IDs')
    .option('--target-permissions <perms>', 'Comma-separated permissions')
    .option('--target-users <users>', 'Comma-separated user IDs')
    // smtp fields
    .option('--host <host>', 'SMTP host')
    .option('--port <port>', 'SMTP port', (v) => parseInt(v, 10))
    .option('--from-address <addr>', 'From email address')
    .option('--from-name <name>', 'From display name')
    .option('--username <user>', 'SMTP username')
    .option('--password <pass>', 'SMTP password (secret)')
    // ses
    .option('--region <region>', 'AWS region')
    .option('--access-key-id <id>', 'AWS access key ID')
    .option('--secret-access-key <key>', 'AWS secret access key (secret)')
    // sendgrid
    .option('--api-key <key>', 'SendGrid API key (secret)')
    // azure
    .option('--connection-string <str>', 'Azure connection string (secret)')
    // google
    .option('--client-id <id>', 'Google client ID')
    .option('--client-secret <secret>', 'Google client secret (secret)')
    .option('--refresh-token <token>', 'Google refresh token (secret)')
    // webhook
    .option('--url <url>', 'Webhook URL')
    .option('--method <method>', 'HTTP method (POST|GET)')
    .option('--secret <secret>', 'HMAC signing secret (secret)')
    // slack
    .option('--bot-token <token>', 'Slack bot token (secret)')
    .option('--channel-id <id>', 'Slack channel ID')
    // teams / discord
    .option('--webhook-url <url>', 'Webhook URL (Teams/Discord; secret)')
    // pagerduty
    .option('--integration-key <key>', 'PagerDuty integration key (secret)')
    .action(async (id: string, opts: Record<string, unknown>) => {
      try {
        const patch: Record<string, unknown> = {};

        // Non-secret shared fields
        if (opts['name'] !== undefined)   patch['name']   = opts['name'];
        if (opts['fromAddress'] !== undefined) patch['fromAddress'] = opts['fromAddress'];
        if (opts['fromName'] !== undefined)    patch['fromName']    = opts['fromName'];
        if (opts['host'] !== undefined)   patch['host']   = opts['host'];
        if (opts['port'] !== undefined)   patch['port']   = opts['port'];
        if (opts['region'] !== undefined) patch['region'] = opts['region'];
        if (opts['accessKeyId'] !== undefined) patch['accessKeyId'] = opts['accessKeyId'];
        if (opts['clientId'] !== undefined)    patch['clientId']    = opts['clientId'];
        if (opts['url'] !== undefined)    patch['url']    = opts['url'];
        if (opts['method'] !== undefined) patch['method'] = opts['method'];
        if (opts['channelId'] !== undefined)   patch['channelId']   = opts['channelId'];

        // Events
        if (opts['events'] !== undefined) {
          const ev = String(opts['events']).trim();
          patch['events'] = ev ? ev.split(',').map(s => s.trim()).filter(Boolean) : [];
        }

        // Targets
        const targets: Record<string, unknown> = {};
        if (opts['targetRoles'])       targets['roles']       = String(opts['targetRoles']).split(',').map(s => s.trim()).filter(Boolean);
        if (opts['targetPermissions']) targets['permissions'] = String(opts['targetPermissions']).split(',').map(s => s.trim()).filter(Boolean);
        if (opts['targetUsers'])       targets['users']       = String(opts['targetUsers']).split(',').map(s => s.trim()).filter(Boolean);
        if (Object.keys(targets).length) patch['targets'] = targets;

        // Secret fields — only include when explicitly provided (non-empty)
        const secretFields: Record<string, string> = {
          password:        String(opts['password'] ?? ''),
          secretAccessKey: String(opts['secretAccessKey'] ?? ''),
          apiKey:          String(opts['apiKey'] ?? ''),
          connectionString: String(opts['connectionString'] ?? ''),
          clientSecret:    String(opts['clientSecret'] ?? ''),
          refreshToken:    String(opts['refreshToken'] ?? ''),
          secret:          String(opts['secret'] ?? ''),
          botToken:        String(opts['botToken'] ?? ''),
          webhookUrl:      String(opts['webhookUrl'] ?? ''),
          integrationKey:  String(opts['integrationKey'] ?? ''),
        };
        for (const [key, val] of Object.entries(secretFields)) {
          if (opts[key] !== undefined && val.length > 0) patch[key] = val;
        }

        if (Object.keys(patch).length === 0) {
          console.error(chalk.yellow('No fields to update. Provide at least one option.'));
          process.exit(1);
        }

        const updated = await api<ChannelBase & Record<string, unknown>>('PATCH', `/api/notifications/channels/${id}`, patch);
        console.log(chalk.green(`Channel "${id}" updated.`));
        console.log(JSON.stringify(updated, null, 2));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          console.error(chalk.red(`Channel "${id}" not found.`));
        } else if (err instanceof ApiError && err.status === 400) {
          console.error(chalk.red(`Bad request: ${err.message}`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      }
    });

  cmd.addCommand(channel);
  return cmd;
}
