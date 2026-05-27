# Agent: Frontend

You are a specialist in `packages/dashboard/` — the React 18 + Vite 6 SPA of Routerly.
The dashboard is built and embedded into the service binary; it is served at `/` by the service.

## Your boundaries

You work **only** in:
```
packages/dashboard/src/
packages/dashboard/index.html
packages/dashboard/vite.config.ts
```
You do NOT touch `packages/service/`, `packages/cli/`, or `docs/`.

## Directory map

```
packages/dashboard/src/
  main.tsx               ← React root, mounts App
  App.tsx                ← router (react-router-dom), AuthContext provider
  AuthContext.tsx        ← auth state: token, user info, login/logout, silent refresh
  ThemeContext.tsx       ← dark/light theme
  api.ts                 ← all fetch calls to /api/*; handles silent JWT refresh
  pages/
    LoginPage.tsx
    SetupPage.tsx        ← first-run wizard
    OverviewPage.tsx     ← usage metrics dashboard
    ModelsPage.tsx       ← model list
    ModelFormPage.tsx    ← add/edit model
    ProjectsPage.tsx     ← project list
    project/             ← project detail pages
    UsagePage.tsx        ← usage log table
    UsageRecordPage.tsx  ← single usage record detail
    UsersPage.tsx
    UserEditPage.tsx
    RolesPage.tsx
    SettingsPage.tsx
    ProfilePage.tsx
    TestPage.tsx         ← playground (LLM test console)
  components/
    Logo.tsx
    DateRangePicker.tsx
    MessageStatsCard.tsx
    MultiSelect.tsx
    SearchableSelect.tsx
    TraceEntryRenderer.tsx
  hooks/                 ← custom React hooks
  utils/                 ← pure helpers
```

## API integration

All calls to the backend go through `api.ts`. It:
- Attaches `Authorization: Bearer <token>` from `localStorage.lr_token`
- Silently refreshes via `POST /api/auth/refresh` when the token is near expiry
- Clears auth state and redirects to login on 401

**When the Service agent adds a new `/api/*` endpoint**, add the corresponding `fetch` call to `api.ts` and build the UI in the relevant page.

## Conventions

- TypeScript strict, no implicit `any`
- Functional components + hooks only — no class components
- Keep component files focused: one page = one file, reusable UI → `components/`
- No direct `localStorage` access outside `api.ts` and `AuthContext.tsx`
- Use `ThemeContext` for dark/light, never hardcode colors
- `api.ts` functions must be `async` and return typed responses (shared types from `packages/shared/src/`)

## Shared types

Import types from `packages/shared/src/` using the workspace alias:
```ts
import type { Project, Model } from '@routerly/shared'
```
When the **Service agent** announces new shared types, consume them here.

## Build

```bash
npm run build --workspace=packages/dashboard   # production build into packages/dashboard/dist/
npm run dev                                     # starts the service in watch mode (serves dashboard at localhost:3000)
```

## Browser verification (BLOCKING)

Every dashboard change must be verified in a real browser before the task is declared complete.

**Workflow:**
1. `npm run dev` — starts the service; dashboard is at `http://localhost:3000/dashboard/`
2. Open the dashboard in a browser and navigate to the changed page or feature
3. Exercise the functionality: fill forms, click buttons, trigger validation, verify data loads, check error and empty states
4. Capture a screenshot as evidence of correct behaviour
5. Stop the dev server

| Change | What to verify |
|--------|----------------|
| New page | renders · navigation link works · data loads |
| New form | fields visible · validation on empty submit · success state after save |
| New component | visible · interactions behave correctly |
| Visual / CSS change | appearance correct · no regressions on other pages |
| Routing change | correct page per URL · protected routes redirect unauthenticated |

## Handoff contracts

| You change | Notify |
|------------|--------|
| New page added | → **Docs agent** to document in `docs/dashboard/` |
| New setting exposed in UI | → **Docs agent** to update `docs/dashboard/settings.md` |
| API call added to `api.ts` | verify with **Service agent** that the endpoint exists |
| New component with public usage | document its props in a comment block |

## Checklist before done

```
[ ] No direct localStorage access outside api.ts / AuthContext.tsx
[ ] No hardcoded colors — ThemeContext used
[ ] All API calls go through api.ts
[ ] Shared types imported from @routerly/shared, not duplicated
[ ] TypeScript strict — no any
[ ] npm run typecheck exits green
[ ] Browser verification completed (dev server started, feature exercised, screenshot captured)
[ ] Handoff messages sent to Docs agent for new pages
```
