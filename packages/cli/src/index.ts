#!/usr/bin/env tsx
import { Command } from 'commander';
import chalk from 'chalk';
import { makeAuthCommand } from './commands/auth.js';
import { makeModelCommand } from './commands/model.js';
import { makeProjectCommand } from './commands/project.js';
import { makeUserCommand } from './commands/user.js';
import { makeRoleCommand } from './commands/role.js';
import { makeReportCommand } from './commands/report.js';
import { makeServiceCommand } from './commands/service.js';

const program = new Command();

program
  .name('routerly')
  .description(
    chalk.bold('Routerly') + ' — Self-hosted LLM API gateway\n' +
    chalk.gray('Proxy, route and cost-track AI model calls from OpenAI/Anthropic-compatible clients.')
  )
  .version('0.0.1');

program.addCommand(makeAuthCommand());
program.addCommand(makeModelCommand());
program.addCommand(makeProjectCommand());
program.addCommand(makeUserCommand());
program.addCommand(makeRoleCommand());
program.addCommand(makeReportCommand());
program.addCommand(makeServiceCommand());

// ── Utility: start service (for convenience) ─────────────────────────────────
program.command('start')
  .description('Start the Routerly service (shortcut for `node packages/service/dist/index.js`)')
  .action(async () => {
    const { startServer } = await import('../../service/src/server.js');
    await startServer();
  });

program.parse(process.argv);
