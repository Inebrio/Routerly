import { defineModule } from '../../core/index.js';
import { NOTIFICATIONS } from '../../core/tokens.js';
import { emitEvent, appendToInbox } from './emitter.js';
import { dispatchNotification, sendTestNotification } from './sender.js';

/**
 * Notifications module: owns the real notifications implementation
 * (emitter.ts, sender.ts, channels/) and exposes it behind the NOTIFICATIONS
 * DI token. Other files still import emitter.ts/sender.ts directly by path;
 * this module additionally makes it reachable through the container.
 */
export const notificationsModule = defineModule({
  manifest: { id: 'notifications', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(NOTIFICATIONS, {
      emitEvent,
      appendToInbox,
      dispatchNotification,
      sendTestNotification,
    });
  },
});
