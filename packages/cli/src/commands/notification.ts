import { Command } from 'commander';
import chalk from 'chalk';
import { api, ApiError } from '../api.js';

interface ChannelBase { id: string; provider: string; name?: string }

function providerSummary(ch: ChannelBase & Record<string, unknown>): string {
  switch (ch.provider) {
    case 'slack':     return `channelId=${String(ch['channelId'] ?? '')}`;
    case 'teams':
    case 'discord':   return `url=${String(ch['webhookUrl'] ?? '').slice(0, 40)}…`;
    case 'pagerduty': return `key=***`;
    case 'webhook':   return `url=${String(ch['url'] ?? '').slice(0, 40)}…`;
    default:          return `from=${String(ch['fromAddress'] ?? '')}`;
  }
}

export function makeNotificationCommand(): Command {
  const cmd = new Command('notification').description('Manage notification channels');

  const channel = new Command('channel').description('Notification channel sub-commands');

  channel
    .command('list')
    .description('List configured notification channels')
    .action(async () => {
      try {
        const channels = await api<ChannelBase[]>('GET', '/api/notifications/channels');
        if (!channels.length) {
          console.log(chalk.gray('No notification channels configured.'));
          return;
        }
        const rows = channels.map(ch => ({
          Name:    ch.name ?? '(unnamed)',
          Type:    ch.provider,
          Config:  providerSummary(ch as ChannelBase & Record<string, unknown>),
        }));
        console.table(rows);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const add = new Command('add').description('Add a notification channel');

  add
    .requiredOption('--type <type>', 'Channel type: slack|teams|pagerduty|discord')
    .requiredOption('--name <name>', 'Friendly name for this channel')
    // slack
    .option('--bot-token <token>', 'Slack bot token (xoxb-…)')
    .option('--channel-id <id>', 'Slack channel ID')
    // teams / discord
    .option('--webhook-url <url>', 'Webhook URL (Teams or Discord)')
    // pagerduty
    .option('--integration-key <key>', 'PagerDuty integration key')
    .action(async (opts: {
      type: string; name: string;
      botToken?: string; channelId?: string;
      webhookUrl?: string; integrationKey?: string;
    }) => {
      let body: Record<string, unknown>;
      switch (opts.type) {
        case 'slack':
          if (!opts.botToken || !opts.channelId) {
            console.error(chalk.red('--bot-token and --channel-id are required for slack'));
            process.exit(1);
          }
          body = { provider: 'slack', name: opts.name, botToken: opts.botToken, channelId: opts.channelId };
          break;
        case 'teams':
          if (!opts.webhookUrl) { console.error(chalk.red('--webhook-url is required for teams')); process.exit(1); }
          body = { provider: 'teams', name: opts.name, webhookUrl: opts.webhookUrl };
          break;
        case 'pagerduty':
          if (!opts.integrationKey) { console.error(chalk.red('--integration-key is required for pagerduty')); process.exit(1); }
          body = { provider: 'pagerduty', name: opts.name, integrationKey: opts.integrationKey };
          break;
        case 'discord':
          if (!opts.webhookUrl) { console.error(chalk.red('--webhook-url is required for discord')); process.exit(1); }
          body = { provider: 'discord', name: opts.name, webhookUrl: opts.webhookUrl };
          break;
        default:
          console.error(chalk.red(`Unknown type: ${opts.type}. Must be one of: slack, teams, pagerduty, discord`));
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
