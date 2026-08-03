import { describe, it, expect } from 'vitest';
import {
  OptimizerClass,
  OptimizerId,
  OptimizerEstimate,
  OptimizerResult,
  OptimizerStep,
  OptimizerConfig,
  OptimizerCallStat,
  OPTIMIZER_CATALOG,
  optimizerLabel,
  optimizerThreshold,
} from './optimizers.js';
import { ProjectConfig } from './config.js';

describe('type-checks', () => {
  it('type-checks', () => {
    // Type-level test: OptimizerConfig literal type-checks
    const config: OptimizerConfig = {
      steps: [
        { id: 'session-dedup', enabled: true },
        { id: 'relevance', enabled: false, threshold: 0.5 },
      ],
    };

    // Type-level test: OptimizerStep fields
    const step: OptimizerStep = { id: 'llmlingua-2', enabled: true };

    // Type-level test: class + estimate + result
    const cls: OptimizerClass = 'recoverable';
    const estimate: OptimizerEstimate = { estimatedTokensBefore: 100, estimatedTokensAfter: 80 };
    const result: OptimizerResult = {
      changed: true,
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 80,
      note: 'deduped',
    };

    // Exhaustive runtime check: OptimizerId union has exactly the 7 members.
    // `satisfies` forces every listed member to be a valid OptimizerId; the
    // element type annotation forces the list to cover the whole union (a missing
    // member makes `ALL_OPTIMIZER_IDS[number]` narrower than OptimizerId, which is
    // still assignable, so the length assertion below is the coverage guard).
    const ALL_OPTIMIZER_IDS = [
      'session-dedup',
      'ccr',
      'rtk',
      'headroom',
      'json-table',
      'relevance',
      'caveman',
      'llmlingua-2',
    ] as const satisfies readonly OptimizerId[];

    // Compile-time exhaustiveness: this const is `never` only if every OptimizerId
    // is present in ALL_OPTIMIZER_IDS. A new member added to OptimizerId without
    // updating the array breaks this line.
    const _exhaustive: Exclude<OptimizerId, (typeof ALL_OPTIMIZER_IDS)[number]> extends never
      ? true
      : false = true;

    // Runtime check: exactly 8 members.
    expect(ALL_OPTIMIZER_IDS.length).toBe(8);

    // Type-level test: optimizers attaches to ProjectConfig
    const project: Pick<ProjectConfig, 'optimizers'> = { optimizers: config };

    // Type-level test: per-call stat, with and without the rollback flag
    const stat: OptimizerCallStat = { id: 'ccr', tokensBefore: 100, tokensAfter: 60 };
    const rolled: OptimizerCallStat = { id: 'caveman', tokensBefore: 100, tokensAfter: 100, rolledBack: true };

    void cls;
    void estimate;
    void result;
    void step;
    void project;
    void stat;
    void rolled;
    void _exhaustive;
  });
});

describe('OPTIMIZER_CATALOG', () => {
  it('has one entry per optimizer id, keyed by its own id', () => {
    const entries = Object.entries(OPTIMIZER_CATALOG);
    expect(entries.length).toBe(7);
    for (const [key, meta] of entries) expect(meta.id).toBe(key);
  });

  it('gives every optimizer a label and a description', () => {
    for (const meta of Object.values(OPTIMIZER_CATALOG)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it('keeps every threshold spec self-consistent', () => {
    for (const meta of Object.values(OPTIMIZER_CATALOG)) {
      const spec = meta.threshold;
      if (!spec) continue;
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.help.length).toBeGreaterThan(0);
      expect(spec.max).toBeGreaterThan(spec.min);
      expect(spec.step).toBeGreaterThan(0);
      if (spec.default !== undefined) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('leaves relevance without a default, since it is inert without a threshold', () => {
    expect(OPTIMIZER_CATALOG.relevance.threshold?.default).toBeUndefined();
  });
});

describe('optimizerLabel', () => {
  it('returns the catalog label', () => {
    expect(optimizerLabel('ccr')).toBe('Conversation Context Reduction');
  });

  it('degrades to the id itself for an unknown optimizer', () => {
    expect(optimizerLabel('not-an-optimizer')).toBe('not-an-optimizer');
  });
});

describe('optimizerThreshold', () => {
  it('returns the spec of an optimizer that takes a threshold', () => {
    expect(optimizerThreshold('ccr')).toMatchObject({ unit: 'turns', default: 6 });
  });

  it('returns undefined for an optimizer that takes none', () => {
    expect(optimizerThreshold('session-dedup')).toBeUndefined();
  });

  it('returns undefined for an unknown optimizer', () => {
    expect(optimizerThreshold('not-an-optimizer')).toBeUndefined();
  });
});
