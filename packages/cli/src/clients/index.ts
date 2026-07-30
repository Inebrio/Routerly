import type { ClientIntegration } from './types.js';
import { claudeCodeIntegration } from './claude-code.js';
import { codexIntegration } from './codex.js';
import { opencodeIntegration } from './opencode.js';
import { continueIntegration, clineIntegration } from './continue.js';

export const INTEGRATIONS: Record<string, ClientIntegration> = {
  [claudeCodeIntegration.id]: claudeCodeIntegration,
  [codexIntegration.id]: codexIntegration,
  [opencodeIntegration.id]: opencodeIntegration,
  [continueIntegration.id]: continueIntegration,
  [clineIntegration.id]: clineIntegration,
};

export type { ClientIntegration } from './types.js';
export { acquireToken } from './token.js';
