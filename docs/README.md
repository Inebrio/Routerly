# Routerly Documentation

Welcome to the Routerly documentation. Routerly is a self-hosted LLM API gateway
that intelligently routes AI model requests across multiple providers with cost tracking and budget enforcement.

---

## The Three Components

Routerly is made of three components that work together:

| Component | Description | Docs |
|-----------|-------------|------|
| **Service** | The core proxy engine — handles authentication, routing, cost tracking, and provider communication | [docs/service/](service/README.md) |
| **Dashboard** | React web UI for visual management of models, projects, users and usage analytics | [docs/dashboard/](dashboard/README.md) |
| **CLI** | Command-line admin tool for scripting and terminal-based management | [docs/cli/](cli/README.md) |

---

## Getting Started

New to Routerly? Start here:

1. [Installation](getting-started/installation.md) — prerequisites, setup, secret key generation
2. [Quick Start](getting-started/quick-start.md) — register a model, create a project, make your first request
3. [Configuration](getting-started/configuration.md) — environment variables, config file structure, paths

---

## Documentation Index

### Service
- [Overview](service/README.md) — what the service does, how to start it
- [Architecture](service/architecture.md) — monorepo structure, request flow, component diagram
- [Routing Engine](service/routing.md) — policies, scoring, trace system
- [Providers](service/providers.md) — supported providers, adapters, default endpoints
- [Budgets & Limits](service/budgets-and-limits.md) — limit types, window modes, inheritance hierarchy
- [API Reference](service/api-reference.md) — HTTP endpoints with full request/response examples

### Dashboard
- [Overview](dashboard/README.md) — accessing the dashboard, login, navigation
- [Models](dashboard/models.md) — model registration and management
- [Projects](dashboard/projects.md) — project creation, configuration tabs, routing policies
- [Users & Roles](dashboard/users-and-roles.md) — RBAC, permissions, user management
- [Usage Analytics](dashboard/usage-analytics.md) — cost charts, usage filters, export

### CLI
- [Overview](cli/README.md) — installation, configuration, quick reference
- [Commands Reference](cli/commands.md) — all commands with options and examples

### Contributing
- [Development Guide](contributing/development.md) — monorepo setup, local dev, adding features

---

## Quick Navigation by Task

| I want to… | Go to |
|------------|-------|
| Start the service for the first time | [Quick Start](getting-started/quick-start.md) |
| Register an OpenAI / Anthropic model | [CLI: model add](cli/commands.md#model-add) |
| Create a project with budget limits | [CLI: project add](cli/commands.md#project-add) |
| Understand how routing decisions are made | [Routing Engine](service/routing.md) |
| Set a monthly spend cap | [Budgets & Limits](service/budgets-and-limits.md) |
| Manage users via browser | [Dashboard: Users & Roles](dashboard/users-and-roles.md) |
| Query usage / cost reports | [CLI: report](cli/commands.md#report) or [Dashboard: Usage Analytics](dashboard/usage-analytics.md) |
| Add a custom provider endpoint | [Providers](service/providers.md#custom-provider) |
| Contribute to the codebase | [Development Guide](contributing/development.md) |
