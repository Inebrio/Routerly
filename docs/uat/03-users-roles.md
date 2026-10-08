# 03 - Users and roles

User and role management and permission enforcement across the three surfaces.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-03-01 - Create, list and remove a user
**Surfaces:** cli, dashboard, service
**Preconditions:** Admin session
**Steps:**
1. `routerly user add <email> --password-stdin --role <role>`.
2. `routerly user list --json`, dashboard Users page, `GET /api/users`.
3. `routerly user remove <email>`.
**Expected:** All three surfaces list the user; after removal none does; the removed user cannot log in.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-02 - Edit a user in the dashboard
**Surfaces:** dashboard
**Preconditions:** A user exists
**Steps:**
1. Users, open the user, change role and routers, save.
**Expected:** Changes persist after reload and are visible in `user list --json`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-03 - Create a custom role
**Surfaces:** cli, dashboard, service
**Preconditions:** Admin session
**Steps:**
1. `routerly role add <name> --permissions <p1,p2>`.
2. Dashboard Roles page, `GET /api/roles`.
**Expected:** The role appears with exactly the chosen permissions on all three surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-04 - Edit and remove a role
**Surfaces:** cli, dashboard
**Preconditions:** A custom role exists, unused
**Steps:**
1. `routerly role edit <id> --name ... --permissions ...`.
2. `routerly role remove <id>`.
**Expected:** Edit persists; remove succeeds for an unused role.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-05 - Removing a role in use is refused
**Surfaces:** cli, service
**Preconditions:** A role assigned to a user
**Steps:**
1. `routerly role remove <id>`; `DELETE /api/roles/:id`.
**Expected:** Both are rejected with a clear error and the role remains.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-06 - Forbidden without permission
**Surfaces:** service
**Preconditions:** User whose role lacks the permission for `POST /api/users`
**Steps:**
1. Call `POST /api/users` with that user's token.
**Expected:** HTTP 403; nothing is created.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-07 - Built-in role protection
**Surfaces:** service
**Preconditions:** Admin session
**Steps:**
1. Try `DELETE /api/roles/<built-in id>` and `PUT /api/roles/<built-in id>`.
**Expected:** Rejected; the built-in role is unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-03-08 - Router membership
**Surfaces:** cli, service
**Preconditions:** A user and a router
**Steps:**
1. `POST /api/routers/:id/members`, `PUT /api/routers/:id/members/:userId`, `DELETE ...`.
2. `routerly router member add|set-role|remove <router>`.
**Expected:** Membership list and member role follow each change on both surfaces; a non-member user does not see the router in `GET /api/routers`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
