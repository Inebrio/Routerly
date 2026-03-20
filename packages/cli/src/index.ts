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
import { makeStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('routerly')
  .description(
    chalk.bold('Routerly.ai') + ' — One gateway. Any AI model. Total control.\n' +
    chalk.gray('Proxy, route and cost-track AI model calls from OpenAI/Anthropic-compatible clients.')
  )
  .version('0.0.1');

program.addCommand(makeStatusCommand());
program.addCommand(makeAuthCommand());
program.addCommand(makeModelCommand());
program.addCommand(makeProjectCommand());
program.addCommand(makeUserCommand());
program.addCommand(makeRoleCommand());
program.addCommand(makeReportCommand());
program.addCommand(makeServiceCommand());

program.parse(process.argv);
