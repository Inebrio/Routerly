---
globs: packages/dashboard/**
---

You are working in `packages/dashboard/` — the React 18 + Vite 6 SPA of Routerly.

Key reminders for this scope:
- TypeScript strict, no implicit `any`
- Functional components + hooks only — no class components
- No direct `localStorage` access outside `api.ts` and `AuthContext.tsx`
- Use `ThemeContext` for dark/light — never hardcode colors
- All API calls go through `api.ts`
- Shared types imported from `@routerly/shared` — never duplicated
- **Reuse before you create**: existing components, graphical patterns, and logic come first. Don't grow new components or invent new UX when something already in the SPA does the job. Nothing fits → ask before proliferating.
- **Browser verification is BLOCKING** — use the `verify` skill. Complete every checklist item in `.claude/rules/feature-verification.md` that applies. "It looks correct in the code" is not verification.
- Run `npm run typecheck` before declaring done
- Feature status vocabulary: use VERIFIED DONE / VERIFIED PARTIAL / VERIFIED BROKEN — never plain "done" without executed evidence
