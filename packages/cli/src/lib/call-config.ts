import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { CALL_DEFAULT_THRESHOLDS, CALL_TIERS } from '@routerly/shared';
import type { CallConfig, CallSettings } from '@routerly/shared';

/**
 * Reads a `--call-config` / `--from-file` argument: inline JSON, or `@path`
 * to read it from a file. Shape validation is the service's job (400 with
 * details); this only guarantees valid JSON.
 */
export function readCallConfigArg(raw: string): unknown {
  const text = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid call configuration JSON: ${(err as Error).message}`);
  }
}

function settingsSummary(s: CallSettings | undefined): string {
  const parts: string[] = [];
  if (s?.effort) parts.push(`effort=${s.effort}`);
  if (s?.maxOutputTokens !== undefined) parts.push(`max-output-tokens=${s.maxOutputTokens}`);
  if (s?.verbosity) parts.push(`verbosity=${s.verbosity}`);
  return parts.length ? parts.join(' ') : chalk.gray('(no settings)');
}

/** Human-readable block shared by `router call-config show` and `profiles show`. */
export function printCallConfig(cc: CallConfig | undefined, indent = '  '): void {
  if (!cc) {
    console.log(`${indent}${chalk.gray('(not configured)')}`);
    return;
  }
  console.log(`${indent}${chalk.gray('Enabled:      ')}${cc.enabled ? chalk.green('yes') : chalk.yellow('no')}`);
  const t = cc.thresholds;
  console.log(`${indent}${chalk.gray('Thresholds:   ')}medium from ${t?.mediumFromTokens ?? CALL_DEFAULT_THRESHOLDS.mediumFromTokens} tokens, high from ${t?.highFromTokens ?? CALL_DEFAULT_THRESHOLDS.highFromTokens} tokens`);
  const cv = Object.entries(cc.clientValues ?? {}).map(([k, v]) => `${k}=${v}`);
  console.log(`${indent}${chalk.gray('Client values:')} ${cv.length ? cv.join(', ') : chalk.gray('(keep all)')}`);
  for (const tier of CALL_TIERS) {
    console.log(`${indent}${chalk.gray(`Tier ${tier}:`.padEnd(13))} ${settingsSummary(cc.tiers[tier])}`);
  }
}
