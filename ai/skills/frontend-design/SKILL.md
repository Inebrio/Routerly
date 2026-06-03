---
name: frontend-design
description: "Create distinctive, production-grade UI for the Routerly dashboard. Use when the user asks to build, style, or redesign dashboard components, pages, or layouts. Generates visually coherent code that respects existing design tokens and avoids generic AI aesthetics."
---

# Frontend Design — Routerly Dashboard

Routerly's dashboard is a React 18 SPA (`packages/dashboard/`) built with Vite 6.
There is **no Tailwind**, **no shadcn/ui**, and **no CSS framework** — all styling uses
custom CSS with design tokens defined in `src/index.css`.

---

## Context before coding

Before writing any UI code:

1. **Read** `src/index.css` — all design tokens live there for both dark (default) and light themes.
2. **Read** the existing page or component you're editing.
3. **Check** `src/components/` for reusable primitives before inventing new ones.
4. **Check** `src/hooks/` — `useFilterState` and `useUnsavedChanges` cover the two most common patterns.

---

## Stack constraints

| Concern | Rule |
|---------|------|
| Routing | React Router v6 (`react-router-dom`) — `createBrowserRouter` already configured in `App.tsx` |
| Charts | Recharts only (`BarChart`, `LineChart`, `PieChart`, `ResponsiveContainer`, etc.) |
| Icons | Lucide React (`lucide-react`) only — same set already used across pages |
| Animations | Plain CSS `transition` / `@keyframes` — no Motion or Framer |
| State | React built-ins only — no Zustand, Jotai, Redux |
| Persisted filter state | `useFilterState` hook — backed by `localStorage`, serialises to JSON |
| Dirty-form protection | `useUnsavedChanges` hook — blocks navigation and warns on page refresh |
| Data fetching | Only via `src/api.ts` — never `fetch()` directly in a component |
| TypeScript | Strict; shared types come from `@routerly/shared`; `.js` extension on shared imports |
| Theme | `ThemeContext` + `data-theme` attribute on `<html>` — support both `dark` and `light` |

---

## Design token vocabulary

Use only these CSS variables — never hard-code colours or radii:

```
Backgrounds:  --bg-base  --bg-surface  --bg-elevated  --bg-glass  --bg-card
Borders:      --border   --border-focus
Text:         --text-primary  --text-secondary  --text-muted
Accent:       --accent  --accent-hover  --accent-glow
Status:       --success  --warning  --danger
Radii:        --radius  --radius-sm  --radius-lg
Gradients:    --brand-gradient  --brand-btn
```

---

## Design thinking

Before coding, commit to a clear direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Coherence**: New UI must feel part of the existing dark dashboard — never diverge wildly from established chrome.
- **Restraint**: The aesthetic is dark, refined, minimal. Avoid visual noise; use generous spacing, subtle glass effects, and precise borders.
- **Differentiation**: What will make this component or page memorable within context? A well-placed gradient, a thoughtful empty-state illustration, a smooth micro-interaction.

**What to avoid:**
- Generic purple-gradient cards on dark backgrounds
- Overloaded toolbars
- Hard-coded colours
- Shadow-heavy Material-style components
- Tables without search/sort when the dataset can grow

---

## Implementation checklist

- [ ] Only use design tokens — no raw hex values
- [ ] Lucide for all icons
- [ ] All interactive elements have `:hover`, `:focus-visible` states using `--border-focus` or `--accent`
- [ ] Accessible: semantic HTML, `aria-label` on icon-only buttons, keyboard navigation
- [ ] Mobile: layout does not break below 768px (sidebars collapse, tables scroll horizontally)
- [ ] No `any` casts unless unavoidable; prefer types from `@routerly/shared`
- [ ] TypeScript imports from shared packages use `.js` extension

---

## File organisation

| What | Where |
|------|-------|
| Reusable primitives | `src/components/` — `DateRangePicker`, `MultiSelect`, `SearchableSelect`, `MessageStatsCard`, `TraceEntryRenderer`, `Logo` |
| Page-level views | `src/pages/` — `OverviewPage`, `ModelsPage`, `ProjectsPage`, `UsagePage`, `UsageRecordPage`, `SettingsPage`, `UsersPage`, `RolesPage`, `ProfilePage`, `TestPage` |
| Project sub-tabs | `src/pages/project/` — `ProjectLayout`, `ProjectGeneralTab`, `ProjectRoutingTab`, `ProjectTokenTab`, `ProjectUsersTab`, `ProjectLogsTab` |
| Custom hooks | `src/hooks/` — `useFilterState`, `useUnsavedChanges` |
| API calls | `src/api.ts` — all management endpoints; never call `fetch()` elsewhere |
| Global CSS tokens | `src/index.css` — dark + light theme tokens |
| Auth context | `src/AuthContext.tsx` |
| Theme context | `src/ThemeContext.tsx` |

New components that will be used on ≥2 pages go in `src/components/`.
Single-use helpers stay co-located in the page file.

---

## Code patterns

### Glass card surface

```css
.my-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  backdrop-filter: blur(8px);
}
```

### Accent button

```css
.btn-primary {
  background: var(--brand-btn);
  color: #fff;
  border-radius: var(--radius-sm);
  padding: 0.5rem 1.25rem;
  font-weight: 600;
  transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.88; }
.btn-primary:focus-visible { outline: 2px solid var(--border-focus); }
```

### Subtle fade-in

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: fadeIn 0.2s ease-out; }
```

### Loading skeleton

```css
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--bg-glass)    50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}
```

---

## Typography

Match the size/weight conventions already used across pages (`UsagePage`, `OverviewPage`, etc.):

- Page headings: `font-size: 1.25rem; font-weight: 700; color: var(--text-primary)`
- Section labels: `font-size: 0.68–0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted)` (see `FilterLabel` in `UsagePage.tsx`)
- Body / table text: `font-size: 0.875rem; color: var(--text-secondary)`
- Inline code / model IDs: `font-family: monospace; font-size: 0.8rem; color: var(--text-primary)`

## Light theme

The dashboard supports a light theme via `data-theme="light"` on `<html>`, toggled by `ThemeContext`. Both themes are defined in `src/index.css` using overrides on `[data-theme="light"]`. Any new CSS must remain readable in both themes — test with both before shipping.

---

## Remember

> Bold and refined both work — the key is intentionality.
> Every pixel of the Routerly dashboard should feel like it belongs to a professional developer tool, not a generic SaaS template.
