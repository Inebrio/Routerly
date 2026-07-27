# Step 11: modules/auth/ + modules/audit/ + modules/notifications/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** move `auth/`, `plugins/jwt.ts`, `plugins/auth.ts`, `audit/`, `notifications/` (incl. `notifications/channels/`) into `modules/auth/`, `modules/audit/`, `modules/notifications/`, each getting a `defineModule` wrapper exposing a DI token, matching the "flat wrap the existing directory" treatment already used for `modules/catalog/` (Step 5) and `modules/embeddings/` (Step 6).

**Architecture:** unlike Steps 3-10, none of these three source areas are wired through `buildKernel([...coreModules])` today. `plugins/auth.ts` is a raw Fastify plugin registered via `fastify.register(authPlugin)` in `server.ts`; `plugins/jwt.ts`'s `loadSecret()` is a plain startup call; `audit/logger.ts`'s `logAudit` and `notifications/emitter.ts`'s `emitEvent`/`sender.ts`'s `dispatchNotification` are plain functions called directly by consumers, never resolved via the container. Per the overview's KB cross-check, these get the same "flat wrap" treatment as `catalog`/`embeddings`: move the files, add an `index.ts` with a `defineModule` wrapper that registers ONE token exposing the module's real functions by reference (no reimplementation), but do **not** add the module to `coreModules`/`buildKernel` — exactly like `embeddingsModule`, which exists and is unused today. `server.ts`'s `fastify.register(authPlugin)` / `await loadSecret()` calls stay exactly as they are, only their import paths change. All existing consumers keep their direct file imports; only import paths move.

**Tech Stack:** TypeScript ESM, Fastify 5, vitest, existing DI token pattern (`core/tokens.ts`).

## Global Constraints

- No em-dashes anywhere (code, comments, docs, commit messages).
- Wire-format transparency ABSOLUTE — zero behavior change, this is a pure directory move + token wrapper addition.
- Public contracts frozen — every exported function keeps its exact name, signature, and behavior.
- Commit subjects: all-lowercase (commitlint `subject-case`). Commit body lines: <=100 chars (commitlint `body-max-line-length`).
- Every file move via `git mv` (preserves history), never delete+recreate.
- After every multi-path `git add`, run `git status --short` to confirm staged paths (multi-pathspec `git add` silently drops all paths if one doesn't match).
- Run targeted vitest + typecheck after each task; run the full-suite regression once after all three sub-modules are done, compare against the known baseline (3 failed/2154 passed: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1 — pre-existing, unrelated to this restructure).
- **Sequential execution only** (closed decision, overview line 159): audit, then auth, then notifications, one at a time, in this same worktree. No parallel subagents for the three sub-modules despite their mutual independence.
- Order chosen (audit -> auth -> notifications) minimizes cross-module import churn: `audit/logger.ts` has zero references to auth/notifications; `plugins/auth.ts` references `notifications/emitter.js` (temporarily needs an extra `../` hop while notifications hasn't moved yet, corrected in the notifications task group); `notifications/emitter.ts` references `auth/roles.js` (resolves cleanly once auth has already moved).

---

## Task Group A: `modules/audit/`

### Task 1: Move `audit/` into `modules/audit/`, fix internal import depth

**Files:**
- Move: `packages/service/src/audit/logger.ts` -> `packages/service/src/modules/audit/logger.ts`
- Move: `packages/service/src/audit/logger.test.ts` -> `packages/service/src/modules/audit/logger.test.ts`

**Interfaces:**
- Produces: `logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void>`, re-exported `AuditEntry` type, both at `modules/audit/logger.js`.

- [ ] **Step 1: `git mv`**

```bash
mkdir -p modules/audit
git mv audit/logger.ts modules/audit/logger.ts
git mv audit/logger.test.ts modules/audit/logger.test.ts
```

- [ ] **Step 2: fix import depth in both moved files**

`modules/audit/logger.ts`, before:
```ts
import { readConfig, writeConfig } from '../modules/config/loader.js';
import type { AuditEntry } from '../modules/config/loader.js';
```
after:
```ts
import { readConfig, writeConfig } from '../config/loader.js';
import type { AuditEntry } from '../config/loader.js';
```

`modules/audit/logger.test.ts`, before:
```ts
vi.mock('../modules/config/loader.js', () => ({
```
after:
```ts
vi.mock('../config/loader.js', () => ({
```

- [ ] **Step 3: run targeted vitest + typecheck**

```bash
npx vitest run modules/audit/logger.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all tests pass, typecheck clean (remaining errors are the unmoved `routes/api.ts` still importing the old `audit/logger.js` path, fixed in Task 3).

- [ ] **Step 4: commit**

```bash
git add modules/audit/logger.ts modules/audit/logger.test.ts
git status --short
git commit -m "refactor(audit): move audit/logger into modules/audit/"
```

### Task 2: Add `modules/audit/index.ts` module wrapper + `AUDIT` token

**Files:**
- Create: `packages/service/src/modules/audit/index.ts`
- Modify: `packages/service/src/core/tokens.ts`

**Interfaces:**
- Consumes: `logAudit` from `./logger.js` (Task 1).
- Produces: `auditModule: RouterlyModule`, `AUDIT` token (unregistered in `coreModules`/`buildKernel`, matching `EMBEDDINGS`).

- [ ] **Step 1: add `AUDIT` token to `core/tokens.ts`**

Add after the `EMBEDDINGS` token block:
```ts
export const AUDIT = token<{
  logAudit: typeof import('../modules/audit/logger.js').logAudit;
}>('audit.registry');
```

- [ ] **Step 2: write `modules/audit/index.ts`**

```ts
import { defineModule } from '../../core/index.js';
import { AUDIT } from '../../core/tokens.js';
import { logAudit } from './logger.js';

/**
 * Audit module: owns the real audit-trail implementation (logger.ts) and
 * exposes it behind the AUDIT DI token. Other files still import logger.ts
 * directly by path; this module additionally makes it reachable through the
 * container.
 */
export const auditModule = defineModule({
  manifest: { id: 'audit', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(AUDIT, { logAudit });
  },
});
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck --workspace=packages/service
```
Expected: clean for the new files (pre-existing `routes/api.ts` errors remain until Task 3).

- [ ] **Step 4: commit**

```bash
git add packages/service/src/core/tokens.ts packages/service/src/modules/audit/index.ts
git status --short
git commit -m "feat(audit): add audit di token and module wrapper"
```

### Task 3: Repoint external consumers of `audit/logger.js`

**Files:**
- Modify: `packages/service/src/routes/api.ts`
- Modify: `packages/service/src/routes/api.test.ts`

**Interfaces:**
- Consumes: `logAudit`, `AuditEntry` from `../modules/audit/logger.js`.

- [ ] **Step 1: `routes/api.ts`**

before:
```ts
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
```
after:
```ts
import { logAudit } from '../modules/audit/logger.js';
import type { AuditEntry } from '../modules/audit/logger.js';
```

- [ ] **Step 2: `routes/api.test.ts`**

before:
```ts
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
```
after:
```ts
vi.mock('../modules/audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
```

- [ ] **Step 3: blanket stale-reference grep**

```bash
grep -rln "from '\.\./audit/logger\|from '\.\./\.\./audit/logger\|audit/logger\.js'" --include="*.ts" . | grep -v modules/audit
```
Expected: no output (only comment references, e.g. `modules/config/loader.ts`'s "Mirrors audit/logger.ts" comment, which needs no code change).

- [ ] **Step 4: targeted vitest + typecheck**

```bash
npx vitest run routes/api.test.ts routes/api.sessions.test.ts modules/audit/logger.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all pass, typecheck clean.

- [ ] **Step 5: commit**

```bash
git add packages/service/src/routes/api.ts packages/service/src/routes/api.test.ts
git status --short
git commit -m "refactor(audit): repoint external consumers to modules/audit/"
```

---

## Task Group B: `modules/auth/`

### Task 4: Move `auth/`, `plugins/jwt.ts`, `plugins/auth.ts` into `modules/auth/`, fix internal import depth

**Files:**
- Move: `packages/service/src/auth/roles.ts` -> `packages/service/src/modules/auth/roles.ts`
- Move: `packages/service/src/auth/roles.test.ts` -> `packages/service/src/modules/auth/roles.test.ts`
- Move: `packages/service/src/auth/totp.ts` -> `packages/service/src/modules/auth/totp.ts`
- Move: `packages/service/src/auth/totp.test.ts` -> `packages/service/src/modules/auth/totp.test.ts`
- Move: `packages/service/src/plugins/jwt.ts` -> `packages/service/src/modules/auth/jwt.ts`
- Move: `packages/service/src/plugins/jwt.test.ts` -> `packages/service/src/modules/auth/jwt.test.ts`
- Move: `packages/service/src/plugins/auth.ts` -> `packages/service/src/modules/auth/auth.ts`
- Move: `packages/service/src/plugins/auth.test.ts` -> `packages/service/src/modules/auth/auth.test.ts`

**Interfaces:**
- Produces: `ALL_PERMISSIONS`, `BUILT_IN_ROLES`, `getEffectiveRoles` at `modules/auth/roles.js`; `generateTotpSecret`, `getTotpCode`, `verifyTotp`, `generateBackupCodes`, `hashBackupCode` at `modules/auth/totp.js`; `loadSecret`, `getSecret`, `signToken`, `verifyToken`, `createSessionToken`, `generateRawToken` at `modules/auth/jwt.js`; default export `authPlugin`, `extractProjectToken`, `resolveProjectByToken` at `modules/auth/auth.js`.

- [ ] **Step 1: `git mv`**

```bash
git mv auth/roles.ts modules/auth/roles.ts
git mv auth/roles.test.ts modules/auth/roles.test.ts
git mv auth/totp.ts modules/auth/totp.ts
git mv auth/totp.test.ts modules/auth/totp.test.ts
git mv plugins/jwt.ts modules/auth/jwt.ts
git mv plugins/jwt.test.ts modules/auth/jwt.test.ts
git mv plugins/auth.ts modules/auth/auth.ts
git mv plugins/auth.test.ts modules/auth/auth.test.ts
rmdir auth plugins 2>/dev/null || true
```

- [ ] **Step 2: fix import depth (only files with relative imports outside their own new directory)**

`roles.ts`, `roles.test.ts`, `totp.ts`, `totp.test.ts`: zero relative imports (only `@routerly/shared` and `node:crypto`). No changes needed.

`modules/auth/jwt.ts`, before:
```ts
import { getOrCreateSecret } from '../modules/config/loader.js';
```
after:
```ts
import { getOrCreateSecret } from '../config/loader.js';
```

`modules/auth/jwt.test.ts`: check for the same `../modules/config/loader.js` mock path and fix identically if present.

`modules/auth/auth.ts`, before:
```ts
import { readConfig, writeConfig } from '../modules/config/loader.js';
import { emitEvent } from '../notifications/emitter.js';
```
after:
```ts
import { readConfig, writeConfig } from '../config/loader.js';
import { emitEvent } from '../../notifications/emitter.js';
```
(`notifications/` has not moved yet at this point in the sequence — extra `../` hop is temporary, corrected in Task 8 when notifications moves under `modules/`.)

`modules/auth/auth.test.ts`: check for `../modules/config/loader.js` and `../notifications/emitter.js` mock/import paths and apply the same two fixes if present.

- [ ] **Step 3: run targeted vitest + typecheck**

```bash
npx vitest run modules/auth/roles.test.ts modules/auth/totp.test.ts modules/auth/jwt.test.ts modules/auth/auth.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all tests pass. Typecheck will still show errors in `server.ts` and `routes/api.ts` (old `./plugins/*.js` / `../plugins/*.js` / `../auth/*.js` paths) until Task 5.

- [ ] **Step 4: commit**

```bash
git add modules/auth/roles.ts modules/auth/roles.test.ts modules/auth/totp.ts modules/auth/totp.test.ts modules/auth/jwt.ts modules/auth/jwt.test.ts modules/auth/auth.ts modules/auth/auth.test.ts
git status --short
git commit -m "refactor(auth): move auth/ and plugins/jwt+auth into modules/auth/"
```

### Task 5: Add `modules/auth/index.ts` module wrapper + `AUTH` token

**Files:**
- Create: `packages/service/src/modules/auth/index.ts`
- Modify: `packages/service/src/core/tokens.ts`

**Interfaces:**
- Consumes: `signToken`, `verifyToken`, `createSessionToken`, `generateRawToken` from `./jwt.js`; `extractProjectToken`, `resolveProjectByToken` from `./auth.js`; `getEffectiveRoles` from `./roles.js`; `generateTotpSecret`, `verifyTotp`, `generateBackupCodes` from `./totp.js`.
- Produces: `authModule: RouterlyModule`, `AUTH` token (unregistered in `coreModules`/`buildKernel`, matching `EMBEDDINGS`; `fastify.register(authPlugin)` / `loadSecret()` startup wiring in `server.ts` stays untouched).

- [ ] **Step 1: add `AUTH` token to `core/tokens.ts`**

Add after the `AUDIT` token block:
```ts
export const AUTH = token<{
  signToken: typeof import('../modules/auth/jwt.js').signToken;
  verifyToken: typeof import('../modules/auth/jwt.js').verifyToken;
  createSessionToken: typeof import('../modules/auth/jwt.js').createSessionToken;
  generateRawToken: typeof import('../modules/auth/jwt.js').generateRawToken;
  extractProjectToken: typeof import('../modules/auth/auth.js').extractProjectToken;
  resolveProjectByToken: typeof import('../modules/auth/auth.js').resolveProjectByToken;
  getEffectiveRoles: typeof import('../modules/auth/roles.js').getEffectiveRoles;
}>('auth.registry');
```

- [ ] **Step 2: write `modules/auth/index.ts`**

```ts
import { defineModule } from '../../core/index.js';
import { AUTH } from '../../core/tokens.js';
import { signToken, verifyToken, createSessionToken, generateRawToken } from './jwt.js';
import { extractProjectToken, resolveProjectByToken } from './auth.js';
import { getEffectiveRoles } from './roles.js';

/**
 * Auth module: owns the real JWT/session (jwt.ts), project-token resolution
 * (auth.ts, a raw Fastify plugin registered directly in server.ts, unrelated
 * to this token), and role (roles.ts) implementations, exposed behind the
 * AUTH DI token. Other files still import these files directly by path;
 * this module additionally makes the core functions reachable through the
 * container. authPlugin itself stays a plain default export consumed by
 * server.ts's fastify.register(), not part of this token.
 */
export const authModule = defineModule({
  manifest: { id: 'auth', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(AUTH, {
      signToken,
      verifyToken,
      createSessionToken,
      generateRawToken,
      extractProjectToken,
      resolveProjectByToken,
      getEffectiveRoles,
    });
  },
});
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck --workspace=packages/service
```
Expected: clean for the new files (pre-existing `server.ts`/`routes/api.ts` errors remain until Task 6).

- [ ] **Step 4: commit**

```bash
git add packages/service/src/core/tokens.ts packages/service/src/modules/auth/index.ts
git status --short
git commit -m "feat(auth): add auth di token and module wrapper"
```

### Task 6: Repoint external consumers of `auth/*.js` and `plugins/*.js`

**Files:**
- Modify: `packages/service/src/server.ts`
- Modify: `packages/service/src/routes/api.ts`
- Modify: `packages/service/src/routes/api.test.ts`
- Modify: `packages/service/src/routes/api.sessions.test.ts`

**Interfaces:**
- Consumes: `authPlugin` (default), `loadSecret`, `createSessionToken`, `verifyToken`, `generateRawToken`, `generateTotpSecret`, `verifyTotp`, `generateBackupCodes`, `hashBackupCode`, `ALL_PERMISSIONS`, `BUILT_IN_ROLES`, `getEffectiveRoles`, all from `../modules/auth/*.js`.

- [ ] **Step 1: `server.ts`**

before:
```ts
import authPlugin from './plugins/auth.js';
import { loadSecret } from './plugins/jwt.js';
```
after:
```ts
import authPlugin from './modules/auth/auth.js';
import { loadSecret } from './modules/auth/jwt.js';
```

- [ ] **Step 2: `routes/api.ts`**

before:
```ts
import { createSessionToken, verifyToken, generateRawToken } from '../plugins/jwt.js';
import { generateTotpSecret, verifyTotp, generateBackupCodes, hashBackupCode } from '../auth/totp.js';
```
and
```ts
import { ALL_PERMISSIONS, BUILT_IN_ROLES, getEffectiveRoles } from '../auth/roles.js';
```
after:
```ts
import { createSessionToken, verifyToken, generateRawToken } from '../modules/auth/jwt.js';
import { generateTotpSecret, verifyTotp, generateBackupCodes, hashBackupCode } from '../modules/auth/totp.js';
```
and
```ts
import { ALL_PERMISSIONS, BUILT_IN_ROLES, getEffectiveRoles } from '../modules/auth/roles.js';
```

- [ ] **Step 3: `routes/api.test.ts`**

before:
```ts
vi.mock('../plugins/jwt.js', () => ({
```
and
```ts
import { createSessionToken, verifyToken } from '../plugins/jwt.js'
```
and
```ts
vi.mock('../auth/totp.js', () => ({
```
and
```ts
import { verifyTotp, generateTotpSecret, generateBackupCodes, hashBackupCode } from '../auth/totp.js'
```
after (same names, `modules/auth/` path):
```ts
vi.mock('../modules/auth/jwt.js', () => ({
```
```ts
import { createSessionToken, verifyToken } from '../modules/auth/jwt.js'
```
```ts
vi.mock('../modules/auth/totp.js', () => ({
```
```ts
import { verifyTotp, generateTotpSecret, generateBackupCodes, hashBackupCode } from '../modules/auth/totp.js'
```

- [ ] **Step 4: `routes/api.sessions.test.ts`**

before:
```ts
vi.mock('../plugins/jwt.js', () => ({
```
and
```ts
import { verifyToken } from '../plugins/jwt.js'
```
after:
```ts
vi.mock('../modules/auth/jwt.js', () => ({
```
```ts
import { verifyToken } from '../modules/auth/jwt.js'
```

- [ ] **Step 5: blanket stale-reference grep**

```bash
grep -rln "from '\.\./plugins/\|from '\./plugins/\|from '\.\./auth/roles\|from '\.\./auth/totp\|from '\.\./\.\./auth/roles\|from '\.\./\.\./auth/totp" --include="*.ts" . | grep -v modules/auth
```
Expected: no output.

- [ ] **Step 6: targeted vitest + typecheck**

```bash
npx vitest run routes/api.test.ts routes/api.sessions.test.ts modules/auth/roles.test.ts modules/auth/totp.test.ts modules/auth/jwt.test.ts modules/auth/auth.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all pass. Typecheck will still show one remaining error: `modules/auth/auth.ts`'s `../../notifications/emitter.js` import is correct-but-temporary (real file still at `notifications/emitter.ts` until Task 8), so this must resolve clean already; no error expected here.

- [ ] **Step 7: commit**

```bash
git add packages/service/src/server.ts packages/service/src/routes/api.ts packages/service/src/routes/api.test.ts packages/service/src/routes/api.sessions.test.ts
git status --short
git commit -m "refactor(auth): repoint external consumers to modules/auth/"
```

---

## Task Group C: `modules/notifications/`

### Task 7: Move `notifications/` (incl. `channels/`) into `modules/notifications/`, fix internal import depth

**Files:**
- Move: `packages/service/src/notifications/emitter.ts` -> `packages/service/src/modules/notifications/emitter.ts`
- Move: `packages/service/src/notifications/emitter.test.ts` -> `packages/service/src/modules/notifications/emitter.test.ts`
- Move: `packages/service/src/notifications/sender.ts` -> `packages/service/src/modules/notifications/sender.ts`
- Move: `packages/service/src/notifications/sender.test.ts` -> `packages/service/src/modules/notifications/sender.test.ts`
- Move: `packages/service/src/notifications/channels/{discord,pagerduty,slack,teams}.ts` (+ `.test.ts`) -> `packages/service/src/modules/notifications/channels/` (same basenames)

**Interfaces:**
- Produces: `emitEvent`, `appendToInbox`, `resolveTargetUsers`, `matchesPattern`, `NOTIFICATION_EVENTS` at `modules/notifications/emitter.js`; `sendTestNotification`, `dispatchNotification` at `modules/notifications/sender.js`; `sendSlack`/`sendTeams`/`sendPagerDuty`/`sendDiscord`/`NotificationPayload` at `modules/notifications/channels/*.js` (unchanged, `channels/` moves as a whole subtree, internal sibling imports like `./slack.js` for `NotificationPayload` stay identical).

- [ ] **Step 1: `git mv`**

```bash
mkdir -p modules/notifications/channels
git mv notifications/emitter.ts modules/notifications/emitter.ts
git mv notifications/emitter.test.ts modules/notifications/emitter.test.ts
git mv notifications/sender.ts modules/notifications/sender.ts
git mv notifications/sender.test.ts modules/notifications/sender.test.ts
git mv notifications/channels/discord.ts modules/notifications/channels/discord.ts
git mv notifications/channels/discord.test.ts modules/notifications/channels/discord.test.ts
git mv notifications/channels/pagerduty.ts modules/notifications/channels/pagerduty.ts
git mv notifications/channels/pagerduty.test.ts modules/notifications/channels/pagerduty.test.ts
git mv notifications/channels/slack.ts modules/notifications/channels/slack.ts
git mv notifications/channels/slack.test.ts modules/notifications/channels/slack.test.ts
git mv notifications/channels/teams.ts modules/notifications/channels/teams.ts
git mv notifications/channels/teams.test.ts modules/notifications/channels/teams.test.ts
rmdir notifications/channels notifications 2>/dev/null || true
```

- [ ] **Step 2: fix import depth**

`modules/notifications/emitter.ts`, before:
```ts
import { readConfig, writeConfig } from '../modules/config/loader.js';
import { dispatchNotification } from './sender.js';
import { getEffectiveRoles } from '../auth/roles.js';
```
after:
```ts
import { readConfig, writeConfig } from '../config/loader.js';
import { dispatchNotification } from './sender.js';
import { getEffectiveRoles } from '../auth/roles.js';
```
(`./sender.js` and `../auth/roles.js` are unchanged: `sender.ts` is still a direct sibling, and `auth/` now lives one level up from `notifications/` exactly as it did before the move, since both are now `modules/`-level siblings.)

`modules/notifications/emitter.test.ts`: check for a `../modules/config/loader.js` mock path and fix identically if present; `./sender.js` and `../auth/roles.js` references stay as-is.

`modules/notifications/sender.ts`, `sender.test.ts`, and all `channels/*.ts`/`channels/*.test.ts`: zero cross-directory relative imports beyond their own new subtree (`./channels/*.js`, `./emitter.js`, `./slack.js`) — no changes needed.

- [ ] **Step 3: run targeted vitest + typecheck**

```bash
npx vitest run modules/notifications/emitter.test.ts modules/notifications/sender.test.ts modules/notifications/channels/discord.test.ts modules/notifications/channels/pagerduty.test.ts modules/notifications/channels/slack.test.ts modules/notifications/channels/teams.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all tests pass. Typecheck will still show errors in `llm/executor.ts`, `reverse-proxy/lanes/openai.ts`, `routes/api.ts`, `modules/auth/auth.ts` (old/temporary `notifications/emitter.js` paths) until Task 9.

- [ ] **Step 4: commit**

```bash
git add modules/notifications
git status --short
git commit -m "refactor(notifications): move notifications/ into modules/notifications/"
```

### Task 8: Add `modules/notifications/index.ts` module wrapper + `NOTIFICATIONS` token

**Files:**
- Create: `packages/service/src/modules/notifications/index.ts`
- Modify: `packages/service/src/core/tokens.ts`

**Interfaces:**
- Consumes: `emitEvent`, `appendToInbox` from `./emitter.js`; `dispatchNotification`, `sendTestNotification` from `./sender.js`.
- Produces: `notificationsModule: RouterlyModule`, `NOTIFICATIONS` token (unregistered in `coreModules`/`buildKernel`, matching `EMBEDDINGS`).

- [ ] **Step 1: add `NOTIFICATIONS` token to `core/tokens.ts`**

Add after the `AUTH` token block:
```ts
export const NOTIFICATIONS = token<{
  emitEvent: typeof import('../modules/notifications/emitter.js').emitEvent;
  appendToInbox: typeof import('../modules/notifications/emitter.js').appendToInbox;
  dispatchNotification: typeof import('../modules/notifications/sender.js').dispatchNotification;
  sendTestNotification: typeof import('../modules/notifications/sender.js').sendTestNotification;
}>('notifications.registry');
```

- [ ] **Step 2: write `modules/notifications/index.ts`**

```ts
import { defineModule } from '../../core/index.js';
import { NOTIFICATIONS } from '../../core/tokens.js';
import { emitEvent, appendToInbox } from './emitter.js';
import { dispatchNotification, sendTestNotification } from './sender.js';

/**
 * Notifications module: owns the real event-emit/inbox (emitter.ts) and
 * channel-dispatch (sender.ts, channels/*) implementations, exposed behind
 * the NOTIFICATIONS DI token. Other files still import emitter.ts/sender.ts
 * directly by path; this module additionally makes them reachable through
 * the container.
 */
export const notificationsModule = defineModule({
  manifest: { id: 'notifications', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(NOTIFICATIONS, {
      emitEvent,
      appendToInbox,
      dispatchNotification,
      sendTestNotification,
    });
  },
});
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck --workspace=packages/service
```
Expected: clean for the new files (pre-existing consumer errors remain until Task 9).

- [ ] **Step 4: commit**

```bash
git add packages/service/src/core/tokens.ts packages/service/src/modules/notifications/index.ts
git status --short
git commit -m "feat(notifications): add notifications di token and module wrapper"
```

### Task 9: Repoint external consumers of `notifications/emitter.js` and `notifications/sender.js`

**Files:**
- Modify: `packages/service/src/llm/executor.ts`
- Modify: `packages/service/src/llm/executor.test.ts`
- Modify: `packages/service/src/modules/auth/auth.ts`
- Modify: `packages/service/src/reverse-proxy/lanes/openai.ts`
- Modify: `packages/service/src/routes/api.ts`

**Interfaces:**
- Consumes: `emitEvent` from `../modules/notifications/emitter.js` (depth varies by consumer location); `sendTestNotification` from `../modules/notifications/sender.js`.

- [ ] **Step 1: `llm/executor.ts`**

before:
```ts
import { emitEvent } from '../notifications/emitter.js';
```
after:
```ts
import { emitEvent } from '../modules/notifications/emitter.js';
```

- [ ] **Step 2: `llm/executor.test.ts`**

before:
```ts
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
```
and
```ts
import { emitEvent } from '../notifications/emitter.js'
```
after:
```ts
vi.mock('../modules/notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
```
```ts
import { emitEvent } from '../modules/notifications/emitter.js'
```

- [ ] **Step 3: `modules/auth/auth.ts`** (correcting the temporary extra-hop path from Task 4)

before:
```ts
import { emitEvent } from '../../notifications/emitter.js';
```
after:
```ts
import { emitEvent } from '../notifications/emitter.js';
```

- [ ] **Step 4: `reverse-proxy/lanes/openai.ts`**

before:
```ts
import { emitEvent } from '../../notifications/emitter.js'
```
after:
```ts
import { emitEvent } from '../../modules/notifications/emitter.js'
```

- [ ] **Step 5: `routes/api.ts`**

before:
```ts
import { sendTestNotification } from '../notifications/sender.js';
import { emitEvent } from '../notifications/emitter.js';
```
after:
```ts
import { sendTestNotification } from '../modules/notifications/sender.js';
import { emitEvent } from '../modules/notifications/emitter.js';
```

- [ ] **Step 6: `routes/api.test.ts`** (also references `notifications/sender.js`/`emitter.js` via `vi.mock`)

before:
```ts
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn() }))
```
and
```ts
import { sendTestNotification } from '../notifications/sender.js'
```
after:
```ts
vi.mock('../modules/notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
vi.mock('../modules/notifications/emitter.js', () => ({ emitEvent: vi.fn() }))
```
```ts
import { sendTestNotification } from '../modules/notifications/sender.js'
```

- [ ] **Step 7: `routes/api.sessions.test.ts`** (also references `notifications/sender.js` via `vi.mock`)

before:
```ts
vi.mock('../notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
```
after:
```ts
vi.mock('../modules/notifications/sender.js', () => ({ sendTestNotification: vi.fn() }))
```

- [ ] **Step 8: blanket stale-reference grep across the whole `src/`**

```bash
grep -rln "from '\.\./notifications/\|from '\.\./\.\./notifications/\|from '\./notifications/\|from '\.\./auth/\|from '\.\./\.\./auth/\|from '\.\./plugins/\|from '\./plugins/\|from '\.\./audit/\|from '\.\./\.\./audit/" --include="*.ts" .
```
Expected: no output. Confirms `src/auth/`, `src/plugins/`, `src/audit/`, `src/notifications/` are fully vacated and no consumer still points at the old flat paths.

- [ ] **Step 9: targeted vitest + typecheck**

```bash
npx vitest run llm/executor.test.ts reverse-proxy/lanes/openai.ts routes/api.test.ts routes/api.sessions.test.ts modules/notifications/emitter.test.ts modules/notifications/sender.test.ts modules/auth/auth.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all pass, typecheck fully clean (no remaining errors anywhere in the project).

- [ ] **Step 10: commit**

```bash
git add packages/service/src/llm/executor.ts packages/service/src/llm/executor.test.ts packages/service/src/modules/auth/auth.ts packages/service/src/reverse-proxy/lanes/openai.ts packages/service/src/routes/api.ts packages/service/src/routes/api.test.ts packages/service/src/routes/api.sessions.test.ts
git status --short
git commit -m "refactor(notifications): repoint external consumers to modules/notifications/"
```

### Task 10: Full-suite regression + progress ledger

- [ ] **Step 1: run the full test suite**

```bash
npx vitest run
```
Expected: matches the known pre-existing baseline (3 failed/2154 passed: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1). Any new failure is a regression from this step and must be fixed before proceeding.

- [ ] **Step 2: append a Step 11 completion entry to `.superpowers/sdd/progress.md`**

Summarize: audit/auth/notifications moved into `modules/`, three new `index.ts` wrappers with `AUDIT`/`AUTH`/`NOTIFICATIONS` tokens (unregistered in `coreModules`/`buildKernel`, matching the `EMBEDDINGS` precedent), `server.ts`'s `fastify.register(authPlugin)`/`await loadSecret()` untouched apart from import paths, full consumer repoint across `routes/api.ts`, its two test files, `llm/executor.ts`(+test), `reverse-proxy/lanes/openai.ts`. Note: Step 12 (`modules/observability/`) next.

- [ ] **Step 3: commit the plan doc**

```bash
git add docs/superpowers/plans/2026-07-27-modular-step11-auth-audit-notifications-extraction.md
git commit -m "docs: add step 11 modular restructure plan"
```

---

## Self-Review

**Spec coverage:** every file under `auth/`, `plugins/jwt.ts`, `plugins/auth.ts`, `audit/`, `notifications/` (incl. `channels/`) is moved; every identified external consumer (`routes/api.ts`, `routes/api.test.ts`, `routes/api.sessions.test.ts`, `server.ts`, `llm/executor.ts`, `llm/executor.test.ts`, `reverse-proxy/lanes/openai.ts`) is repointed; both new tokens follow the exact `catalog`/`embeddings` precedent (single token per module, unregistered in `coreModules`).

**Placeholder scan:** none — every step shows exact before/after code or an exact shell command.

**Type consistency:** token method names (`logAudit`, `signToken`, `verifyToken`, `createSessionToken`, `generateRawToken`, `extractProjectToken`, `resolveProjectByToken`, `getEffectiveRoles`, `emitEvent`, `appendToInbox`, `dispatchNotification`, `sendTestNotification`) match the real exported names read from source in every task that uses them.

## Execution Handoff

Plan complete, saved to `docs/superpowers/plans/2026-07-27-modular-step11-auth-audit-notifications-extraction.md`. Executing directly via Bash/Edit (no subagent dispatch), consistent with Steps 5-10's established methodology for pre-specified extraction tasks, and per the overview's closed decision, the three task groups run sequentially in this same worktree.
