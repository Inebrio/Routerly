# ai/ — AI-first layer for Routerly

This directory is the canonical context source for any AI agent working on Routerly.

---

## Structure

```
ai/
  memory/       ← persistent project facts
    project.md      immutable facts (version, stack, ports)
    decisions.md    architectural decisions and rationale
    constraints.md  non-negotiable constraints

  context/      ← detailed technical context
    architecture.md  request flow, routing engine, provider adapters
    api.md           all endpoints (LLM proxy + management)
    database.md      JSON storage: files, schemas, access patterns
    infrastructure.md Docker, CI/CD, GitHub Actions, Firebase

  policies/     ← operational rules
    coding-style.md  naming, imports, TypeScript strict, comments
    dependencies.md  dependency management, list per package
    testing.md       Vitest 3, *.test.ts pattern, mocks, fixtures
    security.md      tokens, JWT, passwords, path traversal, Docker

  agents/       ← persona for each role
    service.md     specialist for packages/service/ (Fastify, routing, providers)
    frontend.md    specialist for packages/dashboard/ (React SPA)
    cli.md         specialist for packages/cli/ (Commander CLI)
    docs.md        specialist for docs/ (Docusaurus), consumer of handoffs
    cicd.md        specialist for CI/CD, Docker, install scripts, versioning
    developer.md   generic feature implementation and bugfixes
    reviewer.md    code review
    tester.md      writing Vitest tests

  skills/       ← copy-paste operational guides
    testing/SKILL.md       test templates for policies and providers
    code-review/SKILL.md   Routerly-specific review checklist

  prompts/      ← prompt templates
    implement-feature.md
    fix-bug.md
    review-code.md
    write-tests.md

  workflows/    ← step-by-step workflows
    feature-development.md
    bugfix.md

  adapters/     ← adaptations for specific AI tools
    copilot.md    → .github/copilot-instructions.md
    claude.md     → CLAUDE.md
    codex.md      notes for Codex/ChatGPT
```

---

## Recommended reading order

### Developer implementing a feature
1. `AGENTS.md` (root)
2. `ai/memory/constraints.md`
3. `ai/context/architecture.md`
4. `ai/policies/coding-style.md`
5. `ai/workflows/feature-development.md`
6. `ai/prompts/implement-feature.md`

### Developer fixing a bug
1. `AGENTS.md` (root)
2. `ai/context/architecture.md` (relevant section)
3. `ai/workflows/bugfix.md`
4. `ai/skills/testing/SKILL.md`

### Reviewer
1. `AGENTS.md` (root)
2. `ai/agents/reviewer.md`
3. `ai/skills/code-review/SKILL.md`

### Tester
1. `AGENTS.md` (root)
2. `ai/policies/testing.md`
3. `ai/agents/tester.md`
4. `ai/skills/testing/SKILL.md`

---

## Principles of this layer

- **No duplication**: details live here; `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md` link to these files
- **Specific, not generic**: every file describes how Routerly does things, not general best practices
- **Explicit TODOs**: where verified information is missing, `TODO:` is written explicitly
