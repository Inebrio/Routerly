# Screenshot capture

Generates the dashboard screenshots used in `docs/assets/`. Starts a throwaway
Routerly service against fake fixture data in a temporary home directory,
blocks all outbound network access, logs in, and drives a headless Chromium
through Playwright to capture one PNG per entry in `manifest.json`.

## Prerequisites

- Node >= 20
- `npm install` from the repo root
- `npx playwright install chromium` (once per machine)
- The shared, service and dashboard packages built:
  `npm run build --workspace=packages/shared && npm run build --workspace=packages/service && npm run build --workspace=packages/dashboard`

If Chromium is not installed, the script exits `1` and prints the exact
install command above to stderr instead of a raw Playwright stack trace.

## Usage

Capture every shot in the manifest:

```
npm run screenshots
```

Capture a subset only, leaving every other file in `docs/assets/` untouched:

```
npm run screenshots -- --only screenshot-login,screenshot-overview
```

List every shot name without starting the service or the browser:

```
npm run screenshots -- --list
```

Exit code is `0` on full success, non-zero if any shot failed. A failed shot
never leaves a blank or partial PNG behind: the previous file (if any) is left
alone and the reason is printed to stderr, naming the shot. In particular, a
manifest entry whose `path` points at a route that no longer exists is
detected right after navigation (before any `steps` run) and reported as
such, rather than silently capturing whatever the app's catch-all redirect
landed on.

`ROUTERLY_SCREENSHOT_PORT` pins the port the throwaway service listens on.
Left unset, it defaults to `47816`. See "Why the output is reproducible"
below for why this needs to be fixed at all.

## Adding a new shot

Add an entry to `manifest.json` with:

- `name`: the screenshot's file name, without extension. The PNG is written
  to `docs/assets/<name>.png`.
- `path`: the dashboard route to navigate to, relative to the service's base
  URL (for example `/dashboard/overview`).
- `clip`: `"full"` for the whole scrollable page, `"viewport"` for the
  visible area only.
- `steps`: a list run in order before the shot is taken, each either
  `{ "click": "<selector>" }` or `{ "fill": "<selector>", "value": "<text>" }`.
  Use this to open a modal, switch a tab, or fill and submit a form before
  capturing.
- `waitFor` (optional): a selector to wait for, in addition to the default
  wait described below, before the screenshot is taken. Use it whenever the
  state you want to capture is not simply "the page finished loading": for
  example a modal that opens after a click, or a chat reply that only appears
  once the mock provider has answered.

No script changes are needed for a new shot: adding the manifest entry is
enough.

The script itself waits for the page's own `.spinner` loading indicator to
disappear and stay gone before it reads `waitFor` or takes the shot, not for
the network to go idle. Playwright's `networkidle` is a property of the last
navigation: once it has fired once it stays fired, so awaiting it again after
an in-page click returns immediately and proves nothing about whether the
click's own request has finished. The spinner is the page's own statement
that it is still loading, so waiting on it instead catches genuinely
in-flight data every time.

## Fixtures

Everything under `fixtures/` and `catalog-fixtures/` is fake data, written for
this purpose only: no real project name, connection endpoint, token,
password or credential may appear in a fixture or in a captured screenshot.
The one exception is the deliberately fixed TOTP secret and backup codes used
for the 2FA screenshots, which are capture-only values that were never valid
against a real account.

## Why the output is reproducible

Two runs of the same commit produce byte-identical screenshots. That comes
from several things working together, not from the fixed port alone:

- **Fixed port.** The throwaway service always listens on `47816` (or
  `ROUTERLY_SCREENSHOT_PORT`). The port shows up in the connection snippets on
  the project page, so a port that changed between runs would make those
  screenshots differ byte-for-byte even though nothing about the product had
  changed.
- **Fixture data, not live state.** Projects, connections, profiles,
  experiments and usage all come from the JSON files under `fixtures/`. Usage
  records are stored as `hoursAgo` and resolved to absolute timestamps right
  before the run, so the fixture never ages out of the dashboard's default
  "this month" filter.
- **No live network.** The browser context aborts every request that is not
  to `127.0.0.1` or `localhost`. The provider catalog page is served by a
  small local static server reading `catalog-fixtures/`, and the playground
  trace shot talks to a local mock LLM server that always returns the same
  fixed reply, so neither one depends on a real provider being reachable or
  a real model call returning something different each time.
- **Motion and rasterization disabled.** CSS animations and transitions are
  turned off before every shot, and Chromium is launched with
  `--disable-gpu --disable-partial-raster` so tiled GPU raster cannot redraw
  an edge's antialiasing slightly differently between two otherwise identical
  runs.
- **Capture mode.** Every URL the script navigates to carries
  `?routerlyCapture=1`. The dashboard checks this flag at the few points
  where it would otherwise render a value that is correct but not
  deterministic across runs, such as an uptime counter, a "last updated"
  clock, or a measured request timing, and suppresses it. No real user ever
  sets this parameter, so it can never change what a real user sees.
- **Spinner-based waiting, not network-idle.** See "Adding a new shot" above.

Framing (layout, viewport, element positions) is stable across two runs on
the same machine. Byte-identical output across different machines is not
guaranteed: font rendering varies by OS.

## Deciding what to regenerate

Everything above is fully sufficient on its own. A contributor with no Claude
access and no interest in the pieces below can always run `npm run
screenshots` to regenerate everything, or work out by hand which shots a
change affects and run `npm run screenshots -- --only <names>`. Nothing in
this section is a dependency of the capture script; it never calls the
capture script and the capture script never calls it. It is a convenience
layer that answers the "which shots" question for you, mechanically or with
judgement, so you do not have to read `manifest.json` and the diff yourself
every time.

### The selector

`scripts/screenshots-affected.mjs` reads a git diff, maps the changed paths
to shot names through `scripts/screenshots/impact.json`, and prints the
matching names to stdout, one per line:

```
npm run screenshots:affected -- --range <git-range>
```

The range defaults to `HEAD~1..HEAD` when `--range` is omitted. Output is
empty (and the exit code still `0`) when nothing is affected. The script
exits `1` with a message on stderr on an invalid range, or if
`impact.json` names a shot that `manifest.json` does not have.

`impact.json` is a committed, ordered list of glob rules mapping source
paths to manifest shot names, plus an `ignore` list for paths that never
invalidate a screenshot (tests, docs, non-dashboard packages). A changed
dashboard path that matches neither list selects every shot rather than
none: the default errs toward regenerating too much, never too little, so a
full run should be read as the tool being cautious, not as a bug.

The selector only prints names. It never invokes `npm run screenshots`
itself, so it keeps telling you the truth even if the capture script itself
is broken.

### The one-liner

The selector's output composes directly into the capture script's `--only`
flag:

```
npm run screenshots -- --only "$(npm run --silent screenshots:affected | paste -sd, -)"
```

This is the whole convenience layer in one command: figure out what changed
since the last commit, and regenerate only that. If the selector's output
is empty, the composed command is a no-op.

### The pre-push hook

`.husky/pre-push` runs the selector automatically, but only on `release/*`
branches, and only as a proposal: it prints the affected shots and the
one-liner above to act on them, and always exits `0`. It never blocks a
push, never captures a screenshot and never commits anything. On any other
branch it exits immediately and adds no delay.

### The review skill

`.claude/skills/screenshot-review/SKILL.md` is the judgement layer on top
of the selector, for changes a file-path map cannot decide on its own, such
as a shared component that reaches pages `impact.json` did not anticipate.
It runs the selector first, reads the actual diff, widens the list when the
change reaches further than the mechanical rules describe, never narrows it
below what the selector printed, and shows the final list to a person for
approval before running the capture. It reports a failing capture as a
failure, never as success, and leaves committing the result to the person.
