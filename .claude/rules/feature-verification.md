# Feature Verification Protocol

**Every feature status claim requires executed evidence — not code inspection.**

This rule applies to all agents and the main thread. Reading source files is research, not verification.

**Test at the boundary, not the center.** The happy path (admin user, valid input, API responds 200, data loaded) hides every bug in error-handling, permission enforcement, and empty states. For each feature, identify the conditions that stress the failure paths and run those:

| What the feature touches | What to test at the boundary |
|---|---|
| Permissions / roles | Log in as a user with minimum required permissions. Verify allowed actions work AND forbidden ones return 403 with graceful UI (no crash, no infinite spinner, no blank). |
| Data loading | Test with zero records. The empty state must render — not a spinner, not a crash. |
| API error handling | Simulate failure (wrong token, missing required field, duplicate). The UI must show an error message — not a blank screen. |
| Form input | Submit empty form, submit malformed data. Validation errors must appear. |
| Auth state | Test unauthenticated (no token) and with an expired token. Must redirect to login, not crash. |

The center always works. The boundary is where the code is actually tested.

---

## Mandatory verification layers

Before declaring a feature done, blocked, or partially done, run every layer that applies to the feature scope.

**Browser is required for UI features only.** A service-only feature is proven by curl (exact status + body); a CLI-only feature by the command's stdout/stderr + exit code. The Chrome MCP screenshot is mandatory when (and only when) the feature changes the dashboard. Do not skip the screenshot for UI work; do not demand one for a pure API/CLI change.

### Service layer
Run actual HTTP requests against the running service (`localhost:3000`).
```bash
# Get an admin JWT first (credentials from CLAUDE.local.md)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<admin-password>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Then test the endpoint
curl -s -w "\nHTTP %{http_code}" http://localhost:3000/api/<endpoint> \
  -H "Authorization: Bearer $TOKEN"
```
Record: exact HTTP status code + response body for each case (happy path, auth missing, bad input).

### Permission features — mandatory low-privilege user test

Any feature that touches roles, permissions, or access control MUST include a test with a real user that has the minimum viable permissions. Admin testing alone is not sufficient — admin masks all permission bugs.

Steps:
1. Create a test user via API with only the permissions required by the feature
2. Log in as that user in the browser
3. Verify allowed actions work (correct HTTP 200, correct UI renders)
4. Verify forbidden actions are blocked (HTTP 403 from API, graceful UI — no crash, no spinner, no blank)
5. Delete the test user after verification

```bash
# Create minimal-permission user (credentials from CLAUDE.local.md)
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<admin-password>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Create role with minimum permissions
curl -s -X POST http://localhost:3000/api/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"test-role","name":"Test Role","permissions":["<only-needed-perms>"]}'

# Create user with that role
curl -s -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"testuser@test.local","password":"<test-password>","roleId":"test-role"}'
```

The 403 response is not enough — verify the UI handles it gracefully (shows error message, not blank screen, not crash, not infinite spinner).

### Dashboard layer
Use the **`verify` skill**. Do not navigate manually and describe what you expect — navigate and report what actually renders.

Checklist structure to complete before any status update:
```
[ ] Page loads without error (no console errors, no blank screen)
[ ] Data fetched from API renders correctly in the table/form/list
[ ] Create/edit form: fill fields, submit, confirm success message + list updates
[ ] Delete: confirm dialog appears, item removed from list after confirm
[ ] Validation errors: submit empty form, check error messages appear
[ ] Empty state: what renders when there is no data
[ ] Dark/light theme: no hardcoded colors visible
[ ] Collapsed sidebar: page still usable
```
Only check items relevant to the feature. Mark each [ ] with actual observed result, not "should work."

### CLI layer
Run the actual command against `localhost:3000` with `--json` flag where available.
```bash
routerly <command> [args] --json 2>&1
```
Record: exact exit code + stdout output. For errors: exact stderr message.

---

## Agents and skills to use

| Layer | Tool |
|-------|------|
| Dashboard browser | `verify` skill |
| Service API | Bash + curl |
| CLI commands | Bash + routerly CLI |
| Writing/extending tests + full verification matrix | `qa-manager` agent |

---

## What disqualifies a verification

- "The route exists in App.tsx" — not verified, just read
- "The endpoint is implemented in api.ts" — not verified, just read
- "The component renders X" (without running it) — not verified, just read
- Typecheck passes — necessary but not sufficient

---

## Feature status vocabulary

| Status | Meaning |
|--------|---------|
| `VERIFIED DONE` | All applicable layers executed, all checks passed |
| `VERIFIED PARTIAL` | Executed — some checks failed, list exactly which |
| `VERIFIED BROKEN` | Executed — feature does not work, describe exact failure |
| `NOT VERIFIED` | Code exists but not yet executed |

Never use "done" or "blocked" without the VERIFIED prefix unless you have executed evidence.
