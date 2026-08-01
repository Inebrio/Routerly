/**
 * Experiments (T70): an A/B test that sits above projects.
 *
 * A client points at the experiment's own token instead of a project token.
 * The experiment picks one of its variants per request, each variant being an
 * existing project with its whole configuration, and the rest of the pipeline
 * runs exactly as if the client had used that project's token. Cost and usage
 * stay attributed to the chosen project; the usage record additionally carries
 * the experiment and variant it came from.
 *
 * Nothing here touches the wire: no header selects a variant and no payload
 * field is added, so a client only ever changes its base URL and key.
 */

import type { ProjectToken } from './config.js';

/** How the experiment picks a variant for a request. */
export const EXPERIMENT_ROTATIONS = ['sticky', 'weighted', 'round-robin'] as const;

export type ExperimentRotation = (typeof EXPERIMENT_ROTATIONS)[number];

/**
 * What identifies "the same caller" for `sticky` rotation, without reading a
 * custom header or adding a payload field.
 *
 * `auto` uses the standard `user` field when the client sends it (the same
 * field End Users attribution reads) and otherwise falls back to a stable hash
 * of the conversation prefix combined with the caller's IP and user agent.
 * The narrower values pin one source, for a deployment that knows its clients.
 */
export const STICKY_KEYS = ['auto', 'end-user', 'conversation', 'client'] as const;

export type ExperimentStickyKey = (typeof STICKY_KEYS)[number];

/** Lifecycle of an experiment. Closing is manual: there is no auto-stop rule. */
export const EXPERIMENT_STATUSES = ['draft', 'running', 'closed'] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export interface ExperimentRotationMeta {
  label: string;
  /** One line, written for the person choosing between the three. */
  description: string;
}

/**
 * Single source of truth for how each rotation is named and explained, so the
 * dashboard and the CLI cannot describe the same strategy differently.
 */
export const ROTATION_CATALOG: Record<ExperimentRotation, ExperimentRotationMeta> = {
  sticky: {
    label: 'Sticky per session',
    description: 'The same caller keeps the same variant for the whole conversation, so a multi-turn session is never split across variants.',
  },
  weighted: {
    label: 'Random with weights',
    description: 'Every request draws a variant independently, with the share of traffic each variant declares.',
  },
  'round-robin': {
    label: 'Round robin',
    description: 'Requests alternate between variants in order, giving an even split without randomness.',
  },
};

export function rotationLabel(rotation: ExperimentRotation): string {
  return ROTATION_CATALOG[rotation].label;
}

export function rotationDescription(rotation: ExperimentRotation): string {
  return ROTATION_CATALOG[rotation].description;
}

/** One arm of the test: an existing project, taken whole. */
export interface ExperimentVariant {
  id: string;
  /** The project this variant routes to. */
  projectId: string;
  /** Display name for the arm. Absent means the project's own name is shown. */
  name?: string;
  /**
   * Share of traffic for `weighted` rotation. Any positive numbers work: they
   * are normalised against their own sum, so 1/1 and 50/50 mean the same
   * thing. Ignored by the other two rotations.
   */
  weight?: number;
}

/**
 * Optional quality scoring: a model reads the answer each variant produced and
 * scores it against the criteria the experiment declares. Off unless enabled,
 * and sampled, because every judged call is an extra model call.
 */
export interface ExperimentJudge {
  enabled: boolean;
  /** Model that does the scoring. */
  modelId: string;
  /** What the judge scores, one line each. Free text: they go into its prompt. */
  criteria: string[];
  /** Fraction of the experiment's calls to score, `0`–`1`. */
  sampleRate: number;
}

/** Calls per variant below which the dashboard calls the sample insufficient. */
export const DEFAULT_MIN_SAMPLES_PER_VARIANT = 30;

export interface ExperimentConfig {
  id: string;
  name: string;
  description?: string;
  status: ExperimentStatus;
  rotation: ExperimentRotation;
  /** Only meaningful for `sticky` rotation. Defaults to `auto`. */
  stickyKey?: ExperimentStickyKey;
  variants: ExperimentVariant[];
  /**
   * The experiment's own tokens, same shape and same plaintext storage as a
   * project's: the proxy compares an incoming bearer against both sets, so a
   * client cannot tell the difference between calling a project and calling a
   * test.
   */
  tokens: ProjectToken[];
  /** Quality scoring, off when absent. */
  judge?: ExperimentJudge;
  /** Overrides DEFAULT_MIN_SAMPLES_PER_VARIANT for this experiment. */
  minSamplesPerVariant?: number;
  createdAt: string; // ISO 8601
  /** First transition to `running`. */
  startedAt?: string;
  /** Transition to `closed`. */
  closedAt?: string;
  /** Variant the operator declared the winner when closing. Free choice: the metrics inform it, they do not decide it. */
  winnerVariantId?: string;
}

/**
 * Share of traffic each variant gets under `weighted` rotation, as fractions
 * summing to 1, in the order the variants are declared.
 *
 * A missing weight counts as 1, so a test that never sets weights splits
 * evenly. All-zero weights fall back to an even split too, rather than
 * dividing by zero and sending everything nowhere.
 */
export function variantShares(variants: ExperimentVariant[]): number[] {
  if (variants.length === 0) return [];
  const weights = variants.map(v => (typeof v.weight === 'number' && v.weight > 0 ? v.weight : v.weight === undefined ? 1 : 0));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return variants.map(() => 1 / variants.length);
  return weights.map(w => w / total);
}
