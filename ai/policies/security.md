# Security

## Authentication — two systems

### LLM proxy (`/v1/*`)
- Bearer token extracted from `Authorization: Bearer <token>` header
- Token is stored in `projects.json` as a **SHA-256 hash** — never as plaintext
- Verification: `SHA-256(incomingToken) === storedHash`
- On match: attach `request.project` Fastify decorator
- On mismatch or missing: return `401`

### Management API (`/api/*`)
- Custom HMAC-SHA256 JWT — format: `base64url(payload) + "." + HMAC-SHA256(base64url(payload), secret)`
- Secret: stored in `ROUTERLY_HOME/config/secret`, generated with `crypto.randomBytes(64)`, permissions `0600`
- JWT expiry: 1 hour (`exp` claim in seconds)
- Refresh token: 40-byte random hex, stored as SHA-256 hash in `users.json` (never the raw value)
- On expired/invalid JWT: return `401`
- On insufficient permissions: return `403`

## Passwords

- New passwords: `bcrypt` 12 rounds — always use `bcrypt.hash(password, 12)`
- **Never** use direct SHA-256 for new passwords
- Legacy SHA-256 hashes (unsalted) are silently migrated to bcrypt on first login
- Never log passwords, not even a truncated version

## Secrets management

- Never hardcode secrets in source code
- Never commit `ROUTERLY_HOME/config/secret`
- Never log or expose JWT secrets, API keys, or Bearer tokens
- API keys for providers (`models.json`) should be stored with care — consider at-rest encryption for sensitive deployments (TODO: encryption at rest not yet implemented)

## Input validation

- All incoming HTTP bodies are validated with **Zod** schemas before processing
- Never pass unvalidated user input to file system paths
- Path traversal prevention: any user-supplied path must be resolved and verified to stay inside `ROUTERLY_HOME`
  ```ts
  import { resolve } from 'node:path'
  const safePath = resolve(ROUTERLY_HOME, userInput)
  if (!safePath.startsWith(ROUTERLY_HOME)) throw new Error('Invalid path')
  ```

## Authorization (permissions)

- Always check permissions via the role system before mutating data
- `admin` can do everything; other roles have explicit permission lists in `roles.json`
- The permission check must happen in route handlers or route-level hooks, not in business logic

## CORS

- CORS is configured via `@fastify/cors` — review `settings.json` allowed origins before opening to production
- Default: same-origin only (dashboard served on same port)

## Docker security

- Container runs as non-root user `routerly:routerly`
- No secrets in Docker image layers — all config is in the mounted `/data` volume
- Do not use `--privileged` or bind-mount host paths other than the data volume

## Dependency security

- `npm audit` runs on every CI push — high/critical vulnerabilities block the build
- Keep SDK dependencies (openai, @anthropic-ai/sdk) up to date — they may contain security fixes

## OWASP Top 10 checklist for new endpoints

```
[ ] A01 Broken Access Control — permission check present?
[ ] A02 Cryptographic Failures — no plaintext secrets, bcrypt for passwords
[ ] A03 Injection — Zod validation on all inputs, no eval/exec with user data
[ ] A04 Insecure Design — no sensitive data in error messages
[ ] A05 Security Misconfiguration — CORS restricted, no debug endpoints in prod
[ ] A07 Identification and Authentication — auth plugin applied to route?
[ ] A09 Security Logging — no tokens in logs
```
