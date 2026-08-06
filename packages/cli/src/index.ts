#!/usr/bin/env tsx
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';

const { version: pkgVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string };
import { makeAuthCommand } from './commands/auth.js';
import { makeModelCommand } from './commands/model.js';
import { makeProjectCommand } from './commands/project.js';
import { makeUserCommand } from './commands/user.js';
import { makeRoleCommand } from './commands/role.js';
import { makeReportCommand } from './commands/report.js';
import { makeServiceCommand } from './commands/service.js';
import { makeStatusCommand } from './commands/status.js';
import { makeUpdateCommand } from './commands/update.js';
import { makeTelemetryCommand } from './commands/telemetry.js';
import { makeNotificationCommand } from './commands/notification.js';
import { makeAuditCommand } from './commands/audit.js';
import { makeIntegrationsCommand } from './commands/integrations.js';
import { makeCatalogCommand } from './commands/catalog.js';
import { makeModulesCommand } from './commands/modules.js';
import { makeConnectionsCommand } from './commands/connections.js';
import { makeResilienceCommand } from './commands/resilience.js';
import { makeProfilesCommand } from './commands/profiles.js';
import { makeOptimizersCommand } from './commands/optimizers.js';
import { makeExperimentsCommand } from './commands/experiments.js';
import { makeClientsCommand } from './commands/clients.js';
import { makeMcpCommand } from './commands/mcp.js';

const program = new Command();

program
  .name('routerly')
  .description(
    chalk.bold('Routerly.ai') + ' — One gateway. Any AI model. Total control.\n' +
    chalk.gray('Proxy, route and cost-track AI model calls from OpenAI/Anthropic-compatible clients.')
  )
  .version(pkgVersion);

program.addCommand(makeStatusCommand());
program.addCommand(makeAuthCommand());
program.addCommand(makeModelCommand());
program.addCommand(makeProjectCommand());
program.addCommand(makeUserCommand());
program.addCommand(makeRoleCommand());
program.addCommand(makeReportCommand());
program.addCommand(makeServiceCommand());
program.addCommand(makeUpdateCommand());
program.addCommand(makeTelemetryCommand());
program.addCommand(makeNotificationCommand());
program.addCommand(makeAuditCommand());
program.addCommand(makeIntegrationsCommand());
program.addCommand(makeCatalogCommand());
program.addCommand(makeModulesCommand());
program.addCommand(makeConnectionsCommand());
program.addCommand(makeResilienceCommand());
program.addCommand(makeProfilesCommand());
program.addCommand(makeOptimizersCommand());
program.addCommand(makeExperimentsCommand());
program.addCommand(makeClientsCommand());
program.addCommand(makeMcpCommand());

program.parse(process.argv);
