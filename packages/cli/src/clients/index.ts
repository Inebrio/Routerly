import type { ClientIntegration } from './types.js';

// ponytail: empty until Tasks 5-8 register concrete integrations per client
export const INTEGRATIONS: Record<string, ClientIntegration> = {};

export type { ClientIntegration } from './types.js';
export { acquireToken } from './token.js';
