import { describe, it, expect } from 'vitest';
import { clampDebugWidth, maxDebugWidth, minDebugWidth, DEBUG_MIN, DEBUG_MAX, CONVERSATION_MIN } from './debugPanelLayout';

describe('clampDebugWidth', () => {
  it('keeps width between min and max on a wide container', () => {
    expect(clampDebugWidth(10, 1600)).toBe(DEBUG_MIN);
    expect(clampDebugWidth(5000, 1600)).toBe(DEBUG_MAX);
    expect(clampDebugWidth(400, 1600)).toBe(400);
  });
  it('leaves the conversation its minimum', () => {
    expect(maxDebugWidth(900)).toBe(900 - CONVERSATION_MIN);
    expect(clampDebugWidth(720, 900)).toBe(540);
  });
  it('takes at most half the row on narrow containers', () => {
    expect(maxDebugWidth(500)).toBe(250);
    expect(minDebugWidth(500)).toBe(250);
    expect(clampDebugWidth(720, 500)).toBe(250);
  });
  it('falls back to default on NaN', () => {
    expect(clampDebugWidth(NaN, 1600)).toBe(380);
  });
});
