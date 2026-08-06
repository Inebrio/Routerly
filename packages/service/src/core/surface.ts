/**
 * Surface / metamodule contract (0.4.0 refactory, Plan 6).
 *
 * PREDISPOSITION ONLY (roadmap decision #6) - TYPES, NO IMPLEMENTATION.
 *
 * A "surface" is a user-facing entry point a module exposes: a dashboard page,
 * a CLI command, or a management API route. The eventual metamodule / runtime
 * frontend module loading feature will let a module DECLARE its surfaces so a
 * host can mount them without the host importing the module directly. This file
 * fixes the shape of that declaration so future work has a stable contract to
 * target. Nothing consumes it yet: no module returns a SurfaceContribution, no
 * loader reads one, no runtime frontend module is loaded. It is erased at
 * compile time (types-only) and changes zero behavior.
 *
 * Deferred (NOT built here, see plan Self-review): the mechanism that collects,
 * validates, and mounts these declarations, and any dynamic frontend loading.
 */

/** Where a declared surface attaches. */
export type SurfaceKind = 'dashboard' | 'cli' | 'api'

/** One user-facing entry point a module declares it provides. */
export interface Surface {
  /** Stable id, unique within the owning module. */
  readonly id: string
  /** Which host mounts it. */
  readonly kind: SurfaceKind
  /**
   * Mount hint interpreted by the host for this `kind`:
   * dashboard -> route path (e.g. '/projects/:id/guardrails');
   * cli       -> command path (e.g. 'guardrails list');
   * api       -> route path (e.g. '/api/guardrails').
   */
  readonly at: string
  /** Human-readable label for menus / help text. */
  readonly title: string
}

/**
 * A module's full set of declared surfaces. The intended (future) shape a
 * module would return from a `surfaces()` capability. Not invoked anywhere yet.
 */
export interface SurfaceContribution {
  /** Owning module id (matches ModuleManifest.id). */
  readonly module: string
  readonly surfaces: readonly Surface[]
}
