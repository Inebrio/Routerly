import { defineModule } from '../../core/index.js';
import { AUDIT } from '../../core/tokens.js';
import { logAudit } from './logger.js';

/**
 * Audit module: owns the real audit-trail implementation (logger.ts) and
 * exposes it behind the AUDIT DI token. Other files still import logger.ts
 * directly by path; this module additionally makes it reachable through the
 * container.
 */
export const auditModule = defineModule({
  manifest: { id: 'audit', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(AUDIT, { logAudit });
  },
});
