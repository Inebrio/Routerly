# Development Guide

This guide covers setting up a local development environment and understanding the codebase well
enough to contribute.

---

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10 (comes with Node.js 20)

---

## Setup

Clone and install all workspace dependencies:

```bash
git clone https://github.com/your-org/routerly.git
cd routerly
npm install
```

This installs dependencies for all four packages via npm workspaces.

---

## Running in Development Mode

Start the service with hot-reload (powered by tsx):

```bash
npm run dev
# equivalent to: npm run dev --workspace=packages/service
```

The service restarts automatically on TypeScript file changes.

To run the dashboard in watch mode simultaneously:

```bash
# Terminal 1, service
npm run dev

# Terminal 2, dashboard
npm run dev --workspace=packages/dashboard
```

The dashboard dev server runs on `http://localhost:5173` and proxies API requests to the service on port 3000.

---

## Project Structure

```
routerly/
├── packages/
│   ├── shared/          # Shared TypeScript types and crypto utils
│   ├── service/         # Fastify proxy server
│   ├── cli/             # Commander.js admin CLI
│   └── dashboard/       # Vite + React SPA
├── package.json         # Workspace root (scripts, devDependencies)
├── tsconfig.base.json   # Shared TypeScript config
└── docs/                # This documentation
```

See [Architecture](../service/architecture.md) for a deeper breakdown of the service internals.

---

## Available Scripts

Run from the workspace root:

| Script | Description |
|--------|-------------|
| `npm run build` | Build all packages |
| `npm run dev` | Start service in dev/watch mode |
| `npm test` | Run tests across all packages |
| `npm run lint` | Lint TypeScript files with ESLint |
| `npm run format` | Format with Prettier |

Per-package:

```bash
# Build only dashboard
npm run build --workspace=packages/dashboard

# Run tests in service package
npm test --workspace=packages/service
```

---

## TypeScript

All packages use TypeScript. The root `tsconfig.base.json` defines shared compiler options.
Each package extends it with its own `tsconfig.json`.

Key settings:
- `"moduleResolution": "bundler"` / `"node16"` depending on package
- `"strict": true`, all strict checks enabled
- ESM output (`"module": "ES2022"` or `"NodeNext"`)

---

## Adding a Routing Policy

Routing policies live in `packages/service/src/routing/policies/`.

1. Create a new file: `packages/service/src/routing/policies/my-policy.ts`

```typescript
import type { PolicyFn } from './types.js';

export const myPolicy: PolicyFn = async (candidates, _request, _project) => {
  return candidates.map(candidate => ({
    model: candidate.model,
    score: Math.random(),                  // replace with real logic
    reason: 'My policy reason',
  }));
};
```

2. Register it in the policy map (in `packages/service/src/routing/router.ts` or the policy registry):

```typescript
import { myPolicy } from './policies/my-policy.js';

const POLICY_MAP = {
  // ...existing policies...
  'my-policy': myPolicy,
};
```

3. Add `'my-policy'` to the `RoutingPolicyType` union in `packages/shared/src/types/config.ts`.

---

## Adding a Provider

Provider adapters live in `packages/service/src/providers/`.

1. Implement the `ProviderAdapter` interface:

```typescript
// packages/service/src/providers/my-provider.ts
import type { ProviderAdapter } from './types.js';

export const myProviderAdapter: ProviderAdapter = {
  async chat(model, request) {
    // translate request → provider API → translate response
  },
  async *stream(model, request) {
    // yield SSE chunks
  },
};
```

2. Register in `packages/service/src/providers/index.ts`:

```typescript
import { myProviderAdapter } from './my-provider.js';

export function getProviderAdapter(model: ModelConfig): ProviderAdapter {
  switch (model.provider) {
    // ...
    case 'my-provider': return myProviderAdapter;
    default: throw new Error(`Unknown provider: ${model.provider}`);
  }
}
```

3. Add `'my-provider'` to the `Provider` type in `packages/shared/src/types/config.ts`.

---

## Testing

Tests use [Vitest](https://vitest.dev/):

```bash
npm test                                  # run all packages
npm test --workspace=packages/service     # run service tests only
```

Test files follow the `*.test.ts` naming convention.

---

## Linting & Formatting

```bash
npm run lint      # ESLint, TypeScript-aware rules
npm run format    # Prettier, auto-format all .ts files
```

Both run across all packages. CI will reject PRs that fail lint or have formatting issues.

---

## Environment Variables (Development)

```bash
export ROUTERLY_HOME="$HOME/.routerly-dev"  # optional: use a separate dev config dir
export NODE_ENV="development"               # enables pino-pretty logs
```
