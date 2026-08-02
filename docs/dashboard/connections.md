---
title: Connections
sidebar_position: 4
---

# Dashboard: Connections

The Connections page lets you register provider accounts (credentials) once
and reuse them across models. A **connection** holds the account (e.g. one
OpenAI API key, one Anthropic OAuth login) and its endpoint; a **model** binds
to a connection and adds its own upstream model ID, pricing, context window,
and capability overrides. Editing a connection changes routing for every model
bound to it, which is the whole point of the layer, see
[Models: Preconfigured vs. Custom connection](models.md#preconfigured-vs-custom-connection).

---

## Connections List

Navigate to `/dashboard/connections`.

### Connections List Columns

| Column | Description |
|--------|-------------|
| **Label** | Friendly name you gave the connection |
| **Provider** | Provider badge (e.g. `openai`, `anthropic-oauth`); a `custom` connection also shows the upstream provider name next to the badge |
| **Endpoint** | Base URL override, or a dash if using the provider default |
| **Status** | `Enabled` or `Disabled` |

Each row also has a **Models** button (opening the Models page filtered to
that connection, see [Models on a Connection](#models-on-a-connection)), and,
with `connections:manage`, **Edit** and **Remove** buttons.

With `connections:manage`, clicking anywhere else on a row opens the same
edit page the pencil icon does. Without it the row is inert, since there is
nothing to open.

Users without `connections:read` see a permission-denied empty state instead
of the list.

### Adding a Connection

Creating and editing a connection each live on their own dedicated page.
There is no inline row expander.

1. Click **+ Add Connection**. This navigates to `/dashboard/connections/new`.
2. Fill in the form:
   - **Provider** - select from the dropdown, populated from `GET /api/providers/descriptors`. Selecting a provider fills **Endpoint** with that provider's default address; providers with no fixed address (`custom`, Azure, Bedrock, Vertex) leave it empty
   - **Provider (upstream provider name)** - shown only when the provider is `custom`. Names the service the endpoint belongs to (e.g. `deepseek`); models created on this connection use it as their ID prefix, e.g. `deepseek/deepseek-r1`
   - **Label** - friendly name (e.g. "Primary OpenAI account")
   - **Endpoint** (optional) - override base URL, for custom/self-hosted deployments
   - **Enabled** - whether the connection is usable by routing
   - **Credentials** - typed fields, the same ones the model form shows for that provider (see [Credential Fields](#credential-fields))
3. Click **Create**. You are returned to the Connections list.

Secrets are never displayed once saved - the form only accepts new values, it
never pre-fills or echoes existing ones. Non-secret cloud settings (AWS region
and access key ID, the Azure resource/deployment/API version, the Vertex
project and location) are returned by the API and do pre-fill on edit.

### Credential Fields

The credential section is rendered by the provider, not by free-form key/value
rows: picking a provider swaps in exactly the fields that provider needs. It is
the same component the model form uses for a custom connection, so both forms
ask for the same things in the same order.

| Provider | Fields |
|----------|--------|
| API-key providers (`openai`, `anthropic`, `ollama`, `custom`, …) | **API Key / Token** (masked, with a show/hide toggle) |
| `anthropic-oauth` | **Subscription OAuth Token**, with instructions to generate it via `claude setup-token` |
| `openai-oauth` | **Auth file path** (blank means `~/.codex/auth.json`) plus a **Test** button that reports the account and token expiry |
| `openai-web`, `anthropic-web` | the session token for that provider, an optional **cf_clearance**, and an unofficial-provider warning |
| `azure-openai` | **Azure Resource Name**, **Deployment ID**, **API Version** |
| `bedrock` | **AWS Region**, **AWS Access Key ID**, **AWS Secret Access Key**, optional **Session Token** |
| `vertex` | **GCP Project ID**, **Location**, **Service Account Key** (JSON) |

**Endpoint URL** sits above them and is optional on a connection: leaving it
blank keeps the provider default. Routerly encrypts OAuth and web-session
credentials server-side on save and never returns them; see
[Connections: Credential encryption](../api/management.md#connections) for the
field mapping.

### Editing a Connection

Click a row (or its **Edit** pencil icon) to navigate to
`/dashboard/connections/:id/edit`, the same form used for creation, prefilled
with the connection's current **Provider**, **Label**, **Endpoint**, and
**Enabled** state. All fields are editable, including **Provider**.
Secret fields start blank; leave them blank to keep the existing stored
credentials unchanged, or type a new value to replace them (replacing the whole
credentials object, not a per-field merge).

:::note Change one, change all
Every model instance bound to a connection resolves its endpoint and
credentials from that connection at request time. Editing a connection's
endpoint or credentials here immediately changes routing for **every** model
instance bound to it. There is no per-model override of connection-level
settings. See [Models: Preconfigured vs. Custom connection](models.md#preconfigured-vs-custom-connection).
:::

### Removing a Connection

Click the **Remove** (trash) icon. You will be asked to confirm; the dialog
warns that instances bound to the connection will stop working - the API does
not cascade-delete instances when a connection is deleted.

### Connections Created from the Model Form

Registering or editing a model with **Custom** credentials (see
[Models: Preconfigured vs. Custom connection](models.md#preconfigured-vs-custom-connection))
does not bypass the connection layer. Routerly creates (or updates) a
dedicated, single-model connection for it with id `conn-for-<model-id>`
(labeled with the model's name), and it shows up here like any other
connection. Deleting that model also removes its dedicated connection,
provided no other instance references it.

---

## Models on a Connection

The **Models** button on a connection row opens
`/dashboard/models?connection=<id>`: the ordinary Models page with its
**Connection** filter already set to that connection. There is no separate
per-connection page, models are managed in one place whichever way you get
there.

From that filtered list, **+ Add Model** carries the filter into the form
(`/dashboard/models/new?connection=<id>`), so the new model is bound to the
same connection without picking it again. Pricing, context window, and
capabilities are set on the model, see [Models](models.md).
