import { defineModule } from '../../core/index.js';
import { TELEMETRY } from '../../core/tokens.js';
import { pingTelemetry } from './telemetry.js';

/**
 * Telemetry module: owns the real install/upgrade ping implementation
 * (telemetry.ts) and exposes it behind the TELEMETRY DI token. Other files
 * still import telemetry.ts directly by path; this module additionally
 * makes it reachable through the container.
 */
export const telemetryModule = defineModule({
  manifest: { id: 'telemetry', version: '0.4.0' },
  register({ container }) {
    container.register(TELEMETRY, { pingTelemetry });
  },
});
