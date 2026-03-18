# Users & Roles

Routerly's dashboard uses role-based access control (RBAC). Users are dashboard accounts
(separate from project API tokens) and each user is assigned a role that defines what they can do.

---

## Users

### User List

Navigate to **Users** in the sidebar. The table shows:

- Email address
- Assigned role
- Projects the user can access

### Creating a User

Click **Add User**:

| Field | Description |
|-------|-------------|
| **Email** | Must be unique. Used as login identifier |
| **Password** | Set an initial password. The user can change it from their Profile page |
| **Role** | Assign one of the available roles |

New users can also be created via the CLI:

```bash
routerly user add --email user@example.com --password secret
```

### Editing a User

Click the **Edit** icon to change the user's email, role, or reset their password.

### Removing a User

Click **Delete**. The user loses access immediately. Associated project memberships are also removed.

---

## Roles

Roles define the set of permissions a user has across the system.

### Built-in Roles

Routerly ships with three built-in roles that cannot be modified:

| Role | Permissions |
|------|------------|
| `admin` | Full access: all permissions |
| `operator` | `project:read`, `project:write`, `model:read`, `model:write`, `report:read`, `user:read` |
| `viewer` | `project:read`, `model:read`, `report:read` (read-only) |

### Available Permissions

| Permission | Grants access to |
|------------|-----------------|
| `project:read` | View projects, tokens, members, routing config |
| `project:write` | Create, update, delete projects; manage tokens and members |
| `model:read` | View registered models and their configuration |
| `model:write` | Register, update, and delete models |
| `user:read` | View dashboard users |
| `user:write` | Create, update, and delete dashboard users |
| `report:read` | Access usage and cost reports |

### Custom Roles

Navigate to **Roles** → **Define Role** to create a custom role with a tailored permission set.

| Field | Description |
|-------|-------------|
| **Role ID** | Unique identifier (e.g. `billing-viewer`) |
| **Name** | Human-readable label |
| **Permissions** | Checkbox list of permissions to grant |

Custom roles appear in the role selector when creating or editing a user.

CLI equivalent:
```bash
routerly role define \
  --name "Billing Viewer" \
  --permissions "report:read,model:read"
```

---

## Project Membership Roles

In addition to the system-wide dashboard role, a user can have a **project-specific role** when added
to a project's members list (in the Project > Users tab):

| Project Role | Capabilities |
|-------------|-------------|
| `viewer` | Read-only access to that project's data |
| `editor` | Can modify routing config and model assignments |
| `admin` | Full access to that project including token management |

This allows finer-grained delegation: a user with a `viewer` system role can still be a project `admin`
for a specific project they own.

---

## See Also

- [CLI: user commands](../cli/commands.md#user) — manage users from the terminal
- [CLI: role commands](../cli/commands.md#role) — manage roles from the terminal
- [Projects: Users tab](projects.md#users) — managing project membership
