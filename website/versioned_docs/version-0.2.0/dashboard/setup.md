---
title: Setup
sidebar_position: 1
---

# Setup

The Setup screen appears the first time you open the Routerly dashboard at `http://localhost:3000/dashboard`. It guides you through creating the first admin account.

---

## First-Time Setup

1. Open `http://localhost:3000/dashboard` in your browser.
2. You will be redirected to the **Setup** page automatically if no admin account exists yet.
3. Enter an **email address** and a **password** for the admin account.
4. Click **Create Account**.

After account creation you are redirected to the login page. Log in with the credentials you just created.

---

## Setup API

The setup state can be checked programmatically:

```bash
# Check whether setup has been completed
GET /api/setup/status
```

Response when setup is not yet done:
```json
{ "configured": false }
```

Response after setup:
```json
{ "configured": true }
```

The first-admin endpoint is only available when `configured: false`:

```bash
POST /api/setup/first-admin
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "your-secure-password"
}
```

Once an admin account exists, this endpoint returns `403 Forbidden`.

---

## Subsequent Admin Accounts

After setup is complete, additional admin users can be created from **Users** in the dashboard sidebar. Only users with the `user:write` permission can create new users.

---

## Resetting the Admin Password

If you lose access to the admin account, stop the service and delete `~/.routerly/config/users.json`. On the next start, the setup page will be available again.

:::warning
Deleting `users.json` removes all dashboard users. API keys and project tokens are not affected.
:::
