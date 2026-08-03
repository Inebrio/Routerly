import { describe, expect, it } from 'vitest';
import { OPTIMIZER_CATALOG } from '@routerly/shared';
import { optimizerConfigSchema, optimizerStepSchema } from './schemas.js';

describe('optimizerStepSchema', () => {
  // The enum used to be a hand-written literal list. It missed `json-table`
  // from the day that optimizer shipped, so saving the pipeline and running a
  // preview both answered 400 as soon as the step was in the list.
  it('accepts every optimizer the catalog publishes', () => {
    for (const id of Object.keys(OPTIMIZER_CATALOG)) {
      expect(optimizerStepSchema.safeParse({ id, enabled: true }).success, id).toBe(true);
    }
  });

  it('accepts a full pipeline carrying every catalog optimizer at once', () => {
    const steps = Object.keys(OPTIMIZER_CATALOG).map(id => ({ id, enabled: true }));
    expect(optimizerConfigSchema.safeParse({ steps }).success).toBe(true);
  });

  it('rejects an optimizer id the catalog does not publish', () => {
    expect(optimizerStepSchema.safeParse({ id: 'not-an-optimizer', enabled: true }).success).toBe(false);
  });
});
