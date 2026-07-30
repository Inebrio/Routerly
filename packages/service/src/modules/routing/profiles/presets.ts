import type { RoutingPolicy, RoutingProfile } from '@routerly/shared';

/**
 * Built-in routing profile presets.
 *
 * These are code constants, never persisted to profiles.json and never
 * written through writeConfig(). Users customize a preset by cloning it
 * into a profiles.json overlay (see task 7), not by mutating these objects.
 */

function policies(...types: RoutingPolicy['type'][]): RoutingPolicy[] {
  return types.map(type => ({ type, enabled: true }));
}

// ponytail: presets are code constants, never persisted; clone-to-customize handles edits
export const BUILTIN_PROFILES: readonly RoutingProfile[] = Object.freeze([
  Object.freeze({
    id: 'balanced',
    version: 1,
    label: 'Balanced',
    policies: policies('health', 'performance', 'cheapest', 'capability'),
    selector: 'argmax',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'cheap',
    version: 1,
    label: 'Cheap',
    policies: policies('cheapest', 'budget-remaining', 'health'),
    selector: 'cheapest',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'fast',
    version: 1,
    label: 'Fast',
    policies: policies('performance', 'health'),
    selector: 'lowest-latency',
    fallbackStrategy: 'retry-after-cooldown',
    builtin: true,
  }),
  Object.freeze({
    id: 'coding',
    version: 1,
    label: 'Coding',
    policies: policies('capability', 'model-preference', 'performance', 'health'),
    selector: 'argmax',
    fallbackStrategy: 'next-best',
    builtin: true,
  }),
  Object.freeze({
    id: 'offline',
    version: 1,
    label: 'Offline',
    policies: policies('health', 'cheapest'),
    selector: 'round-robin',
    fallbackStrategy: 'abort',
    builtin: true,
  }),
]);

export function getBuiltin(id: string): RoutingProfile | undefined {
  return BUILTIN_PROFILES.find(p => p.id === id);
}
