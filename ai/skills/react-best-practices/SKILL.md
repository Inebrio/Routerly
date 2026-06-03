---
name: react-best-practices
description: "React performance and correctness guidelines for the Routerly dashboard (React 18, Vite 6, no Next.js, no SSR). Use when writing, reviewing, or refactoring components in packages/dashboard/ — especially around data fetching, re-render optimization, and bundle size."
---

# React Best Practices — Routerly Dashboard

Performance and correctness guidelines for `packages/dashboard/`.
Adapted from Vercel's React Best Practices guide. **No Next.js / no SSR** — all rules that reference RSC, Server Actions, or `next/*` APIs do not apply here.

---

## When to apply

- Writing new components or pages
- Implementing data fetching (`useEffect` + `src/api.ts`)
- Reviewing code for performance problems
- Refactoring existing components

---

## Priority categories

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Eliminating async waterfalls | CRITICAL |
| 2 | Bundle size | CRITICAL |
| 3 | Re-render optimization | HIGH |
| 4 | Rendering performance | MEDIUM |
| 5 | JavaScript performance | LOW–MEDIUM |

---

## 1. Eliminating async waterfalls (CRITICAL)

**Problem**: Sequential `await`s that could run in parallel.

```ts
// ❌ Waterfall — projects only load after models
const models   = await getModels();
const projects = await getProjects();

// ✅ Parallel — both kick off simultaneously
const [models, projects] = await Promise.all([getModels(), getProjects()]);
```

**In React effects**: start fetches early, don't nest them.

```ts
// ❌ Nested — projects wait for models
useEffect(() => {
  getModels().then(m => {
    setModels(m);
    getProjects().then(p => setProjects(p)); // unnecessary waterfall
  });
}, []);

// ✅ Parallel — as done in UsagePage.tsx
useEffect(() => {
  Promise.all([getModels(), getProjects()]).then(
    ([m, p]) => { setModels(m); setProjects(p); }
  );
}, []);
```

**Guard cheaply before fetching**:

```ts
// ✅ Don't fetch usage for an unselected project
if (!projectId) return;
const record = await getUsageRecord(projectId);
```

---

## 2. Bundle size (CRITICAL)

### Avoid barrel imports from lucide-react

Routerly already imports named icons from `'lucide-react'` (see `App.tsx`). Vite tree-shakes these correctly for this project — named imports are fine. Switch to deep imports only if a bundle analysis shows otherwise:

```ts
// ✅ Fine with Vite — already the project convention
import { LayoutDashboard, Cpu, FolderOpen, BarChart2 } from 'lucide-react';
```

### Lazy-load heavy pages

`App.tsx` currently eager-imports all pages. As the SPA grows, lazy-load infrequently-visited routes:

```ts
// In App.tsx — wrap in Suspense
const UsageRecordPage = lazy(() => import('./pages/UsageRecordPage.js'));
const RolesPage       = lazy(() => import('./pages/RolesPage.js'));

<Suspense fallback={<div className="skeleton" style={{ height: '100%' }} />}>
  <UsageRecordPage />
</Suspense>
```

### localStorage access — use `useFilterState`

Never read/write `localStorage` directly for filter preferences. Use the existing hook:

```ts
// ✅ Already how UsagePage, ProjectLogsTab, etc. work
const [projectIds, setProjectIds] = useFilterState<string[]>({
  key: 'usage-filters-projectIds',
  defaultValue: [],
});
```

For one-off non-filter state, access `localStorage` only in `useEffect` or lazy `useState` initialisers (never during render).

---

## 3. Re-render optimization (HIGH)

### Don't subscribe to state only used in callbacks

```ts
// ❌ Re-renders on every selectedModel change, but only needs it on submit
const [selectedModel, setSelectedModel] = useState<string>('');
const handleSubmit = () => sendRequest(selectedModel);

// ✅ Use a ref for transient playground/test state
const selectedModelRef = useRef(selectedModel);
useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
const handleSubmit = () => sendRequest(selectedModelRef.current);
```

### Hoist stable non-primitive defaults

```ts
// ❌ New array every render → MultiSelect child always re-renders
<MultiSelect value={[]} onChange={setModelIds} options={modelOptions} />

// ✅ Stable empty reference defined outside the component
const NO_MODELS: string[] = [];
<MultiSelect value={NO_MODELS} onChange={setModelIds} options={modelOptions} />
```

### Use primitive dependencies in effects

```ts
// ❌ dateRange object reference changes every render (from useFilterState)
useEffect(() => { fetchUsage(dateRange); }, [dateRange]);

// ✅ Extract the primitives that actually matter
useEffect(() => { fetchUsage({ from, to }); }, [from, to]);
```

### Use functional setState for callbacks

```ts
// ❌ Stale closure if 'count' captures old value
const increment = useCallback(() => setCount(count + 1), [count]);

// ✅ Functional form — stable callback
const increment = useCallback(() => setCount(c => c + 1), []);
```

### Lazy state initialisation

```ts
// ❌ parseSavedFilters() runs on every render
const [filters, setFilters] = useState(parseSavedFilters());

// ✅ Called only on mount
const [filters, setFilters] = useState(() => parseSavedFilters());
```

### Avoid memo for primitives

```ts
// ❌ Unnecessary
const label = useMemo(() => `${count} requests`, [count]);

// ✅ Plain derivation is fine
const label = `${count} requests`;
```

### startTransition for non-urgent updates

```ts
import { startTransition } from 'react';

// Filter the usage log without blocking the search input
const handleSearch = (q: string) => {
  setQuery(q); // urgent — update input immediately
  startTransition(() =>
    setFilteredRecords(records.filter(r => r.model.includes(q))) // deferrable
  );
};
```

### Don't define components inside components

```tsx
// ❌ New identity every render → unmounts/remounts
function UsagePage() {
  const FilterLabel = ({ children }: { children: React.ReactNode }) => (
    <span style={{ color: 'var(--text-muted)' }}>{children}</span>
  );
  return <FilterLabel>Model</FilterLabel>;
}

// ✅ Define at module level (the pattern already used in UsagePage.tsx)
function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase',
                   letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}
```

---

## 4. Rendering performance (MEDIUM)

### Use ternary, not `&&`, for conditionals

```tsx
// ❌ Renders "0" when count is 0
{count && <Badge>{count}</Badge>}

// ✅
{count ? <Badge>{count}</Badge> : null}
```

### content-visibility for long lists

```css
/* Applied to a list container with many rows */
.request-log-row {
  content-visibility: auto;
  contain-intrinsic-size: 0 48px; /* estimated row height */
}
```

### Hoist static JSX

```tsx
// ❌ React.createElement called every render
function Sidebar() {
  const logo = <Logo />;
  return <nav>{logo}…</nav>;
}

// ✅ Defined at module level
const LOGO = <Logo />;
function Sidebar() {
  return <nav>{LOGO}…</nav>;
}
```

---

## 5. JavaScript performance (LOW–MEDIUM)

### Build lookup maps for repeated access

```ts
// ❌ O(n) on every access
const getModel = (id: string) => models.find(m => m.id === id);

// ✅ O(1) after build
const modelMap = new Map(models.map(m => [m.id, m]));
const getModel = (id: string) => modelMap.get(id);
```

### Cache property access in hot loops

```ts
// ❌
for (let i = 0; i < data.requests.length; i++) { … }

// ✅
const { requests } = data;
const len = requests.length;
for (let i = 0; i < len; i++) { … }
```

### Use Set for membership checks

```ts
// ❌ O(n) every check
if (disabledProviders.includes(provider)) { … }

// ✅ O(1)
const disabledSet = new Set(disabledProviders);
if (disabledSet.has(provider)) { … }
```

### Early exit

```ts
// ✅ Avoid iterating when not needed
function hasOverBudgetProject(projects: Project[]) {
  for (const p of projects) {
    if (p.budgetUsed > p.budgetLimit) return true;
  }
  return false;
}
```

---

## Routerly-specific reminders

- **API calls** always via `src/api.ts` (`getModels`, `getProjects`, `getUsage`, `getUsers`, `getRoles`, `getSettings`, `getSystemInfo`, `getMe`, etc.) — never `fetch()` directly.
- **Auth** is fully handled inside `api.ts` (auto-refresh, Bearer header) — never touch `localStorage` auth keys in components.
- **Types** come from `src/api.ts` exports (`Model`, `Project`, `UsageRecord`, `UsageStats`, `User`, `Role`, `TraceEntry`, etc.) or from `@routerly/shared` for cross-package types.
- **Import extension**: `import type { SomeType } from '@routerly/shared/types.js'` — the `.js` extension is mandatory.
- **Persisted filters**: always via `useFilterState` — never raw `localStorage.getItem/setItem` for UI state.
- **Dirty forms**: always use `useUnsavedChanges(isDirty)` on any settings/config form (e.g., `SettingsPage`, `ModelFormPage`, `ProjectGeneralTab`).
- **Recharts**: wrap all charts in `<ResponsiveContainer width="100%" height={...}>` — never set a fixed pixel width.
