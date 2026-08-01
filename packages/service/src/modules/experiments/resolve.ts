import type { ExperimentConfig, ExperimentVariant, ProjectConfig, ProjectToken } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { pickVariant, type RotationInput } from './rotation.js';

/**
 * Outcome of authenticating an incoming bearer against the experiments (T71).
 *
 * `null` from the resolver means "not an experiment token", which is the normal
 * case and lets the caller fall through to its own invalid-token answer.
 */
export type ExperimentResolution =
  | { status: 'ok'; experiment: ExperimentConfig; token: ProjectToken; variant: ExperimentVariant; project: ProjectConfig }
  | { status: 'expired'; experiment: ExperimentConfig }
  | { status: 'not-running'; experiment: ExperimentConfig }
  | { status: 'misconfigured'; experiment: ExperimentConfig };

/** Find the experiment owning this bearer, in the same plaintext way projects are matched. */
export async function resolveExperimentByToken(
  incomingToken: string,
): Promise<{ experiment: ExperimentConfig; token: ProjectToken } | null> {
  const experiments = await readConfig('experiments');
  for (const experiment of experiments) {
    for (const token of experiment.tokens || []) {
      if (token.token === incomingToken) return { experiment, token };
    }
  }
  return null;
}

/**
 * Authenticate a bearer as an experiment token and pick the variant this
 * request runs on. Returns null when the token belongs to no experiment.
 *
 * Only a `running` experiment routes traffic: a draft has not been started and
 * a closed one is being read, not written to, so both refuse the call rather
 * than silently sending it to an arbitrary arm.
 */
export async function resolveExperimentRequest(
  incomingToken: string,
  input: RotationInput,
): Promise<ExperimentResolution | null> {
  const found = await resolveExperimentByToken(incomingToken);
  if (!found) return null;
  const { experiment, token } = found;

  if (token.expiresAt && new Date(token.expiresAt) < new Date()) return { status: 'expired', experiment };
  if (experiment.status !== 'running') return { status: 'not-running', experiment };

  const projects = await readConfig('projects');
  const byId = new Map(projects.map(p => [p.id, p]));
  // A variant whose project was deleted is skipped rather than served as a 500:
  // the remaining arms are still a valid, if unbalanced, test.
  const usable = experiment.variants.filter(v => byId.has(v.projectId));
  if (usable.length === 0) return { status: 'misconfigured', experiment };

  const variant = pickVariant({ ...experiment, variants: usable }, input);
  if (!variant) return { status: 'misconfigured', experiment };

  void touchToken(experiment.id, token.token);
  return { status: 'ok', experiment, token, variant, project: byId.get(variant.projectId)! };
}

/** Fire-and-forget lastUsedAt, mirroring what the auth preHandler does for project tokens. */
async function touchToken(experimentId: string, rawToken: string): Promise<void> {
  try {
    const experiments = await readConfig('experiments');
    const ei = experiments.findIndex(e => e.id === experimentId);
    if (ei === -1) return;
    const ti = experiments[ei]!.tokens?.findIndex(t => t.token === rawToken) ?? -1;
    if (ti === -1) return;
    experiments[ei]!.tokens[ti]!.lastUsedAt = new Date().toISOString();
    await writeConfig('experiments', experiments);
  } catch {
    /* non-fatal: a missed timestamp must never fail a request */
  }
}
