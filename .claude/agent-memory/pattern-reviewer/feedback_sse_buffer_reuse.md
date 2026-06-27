---
name: dashboard-duplicated-sse-and-sort-helpers
description: Recurring duplication traps in the dashboard — twin SSE stream loops and per-page sort helpers
metadata:
  type: feedback
---

Two duplication traps recur in `packages/dashboard`:

**Why:** the same logic is copy-pasted across pages/loops, so a fix or a test lands in one copy and silently misses the sibling.

**How to apply:**
- `TestPage.tsx` has **two** SSE-consuming loops: `ComparePanel` (compare mode) and `handleSend` (main composer). They are near-identical (line-buffer + `processLine` + flush + `instanceof SyntaxError` catch). Any SSE fix or test must cover BOTH — the compare-panel loop is the one that habitually gets the fix but no test (verified 0/42 stmt coverage at review of release/0.3.0). Grep `buffer += decoder.decode` to count loops.
- `SortIcon`, the `SortDir` type, and the `th`/`thInner` sortable-header helper are duplicated verbatim in `UsagePage.tsx` and `ModelsPage.tsx`. When either table is touched, flag the duplication / suggest a shared `components/SortableTh`.
