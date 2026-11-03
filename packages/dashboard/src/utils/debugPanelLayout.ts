// Width limits of the Playground Debug panel. The panel is never narrower than
// MIN, never wider than MAX, and always leaves the conversation CONVERSATION_MIN.
export const DEBUG_MIN = 280;
export const DEBUG_MAX = 720;
export const DEBUG_DEFAULT = 380;
export const CONVERSATION_MIN = 360;

export function maxDebugWidth(containerWidth: number): number {
  // Narrow windows: the panel takes at most half of the row so the conversation stays visible.
  if (containerWidth < DEBUG_MIN + CONVERSATION_MIN) return Math.max(200, Math.floor(containerWidth / 2));
  return Math.min(DEBUG_MAX, containerWidth - CONVERSATION_MIN);
}

export function minDebugWidth(containerWidth: number): number {
  return Math.min(DEBUG_MIN, maxDebugWidth(containerWidth));
}

export function clampDebugWidth(width: number, containerWidth: number): number {
  const w = Number.isFinite(width) ? width : DEBUG_DEFAULT;
  return Math.round(Math.min(maxDebugWidth(containerWidth), Math.max(minDebugWidth(containerWidth), w)));
}
