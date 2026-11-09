import type { Model } from '../api';

/** True for models that can serve chat requests (decision models cannot). */
export const isChatModel = (m: Model) => m.capabilities?.decision !== true;
