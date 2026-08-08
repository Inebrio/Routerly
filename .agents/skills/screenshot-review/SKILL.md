---
name: screenshot-review
description: Judge which documentation screenshots a change actually invalidates, on top of the mechanical selector, and get a person's approval before regenerating any of them. Use when reviewing a diff that touches the dashboard before its screenshots are refreshed.
---

# Screenshot review

The mechanical layer, `scripts/screenshots-affected.mjs`, is the reproducible
base: same diff, same list, every time, no Codex required. This skill is the
judgement layer on top of it, for the cases a file-path map cannot decide. It
never replaces the selector and it never runs the capture on its own
authority.

## Steps, in order

1. **Run the selector first.**
   ```
   npm run screenshots:affected -- --range <range>
   ```
   `<range>` is whatever range is under review (a PR's range, a release
   branch's range since it diverged, or the default `HEAD~1..HEAD`). This is
   the mechanical proposal: one shot name per line, or nothing if the
   selector found no affected shot. Treat it as the floor of the final list,
   never as the ceiling.

2. **Read the actual diff for that range.** `git diff <range>` (or the
   equivalent for the surface under review). Do not judge from file names
   alone; read what changed.

3. **Widen when the diff reaches further than the map described.** A shared
   component, a layout wrapper, a route change, a style token that several
   pages consume, anything the mechanical rule in
   `scripts/screenshots/impact.json` did not anticipate: add the shots those
   pages own to the list. Never narrow the list below what the selector
   already printed. If you have a reason to think one of the selector's own
   names is not actually affected, say so explicitly in the summary shown to
   the person in step 4; do not drop it silently.

4. **Show the final list to a person before running anything.** State three
   things: what the selector proposed, what was added and why, and what (if
   anything) was kept despite looking possibly unnecessary and why it was
   kept anyway. Wait for that person's approval. This skill never proceeds
   past this point on its own judgement alone.

5. **Run the capture only after approval**, using the frozen composed
   command with the approved names, comma-separated:
   ```
   npm run screenshots -- --only <name>[,<name>...]
   ```
   Do not invent flags or behavior beyond this contract and the selector's
   `--range` flag; both are frozen elsewhere and this skill only calls them.

6. **Leave the commit to the person.** Any resulting change under
   `docs/assets/*.png` is committed and pushed by the person, not by this
   skill. This skill never commits and never pushes on its own authority.

7. **Report a failing capture as a failure.** If `npm run screenshots`
   exits non-zero, that is the outcome to report, verbatim (the reason it
   printed on stderr), never rounded up to success and never swallowed. A
   partial run is not a partial success; the capture script itself writes no
   partial file on failure, so there is nothing to salvage from it.
