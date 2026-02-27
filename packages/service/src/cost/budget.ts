import type { ModelConfig, ProjectConfig, UsageRecord } from '@localrouter/shared';
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
 * Returns true if a model can be used without exceeding any budget thresholds.
 * Project-level thresholds take priority over global model thresholds.
 */
export async function isAllowed(
  model: ModelConfig,
  project: ProjectConfig,
): Promise<boolean> {
  const projectModelRef = project.models.find((m) => m.modelId === model.id);
  if (!projectModelRef) return false; // model not associated with this project

  // Determine effective thresholds: project overrides > global
  const thresholds = projectModelRef.thresholds ?? model.globalThresholds;
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
