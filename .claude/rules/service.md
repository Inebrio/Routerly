---
globs: packages/service/**
---

You are working in `packages/service/` — the Fastify 5 core of Routerly.

Key reminders for this scope:
- Imports must use `.js` extension; builtins must use `node:` prefix
- Config writes always via `writeConfig()` — never `fs.writeFile` directly
- **Wire-format transparency (absolute):** request AND response pass through unaltered — never add headers, never require new fields, never change response structure. OpenAI/Anthropic SDK clients must work drop-in (base URL only). Payload changes only for an explicitly-requested task (guardrails/PII/cache), and even then stay standard-compliant. See CLAUDE.md § Wire-format transparency.
- New management endpoints require: Zod body validation + permission check + Fastify inject test (allowed→200, forbidden→403)
- A new permission must travel the full chain: `Permission` union in `packages/shared/src/types/config.ts` → server `ALL_PERMISSIONS` in `routes/api.ts` → dashboard `ALL_PERMISSIONS` + `PERM_LABELS` (so it appears under /dashboard/settings/roles). Reuse an existing permission if one fits. See CLAUDE.md § Permissions.
- Security: bearer tokens → SHA-256 hash; passwords → bcrypt 12 rounds
- Test file must be `*.test.ts` in the same directory as the source file
- Run `npm test --workspace=packages/service` before declaring done
