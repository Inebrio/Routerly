import type { RouterlyModule } from './index.js'

/**
 * Contrib registration seam (0.4.0 refactory, Plan 6).
 *
 * The single extension point for third-party ("contrib") modules. The kernel
 * bootstrap spreads this array into its static module list, so appending a
 * module here is all it takes to register one.
 *
 * PREDISPOSITION ONLY (roadmap decision #6): this array is empty and stays
 * empty for this phase. There is NO dynamic loading (no filesystem scan, no
 * `import()`, no npm resolution). Contrib modules are added here by editing
 * this file, statically, against the module SDK (`./sdk.js`). Automatic
 * discovery is deferred; see the plan's Self-review.
 *
 * ponytail: a typed empty array proves the shape without loading anything.
 * Add a discovery mechanism only when a real contrib module needs to ship
 * out-of-tree.
 */
export const CONTRIB_MODULES: RouterlyModule[] = []
