import type { ClientIntegration } from './types.js';
import { claudeCodeIntegration } from './claude-code.js';
import { codexIntegration } from './codex.js';
import { opencodeIntegration } from './opencode.js';
import { continueIntegration, clineIntegration } from './continue.js';
import { MANUAL_INTEGRATIONS } from './manual.js';

export const INTEGRATIONS: Record<string, ClientIntegration> = {
  [claudeCodeIntegration.id]: claudeCodeIntegration,
  [codexIntegration.id]: codexIntegration,
  [opencodeIntegration.id]: opencodeIntegration,
  [continueIntegration.id]: continueIntegration,
  [clineIntegration.id]: clineIntegration,
  ...Object.fromEntries(MANUAL_INTEGRATIONS.map(i => [i.id, i])),
};

export type { ClientIntegration } from './types.js';
export { acquireToken } from './token.js';
