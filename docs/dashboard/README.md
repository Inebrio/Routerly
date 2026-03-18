# Dashboard

The Routerly dashboard is a React web application that provides a visual interface for managing
all aspects of your Routerly installation, models, projects, users, roles, and usage analytics.

---

## Accessing the Dashboard

The dashboard is served by the service at `/dashboard/` when `dashboardEnabled` is `true` in settings.

```
http://localhost:3000/dashboard/
```

To enable or disable it:

```bash
# Via CLI
routerly service configure --dashboard true

# Or edit ~/.routerly/config/settings.json
{ "dashboardEnabled": true }
```

---

## First Login

On a fresh installation, you need to create the first admin user before you can log in:

```bash
routerly user add --email admin@example.com --password your-secure-password
```

Then open `http://localhost:3000/dashboard/` and log in with those credentials.

> Session tokens expire after 24 hours. After expiry, you will be redirected to the login page.

---

## Navigation

The sidebar provides access to all sections:

| Section | Description |
|---------|-------------|
| **Overview** | Cost summary, timeline charts, usage breakdown by model |
| **Models** | Register and manage LLM providers |
| **Projects** | Create and configure projects |
| **Users** | Manage dashboard user accounts |
| **Roles** | Define RBAC roles and permissions |
| **Usage** | Detailed usage analytics with filtering |
| **Settings** | Service configuration and notifications |
| **Profile** | Current user information |

---

## Theme

The dashboard supports light, dark, and auto (system-preference) themes.
Switch via the theme toggle in the top-right corner.

---

## Building the Dashboard

The dashboard is pre-built and served from `packages/dashboard/dist/`. To rebuild after changes:

```bash
npm run build --workspace=packages/dashboard
# or:
cd packages/dashboard && npm run build
```

---

## Dashboard Documentation

- [Models](models.md): register, edit, and delete LLM models
- [Projects](projects.md): create projects, configure routing and budgets
- [Users & Roles](users-and-roles.md): manage access control
- [Usage Analytics](usage-analytics.md): explore cost and usage data
