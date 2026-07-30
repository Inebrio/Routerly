import type { ClientIntegration } from './types.js';
import { claudeCodeIntegration } from './claude-code.js';

// ponytail: Tasks 6-8 register the remaining concrete integrations per client
export const INTEGRATIONS: Record<string, ClientIntegration> = {
  [claudeCodeIntegration.id]: claudeCodeIntegration,
};

export type { ClientIntegration } from './types.js';
export { acquireToken } from './token.js';
