import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api, ApiError } from '../api.js';

interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'error';
  event: string;
  timestamp: string;
  details?: string;
  read?: boolean;
}

interface NotificationInboxResponse {
  notifications: Notification[];
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
    .action(async (opts: { json?: boolean }) => {
      try {
        const data = await api<NotificationInboxResponse | Notification[]>('GET', '/api/notifications/inbox?limit=50');
        const notifications = Array.isArray(data) ? data : data.notifications;

        if (opts.json) {
          console.log(JSON.stringify(notifications, null, 2));
          return;
        }

        if (notifications.length === 0) {
          console.log(chalk.yellow('No notifications.'));
          return;
        }

        const table = new Table({
          head: ['Severity', 'Event', 'Timestamp', 'Details'].map(h => chalk.cyan(h)),
        });

        for (const n of notifications) {
          const severity = n.severity === 'error'
            ? chalk.red(n.severity)
            : n.severity === 'warning'
              ? chalk.yellow(n.severity)
              : chalk.blue(n.severity);
          const details = n.details ? (n.details.length > 60 ? n.details.slice(0, 57) + '…' : n.details) : chalk.gray('—');
          table.push([
            severity,
            n.event,
            new Date(n.timestamp).toLocaleString(),
            details,
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
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
    .action(async (id: string) => {
      try {
        const result = await api<{ ok: boolean; message: string }>('POST', `/api/notifications/channels/${id}/test`, {});
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

  cmd.addCommand(channel);
  return cmd;
}
