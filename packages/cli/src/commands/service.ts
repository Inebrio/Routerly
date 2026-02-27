import { Command } from 'commander';
import chalk from 'chalk';
import { readStore, writeStore, PATHS } from '../store.js';

export function makeServiceCommand(): Command {
  const cmd = new Command('service').description('Control the LocalRouter service');

  cmd.command('status')
    .description('Show current service configuration')
    .action(async () => {
      const settings = await readStore('settings');
      const models = await readStore('models');
      const projects = await readStore('projects');

      console.log(chalk.bold('\nLocalRouter Service Configuration\n'));
      console.log(`  ${chalk.cyan('Port:')}          ${settings.port}`);
      console.log(`  ${chalk.cyan('Host:')}          ${settings.host}`);
      console.log(`  ${chalk.cyan('Dashboard:')}     ${settings.dashboardEnabled ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  ${chalk.cyan('Log level:')}     ${settings.logLevel}`);
      console.log(`  ${chalk.cyan('Timeout:')}       ${settings.defaultTimeoutMs}ms`);
      console.log(`  ${chalk.cyan('Config dir:')}    ${PATHS.config}`);
      console.log(`  ${chalk.cyan('Data dir:')}      ${PATHS.data}`);
      console.log(`  ${chalk.cyan('Models:')}        ${models.length}`);
      console.log(`  ${chalk.cyan('Projects:')}      ${projects.length}`);
      console.log();
    });

  cmd.command('configure')
    .description('Update service settings')
    .option('--port <port>', 'HTTP port to listen on')
    .option('--host <host>', 'Host to bind to')
    .option('--dashboard <bool>', 'Enable/disable dashboard (true|false)')
    .option('--log-level <level>', 'Log level: trace|debug|info|warn|error')
    .option('--timeout <ms>', 'Default per-model timeout in ms')
    .action(async (opts: {
      port?: string; host?: string; dashboard?: string;
      logLevel?: string; timeout?: string;
    }) => {
      const settings = await readStore('settings');

      if (opts.port) settings.port = parseInt(opts.port, 10);
      if (opts.host) settings.host = opts.host;
      if (opts.dashboard !== undefined) settings.dashboardEnabled = opts.dashboard === 'true';
      if (opts.logLevel) settings.logLevel = opts.logLevel as typeof settings.logLevel;
      if (opts.timeout) settings.defaultTimeoutMs = parseInt(opts.timeout, 10);

      await writeStore('settings', settings);
      console.log(chalk.green('✓ Settings updated.'));
    });

  return cmd;
}
