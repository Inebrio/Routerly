import { defineModule } from '../../core/index.js';
import { UPDATE_CHECKER } from '../../core/tokens.js';
import { updateChecker } from './update-checker.js';

/**
 * Update-checker module: owns the real GitHub Releases polling singleton
 * (update-checker.ts) and exposes it behind the UPDATE_CHECKER DI token.
 * Other files still import update-checker.ts directly by path; this module
 * additionally makes it reachable through the container.
 */
export const updateCheckerModule = defineModule({
  manifest: { id: 'update-checker', version: '0.4.0' },
  register({ container }) {
    container.register(UPDATE_CHECKER, {
      start: (currentVersion, channel) => updateChecker.start(currentVersion, channel),
      updateChannel: (channel) => updateChecker.updateChannel(channel),
      check: () => updateChecker.check(),
      getAvailableReleases: () => updateChecker.getAvailableReleases(),
      getLastResult: () => updateChecker.getLastResult(),
      stop: () => updateChecker.stop(),
    });
  },
});
