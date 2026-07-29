---
title: Connections
sidebar_position: 4
---

# Dashboard: Connections

The Connections page lets you register provider accounts (credentials) and,
per connection, the model instances routable on top of it. This replaces
configuring a model's provider and credentials in one step: a **connection**
holds the account (e.g. one OpenAI API key, one Anthropic OAuth login), and a
**model instance** exposes one upstream model on top of that connection with
its own pricing, context window, and capability overrides.

---

## Connections List

Navigate to `/dashboard/connections`.

### Connections List Columns

| Column | Description |
|--------|-------------|
| **Label** | Friendly name you gave the connection |
| **Provider** | Provider badge (e.g. `openai`, `anthropic-oauth`) |
| **Endpoint** | Base URL override, or a dash if using the provider default |
| **Status** | `Enabled` or `Disabled` |

Each row also has an **Instances** button (linking to that connection's
[Model Instances](#model-instances) page), and, with `connections:manage`,
**Edit** and **Remove** buttons.

Users without `connections:read` see a permission-denied empty state instead
of the list.

### Adding a Connection

1. Click **+ Add Connection**
2. Fill in the form:
   - **Provider** — select from the dropdown, populated from `GET /api/providers/descriptors`
   - **Label** — friendly name (e.g. "Primary OpenAI account")
   - **Endpoint** (optional) — override base URL, for custom/self-hosted deployments
   - **Enabled** — whether the connection is usable by routing
   - **Credentials** — add one or more key/value rows. Field names are free-form text; the value input is masked (`type="password"`)
3. Click **Create**

Credentials are never displayed once saved — the form only accepts new
values, it never pre-fills or echoes existing ones.

:::note oauth/web providers
For providers whose type is OAuth- or web-session-based (e.g. `anthropic-oauth`,
`openai-web`), enter the plaintext credential under the conventional field name
the resolver expects — `oauthPlain` / `refreshPlain` for OAuth providers,
`cookiePlain` / `cfClearancePlain` for web-session providers. Routerly
encrypts these server-side on save and never returns them; see
[Connections: Credential encryption](../api/management.md#connections) for
the full field mapping. All other providers use a plain `apiKey` field, which
is stored as entered.
:::

### Editing a Connection

Click the **Edit** (pencil) icon on a row to open the same form inline below
it. All fields are editable, including **Provider**. Credential rows start
empty — leave them empty to keep the existing stored credentials unchanged,
or add rows to replace them (replacing the whole credentials object, not a
per-field merge).

### Removing a Connection

Click the **Remove** (trash) icon. You will be asked to confirm; the dialog
warns that instances bound to the connection will stop working — the API does
not cascade-delete instances when a connection is deleted.

---

## Model Instances

Click the **Instances** button on any connection row to open
`/dashboard/connections/:connectionId/instances`. This page lists (and lets
you add or remove) the model instances exposed on top of that one connection.

The page header shows the connection's label and provider badge, with a
back arrow to return to the Connections list.

### Model Instances List Columns

| Column | Description |
|--------|-------------|
| **Upstream Model ID** | The provider's model identifier, e.g. `gpt-5-mini` |
| **Input $/1M** | Input token price in USD |
| **Output $/1M** | Output token price in USD |
| **Cache $/1M** | Cache read price, or a dash if not set |
| **Context Size** | Maximum context window, e.g. `128k`, or a dash if not set |

With `connections:manage`, each row also has a **Remove** button.

### Adding an Instance Manually

1. Click **+ Add Instance**
2. Fill in **Upstream Model ID**, **Input $/1M**, **Output $/1M**, **Cache $/1M** (optional), and **Context Size**
3. Click **Create**

### Importing from the Catalog

Click **Import from catalog** to open an inline panel listing built-in
catalog entries filtered to the connection's provider. Each entry shows its
price and context window and an **Import** button, which creates an instance
pre-filled from the catalog entry (pricing and context window; you don't
enter them manually). Entries already imported (matched by upstream model ID)
show **Imported** instead and cannot be re-imported.

### Removing an Instance

Click the **Remove** (trash) icon next to an instance row. You will be asked
to confirm.
