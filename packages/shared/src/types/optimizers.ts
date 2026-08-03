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

/**
 * What one optimizer step did to a real request (T63). Written on the usage
 * record so the measured saving can be attributed to the optimizer that
 * produced it, instead of being inferred from a preview.
 *
 * Only steps that changed the request are recorded: a step that ran and left
 * the prompt untouched carries no information and would just grow the file.
 */
export interface OptimizerCallStat {
  id: OptimizerId;
  /** Estimated prompt tokens before this step ran. */
  tokensBefore: number;
  /** Estimated prompt tokens after it ran, or `tokensBefore` when rolled back. */
  tokensAfter: number;
  /** Set when the safety gate or `validate` rejected the output and it was rolled back. */
  rolledBack?: boolean;
}

/**
 * Meaning and bounds of an optimizer's `threshold` (T63).
 *
 * Every optimizer reads the same numeric field but interprets it differently:
 * turns for `ccr`, reserved tokens for `headroom`, a ratio for `relevance` and
 * `llmlingua-2`. Without this spec each surface would have to hardcode its own
 * idea of what a sensible value is.
 */
export interface OptimizerThresholdSpec {
  /** What the number means, e.g. "Recent turns to keep". */
  label: string;
  /** Unit shown next to the control. */
  unit: 'turns' | 'tokens' | 'ratio';
  min: number;
  max: number;
  step: number;
  /** Value the optimizer falls back to when the step leaves it empty. Absent = the optimizer stays inert without one. */
  default?: number;
  /** Which way is more aggressive, in one line. */
  help: string;
}

/** Everything a surface needs to present an optimizer without knowing its code. */
export interface OptimizerMeta {
  id: OptimizerId;
  label: string;
  klass: OptimizerClass;
  description: string;
  /** Absent for optimizers that take no threshold. */
  threshold?: OptimizerThresholdSpec;
}

/**
 * The built-in optimizers, as dashboard, CLI and docs see them. `klass` and the
 * threshold defaults mirror the service implementations: change one and this
 * catalog has to follow, which is what `optimizers/catalog.test.ts` in the
 * service checks.
 */
export const OPTIMIZER_CATALOG: Record<OptimizerId, OptimizerMeta> = {
  'session-dedup': {
    id: 'session-dedup',
    label: 'Session Dedup',
    klass: 'lossless',
    description: 'Drops exact-duplicate repeated messages within a conversation, keeping the first and last of any run.',
  },
  ccr: {
    id: 'ccr',
    label: 'Conversation Context Reduction',
    klass: 'recoverable',
    description: 'Keeps the system prefix and the most recent turns; older turns are condensed into a single compact block.',
    threshold: {
      label: 'Recent turns to keep',
      unit: 'turns',
      min: 1,
      max: 50,
      step: 1,
      default: 3,
      help: 'Fewer turns means a shorter prompt and less history for the model to work with.',
    },
  },
  rtk: {
    id: 'rtk',
    label: 'Redundant Token Killer',
    klass: 'recoverable',
    description: 'Collapses redundant whitespace and strips repeated boilerplate blocks from message text.',
  },
  headroom: {
    id: 'headroom',
    label: 'Context Headroom',
    klass: 'lossless',
    description: 'Drops the oldest turns until the request fits the model context window with the reserved headroom.',
    threshold: {
      label: 'Reserved completion budget',
      unit: 'tokens',
      min: 0,
      max: 32768,
      step: 128,
      default: 1024,
      help: 'Tokens kept free for the answer. A larger reserve trims more history.',
    },
  },
  relevance: {
    id: 'relevance',
    label: 'Relevance Filter',
    klass: 'lossy',
    description: 'Drops older turns whose lexical overlap with the newest turn falls below the threshold. The newest turn is always kept.',
    threshold: {
      label: 'Minimum overlap with the newest turn',
      unit: 'ratio',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.1,
      help: 'Higher drops more turns. Above about 0.3 most history is dropped and the safety gate starts rejecting the result.',
    },
  },
  caveman: {
    id: 'caveman',
    label: 'Caveman',
    klass: 'lossy',
    description: 'Strips English filler and function words while preserving code, URLs and numbers. English only: it stays inert on any other language, where LLMLingua-2 is the step to use.',
  },
  'llmlingua-2': {
    id: 'llmlingua-2',
    label: 'LLMLingua-2',
    klass: 'lossy',
    description: 'Model-based compression: a multilingual model scores every token and the least useful ones are dropped. Works in any language it covers. Off until the optional runtime and the model are installed.',
    threshold: {
      label: 'Fraction of tokens to keep',
      unit: 'ratio',
      min: 0.05,
      max: 0.95,
      step: 0.05,
      default: 0.5,
      help: 'Lower keeps fewer tokens, so it compresses harder. Values outside 0 to 1 fall back to the default.',
    },
  },
};

/** Human label for an optimizer id, degrading to the id itself for unknown ones. */
export function optimizerLabel(id: string): string {
  return OPTIMIZER_CATALOG[id as OptimizerId]?.label ?? id;
}

/** Threshold spec of an optimizer, or `undefined` when it takes no threshold. */
export function optimizerThreshold(id: string): OptimizerThresholdSpec | undefined {
  return OPTIMIZER_CATALOG[id as OptimizerId]?.threshold;
}
