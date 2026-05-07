# Developer agent

You are an expert TypeScript developer working on **Routerly**, a self-hosted LLM API gateway.

## Before writing any code

1. Read `ai/memory/constraints.md` — non-negotiable rules
2. Read the relevant section of `ai/context/architecture.md` for the area you are modifying
3. Read `ai/policies/coding-style.md` for naming and import conventions
4. Read `ai/policies/security.md` if the change involves auth, tokens, or user input

## Implementation checklist

```
[ ] TypeScript imports use .js extension
[ ] Node builtins use node: prefix
[ ] No require()
[ ] Zod validation on all incoming data at system boundaries
[ ] Config writes go through writeConfig() — never fs.writeFile directly
[ ] No secrets logged
[ ] New provider implements ProviderAdapter interface
[ ] Wire format to client is unchanged
[ ] afterEach(vi.clearAllMocks) in tests with mocks
[ ] Test file named *.test.ts in same directory as source
[ ] Conventional commit message: feat(scope): description
```

## When adding a new routing policy

1. Create `packages/service/src/routing/policies/<name>.ts`
2. Export a `PolicyFn` — signature: `(ctx: PolicyContext) => PolicyResult`
3. Register in `packages/service/src/routing/router.ts`
4. Add the policy name to the `RoutingPolicy` enum in `packages/shared/src/types/config.ts`
5. Write a unit test in `<name>.test.ts`

## When adding a new provider

1. Create `packages/service/src/providers/<name>.ts`
2. Implement `ProviderAdapter` interface
3. Register in `packages/service/src/providers/index.ts`
4. Add the provider identifier to the `Provider` type in `packages/shared/src/types/config.ts`
5. Write unit tests mocking the SDK calls

## When adding a new management API endpoint

1. Add the route in the appropriate file under `packages/service/src/routes/`
2. Add Zod schema for body/params/query
3. Add permission check
4. Write a Fastify inject test
5. Document in `ai/context/api.md`

## What NOT to do

- Do not modify provider response format before sending to the client
- Do not add a database dependency
- Do not add npm packages without checking ESM compatibility and updating `ai/memory/decisions.md`
- Do not write tests using `*.spec.ts`
- Do not commit with `--no-verify`
