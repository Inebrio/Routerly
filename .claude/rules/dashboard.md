---
globs: packages/dashboard/**
---

Working in `packages/dashboard/` — React 18 + Vite 6 SPA.

- TypeScript strict, no implicit `any`
- Functional components + hooks only — no class components
- No direct `localStorage` outside `api.ts` and `AuthContext.tsx`
- Use `ThemeContext` for dark/light — never hardcode colors
- All API calls through `api.ts`
- Shared types from `@routerly/shared` — never duplicate them
- Reuse existing components before creating new ones
- Build before browser-testing: `npm run build --workspace=packages/dashboard`
