/**
 * Prompt/context optimizer contract types (#optimizers).
 *
 * Shared holds only wire/config types. The runtime `Optimizer` interface lives
 * in the service because it references `ProxyContext`.
 */

/** Reversibility class of an optimizer's transformation. */
export type OptimizerClass = 'lossless' | 'recoverable' | 'lossy';

/** Stable identifier of a built-in optimizer. */
export type OptimizerId =
  | 'session-dedup'
  | 'ccr'
  | 'rtk'
  | 'headroom'
  | 'relevance'
  | 'caveman'
  | 'llmlingua-2';

/** Token estimate produced before applying an optimizer. */
export interface OptimizerEstimate {
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Outcome of applying an optimizer to a request. */
export interface OptimizerResult {
  changed: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  note?: string;
}

/**
 * One optimizer in a project's pipeline. Array order = execution order.
 */
export interface OptimizerStep {
  id: OptimizerId;
  enabled: boolean;
  threshold?: number;
}

/**
 * Per-project optimizer config. Presence of `optimizers` on a `ProjectConfig`
 * activates the subsystem; `steps` order is the execution order.
 */
export interface OptimizerConfig {
  steps: OptimizerStep[];
}
