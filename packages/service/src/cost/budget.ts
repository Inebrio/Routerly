import type { ModelConfig, ProjectConfig, ProjectToken, UsageRecord } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';

type Period = 'daily' | 'weekly' | 'monthly';

function startOf(period: Period, now: Date): Date {
  const d = new Date(now);
  if (period === 'daily') {
    d.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    // ISO week starts on Monday
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Returns true if a model can be used for routing/internal calls,
 * checking only the model's globalThresholds against usage for the given project.
 * Used when the model is not necessarily a project candidate (e.g. llm routing model).
 */
export async function isAllowedForRoutingModel(
  model: ModelConfig,
  projectId: string,
): Promise<boolean> {
  const thresholds = model.globalThresholds;
  if (!thresholds) return true;

  const records = await readConfig('usage');
  const now = new Date();

  const relevant = records.filter(
    (r: UsageRecord) =>
      r.projectId === projectId && r.modelId === model.id && r.outcome === 'success',
  );

  const periods: Period[] = ['daily', 'weekly', 'monthly'];
  for (const period of periods) {
    const limit = thresholds[period];
    if (limit === undefined) continue;

    const start = startOf(period, now);
    const spent = relevant
      .filter((r: UsageRecord) => new Date(r.timestamp) >= start)
      .reduce((sum: number, r: UsageRecord) => sum + r.cost, 0);

    if (spent >= limit) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if a model can be used without exceeding any budget thresholds.
 * Priority: token-level > project-level > global model thresholds.
 */
export async function isAllowed(
  model: ModelConfig,
  project: ProjectConfig,
  token?: ProjectToken,
): Promise<boolean> {
  const projectModelRef = project.models.find((m) => m.modelId === model.id);
  if (!projectModelRef) return false; // model not associated with this project

  // Determine effective thresholds: token overrides > project overrides > global
  const tokenModelRef = token?.models?.find((m) => m.modelId === model.id);
  const thresholds = tokenModelRef?.thresholds ?? projectModelRef.thresholds ?? model.globalThresholds;
  if (!thresholds) return true; // no limits configured

  const records = await readConfig('usage');
  const now = new Date();

  // Filter records for this project + model
  const relevant = records.filter(
    (r: UsageRecord) =>
      r.projectId === project.id && r.modelId === model.id && r.outcome === 'success',
  );

  const periods: Period[] = ['daily', 'weekly', 'monthly'];
  for (const period of periods) {
    const limit = thresholds[period];
    if (limit === undefined) continue;

    const start = startOf(period, now);
    const spent = relevant
      .filter((r: UsageRecord) => new Date(r.timestamp) >= start)
      .reduce((sum: number, r: UsageRecord) => sum + r.cost, 0);

    if (spent >= limit) {
      return false;
    }
  }

  return true;
}
