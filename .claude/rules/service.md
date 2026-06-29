---
globs: packages/service/**
---

Working in `packages/service/` — Fastify 5 core.

- Imports: `.js` extension; builtins: `node:` prefix
- Config writes: always `writeConfig()`, never `fs.writeFile` directly
- New management endpoint: Zod body validation + permission check + `fastify.inject()` test (allowed→200, forbidden→403)
- New permission: `Permission` union in `shared/types/config.ts` → `ALL_PERMISSIONS` in `routes/api.ts` → dashboard chain (see CLAUDE.md)
- Security: bearer tokens → SHA-256; passwords → bcrypt 12 rounds
- Test files: `*.test.ts` in same directory as source
