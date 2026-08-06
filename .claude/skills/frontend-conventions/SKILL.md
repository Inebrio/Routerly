---
name: frontend-conventions
description: Rules for the dashboard SPA in this repository, including the visual bar a page must clear. Use when implementing anything a user sees.
---

# Frontend conventions

Binding detail lives in `.claude/rules/dashboard.md`. React 18, Vite 6,
TypeScript strict.

## Rules

- Functional components and hooks only. No implicit `any`.
- Every API call goes through `api.ts`. No `fetch` in a component.
- `localStorage` is touched only in `api.ts` and `AuthContext.tsx`.
- Colours come from `ThemeContext`. Never hardcode one: it breaks the other
  theme, and both themes ship.
- Types come from the shared package. Never duplicate one.
- Reuse an existing component before writing a new one. Look in
  `src/components/` first, every time.
- A dropdown is a `SearchableSelect`, never a native `select`. This is the
  standing default, not a question to ask.

## The visual bar

A page that works but looks broken is not done. Before you report done:

- Spacing and alignment match the pages next to it.
- Both themes render correctly. Check the one you did not develop in.
- Empty state is handled and says something useful.
- Loading state exists. Error state exists and shows the real message.
- Nothing overflows or reflows at a narrower viewport.

## Verify in a browser

Build first, then navigate:

```
npm run build --workspace=packages/dashboard
```

A page you have not opened is not verified. Open it, exercise the flow a
user would, read the console, and treat a console error as a failure even
when the screen looks right.
