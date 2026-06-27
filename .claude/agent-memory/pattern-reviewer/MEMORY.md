# pattern-reviewer — Memory

Persistent notes for the `pattern-reviewer` agent (pre-merge: security, constraints, correctness, reuse, docs parity). One fact per entry. Append durable, non-obvious learnings here (recurring violations, reuse traps, wire-format edge cases); keep code structure and git history out (those live in the repo).

<!-- entries below -->

- [Trace observability PII-leak audit](project_trace_observability.md) — verify pii/guardrail trace entries leak only entity TYPES, never raw values; trace is out-of-band
- [Dashboard duplicated SSE + sort helpers](feedback_sse_buffer_reuse.md) — TestPage has TWO twin SSE loops (compare panel often untested); SortIcon/th duplicated across Usage+Models pages
