import { describe, it, expect } from 'vitest';
import {
  normalizeUpdateChannel, updateChannelDeprecationWarning, isValidUpdateChannel,
  UPDATE_CHANNEL_ERROR,
} from './config.js';

describe('normalizeUpdateChannel', () => {
  it.each([
    [undefined, 'latest'],
    ['', 'latest'],
    ['latest', 'latest'],
    ['current', 'current'],
    ['next', 'next'],
  ])('resolves %j to %j with no deprecated alias', (input, expected) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(expected);
    expect(result.deprecatedAlias).toBeUndefined();
  });

  it('maps "stable" to "current" and reports the alias', () => {
    expect(normalizeUpdateChannel('stable')).toEqual({ channel: 'current', deprecatedAlias: 'stable' });
  });

  it('maps "develop" to "next" and reports the alias', () => {
    expect(normalizeUpdateChannel('develop')).toEqual({ channel: 'next', deprecatedAlias: 'develop' });
  });

  it.each([
    'v0.3.0',
    '0.3.0',
    'some-other-string',
  ])('passes %j through verbatim, with no deprecated alias', (input) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(input);
    expect(result.deprecatedAlias).toBeUndefined();
  });

  it.each([
    'Stable',
    ' stable',
    'STABLE',
  ])('does NOT case-fold or trim %j — it passes through verbatim (EC4)', (input) => {
    const result = normalizeUpdateChannel(input);
    expect(result.channel).toBe(input);
    expect(result.deprecatedAlias).toBeUndefined();
  });
});

describe('updateChannelDeprecationWarning', () => {
  it('returns the exact stable sentence', () => {
    expect(updateChannelDeprecationWarning('stable')).toBe(
      'Update channel "stable" was renamed to "current". "stable" still works but is deprecated and will be removed in a future release; switch to "current".',
    );
  });

  it('returns the exact develop sentence', () => {
    expect(updateChannelDeprecationWarning('develop')).toBe(
      'Update channel "develop" was renamed to "next". "develop" still works but is deprecated and will be removed in a future release; switch to "next".',
    );
  });
});

describe('isValidUpdateChannel', () => {
  it.each([
    'latest', 'current', 'next',
    'stable', 'develop',
    'v0.4.0', '0.4.0', 'v0.4.0-rc.1', '1.2.3-beta.2',
  ])('accepts %j', (value) => {
    expect(isValidUpdateChannel(value)).toBe(true);
  });

  it.each([
    'banana', '', 'Stable', ' current', 'v0.4', '0.4', 'v0.4.0.0', 'v0.4.0-',
  ])('rejects %j', (value) => {
    expect(isValidUpdateChannel(value)).toBe(false);
  });
});

describe('UPDATE_CHANNEL_ERROR', () => {
  it('names the accepted values', () => {
    expect(UPDATE_CHANNEL_ERROR).toBe(
      'Invalid channel. Accepted values: latest, current, next, or a version tag such as v0.4.0.',
    );
  });
});
