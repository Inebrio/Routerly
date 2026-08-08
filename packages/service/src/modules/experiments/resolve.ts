import type { ExperimentConfig, ExperimentVariant, RouterConfig, RouterToken } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { pickVariant, type RotationInput } from './rotation.js';

/**
 * Outcome of authenticating an incoming bearer against the experiments (T71).
 *
 * `null` from the resolver means "not an experiment token", which is the normal
 * case and lets the caller fall through to its own invalid-token answer.
 */
export type ExperimentResolution =
  | { status: 'ok'; experiment: ExperimentConfig; token: RouterToken; variant: ExperimentVariant; router: RouterConfig }
  | { status: 'expired'; experiment: ExperimentConfig }
  | { status: 'misconfigured'; experiment: ExperimentConfig };

/** Find the experiment owning this bearer, in the same plaintext way routers are matched. */
export async function resolveExperimentByToken(
  incomingToken: string,
): Promise<{ experiment: ExperimentConfig; token: RouterToken } | null> {
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
 * An experiment routes traffic from the moment it exists: there is no start
 * step, so the only reasons to refuse are an expired token or variants that no
 * longer point at an existing router.
 */
export async function resolveExperimentRequest(
  incomingToken: string,
  input: RotationInput,
): Promise<ExperimentResolution | null> {
  const found = await resolveExperimentByToken(incomingToken);
  if (!found) return null;
  const { experiment, token } = found;

  if (token.expiresAt && new Date(token.expiresAt) < new Date()) return { status: 'expired', experiment };

  const routers = await readConfig('routers');
  const byId = new Map(routers.map(p => [p.id, p]));
  // A variant whose router was deleted is skipped rather than served as a 500:
  // the remaining arms are still a valid, if unbalanced, test.
  const usable = experiment.variants.filter(v => byId.has(v.routerId));
  if (usable.length === 0) return { status: 'misconfigured', experiment };

  const variant = pickVariant({ ...experiment, variants: usable }, input);
  if (!variant) return { status: 'misconfigured', experiment };

  void touchToken(experiment.id, token.token);
  return { status: 'ok', experiment, token, variant, router: byId.get(variant.routerId)! };
}

/** Fire-and-forget lastUsedAt, mirroring what the auth preHandler does for router tokens. */
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
