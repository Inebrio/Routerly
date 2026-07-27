import type { UsageRecord } from '@routerly/shared'
import { readConfig } from '../config/loader.js'

// Single canonical usage read. All budget checks and usage-scanning routing policies
// go through here instead of each calling readConfig('usage') with its own cast.
// ponytail: thin wrapper by design, the value is ONE scan implementation + ONE type
// cast. Upgrade point: if usage.json growth (issue #124) forces a windowed or streamed
// read, change it here once and every phase inherits it.
export async function readUsageRecords(): Promise<UsageRecord[]> {
  return (await readConfig('usage')) as UsageRecord[]
}
