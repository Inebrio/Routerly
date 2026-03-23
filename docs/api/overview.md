---
title: API Overview
sidebar_position: 1
---

# API Overview

Routerly exposes two groups of HTTP endpoints:

| Group | Path prefix | Auth method | Purpose |
|-------|-------------|-------------|---------|
| **LLM Proxy** | `/v1/*` | Bearer project token | Forward requests to LLM providers |
| **Management API** | `/api/*` | Bearer JWT (dashboard session) | Configure models, projects, users, etc. |

---

## Authentication

### LLM Proxy (`/v1/*`)

Pass your **project token** as a Bearer token:

```http
Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN
```

Project tokens start with `sk-lr-` and are created in the project's **Tokens** tab.

### Management API (`/api/*`)

First obtain a JWT by logging in:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 86400
}
```

Then pass the JWT as a Bearer token:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

JWTs expire after 24 hours. Re-authenticate to get a new token.

---

## Error Format

All errors return a JSON body:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

Common error codes:

| HTTP Status | `error` value | Meaning |
|-------------|--------------|---------|
| `400` | `validation_error` | Request body is invalid |
| `401` | `unauthorized` | Missing or invalid token |
| `403` | `forbidden` | Valid token but insufficient permissions |
| `404` | `not_found` | Resource does not exist |
| `409` | `conflict` | Duplicate resource (e.g. slug already taken) |
| `503` | `budget_exceeded` | Request blocked by a budget limit |
| `503` | `no_model_available` | All routing candidates filtered out |

---

## Request Tracing

Every proxied request includes the `x-routerly-trace-id` header in the response:

```
x-routerly-trace-id: 018f3c2a-4b5d-7e8f-9012-34567890abcd
```

Use this ID to look up the full request trace in the Usage page or via the [Usage API](./management.md#usage).

---

## Health Check

```
GET /health
```

Unauthenticated. Returns `200 OK` with:

```json
{ "status": "ok", "version": "1.2.3" }
```

Suitable for load-balancer health probes.
