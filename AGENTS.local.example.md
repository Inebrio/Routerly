# AGENTS.local.md — Local Developer Environment

> **Copy this file to `AGENTS.local.md` and fill in your details.**
> `AGENTS.local.md` is gitignored (`*.local`) — it will never be committed.
> It is read by AI agents **after** `AGENTS.md` to enrich context with your local setup.

---

## Local environment

| Variable | Value |
|----------|-------|
| `ROUTERLY_HOME` | `~/.routerly/` |
| Service port | `3000` (default) |
| Node version | `v22.x` |
| OS | macOS |

---

## Developer identity

| Key | Value |
|-----|-------|
| Routerly username | `YOUR_USERNAME` |
| Test project token | `YOUR_TEST_PROJECT_TOKEN` |

The test project token is used for all manual API tests and integration tests.

---

## Local providers

List the LLM providers you have running/configured locally. Agents use this to avoid
suggesting configurations that don't match your actual setup.

| Provider | Endpoint | Notes |
|----------|----------|-------|
| Ollama | `http://localhost:11434` | models: llama3, mistral |
| OpenAI | cloud | key in `~/.routerly/config.json` |
| Anthropic | cloud | key in `~/.routerly/config.json` |

---

## Active work

Document branches, features in progress, or pending tasks that agents should know about
so they don't create conflicting changes.

```
# Example:
# branch: feat/streaming-v2
# WIP: refactoring provider adapter interface in packages/service/src/adapters/
# do not touch: packages/service/src/adapters/openai.ts — mid-refactor
```

---

## Personal preferences for agents

Override or extend project-wide coding preferences for this developer.

```
# Examples:
# - Prefer explicit return types on all functions
# - When in doubt, ask before modifying test files
# - Console.log is acceptable during local development
# - Preferred test runner flags: --reporter=verbose
```

---

## Local tooling

Tools installed on this machine relevant to the project.

```
# Example:
# - Docker Desktop 4.x
# - Postman / httpie for API testing
# - pino-pretty installed globally: npm i -g pino-pretty
# - jq available in PATH
```

---

## Notes for agents

Any free-form context the agent should keep in mind when working on this machine.

```
# Example:
# - This machine is used for both CLI and service work
# - dashboard hot-reload on port 5173 is always running during development
# - Do not run `npm run build` on the full monorepo — it takes >2 min
```
