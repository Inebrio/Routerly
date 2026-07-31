import { describe, it, expect } from 'vitest';
import {
  OptimizerClass,
  OptimizerId,
  OptimizerEstimate,
  OptimizerResult,
  OptimizerStep,
  OptimizerConfig,
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

    // Runtime check: exactly 7 members.
    expect(ALL_OPTIMIZER_IDS.length).toBe(7);

    // Type-level test: optimizers attaches to ProjectConfig
    const project: Pick<ProjectConfig, 'optimizers'> = { optimizers: config };

    void cls;
    void estimate;
    void result;
    void step;
    void project;
    void _exhaustive;
  });
});
