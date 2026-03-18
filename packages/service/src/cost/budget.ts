import type { Limit, LimitPeriod, LimitsMode, RollingUnit, ModelConfig, ProjectConfig, ProjectToken, UsageRecord } from '@routerly/shared';
import { readConfig } from '../config/loader.js';

// ─── Window helpers ────────────────────────────────────────────────────────────

/** Start of a calendar-fixed period (resets at natural boundary: midnight, Monday, 1st of month…) */
function startOfPeriod(period: LimitPeriod, now: Date): Date {
  const d = new Date(now);
  switch (period) {
    case 'hourly':
      d.setMinutes(0, 0, 0);
      break;
    case 'daily':
      d.setHours(0, 0, 0, 0);
      break;
    case 'weekly': {
      // ISO week: Monday
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'monthly':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      break;
  }
  return d;
}

/** Milliseconds per rolling unit */
const ROLLING_UNIT_MS: Record<RollingUnit, number> = {
  second: 1_000,
  minute: 60_000,
  hour:   3_600_000,
  day:    86_400_000,
  week:   7 * 86_400_000,
  month:  30 * 86_400_000, // approximate
};

/**
 * Map a legacy `window` string (old Limit format) to the new LimitPeriod.
 * Allows loading configs written before the period/rolling split.
 */
function legacyWindowToPeriod(window: string | undefined): LimitPeriod {
  switch (window) {
    case 'minute': case 'hour': return 'hourly';
    case 'day':   return 'daily';
    case 'week':  return 'weekly';
    case 'month': return 'monthly';
    case 'year':  return 'yearly';
    default:      return 'daily';
  }
}

/**
 * Convert legacy BudgetThresholds to Limit[] for backward compatibility.
 */
function legacyToLimits(thresholds: { daily?: number; weekly?: number; monthly?: number } | undefined): Limit[] {
  if (!thresholds) return [];
  const limits: Limit[] = [];
  if (thresholds.daily   != null) limits.push({ metric: 'cost', windowType: 'period', period: 'daily',   value: thresholds.daily   });
  if (thresholds.weekly  != null) limits.push({ metric: 'cost', windowType: 'period', period: 'weekly',  value: thresholds.weekly  });
  if (thresholds.monthly != null) limits.push({ metric: 'cost', windowType: 'period', period: 'monthly', value: thresholds.monthly });
  return limits;
}

/**
 * Resolve effective limits: prefer new `limits`, fall back to legacy `thresholds`.
 */
function resolveLimits(obj: { limits?: Limit[]; thresholds?: { daily?: number; weekly?: number; monthly?: number } } | undefined): Limit[] {
  if (!obj) return [];
  if (obj.limits && obj.limits.length > 0) return obj.limits;
  return legacyToLimits(obj.thresholds);
}

// ─── Override mode helpers ─────────────────────────────────────────────────────────────

type LevelResolution = { mode: LimitsMode; limits: Limit[] };

/**
 * Inspect a config ref (ProjectModelRef or TokenModelRef) and determine
 * what limits it contributes at this level.
 * Returns null if the level has no configuration (transparent / pass-through).
 */
function resolveLevel(
  obj: { limits?: Limit[]; thresholds?: { daily?: number; weekly?: number; monthly?: number }; limitsMode?: LimitsMode } | undefined,
): LevelResolution | null {
  if (!obj) return null;
  const mode: LimitsMode = obj.limitsMode ?? 'replace';
  // 'disable' is always active even with no limits configured
  if (mode === 'disable') return { mode, limits: [] };
  const limits = resolveLimits(obj);
  // 'replace' / 'extend' only active if limits are actually configured
  if (limits.length === 0) return null;
  return { mode, limits };
}

/**
 * Merge a level's resolution with the inherited limits from the parent level.
 * - null (not configured): transparent, pass through inherited unchanged
 * - disable:  no limits apply at all (return [])
 * - replace:  only this level's limits apply (ignore inherited)
 * - extend:   union — this level's limits + inherited must ALL pass
 */
function applyResolution(level: LevelResolution | null, inherited: Limit[]): Limit[] {
  if (!level)                  return inherited;               // transparent
  if (level.mode === 'disable') return [];                     // disable all
  if (level.mode === 'extend')  return [...level.limits, ...inherited]; // stack
  return level.limits;                                         // replace
}

/**
 * Check whether a set of Limit rules is satisfied by usage records.
 * Returns true if all limits pass (or no limits configured).
 * Handles both new-format limits (windowType: 'period'|'rolling') and
 * legacy limits (window: string) for backward compatibility.
 */
function checkLimits(limits: Limit[], records: UsageRecord[], now: Date): boolean {
  for (const lim of limits) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyWindow = (lim as any).window as string | undefined;

    let start: Date;
    if (lim.windowType === 'rolling') {
      const amount = lim.rollingAmount ?? 1;
      const unit   = lim.rollingUnit   ?? 'day';
      start = new Date(now.getTime() - amount * (ROLLING_UNIT_MS[unit] ?? 86_400_000));
    } else {
      // 'period' or legacy object with `window` field
      const period = lim.period ?? legacyWindowToPeriod(legacyWindow);
      start = startOfPeriod(period, now);
    }

    const windowRecords = records.filter(r => new Date(r.timestamp) >= start);

    const total =
      lim.metric === 'cost'         ? windowRecords.reduce((s, r) => s + r.cost, 0) :
      lim.metric === 'calls'        ? windowRecords.length :
      lim.metric === 'input_tokens' ? windowRecords.reduce((s, r) => s + r.inputTokens, 0) :
      lim.metric === 'output_tokens'? windowRecords.reduce((s, r) => s + r.outputTokens, 0) :
      /* total_tokens */              windowRecords.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

    if (total >= lim.value) return false;
  }
  return true;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Snapshot del consumo corrente per un singolo limite */
export interface LimitSnapshot {
  metric: Limit['metric'];
  /** Descrizione leggibile della finestra (es. "daily", "rolling 7 days") */
  window: string;
  /** Valore soglia configurato */
  value: number;
  /** Consumo attuale nella finestra */
  current: number;
  /** Quota rimanente (value - current) */
  remaining: number;
}

/**
 * Restituisce lo snapshot dei consumi correnti per tutti i limiti effettivi
 * del modello, rispettando la gerarchia token > project > global.
 * Se non ci sono limiti configurati, restituisce [].
 */
export async function getLimitUsageSnapshot(
  model: ModelConfig,
  project: ProjectConfig,
  token?: ProjectToken,
): Promise<LimitSnapshot[]> {
  const projectModelRef = project.models.find((m: { modelId: string }) => m.modelId === model.id);
  if (!projectModelRef) return [];

  const tokenModelRef = token?.models?.find((m: { modelId: string }) => m.modelId === model.id);
  const globalLimits  = model.limits?.length ? model.limits : legacyToLimits(model.globalThresholds);

  const projectResolution = resolveLevel(projectModelRef);
  const tokenResolution   = resolveLevel(tokenModelRef);

  const afterProject = applyResolution(projectResolution, globalLimits);
  const limits       = applyResolution(tokenResolution, afterProject);

  if (!limits.length) return [];

  const records = await readConfig('usage');
  const now = new Date();

  const relevant = (records as UsageRecord[]).filter(
    r => r.projectId === project.id && r.modelId === model.id && r.outcome === 'success',
  );

  return limits.map(lim => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyWindow = (lim as any).window as string | undefined;

    let start: Date;
    let windowLabel: string;

    if (lim.windowType === 'rolling') {
      const amount = lim.rollingAmount ?? 1;
      const unit   = lim.rollingUnit   ?? 'day';
      start = new Date(now.getTime() - amount * (ROLLING_UNIT_MS[unit] ?? 86_400_000));
      windowLabel = `rolling ${amount} ${unit}${amount !== 1 ? 's' : ''}`;
    } else {
      const period = lim.period ?? legacyWindowToPeriod(legacyWindow);
      start = startOfPeriod(period, now);
      windowLabel = period;
    }

    const windowRecords = relevant.filter(r => new Date(r.timestamp) >= start);

    const current =
      lim.metric === 'cost'          ? windowRecords.reduce((s, r) => s + r.cost, 0) :
      lim.metric === 'calls'         ? windowRecords.length :
      lim.metric === 'input_tokens'  ? windowRecords.reduce((s, r) => s + r.inputTokens, 0) :
      lim.metric === 'output_tokens' ? windowRecords.reduce((s, r) => s + r.outputTokens, 0) :
      /* total_tokens */               windowRecords.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

    return {
      metric: lim.metric,
      window: windowLabel,
      value: lim.value,
      current: +current.toFixed(6),
      remaining: +(lim.value - current).toFixed(6),
    };
  });
}

/**
 * Returns true if a model can be used for routing/internal calls,
 * checking only the model's global limits against usage for the given project.
 */
export async function isAllowedForRoutingModel(
  model: ModelConfig,
  projectId: string,
): Promise<boolean> {
  const limits = model.limits?.length
    ? model.limits
    : legacyToLimits(model.globalThresholds);

  if (!limits.length) return true;

  const records = await readConfig('usage');
  const now = new Date();

  const relevant = (records as UsageRecord[]).filter(
    r => r.projectId === projectId && r.modelId === model.id && r.outcome === 'success',
  );

  return checkLimits(limits, relevant, now);
}

/**
 * Returns true if a model can be used without exceeding any limit.
 * Priority: token-level > project-level > global model limits.
 */
export async function isAllowed(
  model: ModelConfig,
  project: ProjectConfig,
  token?: ProjectToken,
): Promise<boolean> {
  const projectModelRef = project.models.find((m: { modelId: string }) => m.modelId === model.id);
  if (!projectModelRef) return false;

  // Build effective limits applying mode: replace | extend | disable
  const tokenModelRef = token?.models?.find((m: { modelId: string }) => m.modelId === model.id);
  const globalLimits  = model.limits?.length ? model.limits : legacyToLimits(model.globalThresholds);

  const projectResolution = resolveLevel(projectModelRef);
  const tokenResolution   = resolveLevel(tokenModelRef);

  // Apply from global → project → token
  const afterProject = applyResolution(projectResolution, globalLimits);
  const limits       = applyResolution(tokenResolution, afterProject);

  if (!limits.length) return true;

  const records = await readConfig('usage');
  const now = new Date();

  const relevant = (records as UsageRecord[]).filter(
    r => r.projectId === project.id && r.modelId === model.id && r.outcome === 'success',
  );

  return checkLimits(limits, relevant, now);
}

