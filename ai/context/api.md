# API reference

All endpoints exposed by the service. Base URL: `http://localhost:3000` (default).

---

## LLM proxy — `/v1/*`

Auth: `Authorization: Bearer <project-token>` (token in `projects.json`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | OpenAI Chat Completions proxy (streaming supported) |
| POST | `/v1/responses` | OpenAI Responses API proxy |
| POST | `/v1/messages` | Anthropic Messages proxy (streaming supported) |
| GET | `/v1/models` | List of models configured for the project |

Response headers added by Routerly:
- `x-routerly-trace-id` — unique ID for the routed request
- `x-routerly-model` — model actually used

---

## Management API — `/api/*`

Auth: `Authorization: Bearer <jwt>` (JWT issued by `POST /api/auth/login`).
Exception: `POST /api/auth/login` and `POST /api/auth/refresh` are unauthenticated.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with username + password, returns `{ token, refreshToken }` |
| POST | `/api/auth/refresh` | Exchange refresh token for new JWT |
| POST | `/api/auth/logout` | Invalidate refresh token |
| GET | `/api/auth/me` | Returns authenticated user info |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create a project |
| GET | `/api/projects/:id` | Get project by ID |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/:id/rotate-key` | Rotate the project Bearer token |

### Models

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/models` | List all configured models |
| POST | `/api/models` | Add a model |
| GET | `/api/models/:id` | Get model by ID |
| PUT | `/api/models/:id` | Update model |
| DELETE | `/api/models/:id` | Delete model |

### Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | List supported providers |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users (admin only) |
| POST | `/api/users` | Create a user (admin only) |
| GET | `/api/users/:id` | Get user by ID |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user (admin only) |
| PUT | `/api/users/:id/password` | Change password |

### Roles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/roles` | List all roles |
| POST | `/api/roles` | Create a custom role (admin only) |
| PUT | `/api/roles/:id` | Update role (admin only) |
| DELETE | `/api/roles/:id` | Delete role (admin only) |

### Usage / Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/usage` | Usage summary (supports `?projectId=`, `?from=`, `?to=`) |
| GET | `/api/usage/export` | Export usage as CSV |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update settings |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications/config` | Get notification config |
| PUT | `/api/notifications/config` | Update notification config |

---

## Health and misc

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | Returns `{ status: "ok" }` — used by Docker healthcheck |
| GET | `/dashboard/*` | none | Serves the React SPA |

---

## Error codes

| HTTP code | Meaning |
|-----------|---------|
| 400 | Validation error (Zod) |
| 401 | Missing or invalid Bearer token / JWT |
| 403 | Authenticated but insufficient permissions |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 503 | All model candidates failed or budget exhausted |

---

## Permission model

Permissions are defined in `roles.json`. Built-in roles:

| Role | Permissions |
|------|------------|
| `admin` | all (`*`) |
| `operator` | `project:read`, `project:write`, `model:read`, `model:write`, `report:read`, `user:read` |
| `viewer` | `project:read`, `model:read`, `report:read` |

Custom roles can be created via `POST /api/roles`.
