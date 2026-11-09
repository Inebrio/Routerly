import { describe, it, expect } from 'vitest';
import { isChatModel } from './models';
import type { Model } from '../api';

describe('isChatModel', () => {
  it('excludes decision models only', () => {
    expect(isChatModel({ capabilities: { decision: true } } as Model)).toBe(false);
    expect(isChatModel({ capabilities: { embedding: true } } as Model)).toBe(true);
    expect(isChatModel({} as Model)).toBe(true);
  });
});
