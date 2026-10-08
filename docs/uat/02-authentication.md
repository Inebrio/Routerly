# 02 - Authentication and 2FA

Login, session handling, accounts in the CLI and two-factor authentication on the dashboard, CLI and service.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-02-01 - Dashboard login with valid credentials
**Surfaces:** dashboard
**Preconditions:** Admin exists
**Steps:**
1. Open the login page, enter email and password.
**Expected:** Redirect to the Overview page; a wrong password shows an error and does not sign in.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-02 - Login error shape
**Surfaces:** service
**Preconditions:** Admin exists
**Steps:**
1. `curl -X POST /api/auth/login` with a wrong password, then a right one.
**Expected:** Wrong password returns a 4xx with a JSON error and no token; the right one returns tokens.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-03 - CLI login and whoami
**Surfaces:** cli
**Preconditions:** Admin exists
**Steps:**
1. `routerly auth login --url <url> --email <e> --password <p> --alias uat`.
2. `routerly auth whoami --json`.
**Expected:** Exit 0; whoami JSON contains the email, role and `language`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-04 - CLI accounts: ps, switch, rename, logout
**Surfaces:** cli
**Preconditions:** Two accounts logged in
**Steps:**
1. `routerly auth ps`, `routerly auth switch <alias>`, `routerly auth rename <old> <new>`, `routerly auth logout <alias>`.
**Expected:** Each command reflects the change in the next `ps`; the active account's `serverUrl` is the one used by later commands.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-05 - Silent token refresh
**Surfaces:** cli
**Preconditions:** Logged in; access token near or past expiry
**Steps:**
1. Wait for expiry (or edit `expiresAt` in the CLI store), run `routerly router list`.
2. `routerly auth refresh`.
**Expected:** The command succeeds without asking for a password.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-06 - Enable 2FA from the dashboard
**Surfaces:** dashboard
**Preconditions:** Logged-in user without 2FA, authenticator app
**Steps:**
1. Profile, enable 2FA, scan, confirm with a code.
2. Log out, log in again.
**Expected:** Login asks for the code and accepts a valid one; backup codes are shown once.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-07 - Login with a backup code
**Surfaces:** dashboard
**Preconditions:** User with 2FA and unused backup codes
**Steps:**
1. Log in, enter a backup code instead of a TOTP code.
2. Reuse the same backup code.
**Expected:** First use signs in; the second use is rejected.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-08 - Disable 2FA
**Surfaces:** dashboard, service
**Preconditions:** User with 2FA
**Steps:**
1. Disable 2FA with a valid code.
2. `POST /api/auth/2fa/verify` is no longer required at login.
**Expected:** Login no longer asks for a code.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-09 - Admin resets another user's 2FA
**Surfaces:** cli, dashboard
**Preconditions:** Second user with 2FA, admin session
**Steps:**
1. `routerly user 2fa status <email>`, `routerly user 2fa reset <email>`.
2. Dashboard: Users, same action.
**Expected:** Status flips from enabled to disabled; the user can log in without a code.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-02-10 - Require MFA for all users
**Surfaces:** cli, dashboard
**Preconditions:** Admin session
**Steps:**
1. `routerly service configure --require-mfa`.
2. Log in as a user without 2FA.
**Expected:** The user is forced to set up 2FA before using the dashboard; turning the setting off restores normal login.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
