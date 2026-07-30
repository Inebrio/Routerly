import type { ClientIntegration } from './types.js';
import { claudeCodeIntegration } from './claude-code.js';
import { codexIntegration } from './codex.js';
import { opencodeIntegration } from './opencode.js';

// ponytail: Task 8 registers the remaining concrete integrations per client
export const INTEGRATIONS: Record<string, ClientIntegration> = {
  [claudeCodeIntegration.id]: claudeCodeIntegration,
  [codexIntegration.id]: codexIntegration,
  [opencodeIntegration.id]: opencodeIntegration,
};

export type { ClientIntegration } from './types.js';
export { acquireToken } from './token.js';
