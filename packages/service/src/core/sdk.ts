/**
 * Routerly module SDK (0.4.0 refactory, Plan 6).
 *
 * The stable, public authoring surface for Routerly modules. A future contrib
 * module (in-tree or, later, distributed as an npm package) is written
 * against exactly these names. It is a curated view of `core/index.js`: it
 * omits internal kernel mechanics (Kernel, topologicalSort, GraphNode,
 * topicMatches) so the authoring contract does not drift as the kernel grows.
 *
 * Authoring a module:
 *
 *   import { defineModule, token, type ModuleRegistry, type Runtime } from './sdk.js'
 *
 *   const MY_SERVICE = token<MyService>('my.service')
 *
 *   export const myModule = defineModule({
 *     // 1. manifest: identity + ordering. `dependsOn` keys are other module ids;
 *     //    `before` / `after` / `weight` order this module against its peers.
 *     manifest: { id: 'my-module', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
 *
 *     // 2. register: put services behind DI tokens. Runs in dependency order,
 *     //    before any module starts. Contribute processors here by resolving the
 *     //    pipeline ProcessorRegistry from the container and calling `.contribute(p)`.
 *     register({ container, events }: ModuleRegistry) {
 *       container.register(MY_SERVICE, buildMyService())
 *     },
 *
 *     // 3. start (optional): open connections / warm caches. Runs after every
 *     //    module registered.
 *     async start({ container, events }: Runtime) {},
 *
 *     // 4. stop (optional): tear down. Runs in reverse start order, best-effort.
 *     async stop() {},
 *   })
 *
 * A processor is a thin unit contributed to a named pipeline phase:
 *
 *   const p: Processor<Ctx> = { id: 'my-step', phase: 'request.preprocess', run(ctx) {} }
 *
 * ponytail: pure re-export barrel, no runtime code. The doc comment is the SDK's
 * only added value over `core/index.js`; it is the authoring contract, curated.
 */
export {
  defineModule,
  ProcessorRegistry,
  token,
  EventBus,
  ServiceContainer,
  shortCircuit,
  isShortCircuit,
  KernelError,
  ModuleGraphError,
  MissingDependencyError,
  DependencyCycleError,
  AlterableRegistry,
  createRouteRegistry,
} from './index.js'

export type {
  RouterlyModule,
  ModuleManifest,
  ModuleRegistry,
  Runtime,
  Processor,
  Token,
  Contribution,
  RouteContribution,
} from './index.js'
