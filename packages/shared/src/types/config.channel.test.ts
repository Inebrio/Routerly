import { describe, it, expect } from 'vitest';
import {
  normalizeUpdateChannel, isValidUpdateChannel,
  UPDATE_CHANNEL_ERROR,
} from './config.js';

describe('normalizeUpdateChannel', () => {
  it.each([
    [undefined, 'latest'],
    ['', 'latest'],
    ['latest', 'latest'],
    ['current', 'current'],
    ['next', 'next'],
    ['develop', 'develop'],
  ])('resolves %j to %j', (input, expected) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(expected);
  });

  it.each([
    'v0.3.0',
    '0.3.0',
    'some-other-string',
    'stable',
  ])('passes %j through verbatim', (input) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(input);
  });

  it.each([
    'Stable',
    ' stable',
    'STABLE',
  ])('does NOT case-fold or trim %j — it passes through verbatim (EC4)', (input) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(input);
  });
});

describe('isValidUpdateChannel', () => {
  it.each([
    'latest', 'current', 'next', 'develop',
    'v0.4.0', '0.4.0', 'v0.4.0-rc.1', '1.2.3-beta.2',
  ])('accepts %j', (value) => {
    expect(isValidUpdateChannel(value)).toBe(true);
  });

  it.each([
    'banana', '', 'Stable', ' current', 'v0.4', '0.4', 'v0.4.0.0', 'v0.4.0-', 'stable',
  ])('rejects %j', (value) => {
    expect(isValidUpdateChannel(value)).toBe(false);
  });
});

describe('UPDATE_CHANNEL_ERROR', () => {
  it('names the accepted values', () => {
    expect(UPDATE_CHANNEL_ERROR).toBe(
      'Invalid channel. Accepted values: latest, current, next, develop, or a version tag such as v0.4.0.',
    );
  });
});
