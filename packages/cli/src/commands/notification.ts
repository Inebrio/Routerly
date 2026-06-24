import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { api } from '../api.js';

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

export function makeNotificationCommand(): Command {
  const cmd = new Command('notification').description('Manage inbox notifications');

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

  return cmd;
}
